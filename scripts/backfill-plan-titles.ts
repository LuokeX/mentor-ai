/**
 * 方案标题快照回填脚本（全量重算存量方案的 title / titleFull / attributionKeywords）。
 *
 * 背景：plan 列表与详情只投影生成时固化的标题快照。assistant_dialogue 标题
 * 改为带「AI问题：」前缀后（见 server/domain/plan-titles.ts），存量方案快照
 * 仍为旧格式，需要一次性重算回填，使新老方案展示一致——重算逻辑与
 * server/api/v1/assessments/[module]/submit.post.ts 的生成逻辑保持一致：
 * - 归因列表：report.planStructure.attribution.items，过滤 strength=reference；
 * - 归因描述：plan_assessment_attempts → assessment_attempts.result.attributions
 *   按 code 建立 description 映射（任一 attempt 有该 code 的描述即用）；
 * - assistant_dialogue 对象名：guardianId → guardians.name_enc，否则
 *   studentId → students.name_enc，AES 解密后取 guardianName || studentName；
 * - 标题：buildPlanTitle（moduleTitle 取 shared/assessments.ts 的 moduleMeta）；
 * - 关键词：buildAttributionKeywords。
 *
 * 用法：
 *   pnpm backfill:plan-titles --dry-run   # 只计算与打印报告，不写库（exit 0）
 *   pnpm backfill:plan-titles             # 实际回填；有失败时 exit(1)，已写入保留
 *
 * ⚠️ 安全警告：目标必须是测试库（port=5435, database=mentor_ai）。
 *    正式库（5433）与本地库（5434）不可写；脚本启动时校验连接串，
 *    port/database 不匹配立即 exit(1)。
 */
import { Pool } from 'pg'
import { loadLocalEnv } from './load-env'
import { decryptSensitive } from '../server/utils/crypto'
import { buildAttributionKeywords, buildPlanTitle, truncateByChars } from '../server/domain/plan-titles'
import type { PlanSourceType } from '../server/domain/plan-titles'
import { redactPii } from '../server/integrations/deepseek'
// #shared/assessments 别名在纯 node 脚本（tsx 直跑）中不可用，改用相对导入；
// moduleMeta 为纯数据导出（仅 type-only 依赖 contracts），无 Nuxt 运行时依赖。
import { moduleMeta } from '../shared/assessments'
import type { ModuleId } from '../shared/contracts'

loadLocalEnv()

const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required; copy .env.example to .env first')
const secret = process.env.ENCRYPTION_KEY || 'development-encryption-key-change-me'

const parsed = new URL(databaseUrl)
const host = parsed.hostname
const port = Number(parsed.port)
const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
process.stdout.write(`连接串解析：host=${host} port=${port} database=${database}\n`)
if (port !== 5435 || database !== 'mentor_ai') {
  if (process.env.BACKFILL_ALLOW_PRODUCTION === '1' && port === 5433 && database === 'mentor_ai') {
    process.stdout.write(`警告：目标为正式库（${host}:${port}/${database}），已通过 BACKFILL_ALLOW_PRODUCTION=1 显式放行；请确认这是一次经授权的正式发布。\n`)
  } else {
    process.stdout.write(
      `错误：目标必须是测试库（port=5435, database=mentor_ai），当前 port=${port} database=${database}；正式库(5433)需 BACKFILL_ALLOW_PRODUCTION=1 才可写。\n`
    )
    process.exit(1)
  }
}

const dryRun = process.argv.includes('--dry-run')
const pool = new Pool({ connectionString: databaseUrl })

interface PlanRow {
  id: string
  sourceType: string | null
  module: string
  title: string
  titleFull: string | null
  studentId: string | null
  guardianId: string | null
  sourceQuestionSummary: string | null
  sourceChatSessionId: string | null
  attributionKeywords: string[] | null
  report: Record<string, unknown> | null
}

interface AttributionItem {
  code: string
  name: string
  strength: string
}

/** 从 plan.report 防御式解析 planStructure.attribution.items（结构缺失返回空数组）。 */
function parseAttributionItems(report: unknown): AttributionItem[] {
  if (!report || typeof report !== 'object') return []
  const planStructure = (report as Record<string, unknown>).planStructure
  if (!planStructure || typeof planStructure !== 'object') return []
  const attribution = (planStructure as Record<string, unknown>).attribution
  if (!attribution || typeof attribution !== 'object') return []
  const items = (attribution as Record<string, unknown>).items
  if (!Array.isArray(items)) return []
  return items.filter((item): item is AttributionItem => {
    if (!item || typeof item !== 'object') return false
    const it = item as Record<string, unknown>
    return typeof it.code === 'string' && typeof it.name === 'string' && typeof it.strength === 'string'
  })
}

/** 该 plan 关联的全部评估结果中，按归因 code 建立首个非空 description 映射。 */
async function buildDescriptionMap(planId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const { rows } = await pool.query<{ result: unknown }>(
    `SELECT aa.result
       FROM plan_assessment_attempts paa
       JOIN assessment_attempts aa ON aa.id = paa.assessment_attempt_id
      WHERE paa.plan_id = $1`,
    [planId]
  )
  for (const row of rows) {
    if (!row.result || typeof row.result !== 'object') continue
    const attributions = (row.result as Record<string, unknown>).attributions
    if (!Array.isArray(attributions)) continue
    for (const attribution of attributions) {
      if (!attribution || typeof attribution !== 'object') continue
      const a = attribution as Record<string, unknown>
      if (typeof a.code !== 'string' || typeof a.description !== 'string') continue
      const description = a.description.trim()
      if (description && !map.has(a.code)) map.set(a.code, description)
    }
  }
  return map
}

/** AI 来源的问题摘要：优先取快照列，为空时从会话首条 user 消息重建（与详情页 sourceConversation 逻辑一致）。 */
async function resolveQuestionSummary(plan: PlanRow): Promise<string | null> {
  if (plan.sourceQuestionSummary) return plan.sourceQuestionSummary
  if (!plan.sourceChatSessionId) return null
  const { rows } = await pool.query<{ content_enc: string | null }>(
    `SELECT content_enc FROM chat_messages
      WHERE session_id = $1 AND role = 'user'
      ORDER BY created_at ASC LIMIT 1`,
    [plan.sourceChatSessionId]
  )
  const contentEnc = rows[0]?.content_enc
  if (!contentEnc) return null
  try {
    return truncateByChars(redactPii(decryptSensitive(contentEnc, secret)), 80)
  } catch {
    return null
  }
}

async function resolveObjectLabel(plan: PlanRow): Promise<string | undefined> {
  if (plan.guardianId) {
    const { rows } = await pool.query<{ name_enc: string | null }>(
      'SELECT name_enc FROM guardians WHERE id = $1', [plan.guardianId]
    )
    const nameEnc = rows[0]?.name_enc
    if (nameEnc) {
      const name = decryptSensitive(nameEnc, secret).trim()
      if (name) return name
    }
  } else if (plan.studentId) {
    const { rows } = await pool.query<{ name_enc: string | null }>(
      'SELECT name_enc FROM students WHERE id = $1', [plan.studentId]
    )
    const nameEnc = rows[0]?.name_enc
    if (nameEnc) {
      const name = decryptSensitive(nameEnc, secret).trim()
      if (name) return name
    }
  }
  return undefined
}

const { rows: plans } = await pool.query<PlanRow>(
  `SELECT id, source_type AS "sourceType", module, title, title_full AS "titleFull",
          student_id AS "studentId", guardian_id AS "guardianId",
          source_question_summary AS "sourceQuestionSummary",
          source_chat_session_id AS "sourceChatSessionId",
          attribution_keywords AS "attributionKeywords", report
     FROM plans
    ORDER BY id`
)

const stats = { total: plans.length, direct: 0, assistant: 0, changed: 0, unchanged: 0, failed: 0 }
const samples: Array<{ kind: 'assistant' | 'direct', id: string, module: string, oldTitle: string, newTitle: string }> = []
const failures: Array<{ id: string, reason: string }> = []
const updates: Array<{ id: string, title: string, titleFull: string, attributionKeywords: string[] }> = []

for (const plan of plans) {
  // sourceType 为空（存量异常数据）时与 buildPlanTitle 运行时分支一致，按直接评估处理
  const isAssistant = plan.sourceType === 'assistant_dialogue'
  const kind: 'assistant' | 'direct' = isAssistant ? 'assistant' : 'direct'
  if (isAssistant) stats.assistant += 1
  else stats.direct += 1
  try {
    const attributionItems = parseAttributionItems(plan.report)
      .filter((item) => item.strength !== 'reference')
    const attributionNames = attributionItems.map((item) => item.name)
    const descriptionMap = await buildDescriptionMap(plan.id)
    const attributionDescriptions = attributionItems.map((item) => descriptionMap.get(item.code) || item.name)

    const objectLabel = await resolveObjectLabel(plan)
    const questionSummary = await resolveQuestionSummary(plan)
    const meta = moduleMeta[plan.module as ModuleId]
    const moduleTitle = meta?.title ?? plan.module
    const sourceType: PlanSourceType = isAssistant ? 'assistant_dialogue' : 'direct_assessment'
    const { title, titleFull } = buildPlanTitle({
      sourceType,
      moduleTitle,
      objectLabel,
      questionSummary,
      attributionNames,
      attributionDescriptions
    })
    const keywords = buildAttributionKeywords(attributionNames)

    const oldKeywords = plan.attributionKeywords || []
    const oldTitleFull = plan.titleFull ?? plan.title
    const changed = plan.title !== title || oldTitleFull !== titleFull
      || JSON.stringify(oldKeywords) !== JSON.stringify(keywords)

    if (changed) {
      stats.changed += 1
      if (samples.filter((s) => s.kind === kind).length < 3) {
        samples.push({ kind, id: plan.id, module: plan.module, oldTitle: plan.title, newTitle: title })
      }
      updates.push({ id: plan.id, title, titleFull, attributionKeywords: keywords })
    } else {
      stats.unchanged += 1
    }
  } catch (error) {
    stats.failed += 1
    failures.push({ id: plan.id, reason: error instanceof Error ? error.message : String(error) })
  }
}

process.stdout.write(`\n=== 方案标题快照回填报告${dryRun ? '（dry-run，未写入）' : ''} ===\n`)
process.stdout.write(`目标库：${database}@${host}:${port}\n`)
process.stdout.write(`总方案：${stats.total}（direct_assessment：${stats.direct}，assistant_dialogue：${stats.assistant}）\n`)
process.stdout.write(`需变更：${stats.changed}，无需变更：${stats.unchanged}，处理失败：${stats.failed}\n`)
if (samples.length) {
  process.stdout.write('\n变更样例（每类来源最多 3 条，旧 → 新）：\n')
  for (const kind of ['assistant', 'direct'] as const) {
    const list = samples.filter((s) => s.kind === kind)
    if (!list.length) continue
    process.stdout.write(`\n[${kind === 'assistant' ? 'assistant_dialogue' : 'direct_assessment'}]\n`)
    for (const s of list) {
      process.stdout.write(`  - ${s.id}（module: ${s.module}）\n`)
      process.stdout.write(`    旧 title：${s.oldTitle}\n`)
      process.stdout.write(`    新 title：${s.newTitle}\n`)
    }
  }
}
if (failures.length) {
  process.stdout.write('\n处理失败的方案：\n')
  for (const f of failures) process.stdout.write(`  - ${f.id}：${f.reason}\n`)
}

if (dryRun) {
  await pool.end()
  process.exit(0)
}

for (const item of updates) {
  await pool.query(
    'UPDATE plans SET title = $1, title_full = $2, attribution_keywords = $3::jsonb WHERE id = $4',
    [item.title, item.titleFull, JSON.stringify(item.attributionKeywords), item.id]
  )
}
process.stdout.write(`\n已更新 ${updates.length} 条方案\n`)
await pool.end()

if (failures.length > 0) {
  process.stdout.write(`存在 ${failures.length} 条处理失败，已写入的保留；请检查上方失败明细后重跑。\n`)
  process.exit(1)
}
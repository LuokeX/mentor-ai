/**
 * 方案归因构成描述回填脚本。
 *
 * 背景：方案快照（plans.report.planStructure.attribution.items）只固化了
 * code/name/share/strength/evidenceCodes。详情页归因构成需要展示归因项的具体
 * 描述（三库 attributionItems.description）与命中的证据描述（三库 evidences
 * description）。2026-08 生成侧已改为快照时写入 description/reasons，本脚本
 * 用于回填存量方案：按归因 code / 证据 code 从该模块已发布的三库版本提取，
 * 补齐缺失的描述，保证新旧方案展示一致。
 *
 * 用法：
 *   pnpm backfill:plan-attributions --dry-run   # 只计算与打印报告，不写库（exit 0）
 *   pnpm backfill:plan-attributions             # 实际回填；有失败时 exit(1)，已写入保留
 *   pnpm backfill:plan-attributions --module=learning_problem   # 只处理指定模块
 *
 * ⚠️ 安全警告：目标必须是测试库（port=5435, database=mentor_ai）。
 *    正式库（5433）与本地库（5434）不可写；脚本启动时校验连接串，
 *    port/database 不匹配立即 exit(1)。
 */
import { Pool } from 'pg'
import { loadLocalEnv } from './load-env'

loadLocalEnv()

const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required; copy .env.example to .env first')

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
const moduleArg = process.argv.find((arg) => arg.startsWith('--module='))
const onlyModule = moduleArg ? moduleArg.slice('--module='.length) : null
const pool = new Pool({ connectionString: databaseUrl })

interface PlanRow {
  id: string
  module: string
  report: Record<string, unknown> | null
}

interface AttributionItemRow {
  code: string
  name: string
  strength: string
  evidenceCodes?: string[]
  description?: string
  reasons?: string[]
}

/** 从 plan.report 防御式解析 planStructure.attribution.items（结构缺失返回空数组）。 */
function parseAttributionItems(report: unknown): AttributionItemRow[] {
  if (!report || typeof report !== 'object') return []
  const planStructure = (report as Record<string, unknown>).planStructure
  if (!planStructure || typeof planStructure !== 'object') return []
  const attribution = (planStructure as Record<string, unknown>).attribution
  if (!attribution || typeof attribution !== 'object') return []
  const items = (attribution as Record<string, unknown>).items
  if (!Array.isArray(items)) return []
  return items.filter((item): item is AttributionItemRow => {
    if (!item || typeof item !== 'object') return false
    const it = item as Record<string, unknown>
    return typeof it.code === 'string' && typeof it.name === 'string' && typeof it.strength === 'string'
  })
}

/** 读取某模块已发布三库版本的归因项描述与证据描述映射。 */
async function loadLibraryMaps(module: string): Promise<{ itemDescription: Map<string, string>, evidenceDescription: Map<string, string> }> {
  const itemDescription = new Map<string, string>()
  const evidenceDescription = new Map<string, string>()
  const { rows } = await pool.query<{ payload: unknown }>(
    `SELECT v.payload
       FROM module_resource_versions v
       JOIN module_resource_libraries l ON l.id = v.library_id
      WHERE l.module = $1 AND l.library_type = 'attribution' AND v.status = 'published'
      ORDER BY v.published_at DESC
      LIMIT 1`,
    [module]
  )
  const payload = rows[0]?.payload
  if (!payload || typeof payload !== 'object') return { itemDescription, evidenceDescription }
  const p = payload as Record<string, unknown>
  const items = Array.isArray(p.attributionItems) ? p.attributionItems : []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    if (typeof it.code === 'string' && typeof it.description === 'string' && it.description.trim()) {
      itemDescription.set(it.code, it.description.trim())
    }
  }
  const evidences = Array.isArray(p.evidences) ? p.evidences : []
  for (const evidence of evidences) {
    if (!evidence || typeof evidence !== 'object') continue
    const e = evidence as Record<string, unknown>
    if (typeof e.evidenceCode === 'string' && typeof e.description === 'string' && e.description.trim()) {
      evidenceDescription.set(e.evidenceCode, e.description.trim())
    }
  }
  return { itemDescription, evidenceDescription }
}

/** 为方案补齐归因项描述与证据描述，返回变更后的 items 与是否变化。 */
function enrichItems(
  items: AttributionItemRow[],
  itemDescription: Map<string, string>,
  evidenceDescription: Map<string, string>
): { next: AttributionItemRow[], changed: boolean } {
  let changed = false
  const next = items.map((item) => {
    const enriched: AttributionItemRow = { ...item }
    if (!enriched.description) {
      const description = itemDescription.get(item.code)
      if (description) {
        enriched.description = description
        changed = true
      }
    }
    if (!enriched.reasons?.length) {
      const reasons = (item.evidenceCodes || [])
        .map((code) => evidenceDescription.get(code))
        .filter((value): value is string => Boolean(value))
      if (reasons.length) {
        enriched.reasons = reasons
        changed = true
      }
    }
    return enriched
  })
  return { next, changed }
}

const { rows: plans } = await pool.query<PlanRow>(
  `SELECT id, module, report FROM plans ORDER BY module, id`
)

const moduleCache = new Map<string, { itemDescription: Map<string, string>, evidenceDescription: Map<string, string> }>()
const stats = { total: 0, changed: 0, unchanged: 0, failed: 0, missingLibrary: 0 }
const samples: Array<{ id: string, module: string, name: string, description?: string, reasons?: string[] }> = []
const failures: Array<{ id: string, reason: string }> = []
const updates: Array<{ id: string, report: Record<string, unknown> }> = []

for (const plan of plans) {
  if (onlyModule && plan.module !== onlyModule) continue
  stats.total += 1
  try {
    const items = parseAttributionItems(plan.report)
    if (!items.length) {
      stats.unchanged += 1
      continue
    }
    if (!moduleCache.has(plan.module)) {
      moduleCache.set(plan.module, await loadLibraryMaps(plan.module))
    }
    const maps = moduleCache.get(plan.module)!
    const { next, changed } = enrichItems(items, maps.itemDescription, maps.evidenceDescription)
    if (!changed) {
      stats.unchanged += 1
      continue
    }
    stats.changed += 1
    if (samples.length < 5) {
      const first = next.find((item) => item.description || item.reasons?.length)
      if (first) samples.push({ id: plan.id, module: plan.module, name: first.name, description: first.description, reasons: first.reasons })
    }
    // 只替换 attribution.items，其余快照字段原样保留
    const report = structuredClone(plan.report || {})
    const planStructure = (report as Record<string, unknown>).planStructure as Record<string, unknown>
    const attribution = planStructure.attribution as Record<string, unknown>
    attribution.items = next
    updates.push({ id: plan.id, report })
  } catch (error) {
    stats.failed += 1
    failures.push({ id: plan.id, reason: error instanceof Error ? error.message : String(error) })
  }
}

process.stdout.write(`\n=== 方案归因描述回填报告${dryRun ? '（dry-run，未写入）' : ''} ===\n`)
process.stdout.write(`目标库：${database}@${host}:${port}\n`)
process.stdout.write(`扫描方案：${stats.total}（${onlyModule ? `仅模块 ${onlyModule}` : '全部模块'}）\n`)
process.stdout.write(`需回填：${stats.changed}，无需变更：${stats.unchanged}，处理失败：${stats.failed}\n`)
if (samples.length) {
  process.stdout.write('\n回填样例（最多 5 条）：\n')
  for (const s of samples) {
    process.stdout.write(`  - ${s.id}（module: ${s.module}）「${s.name}」\n`)
    if (s.description) process.stdout.write(`    描述：${s.description}\n`)
    if (s.reasons?.length) process.stdout.write(`    证据：${s.reasons.join('；')}\n`)
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
    'UPDATE plans SET report = $1::jsonb WHERE id = $2',
    [JSON.stringify(item.report), item.id]
  )
}
process.stdout.write(`\n已更新 ${updates.length} 条方案\n`)
await pool.end()

if (failures.length > 0) {
  process.stdout.write(`存在 ${failures.length} 条处理失败，已写入的保留；请检查上方失败明细后重跑。\n`)
  process.exit(1)
}
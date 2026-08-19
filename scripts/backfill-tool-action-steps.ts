/**
 * 工具动作步骤文本去重回填脚本。
 *
 * 背景：工具库发布版（4.5.0 起）的 structuredSteps「步骤说明」与「步骤标题」
 * 被填成相同文本，renderToolContent 旧实现输出「1. 分开冷静: 分开冷静」式
 * 重复行并固化进存量方案的 plan_actions.detail（及 plans.tools.content 快照）。
 * 渲染函数已改为说明与标题相同时省略冒号部分（server/domain/plan-actions.ts），
 * 本脚本对存量文本做同样的确定性清洗，使新老方案展示一致。
 *
 * 清洗规则（与 renderToolContent 保持一致，只处理匹配内容）：
 *   1. 形如「N. {标题}: {标题}」的步骤行 → 「N. {标题}」；其他行一律不动。
 *   2. 步骤行之间的空行（\n\n 或更多）→ 单换行（\n），使步骤列表紧凑。
 *
 * 用法：
 *   pnpm backfill:tool-action-steps --dry-run   # 只计算与打印报告，不写库（exit 0）
 *   pnpm backfill:tool-action-steps             # 实际回填；有失败时 exit(1)，已写入保留
 *
 * ⚠️ 安全警告：目标必须是测试库（port=5435, database=mentor_ai）。
 *    正式库（5433）需 BACKFILL_ALLOW_PRODUCTION=1 显式放行。
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
const pool = new Pool({ connectionString: databaseUrl })

/** 与 renderToolContent 一致的清理规则：步骤行「N. {x}: {x}」→「N. {x}」，步骤间空行折叠为单换行，其余行不动。 */
function cleanStepText(text: string): string {
  return normalizeStepGaps(text).split('\n').map((line) => {
    const match = line.match(/^(\d+\.\s+)(.+?):\s*(.+)$/)
    if (match && match[2].trim() === match[3].trim()) return `${match[1]}${match[2]}`
    return line
  }).join('\n')
}

const stats = { actions: 0, actionChanged: 0, plans: 0, planChanged: 0, actionSnapshots: 0, actionSnapshotChanged: 0, dupGroups: 0, dupDelete: 0, failed: 0 }
const samples: Array<{ kind: 'action' | 'plan', id: string, oldLine: string, newLine: string }> = []
const failures: Array<{ kind: 'action' | 'plan', id: string, reason: string }> = []

/** 步骤行之间的空行折叠为单换行（旧渲染用 \n\n 产生空行，视觉拖沓且与外层标题混淆）。 */
function normalizeStepGaps(text: string): string {
  return text.replace(/\n\n+(?=\d+\.\s)/g, '\n')
}

/** 返回去重/折叠后的文本与第一处实际变化的行（old/new），无变化时返回 null。 */
function dedupeWithSample(text: string): { cleaned: string, oldLine: string, newLine: string } | null {
  const normalized = normalizeStepGaps(text)
  let firstChange: { oldLine: string, newLine: string } | null = null
  const cleaned = normalized.split('\n').map((line) => {
    const match = line.match(/^(\d+\.\s+)(.+?):\s*(.+)$/)
    if (match && match[2].trim() === match[3].trim()) {
      if (!firstChange) firstChange = { oldLine: line, newLine: `${match[1]}${match[2]}` }
      return `${match[1]}${match[2]}`
    }
    return line
  }).join('\n')
  if (!firstChange && normalized !== text) {
    const gap = text.match(/\n\n+(?=\d+\.\s)/)
    if (gap && gap.index !== undefined) {
      const stepLine = text.slice(gap.index).split('\n').find((l) => /^\d+\.\s/.test(l)) || ''
      firstChange = { oldLine: '步骤间空行', newLine: stepLine }
    }
  }
  return firstChange ? { cleaned, ...firstChange } : null
}

/** plan_actions：工具动作的 detail 文本去重 */
const { rows: actionRows } = await pool.query<{ id: string, detail: string }>(
  `SELECT id, detail FROM plan_actions WHERE title LIKE '使用工具「%' ORDER BY created_at`
)
stats.actions = actionRows.length
const actionUpdates: Array<{ id: string, detail: string }> = []
for (const row of actionRows) {
  const result = dedupeWithSample(row.detail)
  if (!result) continue
  stats.actionChanged += 1
  if (samples.filter((s) => s.kind === 'action').length < 3) {
    samples.push({ kind: 'action', id: row.id, oldLine: result.oldLine, newLine: result.newLine })
  }
  actionUpdates.push({ id: row.id, detail: result.cleaned })
}

/** plans.tools：快照里每个工具的 content 字段去重 */
const { rows: planRows } = await pool.query<{ id: string, tools: unknown }>(
  `SELECT id, tools FROM plans WHERE tools IS NOT NULL AND jsonb_typeof(tools) = 'array' ORDER BY created_at`
)
stats.plans = planRows.length
const planUpdates: Array<{ id: string, tools: unknown }> = []
for (const row of planRows) {
  const tools = row.tools as Array<Record<string, unknown>>
  let changed = false
  const next = tools.map((tool) => {
    if (typeof tool.content !== 'string') return tool
    const cleaned = cleanStepText(tool.content)
    if (cleaned === tool.content) return tool
    changed = true
    return { ...tool, content: cleaned }
  })
  if (!changed) continue
  stats.planChanged += 1
  if (samples.filter((s) => s.kind === 'plan').length < 3) {
    let sample: { oldLine: string, newLine: string } | null = null
    for (let i = 0; i < tools.length && !sample; i++) {
      const oldContent = tools[i]?.content
      const newContent = next[i]?.content
      if (typeof oldContent === 'string' && typeof newContent === 'string' && oldContent !== newContent) {
        const oldLines = oldContent.split('\n')
        const newLines = newContent.split('\n')
        for (let j = 0; j < oldLines.length; j++) {
          if (oldLines[j] !== newLines[j]) {
            sample = { oldLine: oldLines[j] || '', newLine: newLines[j] || '' }
            break
          }
        }
      }
    }
    if (sample) samples.push({ kind: 'plan', id: row.id, ...sample })
  }
  planUpdates.push({ id: row.id, tools: next })
}

/** plans.actions：旧 JSON 快照里动作 detail 去重（懒迁移会用它重建 plan_actions，不同步会重复插入旧文本） */
const { rows: actionSnapshotRows } = await pool.query<{ id: string, actions: unknown }>(
  `SELECT id, actions FROM plans WHERE actions IS NOT NULL AND jsonb_typeof(actions) = 'array' ORDER BY created_at`
)
stats.actionSnapshots = actionSnapshotRows.length
const actionSnapshotUpdates: Array<{ id: string, actions: unknown }> = []
for (const row of actionSnapshotRows) {
  const actions = row.actions as Array<Record<string, unknown>>
  let changed = false
  const next = actions.map((action) => {
    if (typeof action.detail !== 'string') return action
    const cleaned = cleanStepText(action.detail)
    if (cleaned === action.detail) return action
    changed = true
    return { ...action, detail: cleaned }
  })
  if (!changed) continue
  stats.actionSnapshotChanged += 1
  actionSnapshotUpdates.push({ id: row.id, actions: next })
}

/**
 * 重复工具动作清理：懒迁移曾把 plans.actions 快照的旧文本工具动作与 plan_actions
 * 已清洗记录判重失败而重复插入。按 (plan_id, title) 分组，保留 detail 已去重的一条
 * （无重复模式优先，其次 sequence 最小），删除其余；有执行证据引用的不删并告警。
 */
function hasDuplicateLines(text: string): boolean {
  return text.split('\n').some((line) => {
    const m = line.match(/^(\d+\.\s+)(.+?):\s*(.+)$/)
    return Boolean(m && m[2].trim() === m[3].trim())
  })
}

const { rows: dupRows } = await pool.query<{ id: string, planId: string, title: string, detail: string, sequence: number }>(
  `SELECT pa.id, pa.plan_id AS "planId", pa.title, pa.detail, pa.sequence
     FROM plan_actions pa
     JOIN (SELECT plan_id, title FROM plan_actions
            WHERE title LIKE '使用工具「%' GROUP BY plan_id, title HAVING count(*) > 1) d
       ON d.plan_id = pa.plan_id AND d.title = pa.title
    ORDER BY pa.plan_id, pa.title, pa.sequence`
)
const dupGroups = new Map<string, Array<{ id: string, detail: string, sequence: number }>>()
for (const row of dupRows) {
  const key = `${row.planId}\u0000${row.title}`
  if (!dupGroups.has(key)) dupGroups.set(key, [])
  dupGroups.get(key)!.push({ id: row.id, detail: row.detail, sequence: row.sequence })
}
stats.dupGroups = dupGroups.size
const dupDelete: Array<{ id: string }> = []
for (const actions of dupGroups.values()) {
  const clean = actions.filter((a) => !hasDuplicateLines(a.detail))
  const keep = (clean[0] || actions[0])!
  for (const a of actions) if (a.id !== keep.id) dupDelete.push({ id: a.id })
}
stats.dupDelete = dupDelete.length
if (dupDelete.length) {
  const { rows: evRows } = await pool.query<{ actionId: string }>(
    `SELECT DISTINCT action_id AS "actionId" FROM plan_action_evidence WHERE action_id = ANY($1::uuid[])`,
    [dupDelete.map((d) => d.id)]
  )
  const protectedIds = new Set(evRows.map((r) => r.actionId))
  const protectedActions = dupDelete.filter((d) => protectedIds.has(d.id))
  for (const p of protectedActions) {
    failures.push({ kind: 'action', id: p.id, reason: '有执行证据引用，跳过删除（需人工处理）' })
  }
  stats.failed += protectedActions.length
  const keep = new Set(dupDelete.filter((d) => !protectedIds.has(d.id)).map((d) => d.id))
  dupDelete.length = 0
  for (const id of keep) dupDelete.push({ id })
  stats.dupDelete = dupDelete.length
}

process.stdout.write(`\n=== 工具动作步骤去重回填报告${dryRun ? '（dry-run，未写入）' : ''} ===\n`)
process.stdout.write(`目标库：${database}@${host}:${port}\n`)
process.stdout.write(`工具动作：${stats.actions} 条，需去重：${stats.actionChanged}\n`)
process.stdout.write(`含工具快照方案：${stats.plans} 个，需去重：${stats.planChanged}\n`)
process.stdout.write(`含动作快照方案：${stats.actionSnapshots} 个，需去重：${stats.actionSnapshotChanged}\n`)
process.stdout.write(`重复工具动作分组：${stats.dupGroups} 组，待删除：${stats.dupDelete}\n`)
process.stdout.write(`处理失败：${stats.failed}\n`)
if (samples.length) {
  process.stdout.write('\n变更样例（最多各 3 条，旧 → 新，取首个变化的行）：\n')
  for (const s of samples) {
    process.stdout.write(`  - [${s.kind}] ${s.id}\n`)
    process.stdout.write(`    旧：${s.oldLine}\n`)
    process.stdout.write(`    新：${s.newLine}\n`)
  }
}
if (failures.length) {
  process.stdout.write('\n处理失败明细：\n')
  for (const f of failures) process.stdout.write(`  - [${f.kind}] ${f.id}：${f.reason}\n`)
}

if (dryRun) {
  await pool.end()
  process.exit(0)
}

for (const item of actionUpdates) {
  await pool.query('UPDATE plan_actions SET detail = $1, updated_at = now() WHERE id = $2', [item.detail, item.id])
}
for (const item of planUpdates) {
  await pool.query('UPDATE plans SET tools = $1::jsonb WHERE id = $2', [JSON.stringify(item.tools), item.id])
}
for (const item of actionSnapshotUpdates) {
  await pool.query('UPDATE plans SET actions = $1::jsonb WHERE id = $2', [JSON.stringify(item.actions), item.id])
}
for (const item of dupDelete) {
  await pool.query('DELETE FROM plan_actions WHERE id = $1', [item.id])
}
process.stdout.write(
  `\n已更新 ${actionUpdates.length} 条工具动作、${planUpdates.length} 个工具快照、${actionSnapshotUpdates.length} 个动作快照，删除 ${dupDelete.length} 条重复动作\n`
)
await pool.end()

if (failures.length > 0) {
  process.stdout.write(`存在 ${failures.length} 条处理失败，已写入的保留；请检查上方失败明细后重跑。\n`)
  process.exit(1)
}
/**
 * 会话标题回填脚本：按新规则重算存量 chat_sessions.title。
 *
 * 新规则（见 server/domain/chat-titles.ts）：标题取自用户消息序列——
 * 每条消息脱敏后取首句，优先首条消息首句，首句过短（寒暄）时拼接
 * 下一条消息首句；统一断句、截断并追加省略号。
 *
 * 用法：
 *   pnpm backfill:chat-titles --dry-run   # 只计算与打印报告，不写库（exit 0）
 *   pnpm backfill:chat-titles             # 实际回填；有失败时 exit(1)，已写入保留
 *
 * ⚠️ 安全警告：目标必须是测试库（port=5435, database=mentor_ai）。
 *    正式库（5433）与本地库（5434）不可写；脚本启动时校验连接串。
 */
import { Pool } from 'pg'
import { loadLocalEnv } from './load-env'
import { decryptSensitive } from '../server/utils/crypto'
import { buildChatTitle } from '../server/domain/chat-titles'

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

interface SessionRow {
  id: string
  title: string
  userMessagesEnc: string[]
}

const { rows: sessions } = await pool.query<SessionRow>(
  `SELECT s.id,
          s.title,
          COALESCE((
            SELECT jsonb_agg(cm.content_enc ORDER BY cm.created_at ASC)
              FROM chat_messages cm
             WHERE cm.session_id = s.id AND cm.role = 'user'
          ), '[]'::jsonb) AS "userMessagesEnc"
     FROM chat_sessions s
    ORDER BY s.created_at`
)

const stats = { total: sessions.length, changed: 0, unchanged: 0, failed: 0 }
const samples: Array<{ id: string, oldTitle: string, newTitle: string }> = []
const failures: Array<{ id: string, reason: string }> = []
const updates: Array<{ id: string, title: string }> = []

for (const session of sessions) {
  try {
    const messages = (session.userMessagesEnc || [])
      .map((enc) => {
        try {
          return decryptSensitive(enc, secret)
        } catch {
          return ''
        }
      })
      .filter(Boolean)
    const title = buildChatTitle({ messages })
    if (title !== session.title) {
      stats.changed += 1
      if (samples.length < 5) {
        samples.push({ id: session.id, oldTitle: session.title, newTitle: title })
      }
      updates.push({ id: session.id, title })
    } else {
      stats.unchanged += 1
    }
  } catch (error) {
    stats.failed += 1
    failures.push({ id: session.id, reason: error instanceof Error ? error.message : String(error) })
  }
}

process.stdout.write(`\n=== 会话标题回填报告${dryRun ? '（dry-run，未写入）' : ''} ===\n`)
process.stdout.write(`目标库：${database}@${host}:${port}\n`)
process.stdout.write(`总会话：${stats.total}，需变更：${stats.changed}，无需变更：${stats.unchanged}，处理失败：${stats.failed}\n`)
if (samples.length) {
  process.stdout.write('\n变更样例（最多 5 条，旧 → 新）：\n')
  for (const s of samples) {
    process.stdout.write(`  - ${s.id}\n`)
    process.stdout.write(`    旧 title：${s.oldTitle}\n`)
    process.stdout.write(`    新 title：${s.newTitle}\n`)
  }
}
if (failures.length) {
  process.stdout.write('\n处理失败的会话：\n')
  for (const f of failures) process.stdout.write(`  - ${f.id}：${f.reason}\n`)
}

if (dryRun) {
  await pool.end()
  process.exit(0)
}

for (const item of updates) {
  await pool.query('UPDATE chat_sessions SET title = $1 WHERE id = $2', [item.title, item.id])
}
process.stdout.write(`\n已更新 ${updates.length} 条会话标题\n`)
await pool.end()

if (failures.length > 0) {
  process.stdout.write(`存在 ${failures.length} 条处理失败，已写入的保留；请检查上方失败明细后重跑。\n`)
  process.exit(1)
}
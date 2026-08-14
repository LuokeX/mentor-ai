import { Pool } from 'pg'
import { loadLocalEnv } from './load-env'
import { decryptSensitive } from '../server/utils/crypto'

/**
 * 手机号登录迁移回填脚本（0030/0031 之后执行，幂等，可在 0032 前后运行）。
 *
 * drizzle 迁移器为全量执行（0030-0032 一次跑完），而 users.phone 的回填依赖
 * 应用层 AES 解密，无法放在静态 SQL 中。因此：
 * - 0030 加列、0031 删 email 与索引（invitations 的 phone 在 0031 内用 SQL 回填）；
 * - 0032 置空（见 drizzle/0032_yummy_iceman.sql 说明）；
 * - 本脚本负责：解密回填 users.phone → 补 NOT NULL → 删除 phone_enc。
 *
 * 职责：
 * 1. 将 users.phone_enc（AES 密文档案手机号）解密回填到 users.phone；
 * 2. 报告无法回填的账号（无密文或解密失败），需管理员补录；
 * 3. 报告 0031 迁移中置为空串占位的 pending 邀请（需管理员重发）；
 * 4. 回填校验通过后补充 users.phone NOT NULL 约束并删除 phone_enc 列。
 *
 * 用法：
 *   pnpm tsx scripts/backfill-phone.ts --dry-run   # 预览
 *   pnpm tsx scripts/backfill-phone.ts             # 实际执行
 * 幂等：只处理 phone 为空的账号；phone_enc 已删除时仅做约束收尾。
 */
loadLocalEnv()

const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required; copy .env.example to .env first')
const secret = process.env.NUXT_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY
if (!secret) throw new Error('NUXT_ENCRYPTION_KEY / ENCRYPTION_KEY is required for phone backfill')

const dryRun = process.argv.includes('--dry-run')
const pool = new Pool({ connectionString: databaseUrl })

const PHONE_PATTERN = /^1[3-9]\d{9}$/

async function columnExists(table: string, column: string) {
  const { rows } = await pool.query(
    'SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2',
    [table, column]
  )
  return rows.length > 0
}

async function notNullApplied() {
  const { rows } = await pool.query(
    `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'phone'`
  )
  return rows[0]?.is_nullable === 'NO'
}

const [hasPhone, hasPhoneEnc, hasEmail] = await Promise.all([
  columnExists('users', 'phone'),
  columnExists('users', 'phone_enc'),
  columnExists('users', 'email')
])
if (!hasPhone) throw new Error('users.phone 列不存在：请先执行 db:migrate（0030/0031）')
if (hasEmail) throw new Error('users.email 仍存在：请先执行 db:migrate（0031）')

const pending: Array<{ id: string, name: string, phoneEnc: string | null, reason: string }> = []
const conflict: Array<{ id: string, name: string, phone: string }> = []
const updated: Array<{ id: string, phone: string }> = []

if (hasPhoneEnc) {
  const { rows: users } = await pool.query<{ id: string, name: string, phone: string | null, phone_enc: string | null }>(
    'SELECT id, name, phone, phone_enc FROM users WHERE phone IS NULL OR phone = \'\' ORDER BY name'
  )
  for (const user of users) {
    if (!user.phone_enc) {
      pending.push({ id: user.id, name: user.name, phoneEnc: null, reason: '无档案手机号（phone_enc 为空），需管理员补录' })
      continue
    }
    let phone = ''
    try {
      phone = decryptSensitive(user.phone_enc, secret).trim()
    } catch {
      pending.push({ id: user.id, name: user.name, phoneEnc: user.phone_enc, reason: 'phone_enc 解密失败，需管理员补录' })
      continue
    }
    if (!PHONE_PATTERN.test(phone)) {
      pending.push({ id: user.id, name: user.name, phoneEnc: user.phone_enc, reason: `解密结果 "${phone}" 不符合手机号格式，需管理员补录` })
      continue
    }
    const { rows: dup } = await pool.query(
      'SELECT id FROM users WHERE phone = $1 AND id <> $2',
      [phone, user.id]
    )
    if (dup.length > 0) {
      conflict.push({ id: user.id, name: user.name, phone })
      continue
    }
    updated.push({ id: user.id, phone })
  }
}

const { rows: invitations } = await pool.query<{ id: string, name: string }>(
  "SELECT id, name FROM invitations WHERE phone = '' ORDER BY name"
)

process.stdout.write(`\n=== 手机号回填报告${dryRun ? '（dry-run，未写入）' : ''} ===\n`)
process.stdout.write(`待回填用户：${updated.length + pending.length + conflict.length}，可回填：${updated.length}，需补录：${pending.length}，手机号冲突：${conflict.length}，待重发邀请：${invitations.length}\n`)
if (pending.length) {
  process.stdout.write('\n需管理员补录手机号的账号：\n')
  for (const p of pending) process.stdout.write(`  - ${p.name}（id: ${p.id}）${p.reason}\n`)
}
if (conflict.length) {
  process.stdout.write('\n手机号冲突（另一账号已占用，跳过）：\n')
  for (const c of conflict) process.stdout.write(`  - ${c.name}（id: ${c.id}）→ ${c.phone}\n`)
}
if (invitations.length) {
  process.stdout.write('\npending 邀请缺手机号（激活链接仍有效，需管理员重发）：\n')
  for (const inv of invitations) process.stdout.write(`  - ${inv.name}（邀请 id: ${inv.id}）\n`)
}

if (dryRun) {
  await pool.end()
  process.exit(0)
}

for (const item of updated) {
  await pool.query('UPDATE users SET phone = $1 WHERE id = $2', [item.phone, item.id])
}
process.stdout.write(`\n已回填 ${updated.length} 个账号\n`)

if (pending.length || conflict.length) {
  process.stdout.write('存在需人工处理的账号，跳过 NOT NULL 约束与删列（修复后重新执行本脚本）。\n')
  await pool.end()
  process.exit(1)
}

if (!(await notNullApplied())) {
  await pool.query('ALTER TABLE users ALTER COLUMN phone SET NOT NULL')
  process.stdout.write('users.phone NOT NULL 约束已生效。\n')
} else {
  process.stdout.write('users.phone NOT NULL 约束已生效（此前已设置）。\n')
}

if (hasPhoneEnc) {
  await pool.query('ALTER TABLE users DROP COLUMN phone_enc')
  process.stdout.write('users.phone_enc 列已删除，回填迁移完成。\n')
}
await pool.end()
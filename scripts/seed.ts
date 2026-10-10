import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { schools, schoolSettings, userRoles, users } from '../server/db/schema'
import { loadLocalEnv } from './load-env'

loadLocalEnv()
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required; copy .env.example to .env first')
if (process.env.NODE_ENV === 'production' && !process.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is required in production')
const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle(pool)
const passwordHash = await argon2.hash('Mentor@2026', { type: argon2.argon2id })

// 演示账号与正式库保持一致（六力学校 llschool 于 2026-08-19 建立，账号为 138/1668 系列）。
// 组织模型现在按学部拆成三所独立学校（llschool-primary / -junior / -senior，见
// scripts/split-schools-by-section.ts）；本脚本只保证 llschool 上的演示账号存在，
// 拆分后的账号由迁校脚本改挂到对应学部学校。
let [school] = await db.select().from(schools).where(eq(schools.code, 'llschool')).limit(1)
if (!school) [school] = await db.insert(schools).values({ name: '六力学校', code: 'llschool' }).returning()

const accounts = [
  { phone: '13800000000', name: '平台管理员', role: 'platform_admin', schoolId: null },
  { phone: '13800000001', name: '六力学校管理员', role: 'school_admin', schoolId: school.id },
  { phone: '13800000002', name: '张心理', role: 'psychologist', schoolId: school.id },
  { phone: '16688096890', name: '张忠程', role: 'teacher', schoolId: school.id }
] as const
for (const account of accounts) {
  let [existing] = await db.select({ id: users.id }).from(users).where(eq(users.phone, account.phone)).limit(1)
  if (!existing) {
    [existing] = await db.insert(users).values({ ...account, passwordHash }).returning({ id: users.id })
  }
  if (!existing) throw new Error(`种子账号写入失败：${account.phone}`)
  // 角色关联（幂等）：种子账号的角色即其主角色。已存在的角色行不覆盖，
  // 避免把联调期间手工加授的兼任角色（如 teacher + school_admin）清掉
  await db.insert(userRoles)
    .values({ userId: existing.id, roleCode: account.role })
    .onConflictDoNothing({ target: [userRoles.userId, userRoles.roleCode] })
}
const [psych] = await db.select({ id: users.id }).from(users).where(eq(users.phone, '13800000002')).limit(1)
await db.insert(schoolSettings).values({
  schoolId: school.id, helpPhone: '022-00000000', smsRecipients: ['13800000000'], referralPsychologistId: psych?.id
}).onConflictDoUpdate({ target: schoolSettings.schoolId, set: { referralPsychologistId: psych?.id, updatedAt: new Date() } })

await pool.end()
process.stdout.write('Seed complete. Demo password: Mentor@2026. 演示账号：13800000000（平台管理员）/ 13800000001（学校管理员）/ 13800000002（心理专员）/ 16688096890（教师张忠程）\n')
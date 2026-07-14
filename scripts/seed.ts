import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { schools, users, schoolSettings, contentPackages } from '../server/db/schema'
import { encryptSensitive } from '../server/utils/crypto'
import { loadLocalEnv } from './load-env'

loadLocalEnv()
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required; copy .env.example to .env first')
if (process.env.NODE_ENV === 'production' && !process.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is required in production')
const encryptionKey = process.env.ENCRYPTION_KEY || 'development-encryption-key-change-me'
const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle(pool)
const passwordHash = await argon2.hash('Mentor@2026', { type: argon2.argon2id })

let [school] = await db.select().from(schools).where(eq(schools.code, 'demo-school')).limit(1)
if (!school) [school] = await db.insert(schools).values({ name: '六力学校（演示）', code: 'demo-school' }).returning()

const accounts = [
  { email: 'teacher@demo.local', name: '李老师', role: 'teacher', schoolId: school.id },
  { email: 'psychologist@demo.local', name: '王心理专员', role: 'psychologist', schoolId: school.id, totpSecretEnc: encryptSensitive('JBSWY3DPEHPK3PXP', encryptionKey) },
  { email: 'school.admin@demo.local', name: '学校管理员', role: 'school_admin', schoolId: school.id },
  { email: 'platform.admin@demo.local', name: '平台管理员', role: 'platform_admin', schoolId: null }
]
for (const account of accounts) {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, account.email)).limit(1)
  if (!existing) await db.insert(users).values({ ...account, passwordHash })
}
const [psych] = await db.select({ id: users.id }).from(users).where(eq(users.email, 'psychologist@demo.local')).limit(1)
await db.insert(schoolSettings).values({
  schoolId: school.id, helpPhone: '022-00000000', smsRecipients: ['13800000000'], referralPsychologistId: psych?.id
}).onConflictDoUpdate({ target: schoolSettings.schoolId, set: { referralPsychologistId: psych?.id, updatedAt: new Date() } })

const [content] = await db.select({ id: contentPackages.id }).from(contentPackages).where(eq(contentPackages.code, 'core-rules')).limit(1)
if (!content) await db.insert(contentPackages).values({
  code: 'core-rules', name: '四模块核心规则与工具', version: '2.0.0', type: 'assessment', status: 'published',
  payload: { modules: ['self_growth', 'class_system', 'home_school', 'student_case'], note: '封闭试用版种子内容' }, publishedAt: new Date()
})

await pool.end()
process.stdout.write('Seed complete. Demo password: Mentor@2026. Psychologist TOTP secret: JBSWY3DPEHPK3PXP\n')

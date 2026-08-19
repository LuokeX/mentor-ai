import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, isNull, sql } from 'drizzle-orm'
import { loadLocalEnv } from './load-env'
import * as schema from '../server/db/schema'

loadLocalEnv()
const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required; copy .env.example to .env first')
const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle(pool, { schema })
await migrate(db, { migrationsFolder: './drizzle' })

// 兼容性数据回填：旧 JSON/报告快照保持不变，新业务改用稳定 actionId。
const [plans, existingActions] = await Promise.all([
  db.select().from(schema.plans),
  db.select({ planId: schema.planActions.planId }).from(schema.planActions)
])
const migratedPlanIds = new Set(existingActions.map(item => item.planId))
for (const plan of plans) {
  const legacy = (plan.actions || []) as Array<{ title: string, detail: string, status: string }>
  if (!migratedPlanIds.has(plan.id) && legacy.length) {
    await db.insert(schema.planActions).values(legacy.map((action, sequence) => ({
      schoolId: plan.schoolId,
      planId: plan.id,
      ownerUserId: plan.ownerUserId,
      sequence,
      title: action.title,
      detail: action.detail,
      decision: plan.acceptedAt ? 'included' : 'pending',
      decidedAt: plan.acceptedAt || null,
      status: action.status || 'pending',
      dueAt: new Date(plan.createdAt.getTime() + Math.min(sequence + 1, 3) * 86_400_000),
      completedAt: action.status === 'completed' ? plan.updatedAt : null
    }))).onConflictDoNothing()
  }
  if (!plan.nextReviewAt && plan.status === 'in_progress') {
    await db.update(schema.plans).set({ nextReviewAt: new Date(plan.createdAt.getTime() + 7 * 86_400_000) })
      .where(eq(schema.plans.id, plan.id))
  }
}

const legacyReferrals = await db.select().from(schema.referrals).where(isNull(schema.referrals.acknowledgeDueAt))
for (const referral of legacyReferrals) {
  await db.update(schema.referrals).set({
    acknowledgeDueAt: new Date(referral.createdAt.getTime() + 5 * 60_000),
    escalationDueAt: new Date(referral.createdAt.getTime() + 15 * 60_000)
  }).where(eq(schema.referrals.id, referral.id))
}

// 学校管理员评估/方案/AI 对话管理权限键回填（幂等）。
// 0042 的角色 INSERT 使用 ON CONFLICT DO NOTHING，存量库不会自动获得这些键；
// 键缺失时能力解析回退硬编码（功能可用），此处显式补齐保持数据驱动一致。
const rolesToBackfill = await db.select({ code: schema.roles.code }).from(schema.roles)
  .where(sql`"permissions" #>> '{records,assessment}' IS NULL AND "code" = 'school_admin'`)
for (const role of rolesToBackfill) {
  await db.update(schema.roles).set({
    permissions: sql`jsonb_set(
      jsonb_set(
        jsonb_set("permissions", '{records,assessment}', '["view","edit","archive","delete","restore"]'::jsonb, true),
        '{records,plan}', '["view","edit","archive","delete","restore"]'::jsonb, true),
      '{records,conversation}', '["view","edit","archive","delete","restore"]'::jsonb, true)`,
    updatedAt: new Date()
  }).where(eq(schema.roles.code, role.code))
}

await pool.end()
process.stdout.write('Database migrations completed\n')

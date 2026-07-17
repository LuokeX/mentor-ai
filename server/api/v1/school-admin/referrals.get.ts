import { desc, eq } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  return useDb(event).select({
    id: schema.referrals.id,
    safetyEventId: schema.referrals.safetyEventId,
    psychologistId: schema.referrals.psychologistId,
    priority: schema.referrals.priority,
    status: schema.referrals.status,
    acknowledgeDueAt: schema.referrals.acknowledgeDueAt,
    escalationDueAt: schema.referrals.escalationDueAt,
    acknowledgedAt: schema.referrals.acknowledgedAt,
    escalatedAt: schema.referrals.escalatedAt,
    createdAt: schema.referrals.createdAt
  }).from(schema.referrals).where(eq(schema.referrals.schoolId, admin.schoolId)).orderBy(desc(schema.referrals.createdAt)).limit(50)
})

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
    closedAt: schema.referrals.closedAt,
    // safety_events 上下文
    severity: schema.safetyEvents.severity,
    sourceType: schema.safetyEvents.sourceType,
    matchedRules: schema.safetyEvents.matchedRules,
    safetyEventStatus: schema.safetyEvents.status,
    eventCreatedAt: schema.safetyEvents.createdAt,
    // 教师名（safety_events.owner_user_id → users）
    teacherName: schema.users.name,
    // 转介工单自身时间
    createdAt: schema.referrals.createdAt,
    updatedAt: schema.referrals.updatedAt
  })
    .from(schema.referrals)
    .innerJoin(schema.safetyEvents, eq(schema.referrals.safetyEventId, schema.safetyEvents.id))
    .innerJoin(schema.users, eq(schema.safetyEvents.ownerUserId, schema.users.id))
    .where(eq(schema.referrals.schoolId, admin.schoolId))
    .orderBy(desc(schema.referrals.createdAt))
    .limit(50)
})
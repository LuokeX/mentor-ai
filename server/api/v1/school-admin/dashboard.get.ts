import { and, count, desc, eq } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin'])
  const schoolId = user.schoolId!
  const db = useDb(event)
  const [[userCount], [activeCrises], [assessmentCount], usersList, requests, audits, referrals] = await Promise.all([
    db.select({ value: count() }).from(schema.users).where(eq(schema.users.schoolId, schoolId)),
    db.select({ value: count() }).from(schema.safetyEvents).where(and(eq(schema.safetyEvents.schoolId, schoolId), eq(schema.safetyEvents.status, 'open'))),
    db.select({ value: count() }).from(schema.assessmentAttempts).where(eq(schema.assessmentAttempts.schoolId, schoolId)),
    db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, status: schema.users.status, lastLoginAt: schema.users.lastLoginAt }).from(schema.users).where(eq(schema.users.schoolId, schoolId)).orderBy(desc(schema.users.createdAt)),
    db.select().from(schema.adminAccessRequests).where(and(eq(schema.adminAccessRequests.schoolId, schoolId), eq(schema.adminAccessRequests.status, 'pending'))).orderBy(desc(schema.adminAccessRequests.createdAt)),
    db.select().from(schema.adminAccessEvents).where(eq(schema.adminAccessEvents.schoolId, schoolId)).orderBy(desc(schema.adminAccessEvents.createdAt)).limit(50),
    db.select({
      id: schema.referrals.id,
      safetyEventId: schema.referrals.safetyEventId,
      psychologistId: schema.referrals.psychologistId,
      status: schema.referrals.status,
      severity: schema.safetyEvents.severity,
      createdAt: schema.referrals.createdAt,
      updatedAt: schema.referrals.updatedAt
    }).from(schema.referrals).innerJoin(schema.safetyEvents, eq(schema.referrals.safetyEventId, schema.safetyEvents.id))
      .where(eq(schema.referrals.schoolId, schoolId)).orderBy(desc(schema.referrals.createdAt)).limit(50)
  ])
  return { metrics: { users: userCount?.value ?? 0, activeCrises: activeCrises?.value ?? 0, assessments: assessmentCount?.value ?? 0 }, users: usersList, pendingRequests: requests, accessEvents: audits, referrals }
})

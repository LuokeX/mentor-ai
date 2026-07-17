import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { decryptSensitive } from '../../../utils/crypto'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['psychologist'])
  const status = z.enum(['created', 'acknowledged', 'offline_handling', 'escalated', 'closed']).optional().parse(getQuery(event).status)
  const conditions = [eq(schema.referrals.psychologistId, user.id)]
  if (status) conditions.push(eq(schema.referrals.status, status))
  const rows = await useDb(event)
    .select({ referral: schema.referrals, safety: schema.safetyEvents, teacherName: schema.users.name })
    .from(schema.referrals)
    .innerJoin(schema.safetyEvents, eq(schema.referrals.safetyEventId, schema.safetyEvents.id))
    .innerJoin(schema.users, eq(schema.safetyEvents.ownerUserId, schema.users.id))
    .where(and(...conditions))
    .orderBy(desc(schema.referrals.createdAt)).limit(50)
  const secret = useRuntimeConfig(event).encryptionKey
  const now = Date.now()
  return rows.map(row => ({
    ...row.referral,
    severity: row.safety.severity,
    matchedRules: row.safety.matchedRules,
    summary: decryptSensitive(row.safety.summaryEnc, secret).slice(0, 1000),
    teacherName: row.teacherName,
    eventCreatedAt: row.safety.createdAt,
    acknowledgeRemainingSeconds: row.referral.acknowledgedAt ? null : Math.floor(((row.referral.acknowledgeDueAt?.getTime() || now) - now) / 1000),
    escalationRemainingSeconds: row.referral.escalatedAt || row.referral.acknowledgedAt ? null : Math.floor(((row.referral.escalationDueAt?.getTime() || now) - now) / 1000)
  }))
})

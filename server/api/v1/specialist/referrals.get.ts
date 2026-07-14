import { desc, eq } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { decryptSensitive } from '../../../utils/crypto'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['psychologist'])
  const rows = await useDb(event)
    .select({ referral: schema.referrals, safety: schema.safetyEvents, teacherName: schema.users.name })
    .from(schema.referrals)
    .innerJoin(schema.safetyEvents, eq(schema.referrals.safetyEventId, schema.safetyEvents.id))
    .innerJoin(schema.users, eq(schema.safetyEvents.ownerUserId, schema.users.id))
    .where(eq(schema.referrals.psychologistId, user.id))
    .orderBy(desc(schema.referrals.createdAt))
  const secret = useRuntimeConfig(event).encryptionKey
  return rows.map(row => ({
    ...row.referral,
    severity: row.safety.severity,
    matchedRules: row.safety.matchedRules,
    summary: decryptSensitive(row.safety.summaryEnc, secret),
    teacherName: row.teacherName,
    eventCreatedAt: row.safety.createdAt
  }))
})

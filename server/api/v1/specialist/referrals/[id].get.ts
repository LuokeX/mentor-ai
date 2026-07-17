import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { decryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['psychologist'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const [row] = await db.select({ referral: schema.referrals, safety: schema.safetyEvents, teacherName: schema.users.name })
    .from(schema.referrals)
    .innerJoin(schema.safetyEvents, eq(schema.referrals.safetyEventId, schema.safetyEvents.id))
    .innerJoin(schema.users, eq(schema.safetyEvents.ownerUserId, schema.users.id))
    .where(and(eq(schema.referrals.id, id), eq(schema.referrals.psychologistId, user.id))).limit(1)
  if (!row) throw createError({ statusCode: 404, message: '转介工单不存在' })
  const events = await db.select().from(schema.referralEvents).where(eq(schema.referralEvents.referralId, id)).orderBy(asc(schema.referralEvents.createdAt))
  const secret = useRuntimeConfig(event).encryptionKey
  return {
    ...row.referral,
    teacherName: row.teacherName,
    severity: row.safety.severity,
    matchedRules: row.safety.matchedRules,
    summary: decryptSensitive(row.safety.summaryEnc, secret).slice(0, 1000),
    handlingNote: decryptSensitive(row.referral.handlingNoteEnc, secret),
    events: events.map(item => ({ ...item, note: decryptSensitive(item.noteEnc, secret), noteEnc: undefined }))
  }
})

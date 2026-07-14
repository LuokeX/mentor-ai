import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { encryptSensitive } from '../../../../utils/crypto'
import { writeAudit } from '../../../../utils/audit'

const bodySchema = z.object({ status: z.enum(['acknowledged', 'offline_handling', 'closed']), note: z.string().max(1000).optional() })

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['psychologist'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const [updated] = await useDb(event).update(schema.referrals).set({
    status: body.status,
    acknowledgedAt: body.status === 'acknowledged' ? new Date() : undefined,
    handlingNoteEnc: body.note ? encryptSensitive(body.note, useRuntimeConfig(event).encryptionKey) : undefined,
    updatedAt: new Date()
  }).where(and(eq(schema.referrals.id, id), eq(schema.referrals.psychologistId, user.id))).returning()
  if (!updated) throw createError({ statusCode: 404, message: '转介工单不存在' })
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: `referral.${body.status}`, targetType: 'referral', targetId: id })
  return { ok: true }
})

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { encryptSensitive } from '../../../../utils/crypto'
import { writeAudit } from '../../../../utils/audit'
import { trackProductEvent } from '../../../../domain/product-events'

const bodySchema = z.object({
  status: z.enum(['acknowledged', 'offline_handling', 'closed']),
  note: z.string().trim().max(1000).optional(),
  closureReason: z.enum(['resolved', 'transferred_offline', 'false_alarm', 'other']).optional()
}).superRefine((value, context) => {
  if (value.status === 'closed' && !value.closureReason) context.addIssue({ code: 'custom', path: ['closureReason'], message: '关闭工单必须选择关闭原因' })
})

const transitions: Record<string, string[]> = {
  created: ['acknowledged'],
  escalated: ['acknowledged'],
  acknowledged: ['offline_handling', 'closed'],
  offline_handling: ['closed']
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['psychologist'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const [current] = await db.select().from(schema.referrals).where(and(
    eq(schema.referrals.id, id), eq(schema.referrals.psychologistId, user.id)
  )).limit(1)
  if (!current) throw createError({ statusCode: 404, message: '转介工单不存在' })
  if (!transitions[current.status]?.includes(body.status)) throw createError({ statusCode: 409, message: '当前工单状态不允许执行此操作' })
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.update(schema.referrals).set({
      status: body.status,
      acknowledgedAt: body.status === 'acknowledged' ? now : current.acknowledgedAt,
      handlingNoteEnc: body.note ? encryptSensitive(body.note, useRuntimeConfig(event).encryptionKey) : current.handlingNoteEnc,
      closureReason: body.status === 'closed' ? body.closureReason : undefined,
      closedAt: body.status === 'closed' ? now : undefined,
      updatedAt: now
    }).where(eq(schema.referrals.id, id))
    await tx.insert(schema.referralEvents).values({
      schoolId: current.schoolId, referralId: id, actorId: user.id,
      eventType: body.status === 'acknowledged' ? 'acknowledged' : body.status === 'closed' ? 'closed' : 'handling_started',
      fromStatus: current.status, toStatus: body.status,
      noteEnc: body.note ? encryptSensitive(body.note, useRuntimeConfig(event).encryptionKey) : null,
      metadata: body.closureReason ? { closureReason: body.closureReason } : {}
    })
  })
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: `referral.${body.status}`, targetType: 'referral', targetId: id })
  await trackProductEvent(event, {
    schoolId: user.schoolId, userId: user.id, eventName: body.status === 'acknowledged' ? 'crisis_acknowledged' : `referral_${body.status}`,
    targetType: 'referral', targetId: id,
    metadata: { withinAckSla: body.status === 'acknowledged' ? Boolean(current.acknowledgeDueAt && now <= current.acknowledgeDueAt) : false }
  })
  return { ok: true }
})

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { planAcceptanceSchema } from '../../../../../shared/reports'
import { recordPlanOperationEvent } from '../../../../domain/plan-operations'
import { trackProductEvent } from '../../../../domain/product-events'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { encryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = planAcceptanceSchema.parse(await readBody(event))
  const db = useDb(event)

  const [plan] = await db.select({
    id: schema.plans.id,
    schoolId: schema.plans.schoolId,
    ownerUserId: schema.plans.ownerUserId
  }).from(schema.plans).where(and(
    eq(schema.plans.id, id),
    eq(schema.plans.ownerUserId, user.id),
    eq(schema.plans.schoolId, user.schoolId)
  )).limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })

  const now = new Date()
  const nextStatus = body.decision === 'accepted' ? 'accepted' : 'adjustment_needed'
  const [updated] = await db.update(schema.plans).set({
    status: nextStatus,
    acceptanceDecision: body.decision,
    acceptanceReasonEnc: body.reason ? encryptSensitive(body.reason, useRuntimeConfig(event).encryptionKey) : null,
    acceptedAt: body.decision === 'accepted' ? now : null,
    updatedAt: now
  }).where(and(
    eq(schema.plans.id, id),
    eq(schema.plans.ownerUserId, user.id)
  )).returning({ id: schema.plans.id, status: schema.plans.status })

  await writeAudit(event, {
    schoolId: plan.schoolId,
    actorId: user.id,
    action: 'plan.acceptance.update',
    targetType: 'plan',
    targetId: plan.id,
    metadata: { decision: body.decision, status: nextStatus }
  })
  await trackProductEvent(event, {
    schoolId: plan.schoolId,
    userId: user.id,
    eventName: 'plan_acceptance_updated',
    targetType: 'plan',
    targetId: plan.id,
    metadata: { decision: body.decision, status: nextStatus }
  })
  await recordPlanOperationEvent(event, {
    schoolId: plan.schoolId,
    ownerUserId: user.id,
    planId: plan.id,
    eventType: 'plan_acceptance_updated',
    metadata: { decision: body.decision, status: nextStatus }
  })

  return updated || { id: plan.id, status: nextStatus }
})

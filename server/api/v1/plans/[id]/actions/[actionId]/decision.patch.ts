import { and, eq, inArray, isNull } from 'drizzle-orm'
import { planActionDecisionUpdateSchema } from '../../../../../../../shared/reports'
import { recordPlanOperationEvent } from '../../../../../../domain/plan-operations'
import { trackProductEvent } from '../../../../../../domain/product-events'
import { requireUser } from '../../../../../../utils/auth'
import { writeAudit } from '../../../../../../utils/audit'
import { encryptSensitive } from '../../../../../../utils/crypto'
import { schema, useDb } from '../../../../../../utils/db'
import { uuidParam } from '../../../../../../utils/params'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const schoolId = user.schoolId
  const planId = uuidParam(event, 'id')
  const actionId = uuidParam(event, 'actionId')
  const body = planActionDecisionUpdateSchema.parse(await readBody(event))
  const db = useDb(event)

  const [plan] = await db.select({
    id: schema.plans.id,
    status: schema.plans.status,
    acceptedAt: schema.plans.acceptedAt,
    actions: schema.plans.actions,
    updatedAt: schema.plans.updatedAt
  }).from(schema.plans).where(and(
    eq(schema.plans.id, planId),
    eq(schema.plans.ownerUserId, user.id),
    eq(schema.plans.schoolId, schoolId)
  )).limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })
  if (!['pending_acceptance', 'adjustment_needed'].includes(plan.status) || plan.acceptedAt) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '当前方案已开始执行，不能重新选择建议' })
  }

  const [action] = await db.select({
    id: schema.planActions.id,
    sequence: schema.planActions.sequence
  }).from(schema.planActions).where(and(
    eq(schema.planActions.id, actionId),
    eq(schema.planActions.planId, planId),
    eq(schema.planActions.ownerUserId, user.id),
    eq(schema.planActions.schoolId, schoolId)
  )).limit(1)
  if (!action) throw createError({ statusCode: 404, message: '行动方案建议不存在' })

  const now = new Date()
  const secret = useRuntimeConfig(event).encryptionKey
  const nextLegacyActions = [...((plan.actions || []) as Array<{ title: string, detail: string, status: string }>)]
  if (nextLegacyActions[action.sequence]) {
    nextLegacyActions[action.sequence] = {
      ...nextLegacyActions[action.sequence]!,
      status: body.decision === 'included' ? 'pending' : 'cancelled'
    }
  }

  await db.transaction(async (tx) => {
    const [updatedAction] = await tx.update(schema.planActions).set({
      decision: body.decision,
      decisionReason: body.decision === 'rejected' ? body.reason : null,
      decisionNoteEnc: body.decision === 'rejected' && body.note
        ? encryptSensitive(body.note, secret)
        : null,
      decidedAt: now,
      status: body.decision === 'included' ? 'pending' : 'cancelled',
      completedAt: null,
      updatedAt: now
    }).where(and(
      eq(schema.planActions.id, action.id),
      eq(schema.planActions.planId, plan.id),
      eq(schema.planActions.ownerUserId, user.id),
      eq(schema.planActions.schoolId, schoolId)
    )).returning({ id: schema.planActions.id })
    if (!updatedAction) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '建议状态已变化，请刷新后重试' })

    const [updatedPlan] = await tx.update(schema.plans).set({
      actions: nextLegacyActions as any,
      updatedAt: now
    }).where(and(
      eq(schema.plans.id, plan.id),
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.schoolId, schoolId),
      inArray(schema.plans.status, ['pending_acceptance', 'adjustment_needed']),
      isNull(schema.plans.acceptedAt),
      eq(schema.plans.updatedAt, plan.updatedAt)
    )).returning({ id: schema.plans.id })
    if (!updatedPlan) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '方案已变化，请刷新后重试' })

    await recordPlanOperationEvent(event, {
      schoolId,
      ownerUserId: user.id,
      planId: plan.id,
      actionId: action.id,
      eventType: 'plan_action_decision_updated',
      metadata: { decision: body.decision, reason: body.reason || null }
    }, tx)
  })

  await writeAudit(event, {
    schoolId,
    actorId: user.id,
    action: 'plan.action.decision.update',
    targetType: 'plan_action',
    targetId: action.id,
    metadata: { planId: plan.id, decision: body.decision, reason: body.reason || null }
  })
  await trackProductEvent(event, {
    schoolId,
    userId: user.id,
    eventName: 'plan_action_decision_updated',
    targetType: 'plan_action',
    targetId: action.id,
    metadata: { planId: plan.id, decision: body.decision, reason: body.reason || null }
  })

  return { ok: true, actionId: action.id, decision: body.decision }
})

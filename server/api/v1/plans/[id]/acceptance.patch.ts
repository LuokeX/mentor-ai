import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { planAcceptanceSchema } from '../../../../../shared/reports'
import { closeAssessmentSessionsForPlan } from '../../../../domain/assessment-sessions'
import { recordPlanOperationEvent } from '../../../../domain/plan-operations'
import { trackProductEvent } from '../../../../domain/product-events'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { encryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const schoolId = user.schoolId
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = planAcceptanceSchema.parse(await readBody(event))
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey

  const [plan] = await db.select({
    id: schema.plans.id,
    schoolId: schema.plans.schoolId,
    ownerUserId: schema.plans.ownerUserId,
    status: schema.plans.status,
    acceptedAt: schema.plans.acceptedAt
  }).from(schema.plans).where(and(
    eq(schema.plans.id, id),
    eq(schema.plans.ownerUserId, user.id),
    eq(schema.plans.schoolId, schoolId)
  )).limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })

  // 只有待确认/需调整状态可接受或拒绝：危机熔断冻结（escalated）后不能再接受。
  if (!['pending_acceptance', 'adjustment_needed'].includes(plan.status) || plan.acceptedAt) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '当前状态不可接受或拒绝方案' })
  }

  const now = new Date()
  const nextStatus = body.decision === 'accepted' ? 'accepted' : 'adjustment_needed'
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(schema.plans).set({
      status: nextStatus,
      acceptanceDecision: body.decision,
      acceptanceReasonEnc: body.reason ? encryptSensitive(body.reason, secret) : null,
      acceptedAt: body.decision === 'accepted' ? now : null,
      updatedAt: now
    }).where(and(
      eq(schema.plans.id, id),
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.schoolId, schoolId),
      inArray(schema.plans.status, ['pending_acceptance', 'adjustment_needed']),
      isNull(schema.plans.acceptedAt)
    )).returning({ id: schema.plans.id, status: schema.plans.status })
    if (!row) throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '当前状态不可接受或拒绝方案' })

    // 接受执行后评估组使命结束：再次评估会开新组、建新方案，标题归因不再混入旧量表。
    // 拒绝（暂不执行/不适用）保持组 open，仍可继续补充量表后重新合并方案。
    if (nextStatus === 'accepted') {
      await closeAssessmentSessionsForPlan(tx, plan.id, now)
    }
    await recordPlanOperationEvent(event, {
      schoolId: plan.schoolId,
      ownerUserId: user.id,
      planId: plan.id,
      eventType: 'plan_acceptance_updated',
      metadata: { decision: body.decision, status: nextStatus }
    }, tx)
    return row
  })

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

  return updated || { id: plan.id, status: nextStatus }
})

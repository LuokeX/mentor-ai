import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createPlanActions } from '../../../../domain/plan-actions'
import { canUpdatePlanActions, recordPlanOperationEvent } from '../../../../domain/plan-operations'
import { trackProductEvent } from '../../../../domain/product-events'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

const bodySchema = z.object({
  title: z.string().trim().min(2).max(80),
  detail: z.string().trim().min(4).max(500),
  dueAt: z.string().datetime().nullable().optional()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const schoolId = user.schoolId
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)

  const [plan] = await db.select({
    id: schema.plans.id,
    status: schema.plans.status,
    acceptedAt: schema.plans.acceptedAt,
    actions: schema.plans.actions
  }).from(schema.plans).where(and(
    eq(schema.plans.id, id),
    eq(schema.plans.ownerUserId, user.id),
    eq(schema.plans.schoolId, schoolId)
  )).limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })
  if (!canUpdatePlanActions(plan)) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '请先接受方案，再新增行动' })
  }

  const action = await db.transaction(async (tx) => {
    const [currentPlan] = await tx.select({
      id: schema.plans.id,
      status: schema.plans.status,
      acceptedAt: schema.plans.acceptedAt,
      actions: schema.plans.actions
    }).from(schema.plans).where(and(
      eq(schema.plans.id, plan.id),
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.schoolId, schoolId)
    )).limit(1).for('update')
    if (!currentPlan || !canUpdatePlanActions(currentPlan)) {
      throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '方案状态已变化，请刷新后重试' })
    }

    const [created] = await createPlanActions(event, {
      planId: currentPlan.id,
      schoolId,
      ownerUserId: user.id,
      actions: [{ title: body.title, detail: body.detail, status: 'pending' }]
    }, tx)
    if (!created) throw createError({ statusCode: 500, message: '行动创建失败' })

    let result = created
    if (body.dueAt !== undefined) {
      const [updated] = await tx.update(schema.planActions).set({
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        updatedAt: new Date()
      }).where(and(
        eq(schema.planActions.id, created.id),
        eq(schema.planActions.ownerUserId, user.id),
        eq(schema.planActions.planId, plan.id)
      )).returning()
      result = updated || created
    }

    const legacy = [
      ...((currentPlan.actions as Array<{ title: string, detail: string, status: string }>) || []),
      { title: body.title, detail: body.detail, status: 'pending' }
    ]
    const [updatedPlan] = await tx.update(schema.plans).set({ actions: legacy, updatedAt: new Date() }).where(and(
      eq(schema.plans.id, currentPlan.id),
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.schoolId, schoolId),
      eq(schema.plans.status, currentPlan.status)
    )).returning({ id: schema.plans.id })
    if (!updatedPlan) {
      throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '方案状态已变化，请刷新后重试' })
    }
    await recordPlanOperationEvent(event, {
      schoolId,
      ownerUserId: user.id,
      planId: currentPlan.id,
      actionId: result.id,
      eventType: 'plan_action_added',
      metadata: { sequence: result.sequence }
    }, tx)
    return result
  })

  await writeAudit(event, {
    schoolId,
    actorId: user.id,
    action: 'plan.action.create',
    targetType: 'plan_action',
    targetId: action.id,
    metadata: { planId: plan.id, sequence: action.sequence }
  })
  await trackProductEvent(event, {
    schoolId,
    userId: user.id,
    eventName: 'plan_action_added',
    targetType: 'plan_action',
    targetId: action.id,
    metadata: { planId: plan.id, sequence: action.sequence }
  })
  return action
})

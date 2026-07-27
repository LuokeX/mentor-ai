import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { planReviewCreateSchema } from '../../../../../shared/reports'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'
import { ensurePlanActions } from '../../../../domain/plan-actions'
import { planStatusAfterReview, recordPlanOperationEvent } from '../../../../domain/plan-operations'
import { trackProductEvent } from '../../../../domain/product-events'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = planReviewCreateSchema.parse(await readBody(event))
  const db = useDb(event)

  const [plan] = await db.select({
    id: schema.plans.id,
    schoolId: schema.plans.schoolId,
    ownerUserId: schema.plans.ownerUserId,
    title: schema.plans.title,
    actions: schema.plans.actions,
    status: schema.plans.status
  })
    .from(schema.plans)
    .where(and(
      eq(schema.plans.id, id),
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.schoolId, user.schoolId)
    ))
    .limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })
  if (['completed', 'closed', 'archived'].includes(plan.status)) {
    throw createError({ statusCode: 422, message: '已关闭方案不能继续复盘' })
  }

  const [review] = await db.insert(schema.planReviews).values({
    schoolId: plan.schoolId,
    ownerUserId: user.id,
    planId: plan.id,
    reviewAt: body.reviewAt ? new Date(body.reviewAt) : new Date(),
    effectScore: body.effectScore,
    progressNote: body.progressNote,
    nextAction: body.nextAction,
    decision: body.decision
  }).returning()

  const actionRows = await ensurePlanActions(event, plan.id, user.id)
  const completedIds = new Set(body.completedActionIds || [])
  for (const index of body.completedActionIndices || []) {
    const action = actionRows.find(item => item.sequence === index)
    if (action) completedIds.add(action.id)
  }

  // 新实体与旧快照同步，旧客户端仍可按索引读取一个试用版本。
  const nextLegacyActions = [...(((plan.actions as Array<{ title: string; detail: string; status: string }>) || []))]
  if (completedIds.size) {
    const now = new Date()
    for (const actionId of completedIds) {
      await db.update(schema.planActions).set({ status: 'completed', completedAt: now, updatedAt: now })
        .where(and(eq(schema.planActions.id, actionId), eq(schema.planActions.ownerUserId, user.id), eq(schema.planActions.planId, plan.id)))
    }
    for (const row of actionRows.filter(item => completedIds.has(item.id))) {
      if (nextLegacyActions[row.sequence]) nextLegacyActions[row.sequence] = { ...nextLegacyActions[row.sequence]!, status: 'completed' }
    }
  }
  const now = new Date()
  const nextStatus = planStatusAfterReview({ effectScore: body.effectScore, decision: body.decision })
  await db.update(schema.plans).set({
    actions: nextLegacyActions as any,
    status: nextStatus,
    completedAt: nextStatus === 'completed' ? now : null,
    closedAt: ['completed', 'closed'].includes(nextStatus) ? now : null,
    updatedAt: now
  }).where(eq(schema.plans.id, plan.id))

  if (body.decision === 'need_collaboration') {
    const admins = await db.select({ id: schema.users.id }).from(schema.users).where(and(
      eq(schema.users.schoolId, plan.schoolId),
      eq(schema.users.role, 'school_admin'),
      eq(schema.users.status, 'active')
    )).limit(20)
    if (admins.length) {
      await db.insert(schema.notifications).values(admins.map(admin => ({
        schoolId: plan.schoolId,
        userId: admin.id,
        type: 'plan_collaboration',
        title: '方案需要协同处理',
        body: '有教师在复盘中标记方案需要校内协同，请在方案运营看板查看。',
        targetType: 'plan',
        targetId: plan.id,
        deduplicationKey: `plan-collaboration:${plan.id}:${admin.id}:${review?.id || Date.now()}`
      }))).onConflictDoNothing().catch(() => undefined)
    }
  }

  await writeAudit(event, {
    schoolId: plan.schoolId,
    actorId: user.id,
    action: 'plan.review.create',
    targetType: 'plan',
    targetId: plan.id,
    metadata: { effectScore: body.effectScore, decision: body.decision, status: nextStatus }
  })
  await trackProductEvent(event, {
    schoolId: plan.schoolId, userId: user.id, eventName: 'plan_review_completed',
    targetType: 'plan', targetId: plan.id, metadata: { effectScore: body.effectScore, completedActions: completedIds.size, decision: body.decision, status: nextStatus }
  })
  await recordPlanOperationEvent(event, {
    schoolId: plan.schoolId,
    ownerUserId: user.id,
    planId: plan.id,
    eventType: body.decision === 'need_collaboration'
      ? 'plan_collaboration_needed'
      : (['completed', 'closed'].includes(nextStatus) ? 'plan_closed' : 'plan_review_completed'),
    metadata: { effectScore: body.effectScore, completedActions: completedIds.size, decision: body.decision, status: nextStatus }
  })
  return review
})

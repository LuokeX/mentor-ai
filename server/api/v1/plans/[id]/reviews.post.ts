import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { planReviewCreateSchema } from '../../../../../shared/reports'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'
import { ensurePlanActions } from '../../../../domain/plan-actions'
import { trackProductEvent } from '../../../../domain/product-events'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = planReviewCreateSchema.parse(await readBody(event))
  const db = useDb(event)

  const [plan] = await db.select({ id: schema.plans.id, schoolId: schema.plans.schoolId, actions: schema.plans.actions })
    .from(schema.plans)
    .where(and(
      eq(schema.plans.id, id),
      eq(schema.plans.ownerUserId, user.id)
    ))
    .limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })

  const [review] = await db.insert(schema.planReviews).values({
    schoolId: plan.schoolId,
    ownerUserId: user.id,
    planId: plan.id,
    reviewAt: body.reviewAt ? new Date(body.reviewAt) : new Date(),
    effectScore: body.effectScore,
    progressNote: body.progressNote,
    nextAction: body.nextAction
  }).returning()

  const actionRows = await ensurePlanActions(event, plan.id, user.id)
  const completedIds = new Set(body.completedActionIds || [])
  for (const index of body.completedActionIndices || []) {
    const action = actionRows.find(item => item.sequence === index)
    if (action) completedIds.add(action.id)
  }

  // 新实体与旧快照同步，旧客户端仍可按索引读取一个试用版本。
  if (completedIds.size) {
    const now = new Date()
    for (const actionId of completedIds) {
      await db.update(schema.planActions).set({ status: 'completed', completedAt: now, updatedAt: now })
        .where(and(eq(schema.planActions.id, actionId), eq(schema.planActions.ownerUserId, user.id), eq(schema.planActions.planId, plan.id)))
    }
    const actions = (plan.actions as Array<{ title: string; detail: string; status: string }>) || []
    for (const row of actionRows.filter(item => completedIds.has(item.id))) {
      if (actions[row.sequence]) actions[row.sequence] = { ...actions[row.sequence]!, status: 'completed' }
    }
    await db.update(schema.plans)
      .set({ actions: actions as any, updatedAt: new Date() })
      .where(eq(schema.plans.id, plan.id))
  } else {
    await db.update(schema.plans).set({ updatedAt: new Date() }).where(eq(schema.plans.id, plan.id))
  }

  await writeAudit(event, {
    schoolId: plan.schoolId,
    actorId: user.id,
    action: 'plan.review.create',
    targetType: 'plan',
    targetId: plan.id,
    metadata: { effectScore: body.effectScore }
  })
  await trackProductEvent(event, {
    schoolId: plan.schoolId, userId: user.id, eventName: 'plan_review_completed',
    targetType: 'plan', targetId: plan.id, metadata: { effectScore: body.effectScore, completedActions: completedIds.size }
  })
  return review
})

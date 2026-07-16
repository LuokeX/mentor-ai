import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { planReviewCreateSchema } from '../../../../../shared/reports'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'

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

  // 联动完成动作
  if (body.completedActionIndices?.length) {
    const actions = (plan.actions as Array<{ title: string; detail: string; status: string }>) || []
    for (const idx of body.completedActionIndices) {
      if (idx >= 0 && idx < actions.length) {
        const a = actions[idx]!
        actions[idx] = { title: a.title, detail: a.detail, status: 'completed' }
      }
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
  return review
})
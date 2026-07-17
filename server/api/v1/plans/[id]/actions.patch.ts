import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { ensurePlanActions } from '../../../../domain/plan-actions'
import { trackProductEvent } from '../../../../domain/product-events'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = z.object({
    actionId: z.string().uuid().optional(),
    actionIndex: z.number().int().min(0).max(50).optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
  }).refine(value => value.actionId || value.actionIndex !== undefined, { message: '必须提供动作 ID' }).parse(await readBody(event))
  const db = useDb(event)

  const [plan] = await db.select({ id: schema.plans.id, actions: schema.plans.actions })
    .from(schema.plans)
    .where(and(
      eq(schema.plans.id, id),
      eq(schema.plans.ownerUserId, user.id)
    ))
    .limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })

  const persisted = await ensurePlanActions(event, plan.id, user.id)
  const action = body.actionId
    ? persisted.find(item => item.id === body.actionId)
    : persisted.find(item => item.sequence === body.actionIndex)
  if (!action) throw createError({ statusCode: 422, message: '方案动作不存在' })
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.update(schema.planActions).set({
      status: body.status,
      completedAt: body.status === 'completed' ? now : null,
      updatedAt: now
    }).where(and(eq(schema.planActions.id, action.id), eq(schema.planActions.ownerUserId, user.id)))
    const legacy = (plan.actions as Array<{ title: string; detail: string; status: string }>) || []
    if (legacy[action.sequence]) legacy[action.sequence] = { ...legacy[action.sequence]!, status: body.status }
    await tx.update(schema.plans).set({ actions: legacy as any, updatedAt: now }).where(eq(schema.plans.id, plan.id))
  })
  await trackProductEvent(event, {
    schoolId: user.schoolId, userId: user.id, eventName: 'plan_action_updated',
    targetType: 'plan_action', targetId: action.id, metadata: { status: body.status }
  })

  return { ok: true, actionId: action.id }
})

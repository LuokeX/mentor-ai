import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
})

const PRODUCT_EVENT_NAMES = [
  'assistant_question_submitted',
  'assessment_completed'
]

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const query = querySchema.parse(getQuery(event))
  const db = useDb(event)

  const [operations, productEvents] = await Promise.all([
    db.select({
      id: schema.planOperationEvents.id,
      type: schema.planOperationEvents.eventType,
      planId: schema.planOperationEvents.planId,
      actionId: schema.planOperationEvents.actionId,
      metadata: schema.planOperationEvents.metadata,
      createdAt: schema.planOperationEvents.createdAt
    }).from(schema.planOperationEvents).where(and(
      eq(schema.planOperationEvents.schoolId, user.schoolId),
      eq(schema.planOperationEvents.ownerUserId, user.id)
    )).orderBy(desc(schema.planOperationEvents.createdAt)).limit(query.limit),
    db.select({
      id: schema.productEvents.id,
      type: schema.productEvents.eventName,
      targetType: schema.productEvents.targetType,
      targetId: schema.productEvents.targetId,
      metadata: schema.productEvents.metadata,
      createdAt: schema.productEvents.createdAt
    }).from(schema.productEvents).where(and(
      eq(schema.productEvents.schoolId, user.schoolId),
      eq(schema.productEvents.userId, user.id),
      inArray(schema.productEvents.eventName, PRODUCT_EVENT_NAMES)
    )).orderBy(desc(schema.productEvents.createdAt)).limit(query.limit)
  ])

  const planIds = [...new Set([
    ...operations.map(item => item.planId),
    ...productEvents.filter(item => item.targetType === 'plan' && item.targetId).map(item => item.targetId!)
  ])]
  const plans = planIds.length
    ? await db.select({ id: schema.plans.id, title: schema.plans.title })
        .from(schema.plans)
        .where(and(
          inArray(schema.plans.id, planIds),
          eq(schema.plans.schoolId, user.schoolId),
          eq(schema.plans.ownerUserId, user.id)
        ))
    : []
  const titleByPlanId = new Map(plans.map(plan => [plan.id, plan.title]))

  return [...operations.map(item => ({
    ...item,
    source: 'plan_operation' as const,
    title: titleByPlanId.get(item.planId) || '方案记录',
    targetUrl: `/information/plans/${item.planId}`
  })), ...productEvents.map(item => ({
    ...item,
    source: 'product_event' as const,
    title: item.targetType === 'plan' && item.targetId
      ? titleByPlanId.get(item.targetId) || '方案记录'
      : null,
    targetUrl: item.targetType === 'plan' && item.targetId
      ? `/information/plans/${item.targetId}`
      : null
  }))]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, query.limit)
})

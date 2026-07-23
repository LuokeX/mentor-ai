import { and, eq } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const db = useDb(event)

  const plans = await db.select({
    id: schema.plans.id,
    title: schema.plans.title,
    module: schema.plans.module,
    status: schema.plans.status,
    updatedAt: schema.plans.updatedAt,
    nextReviewAt: schema.plans.nextReviewAt,
  }).from(schema.plans)
    .where(and(
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.status, 'in_progress')
    ))
    .orderBy(schema.plans.updatedAt)
    .limit(10)

  return { plans, count: plans.length }
})
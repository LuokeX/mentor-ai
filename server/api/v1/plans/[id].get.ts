import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { decryptSensitive } from '../../../utils/crypto'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const [plan] = await db.select().from(schema.plans).where(and(
    eq(schema.plans.id, id),
    eq(schema.plans.ownerUserId, user.id)
  )).limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })
  const reviews = await db.select().from(schema.planReviews).where(eq(schema.planReviews.planId, id)).orderBy(desc(schema.planReviews.reviewAt), desc(schema.planReviews.createdAt))
  const secret = useRuntimeConfig(event).encryptionKey
  return {
    ...plan,
    summary: decryptSensitive(plan.summaryEnc, secret),
    summaryEnc: undefined,
    reviews
  }
})

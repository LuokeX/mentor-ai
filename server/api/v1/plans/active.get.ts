import { and, eq, inArray } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
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
      eq(schema.plans.schoolId, user.schoolId),
      // 刚提交评估生成的方案是 pending_acceptance，只查 in_progress 的话
      // 工作台「进行中的方案」横幅对新方案永远不亮——教师提交完就找不到它了。
      inArray(schema.plans.status, ['pending_acceptance', 'accepted', 'in_progress', 'review_due', 'adjustment_needed'])
    ))
    .orderBy(schema.plans.updatedAt)
    .limit(10)

  return { plans, count: plans.length }
})
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { closeAssessmentSessionsForPlan } from '../../../domain/assessment-sessions'
import { canReviewPlan, canTransitionPlanStatus } from '../../../domain/plan-operations'
import { requireUser } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const schoolId = user.schoolId
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = z.object({
    status: z.enum(['in_progress', 'completed', 'closed']).optional(),
    nextReviewAt: z.string().datetime().nullable().optional()
  }).refine(value => value.status || value.nextReviewAt !== undefined).parse(await readBody(event))
  const now = new Date()
  const db = useDb(event)
  const [plan] = await db.select({
    id: schema.plans.id,
    status: schema.plans.status,
    acceptedAt: schema.plans.acceptedAt,
    updatedAt: schema.plans.updatedAt
  }).from(schema.plans).where(and(
    eq(schema.plans.id, id),
    eq(schema.plans.ownerUserId, user.id),
    eq(schema.plans.schoolId, schoolId)
  )).limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })
  if (body.status && !canTransitionPlanStatus(plan, body.status)) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '当前方案状态不允许执行此操作' })
  }
  if (body.nextReviewAt !== undefined && !canReviewPlan(plan)) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '请先接受方案，再设置复盘时间' })
  }
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(schema.plans).set({
      status: body.status,
      nextReviewAt: body.nextReviewAt === null ? null : body.nextReviewAt ? new Date(body.nextReviewAt) : undefined,
      completedAt: body.status === 'completed' ? now : undefined,
      closedAt: body.status === 'closed' ? now : undefined,
      updatedAt: now
    }).where(and(
      eq(schema.plans.id, id),
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.schoolId, schoolId),
      eq(schema.plans.status, plan.status),
      // updated_at 由 now() 写入时带微秒尾数，JS Date 只有毫秒精度，
      // 直接等值比较会恒失败（乐观锁误报冲突），两侧统一按毫秒截断。
      sql`date_trunc('milliseconds', ${schema.plans.updatedAt}) = ${plan.updatedAt}::timestamptz`
    )).returning({ id: schema.plans.id })
    if (!row) throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '方案状态已变化，请刷新后重试' })
    // 方案进入执行态（或关闭）后，评估组使命结束：再次评估应开新组、建新方案。
    if (body.status) {
      await closeAssessmentSessionsForPlan(tx, id, now)
    }
    return row
  })
  await writeAudit(event, { schoolId, actorId: user.id, action: 'plan.status.update', targetType: 'plan', targetId: id, metadata: { status: body.status } })
  return { ok: true }
})

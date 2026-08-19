import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { canTransitionPlanStatus } from '../../../../domain/plan-operations'
import { PLAN_TITLE_MAX, truncateByChars } from '../../../../domain/plan-titles'
import { requireSchoolManagement } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { matchesExpectedUpdatedAt, updatedAtMatches } from '../../../../utils/concurrency'
import { schema, useDb } from '../../../../utils/db'

/** 方案状态全集（含 archived），与教师端 server/api/v1/plans/index.get.ts 同源 */
const PLAN_STATUSES = [
  'pending_acceptance', 'accepted', 'in_progress', 'review_due',
  'adjustment_needed', 'escalated', 'completed', 'closed', 'archived'
] as const

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  nextReviewAt: z.string().datetime().nullable().optional(),
  // 状态必须过 canTransitionPlanStatus；'archived' 不在此列，归档走 [id]/archive.post
  status: z.enum(PLAN_STATUSES).optional(),
  expectedUpdatedAt: z.string().datetime()
}).refine(value => value.title !== undefined || value.nextReviewAt !== undefined || value.status !== undefined, {
  message: '至少提供 title、nextReviewAt 或 status 之一'
})

export default defineEventHandler(async (event) => {
  const { actor: user, schoolId } = await requireSchoolManagement(event, ['plans'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const now = new Date()

  const [plan] = await db.select().from(schema.plans)
    .where(and(eq(schema.plans.id, id), eq(schema.plans.schoolId, schoolId)))
    .limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })
  if (plan.status === 'archived') {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '方案已归档，请先恢复后再编辑' })
  }
  if (body.status && !canTransitionPlanStatus(plan, body.status)) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '当前方案状态不允许执行此操作' })
  }
  if (!matchesExpectedUpdatedAt(plan.updatedAt, body.expectedUpdatedAt)) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '方案已被修改，请刷新后重试' })
  }

  await db.transaction(async (tx) => {
    const patch: Partial<typeof schema.plans.$inferInsert> = { updatedAt: now }
    if (body.title !== undefined) {
      // title 是 200 截断的展示值，titleFull 存全文；管理员改标题时同步两者
      patch.title = truncateByChars(body.title, PLAN_TITLE_MAX)
      patch.titleFull = body.title
    }
    if (body.nextReviewAt !== undefined) {
      patch.nextReviewAt = body.nextReviewAt === null ? null : new Date(body.nextReviewAt)
    }
    if (body.status !== undefined) {
      patch.status = body.status
      if (body.status === 'completed') patch.completedAt = now
      if (body.status === 'closed') patch.closedAt = now
    }
    const [updated] = await tx.update(schema.plans).set(patch)
      .where(and(
        eq(schema.plans.id, id),
        eq(schema.plans.schoolId, schoolId),
        updatedAtMatches(schema.plans.updatedAt, body.expectedUpdatedAt)
      ))
      .returning({ id: schema.plans.id })
    if (!updated) {
      throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '方案已被修改，请刷新后重试' })
    }
    await writeAudit(event, {
      schoolId, actorId: user.id, action: 'school_admin.plan.patch',
      targetType: 'plan', targetId: id,
      metadata: {
        title: body.title !== undefined ? { before: plan.title, after: body.title } : undefined,
        nextReviewAt: body.nextReviewAt !== undefined
          ? { before: plan.nextReviewAt ? plan.nextReviewAt.toISOString() : null, after: body.nextReviewAt ?? null }
          : undefined,
        status: body.status !== undefined ? { before: plan.status, after: body.status } : undefined
      }
    }, tx)
  })
  return { ok: true }
})
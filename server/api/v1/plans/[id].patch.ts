import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { closeAssessmentSessionsForPlan } from '../../../domain/assessment-sessions'
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
  const updated = await useDb(event).transaction(async (tx) => {
    const [row] = await tx.update(schema.plans).set({
      status: body.status,
      nextReviewAt: body.nextReviewAt === null ? null : body.nextReviewAt ? new Date(body.nextReviewAt) : undefined,
      completedAt: body.status === 'completed' ? now : undefined,
      closedAt: body.status === 'closed' ? now : undefined,
      updatedAt: now
    }).where(and(
      eq(schema.plans.id, id),
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.schoolId, schoolId)
    )).returning({ id: schema.plans.id })
    if (!row) throw createError({ statusCode: 404, message: '方案不存在' })
    // 方案进入执行态（或关闭）后，评估组使命结束：再次评估应开新组、建新方案。
    if (body.status) {
      await closeAssessmentSessionsForPlan(tx, id, now)
    }
    return row
  })
  await writeAudit(event, { schoolId, actorId: user.id, action: 'plan.status.update', targetType: 'plan', targetId: id, metadata: { status: body.status } })
  return { ok: true }
})
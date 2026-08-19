import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { cleanupAssessmentNotifications, cleanupPlanNotifications, deletePlanCascade, findPlanForAttempt } from '../../../../domain/plan-admin'
import { requireSchoolManagement } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

const bodySchema = z.object({ reason: z.string().trim().min(10).max(500) })

export default defineEventHandler(async (event) => {
  const { actor: user, schoolId } = await requireSchoolManagement(event, ['assessments'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))

  const [attempt] = await useDb(event).select({
    id: schema.assessmentAttempts.id,
    assessmentCode: schema.assessmentAttempts.assessmentCode
  }).from(schema.assessmentAttempts)
    .where(and(eq(schema.assessmentAttempts.id, id), eq(schema.assessmentAttempts.schoolId, schoolId)))
    .limit(1)
  if (!attempt) throw createError({ statusCode: 404, message: '评估不存在' })

  await useDb(event).transaction(async (tx) => {
    // 先删关联方案（含 5 张 restrict 子表与通知）；plan_assessment_attempts 对 plans 是 cascade，自动清理
    const planId = await findPlanForAttempt(tx, id)
    const deletedPlanIds: string[] = []
    if (planId) {
      const { actionIds } = await deletePlanCascade(tx, planId)
      await cleanupPlanNotifications(tx, { planId, actionIds })
      deletedPlanIds.push(planId)
    }
    // 再删评估：assessment_session_attempts / plan_assessment_attempts 对评估均为 cascade
    await tx.delete(schema.assessmentAttempts).where(and(
      eq(schema.assessmentAttempts.id, id),
      eq(schema.assessmentAttempts.schoolId, schoolId)
    ))
    await cleanupAssessmentNotifications(tx, id)
    await writeAudit(event, {
      schoolId, actorId: user.id, action: 'school_admin.assessment.hard_delete',
      targetType: 'assessment', targetId: id,
      metadata: { reason: body.reason, planIds: deletedPlanIds, assessmentCode: attempt.assessmentCode }
    }, tx)
  })
  return { ok: true }
})
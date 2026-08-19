import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireSchoolManagement } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { decryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor: user, schoolId } = await requireSchoolManagement(event, ['plans'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey

  const [plan] = await db.select().from(schema.plans)
    .where(and(eq(schema.plans.id, id), eq(schema.plans.schoolId, schoolId)))
    .limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })

  // 关联评估：经 plan_assessment_attempts 按 sequence 保序投影
  const assessments = await db.select({
    id: schema.assessmentAttempts.id,
    code: schema.assessmentAttempts.assessmentCode,
    status: schema.assessmentAttempts.status,
    result: schema.assessmentAttempts.result,
    submittedAt: schema.assessmentAttempts.submittedAt
  }).from(schema.assessmentAttempts)
    .innerJoin(schema.planAssessmentAttempts, eq(schema.planAssessmentAttempts.assessmentAttemptId, schema.assessmentAttempts.id))
    .where(eq(schema.planAssessmentAttempts.planId, id))
    .orderBy(asc(schema.planAssessmentAttempts.sequence))

  await writeAudit(event, {
    schoolId, actorId: user.id, action: 'school_admin.plan.read',
    targetType: 'plan', targetId: id
  })

  const { summaryEnc, acceptanceReasonEnc, ...rest } = plan
  return {
    ...rest,
    summary: decryptSensitive(summaryEnc, secret),
    acceptanceReason: acceptanceReasonEnc ? decryptSensitive(acceptanceReasonEnc, secret) : null,
    assessments
  }
})
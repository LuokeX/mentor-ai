import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)

  const [plan] = await db.select({
    id: schema.plans.id,
    schoolId: schema.plans.schoolId,
    sourceAssessmentAttemptId: schema.plans.sourceAssessmentAttemptId
  }).from(schema.plans).where(and(
    eq(schema.plans.id, id),
    eq(schema.plans.ownerUserId, user.id),
    eq(schema.plans.schoolId, user.schoolId)
  )).limit(1)

  if (plan) {
    await db.transaction(async (tx) => {
      await tx.delete(schema.plans).where(and(
        eq(schema.plans.id, plan.id),
        eq(schema.plans.ownerUserId, user.id),
        eq(schema.plans.schoolId, user.schoolId!)
      ))
      if (plan.sourceAssessmentAttemptId) {
        await tx.delete(schema.assessmentAttempts).where(and(
          eq(schema.assessmentAttempts.id, plan.sourceAssessmentAttemptId),
          eq(schema.assessmentAttempts.ownerUserId, user.id),
          eq(schema.assessmentAttempts.schoolId, user.schoolId!)
        ))
      }
    })

    await writeAudit(event, {
      schoolId: user.schoolId,
      actorId: user.id,
      action: 'support_case.delete',
      targetType: 'plan',
      targetId: plan.id,
      metadata: { sourceAssessmentAttemptId: plan.sourceAssessmentAttemptId }
    })

    return { deleted: true, type: 'plan' }
  }

  const [attempt] = await db.select({ id: schema.assessmentAttempts.id }).from(schema.assessmentAttempts).where(and(
    eq(schema.assessmentAttempts.id, id),
    eq(schema.assessmentAttempts.ownerUserId, user.id),
    eq(schema.assessmentAttempts.schoolId, user.schoolId)
  )).limit(1)

  if (attempt) {
    await db.delete(schema.assessmentAttempts).where(and(
      eq(schema.assessmentAttempts.id, attempt.id),
      eq(schema.assessmentAttempts.ownerUserId, user.id),
      eq(schema.assessmentAttempts.schoolId, user.schoolId)
    ))

    await writeAudit(event, {
      schoolId: user.schoolId,
      actorId: user.id,
      action: 'support_case.delete',
      targetType: 'assessment',
      targetId: attempt.id
    })

    return { deleted: true, type: 'assessment' }
  }

  throw createError({ statusCode: 404, message: '支持案例不存在' })
})

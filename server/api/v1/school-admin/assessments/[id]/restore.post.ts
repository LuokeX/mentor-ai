import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { findPlanForAttempt, restorePlanCascade } from '../../../../../domain/plan-admin'
import { requireSchoolManagement } from '../../../../../domain/school-management'
import { writeAudit } from '../../../../../utils/audit'
import { matchesExpectedUpdatedAt, updatedAtMatches } from '../../../../../utils/concurrency'
import { schema, useDb } from '../../../../../utils/db'

const bodySchema = z.object({ expectedUpdatedAt: z.string().datetime(), reason: z.string().trim().min(10).max(500) })

export default defineEventHandler(async (event) => {
  const { actor: user, schoolId } = await requireSchoolManagement(event, ['assessments'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const now = new Date()

  const [attempt] = await db.select().from(schema.assessmentAttempts)
    .where(and(eq(schema.assessmentAttempts.id, id), eq(schema.assessmentAttempts.schoolId, schoolId)))
    .limit(1)
  if (!attempt) throw createError({ statusCode: 404, message: '评估不存在' })
  if (attempt.status !== 'archived') {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '只能恢复已归档的评估' })
  }
  if (!matchesExpectedUpdatedAt(attempt.updatedAt, body.expectedUpdatedAt)) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '评估已被修改，请刷新后重试' })
  }

  await db.transaction(async (tx) => {
    const [updated] = await tx.update(schema.assessmentAttempts).set({
      status: attempt.archivedPreviousStatus || 'submitted',
      archivedAt: null,
      archivedBy: null,
      archivedPreviousStatus: null,
      updatedAt: now
    }).where(and(
      eq(schema.assessmentAttempts.id, id),
      eq(schema.assessmentAttempts.schoolId, schoolId),
      eq(schema.assessmentAttempts.status, 'archived'),
      updatedAtMatches(schema.assessmentAttempts.updatedAt, body.expectedUpdatedAt)
    )).returning({ id: schema.assessmentAttempts.id })
    if (!updated) {
      throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '评估已被修改，请刷新后重试' })
    }

    // 连带恢复所属方案（方案同样处于归档态时恢复为归档前状态）
    const planId = await findPlanForAttempt(tx, id)
    const planRestoredStatus = planId ? await restorePlanCascade(tx, { schoolId, planId, actorId: user.id, now }) : null

    await writeAudit(event, {
      schoolId, actorId: user.id, action: 'school_admin.assessment.restore',
      targetType: 'assessment', targetId: id,
      metadata: {
        reason: body.reason,
        restoredStatus: attempt.archivedPreviousStatus || 'submitted',
        planId: planId ?? null,
        planRestoredStatus: planRestoredStatus ?? null
      }
    }, tx)
  })
  return { ok: true }
})
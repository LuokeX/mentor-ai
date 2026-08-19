import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { archivePlanCascade, findPlanForAttempt } from '../../../../../domain/plan-admin'
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
  if (attempt.status === 'archived') {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '评估已归档' })
  }
  if (!matchesExpectedUpdatedAt(attempt.updatedAt, body.expectedUpdatedAt)) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '评估已被修改，请刷新后重试' })
  }

  await db.transaction(async (tx) => {
    const [updated] = await tx.update(schema.assessmentAttempts).set({
      status: 'archived',
      archivedAt: now,
      archivedBy: user.id,
      archivedPreviousStatus: attempt.status,
      updatedAt: now
    }).where(and(
      eq(schema.assessmentAttempts.id, id),
      eq(schema.assessmentAttempts.schoolId, schoolId),
      updatedAtMatches(schema.assessmentAttempts.updatedAt, body.expectedUpdatedAt)
    )).returning({ id: schema.assessmentAttempts.id })
    if (!updated) {
      throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '评估已被修改，请刷新后重试' })
    }

    // 连带处置所属方案：评估归档 → 方案一并归档，方案原状态存入 archivedPreviousStatus
    const planId = await findPlanForAttempt(tx, id)
    const planPreviousStatus = planId ? await archivePlanCascade(tx, { schoolId, planId, actorId: user.id, now }) : null

    await writeAudit(event, {
      schoolId, actorId: user.id, action: 'school_admin.assessment.archive',
      targetType: 'assessment', targetId: id,
      metadata: {
        reason: body.reason,
        previousStatus: attempt.status,
        planId: planId ?? null,
        planPreviousStatus: planPreviousStatus ?? null
      }
    }, tx)
  })
  return { ok: true }
})
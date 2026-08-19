import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireSchoolManagement } from '../../../../../domain/school-management'
import { writeAudit } from '../../../../../utils/audit'
import { matchesExpectedUpdatedAt, updatedAtMatches } from '../../../../../utils/concurrency'
import { schema, useDb } from '../../../../../utils/db'

const bodySchema = z.object({ expectedUpdatedAt: z.string().datetime(), reason: z.string().trim().min(10).max(500) })

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
  if (plan.status !== 'archived') {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '只能恢复已归档的方案' })
  }
  if (!matchesExpectedUpdatedAt(plan.updatedAt, body.expectedUpdatedAt)) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '方案已被修改，请刷新后重试' })
  }

  // 仅处置方案自身（不连动评估）；恢复为归档前状态（缺省 in_progress）
  await db.transaction(async (tx) => {
    const restoredStatus = plan.archivedPreviousStatus || 'in_progress'
    const [updated] = await tx.update(schema.plans).set({
      status: restoredStatus,
      archivedAt: null,
      archivedBy: null,
      archivedPreviousStatus: null,
      updatedAt: now
    }).where(and(
      eq(schema.plans.id, id),
      eq(schema.plans.schoolId, schoolId),
      eq(schema.plans.status, 'archived'),
      updatedAtMatches(schema.plans.updatedAt, body.expectedUpdatedAt)
    )).returning({ id: schema.plans.id })
    if (!updated) {
      throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '方案已被修改，请刷新后重试' })
    }
    await writeAudit(event, {
      schoolId, actorId: user.id, action: 'school_admin.plan.restore',
      targetType: 'plan', targetId: id,
      metadata: { reason: body.reason, restoredStatus }
    }, tx)
  })
  return { ok: true }
})
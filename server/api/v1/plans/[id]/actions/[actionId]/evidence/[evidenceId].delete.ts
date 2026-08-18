import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { canUpdatePlanActions } from '../../../../../../../domain/plan-operations'
import { requireUser } from '../../../../../../../utils/auth'
import { writeAudit } from '../../../../../../../utils/audit'
import { schema, useDb } from '../../../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const planId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const actionId = z.string().uuid().parse(getRouterParam(event, 'actionId'))
  const evidenceId = z.string().uuid().parse(getRouterParam(event, 'evidenceId'))
  const db = useDb(event)
  const [plan] = await db.select({ status: schema.plans.status, acceptedAt: schema.plans.acceptedAt })
    .from(schema.plans).where(and(
      eq(schema.plans.id, planId),
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.schoolId, user.schoolId)
    )).limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })
  if (!canUpdatePlanActions(plan)) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '当前方案状态不可删除执行证据' })
  }
  const [deleted] = await db.update(schema.planActionEvidence).set({
    status: 'deleted',
    contentEnc: null,
    deletedAt: new Date()
  }).where(and(
    eq(schema.planActionEvidence.id, evidenceId),
    eq(schema.planActionEvidence.planId, planId),
    eq(schema.planActionEvidence.actionId, actionId),
    eq(schema.planActionEvidence.ownerUserId, user.id),
    eq(schema.planActionEvidence.schoolId, user.schoolId),
    eq(schema.planActionEvidence.status, 'active')
  )).returning({ id: schema.planActionEvidence.id })
  if (!deleted) throw createError({ statusCode: 404, message: '证据文件不存在' })
  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'plan.action.evidence.delete',
    targetType: 'plan_action_evidence',
    targetId: evidenceId,
    metadata: { planId, actionId }
  })
  return { ok: true }
})

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { planActionBlockReasonSchema, planActionStatusSchema } from '../../../../../shared/reports'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { encryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'
import { ensurePlanActions } from '../../../../domain/plan-actions'
import { recordPlanOperationEvent } from '../../../../domain/plan-operations'
import { trackProductEvent } from '../../../../domain/product-events'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = z.object({
    actionId: z.string().uuid().optional(),
    actionIndex: z.number().int().min(0).max(50).optional(),
    status: planActionStatusSchema,
    executedAt: z.string().datetime().optional(),
    executionNote: z.string().trim().min(1).max(500).optional(),
    blockReason: planActionBlockReasonSchema.optional(),
    blockNote: z.string().trim().max(500).optional(),
    evidenceType: z.enum(['observation', 'communication', 'artifact', 'none']).default('none'),
    evidenceSummary: z.string().trim().max(500).optional(),
    teacherConfidence: z.number().int().min(1).max(5).optional()
  })
    .refine(value => value.actionId || value.actionIndex !== undefined, { message: '必须提供动作 ID' })
    .superRefine((value, context) => {
      if (value.status === 'blocked' && !value.blockReason) {
        context.addIssue({ code: 'custom', path: ['blockReason'], message: '标记受阻时必须选择受阻原因' })
      }
    })
    .parse(await readBody(event))
  const db = useDb(event)

  const [plan] = await db.select({
    id: schema.plans.id,
    schoolId: schema.plans.schoolId,
    ownerUserId: schema.plans.ownerUserId,
    actions: schema.plans.actions,
    status: schema.plans.status
  })
    .from(schema.plans)
    .where(and(
      eq(schema.plans.id, id),
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.schoolId, user.schoolId)
    ))
    .limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })
  if (['completed', 'closed', 'archived'].includes(plan.status)) {
    throw createError({ statusCode: 422, message: '已关闭方案不能继续更新动作' })
  }

  const persisted = await ensurePlanActions(event, plan.id, user.id)
  const action = body.actionId
    ? persisted.find(item => item.id === body.actionId)
    : persisted.find(item => item.sequence === body.actionIndex)
  if (!action) throw createError({ statusCode: 422, message: '方案动作不存在' })
  const now = new Date()
  const secret = useRuntimeConfig(event).encryptionKey
  const nextPlanStatus = body.status === 'blocked'
    ? (['risk_escalated', 'need_collaboration'].includes(body.blockReason || '') ? 'escalated' : 'adjustment_needed')
    : (body.status === 'in_progress' || body.status === 'completed' ? 'in_progress' : plan.status)
  await db.transaction(async (tx) => {
    await tx.update(schema.planActions).set({
      status: body.status,
      completedAt: body.status === 'completed' ? now : null,
      executedAt: body.executedAt ? new Date(body.executedAt) : (body.status === 'completed' ? now : null),
      executionNote: body.executionNote ?? null,
      startedAt: body.status === 'in_progress' && !action.startedAt ? now : action.startedAt,
      blockedAt: body.status === 'blocked' ? now : null,
      blockReason: body.status === 'blocked' ? body.blockReason : null,
      blockNoteEnc: body.status === 'blocked' && body.blockNote ? encryptSensitive(body.blockNote, secret) : null,
      evidenceType: body.evidenceType || 'none',
      evidenceSummaryEnc: body.evidenceSummary ? encryptSensitive(body.evidenceSummary, secret) : null,
      teacherConfidence: body.teacherConfidence || null,
      updatedAt: now
    }).where(and(eq(schema.planActions.id, action.id), eq(schema.planActions.ownerUserId, user.id)))
    const legacy = (plan.actions as Array<{ title: string; detail: string; status: string }>) || []
    if (legacy[action.sequence]) legacy[action.sequence] = { ...legacy[action.sequence]!, status: body.status }
    await tx.update(schema.plans).set({ actions: legacy as any, status: nextPlanStatus, updatedAt: now }).where(eq(schema.plans.id, plan.id))
  })
  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'plan.action.update',
    targetType: 'plan',
    targetId: plan.id,
    metadata: { actionId: action.id, status: body.status, blockReason: body.blockReason }
  })
  await trackProductEvent(event, {
    schoolId: user.schoolId, userId: user.id, eventName: 'plan_action_updated',
    targetType: 'plan_action', targetId: action.id, metadata: { status: body.status, blockReason: body.blockReason || null, hasExecutionNote: Boolean(body.executionNote) }
  })
  await recordPlanOperationEvent(event, {
    schoolId: user.schoolId,
    ownerUserId: user.id,
    planId: plan.id,
    actionId: action.id,
    eventType: body.status === 'blocked' ? 'plan_action_blocked' : 'plan_action_updated',
    metadata: { status: body.status, blockReason: body.blockReason || null, confidence: body.teacherConfidence || null }
  })

  return { ok: true, actionId: action.id }
})

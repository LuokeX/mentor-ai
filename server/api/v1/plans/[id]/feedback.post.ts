import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { planFeedbackCreateSchema } from '../../../../../shared/reports'
import { canReviewPlan, recordPlanOperationEvent } from '../../../../domain/plan-operations'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'
import { trackProductEvent } from '../../../../domain/product-events'
import { encryptSensitive } from '../../../../utils/crypto'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = planFeedbackCreateSchema.parse(await readBody(event))
  const db = useDb(event)

  const [plan] = await db.select({
    id: schema.plans.id,
    schoolId: schema.plans.schoolId,
    module: schema.plans.module,
    matchedRuleIds: schema.plans.matchedRuleIds,
    matchedToolCodes: schema.plans.matchedToolCodes,
    sourceResourceVersionIds: schema.plans.sourceResourceVersionIds,
    status: schema.plans.status,
    acceptedAt: schema.plans.acceptedAt
  })
    .from(schema.plans)
    .where(and(
      eq(schema.plans.id, id),
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.schoolId, user.schoolId)
    ))
    .limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })
  if (!canReviewPlan(plan)) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '请先接受并执行方案，再提交质量反馈' })
  }
  if (body.actionId) {
    const [action] = await db.select({ id: schema.planActions.id }).from(schema.planActions).where(and(
      eq(schema.planActions.id, body.actionId),
      eq(schema.planActions.planId, plan.id),
      eq(schema.planActions.ownerUserId, user.id)
    )).limit(1)
    if (!action) throw createError({ statusCode: 422, message: '方案动作不存在' })
  }

  const [feedback] = await db.insert(schema.planFeedback).values({
    schoolId: plan.schoolId,
    planId: plan.id,
    actionId: body.actionId || null,
    ownerUserId: user.id,
    module: plan.module,
    ruleIds: body.ruleIds?.length ? body.ruleIds : plan.matchedRuleIds,
    toolCodes: body.toolCodes?.length ? body.toolCodes : plan.matchedToolCodes,
    sourceResourceVersionIds: plan.sourceResourceVersionIds,
    attributionAccuracy: body.attributionAccuracy,
    toolUsability: body.toolUsability,
    scriptNaturalness: body.scriptNaturalness,
    actionDifficulty: body.actionDifficulty,
    tags: body.tags,
    noteEnc: body.note ? encryptSensitive(body.note, useRuntimeConfig(event).encryptionKey) : null
  }).returning()

  await writeAudit(event, {
    schoolId: plan.schoolId,
    actorId: user.id,
    action: 'plan.feedback.create',
    targetType: 'plan',
    targetId: plan.id,
    metadata: {
      attributionAccuracy: body.attributionAccuracy,
      toolUsability: body.toolUsability,
      tags: body.tags
    }
  })
  await trackProductEvent(event, {
    schoolId: plan.schoolId,
    userId: user.id,
    eventName: 'plan_feedback_submitted',
    targetType: 'plan',
    targetId: plan.id,
    metadata: {
      attributionAccuracy: body.attributionAccuracy,
      toolUsability: body.toolUsability,
      ruleCount: (body.ruleIds?.length ? body.ruleIds : plan.matchedRuleIds).length,
      toolCount: (body.toolCodes?.length ? body.toolCodes : plan.matchedToolCodes).length,
      tagCount: body.tags.length
    }
  })
  await recordPlanOperationEvent(event, {
    schoolId: plan.schoolId,
    ownerUserId: user.id,
    planId: plan.id,
    actionId: body.actionId,
    eventType: 'plan_feedback_submitted',
    metadata: {
      attributionAccuracy: body.attributionAccuracy,
      toolUsability: body.toolUsability,
      tagCount: body.tags.length
    }
  })
  return feedback ? { ...feedback, noteEnc: undefined, note: body.note || null } : { ok: true }
})

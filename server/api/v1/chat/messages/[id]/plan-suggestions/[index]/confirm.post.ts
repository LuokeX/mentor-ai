import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../../../utils/auth'
import { schema, useDb } from '../../../../../../../utils/db'
import { ensurePlanActions } from '../../../../../../../domain/plan-actions'
import { trackProductEvent } from '../../../../../../../domain/product-events'
import { writeAudit } from '../../../../../../../utils/audit'

type Suggestion = { planId?: string, actionId?: string, newStatus?: string, progressNote?: string, appliedAt?: string, executedAt?: string, executionNote?: string }

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const messageId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const index = z.coerce.number().int().min(0).max(4).parse(getRouterParam(event, 'index'))
  const body = z.object({
    executedAt: z.string().datetime().optional(),
    executionNote: z.string().min(1).max(500).optional(),
  }).parse(await readBody(event))
  const db = useDb(event)
  const [message] = await db.select().from(schema.chatMessages).where(and(
    eq(schema.chatMessages.id, messageId), eq(schema.chatMessages.ownerUserId, user.id), eq(schema.chatMessages.role, 'assistant'),
    isNull(schema.chatMessages.deletedAt)
  )).limit(1)
  if (!message) throw createError({ statusCode: 404, message: '回答不存在' })
  const metadata = (message.metadata || {}) as Record<string, unknown>
  const suggestions = Array.isArray(metadata.planUpdateSuggestions) ? metadata.planUpdateSuggestions as Suggestion[] : []
  const suggestion = suggestions[index]
  if (!suggestion?.planId) throw createError({ statusCode: 404, message: '方案更新建议不存在' })
  if (suggestion.appliedAt) throw createError({ statusCode: 409, message: '该建议已经确认' })
  const actions = await ensurePlanActions(event, suggestion.planId, user.id)
  const action = suggestion.actionId ? actions.find(item => item.id === suggestion.actionId) : undefined
  const [plan] = await db.select().from(schema.plans).where(and(
    eq(schema.plans.id, suggestion.planId), eq(schema.plans.ownerUserId, user.id)
  )).limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })
  const allowedStatus = ['pending', 'in_progress', 'completed', 'cancelled']
  const newStatus = suggestion.newStatus && allowedStatus.includes(suggestion.newStatus) ? suggestion.newStatus : undefined
  const now = new Date()
  await db.transaction(async (tx) => {
    if (action && newStatus) {
      await tx.update(schema.planActions).set({
        status: newStatus,
        completedAt: newStatus === 'completed' ? now : null,
        executedAt: body.executedAt ? new Date(body.executedAt) : undefined,
        executionNote: body.executionNote || null,
        updatedAt: now
      }).where(and(eq(schema.planActions.id, action.id), eq(schema.planActions.ownerUserId, user.id)))
      const legacy = (plan.actions || []) as Array<{ title: string, detail: string, status: string }>
      if (legacy[action.sequence]) legacy[action.sequence] = { ...legacy[action.sequence]!, status: newStatus }
      await tx.update(schema.plans).set({ actions: legacy as any, updatedAt: now }).where(eq(schema.plans.id, plan.id))
    }
    if (suggestion.progressNote?.trim()) {
      await tx.insert(schema.planReviews).values({
        schoolId: user.schoolId!, planId: plan.id, ownerUserId: user.id,
        effectScore: 3, progressNote: suggestion.progressNote.slice(0, 500), nextAction: '继续跟进'
      })
    }
    suggestions[index] = { ...suggestion, appliedAt: now.toISOString() }
    await tx.update(schema.chatMessages).set({ metadata: { ...metadata, planUpdateSuggestions: suggestions } })
      .where(eq(schema.chatMessages.id, message.id))
  })
  await writeAudit(event, {
    schoolId: user.schoolId, actorId: user.id, action: 'plan.ai_suggestion.confirm',
    targetType: 'plan', targetId: plan.id, metadata: { messageId, suggestionIndex: index, actionId: action?.id, newStatus }
  })
  await trackProductEvent(event, {
    schoolId: user.schoolId, userId: user.id, eventName: 'plan_suggestion_confirmed',
    targetType: 'plan', targetId: plan.id, metadata: { hasActionUpdate: Boolean(action && newStatus), hasReview: Boolean(suggestion.progressNote) }
  })
  return { ok: true, actionId: action?.id }
})

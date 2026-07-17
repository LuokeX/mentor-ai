import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { encryptSensitive } from '../../../../../utils/crypto'
import { schema, useDb } from '../../../../../utils/db'
import { trackProductEvent } from '../../../../../domain/product-events'

const bodySchema = z.object({
  rating: z.enum(['helpful', 'not_helpful']),
  reasons: z.array(z.enum(['not_relevant', 'not_actionable', 'source_insufficient', 'too_generic', 'other'])).max(5).default([]),
  comment: z.string().trim().max(500).optional()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const messageId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const [message] = await db.select({ id: schema.chatMessages.id, sessionId: schema.chatMessages.sessionId })
    .from(schema.chatMessages).where(and(
      eq(schema.chatMessages.id, messageId), eq(schema.chatMessages.ownerUserId, user.id), eq(schema.chatMessages.role, 'assistant')
    )).limit(1)
  if (!message) throw createError({ statusCode: 404, message: '回答不存在' })
  const now = new Date()
  await db.insert(schema.assistantFeedback).values({
    schoolId: user.schoolId,
    userId: user.id,
    sessionId: message.sessionId,
    messageId,
    rating: body.rating,
    reasons: body.reasons,
    commentEnc: body.comment ? encryptSensitive(body.comment, useRuntimeConfig(event).encryptionKey) : null
  }).onConflictDoUpdate({
    target: [schema.assistantFeedback.userId, schema.assistantFeedback.messageId],
    set: {
      rating: body.rating,
      reasons: body.reasons,
      commentEnc: body.comment ? encryptSensitive(body.comment, useRuntimeConfig(event).encryptionKey) : null,
      updatedAt: now
    }
  })
  await trackProductEvent(event, {
    schoolId: user.schoolId, userId: user.id, eventName: 'assistant_feedback_submitted',
    targetType: 'chat_message', targetId: messageId, metadata: { rating: body.rating }
  })
  return { ok: true }
})

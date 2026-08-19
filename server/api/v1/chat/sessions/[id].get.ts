import { and, asc, eq } from 'drizzle-orm'
import { requireUser } from '../../../../utils/auth'
import { decryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = getRouterParam(event, 'id') || ''
  const db = useDb(event)
  const [session] = await db.select().from(schema.chatSessions)
    .where(and(eq(schema.chatSessions.id, id), eq(schema.chatSessions.ownerUserId, user.id), eq(schema.chatSessions.schoolId, user.schoolId!)))
    .limit(1)
  if (!session) throw createError({ statusCode: 404, message: '对话不存在' })
  if (session.status === 'archived') throw createError({ statusCode: 409, message: '对话已归档' })
  const config = useRuntimeConfig(event)
  const messages = await db.select({
    id: schema.chatMessages.id,
    role: schema.chatMessages.role,
    contentEnc: schema.chatMessages.contentEnc,
    metadata: schema.chatMessages.metadata,
    createdAt: schema.chatMessages.createdAt
  }).from(schema.chatMessages)
    .where(and(eq(schema.chatMessages.sessionId, id), eq(schema.chatMessages.ownerUserId, user.id)))
    .orderBy(asc(schema.chatMessages.createdAt))
  return {
    session,
    messages: messages.map(item => ({
      id: item.id,
      role: item.role,
      text: decryptSensitive(item.contentEnc, config.encryptionKey),
      metadata: item.metadata,
      createdAt: item.createdAt
    }))
  }
})

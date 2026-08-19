import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import { requireUser } from '../../../../utils/auth'
import { decryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = getRouterParam(event, 'id') || ''
  const db = useDb(event)
  const [session] = await db.select().from(schema.chatSessions)
    .where(and(
      eq(schema.chatSessions.id, id),
      eq(schema.chatSessions.ownerUserId, user.id),
      eq(schema.chatSessions.schoolId, user.schoolId!),
      // 管理员归档的对话对教师不可见（视为不存在，404 语义与现状一致）
      ne(schema.chatSessions.status, 'archived'),
    ))
    .limit(1)
  if (!session) throw createError({ statusCode: 404, message: '对话不存在' })
  const config = useRuntimeConfig(event)
  const messages = await db.select({
    id: schema.chatMessages.id,
    role: schema.chatMessages.role,
    contentEnc: schema.chatMessages.contentEnc,
    metadata: schema.chatMessages.metadata,
    createdAt: schema.chatMessages.createdAt
  }).from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.sessionId, id),
      eq(schema.chatMessages.ownerUserId, user.id),
      // 管理员软删的消息对教师不可见
      isNull(schema.chatMessages.deletedAt),
    ))
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

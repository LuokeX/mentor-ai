import { and, desc, eq, ne } from 'drizzle-orm'
import { apiContext } from '../../../utils/handler'
import { schema } from '../../../utils/db'
import { loadSessionContextsBatch } from '../../../domain/chat-session-contexts'

export default defineEventHandler(async (event) => {
  const { user, db } = await apiContext(event, ['teacher'])
  const sessions = await db.select({
    id: schema.chatSessions.id,
    title: schema.chatSessions.title,
    contextType: schema.chatSessions.contextType,
    contextId: schema.chatSessions.contextId,
    metadata: schema.chatSessions.metadata,
    status: schema.chatSessions.status,
    updatedAt: schema.chatSessions.updatedAt,
    createdAt: schema.chatSessions.createdAt
  }).from(schema.chatSessions)
    .where(and(eq(schema.chatSessions.ownerUserId, user.id), ne(schema.chatSessions.status, 'archived')))
    .orderBy(desc(schema.chatSessions.updatedAt))
    .limit(30)
  // 对象集（主对象 + 关联对象）：列表里也展示「@ 了哪几位」，前端按 contexts 渲染
  const contexts = await loadSessionContextsBatch(event, sessions)
  return sessions.map(session => ({
    ...session,
    contexts: contexts.get(session.id) ?? []
  }))
})

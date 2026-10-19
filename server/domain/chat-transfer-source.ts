/**
 * 「AI 对话转存为业务记录」的来源校验。
 *
 * 场景：教师在聊天页把某条消息转存为学生事件 / 家校沟通记录，目标页预填后提交时会带上
 * sourceChatSessionId + sourceChatMessageId；服务端必须确认这两个 id 都属于当前教师，
 * 否则等于给任意记录挂上别人的会话指针（越权引用）。
 *
 * 边界：只做校验与归一化，不读取消息正文（正文由前端预填时自行取用，服务端不重复解密）。
 * 来源是可选的：手工创建的记录不带来源，返回 null。
 */
import type { H3Event } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import type { AuthUser } from '../../app/composables/useAuth'
import { schema, useDb } from '../utils/db'

export interface ChatRecordSource {
  sessionId: string
  messageId: string
}

/**
 * 校验来源会话与消息归属：两者要么都传、要么都不传。
 * 会话不存在/不属于当前教师、消息不属于该会话（或已软删）时抛 404/409，不暴露越权目标是否存在。
 */
export async function assertChatMessageSource(
  event: H3Event,
  user: AuthUser,
  sessionId?: string | null,
  messageId?: string | null
): Promise<ChatRecordSource | null> {
  if (!sessionId && !messageId) return null
  if (!sessionId || !messageId) {
    throw createError({ statusCode: 422, message: '来源对话与会话消息必须同时提供' })
  }
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const db = useDb(event)
  const [session] = await db.select({ id: schema.chatSessions.id, status: schema.chatSessions.status })
    .from(schema.chatSessions)
    .where(and(
      eq(schema.chatSessions.id, sessionId),
      eq(schema.chatSessions.ownerUserId, user.id),
      eq(schema.chatSessions.schoolId, user.schoolId)
    ))
    .limit(1)
  if (!session) throw createError({ statusCode: 404, message: '来源对话不存在' })
  if (session.status === 'archived') throw createError({ statusCode: 409, message: '来源对话已归档，无法转存' })
  const [message] = await db.select({ id: schema.chatMessages.id })
    .from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.id, messageId),
      eq(schema.chatMessages.sessionId, sessionId),
      eq(schema.chatMessages.ownerUserId, user.id),
      isNull(schema.chatMessages.deletedAt)
    ))
    .limit(1)
  if (!message) throw createError({ statusCode: 404, message: '来源对话消息不存在' })
  return { sessionId, messageId }
}

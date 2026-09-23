import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'
import { trackProductEvent } from '../../../../domain/product-events'

/**
 * 教师删除自己会话中的一条消息。
 *
 * 语义：软删（chat_messages.deleted_at / deleted_by），内容保留在库中——消息属于业务档案的一部分，
 * 历史与审计需要保留记录；历史消息读取本来就过滤 deletedAt，教师刷新后即不再看到该条。
 * 只允许操作本人、本校的消息；重复删除按无效状态流转返回 409。
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)

  // 前置查询不过滤 deletedAt：用于区分「不存在 / 越权」与「已删除」两种情况
  const [message] = await db.select({
    id: schema.chatMessages.id,
    sessionId: schema.chatMessages.sessionId,
    role: schema.chatMessages.role,
    deletedAt: schema.chatMessages.deletedAt
  }).from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.id, id),
      eq(schema.chatMessages.ownerUserId, user.id),
      eq(schema.chatMessages.schoolId, user.schoolId)
    ))
    .limit(1)
  if (!message) throw createError({ statusCode: 404, message: '消息不存在' })
  if (message.deletedAt) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '消息已删除' })
  }

  // 软删：最终 UPDATE 再次带上归属与未删条件，并发下已被删除时不重复写入
  const [deleted] = await db.update(schema.chatMessages)
    .set({ deletedAt: new Date(), deletedBy: user.id })
    .where(and(
      eq(schema.chatMessages.id, id),
      eq(schema.chatMessages.ownerUserId, user.id),
      eq(schema.chatMessages.schoolId, user.schoolId),
      isNull(schema.chatMessages.deletedAt)
    ))
    .returning({ id: schema.chatMessages.id })
  if (!deleted) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '消息已删除' })
  }

  // 审计只记会话 id 与角色，不记消息正文或任何敏感内容
  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'teacher.chat.message.delete',
    targetType: 'chat_message',
    targetId: id,
    metadata: { sessionId: message.sessionId, role: message.role }
  })
  await trackProductEvent(event, {
    schoolId: user.schoolId, userId: user.id, eventName: 'assistant_message_deleted',
    targetType: 'chat_message', targetId: id, metadata: { role: message.role }
  })

  return { deleted: true }
})

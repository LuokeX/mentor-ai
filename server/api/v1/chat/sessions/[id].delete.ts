import { and, eq } from 'drizzle-orm'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = getRouterParam(event, 'id') || ''
  const db = useDb(event)

  const [session] = await db.select({ id: schema.chatSessions.id, status: schema.chatSessions.status })
    .from(schema.chatSessions)
    .where(and(eq(schema.chatSessions.id, id), eq(schema.chatSessions.ownerUserId, user.id)))
    .limit(1)

  if (!session) throw createError({ statusCode: 404, message: '对话不存在' })

  if (session.status === 'archived') {
    throw createError({ statusCode: 409, message: '对话已归档' })
  }

  // 对话会话改为归档，不物理删除（保留关联消息）
  // chatMessages 的 onDelete 已是 restrict，不级联删除
  await db.update(schema.chatSessions).set({
    status: 'archived',
    archivedAt: new Date(),
    archivedBy: user.id,
    updatedAt: new Date(),
  }).where(and(eq(schema.chatSessions.id, id), eq(schema.chatSessions.ownerUserId, user.id)))

  return { archived: true }
})
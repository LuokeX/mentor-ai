import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../../utils/auth'
import { writeAudit } from '../../../../../../utils/audit'
import { schema, useDb } from '../../../../../../utils/db'

const bodySchema = z.object({ reason: z.string().trim().min(10).max(500).optional() })

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const messageId = z.string().uuid().parse(getRouterParam(event, 'messageId'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)

  // 消息必须属于本校且属于该会话
  const [message] = await db.select({ id: schema.chatMessages.id, deletedAt: schema.chatMessages.deletedAt })
    .from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.id, messageId),
      eq(schema.chatMessages.sessionId, id),
      eq(schema.chatMessages.schoolId, user.schoolId),
    ))
    .limit(1)
  if (!message) throw createError({ statusCode: 404, message: '消息不存在' })
  if (message.deletedAt) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '消息已删除' })
  }

  // 软删：内容保留在库中，任何详情接口不可见
  const [updated] = await db.update(schema.chatMessages)
    .set({ deletedAt: new Date(), deletedBy: user.id })
    .where(and(eq(schema.chatMessages.id, messageId), isNull(schema.chatMessages.deletedAt)))
    .returning({ id: schema.chatMessages.id })
  if (!updated) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '消息已删除' })
  }

  await writeAudit(event, {
    schoolId: user.schoolId, actorId: user.id, action: 'school_admin.conversation.message.delete',
    targetType: 'conversation', targetId: id,
    metadata: { messageId, reason: body.reason },
  })
  return { ok: true }
})
import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { decryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)

  const [session] = await db.select().from(schema.chatSessions)
    .where(and(eq(schema.chatSessions.id, id), eq(schema.chatSessions.schoolId, user.schoolId)))
    .limit(1)
  if (!session) throw createError({ statusCode: 404, message: '对话不存在' })

  const secret = useRuntimeConfig(event).encryptionKey
  // 消息只返回未软删的；软删消息内容保留在库中，任何详情接口不可见
  const [messages, routingDecisions] = await Promise.all([
    db.select({
      id: schema.chatMessages.id,
      role: schema.chatMessages.role,
      contentEnc: schema.chatMessages.contentEnc,
      metadata: schema.chatMessages.metadata,
      createdAt: schema.chatMessages.createdAt,
    }).from(schema.chatMessages)
      .where(and(eq(schema.chatMessages.sessionId, id), isNull(schema.chatMessages.deletedAt)))
      .orderBy(asc(schema.chatMessages.createdAt)),
    db.select().from(schema.routingDecisions)
      .where(eq(schema.routingDecisions.sessionId, id))
      .orderBy(asc(schema.routingDecisions.createdAt)),
  ])

  await writeAudit(event, {
    schoolId: user.schoolId, actorId: user.id, action: 'school_admin.conversation.read',
    targetType: 'conversation', targetId: id,
  })

  return {
    ...session,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      text: decryptSensitive(m.contentEnc, secret),
      metadata: m.metadata,
      createdAt: m.createdAt,
    })),
    routingDecisions,
  }
})
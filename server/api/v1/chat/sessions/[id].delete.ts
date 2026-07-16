import { and, eq } from 'drizzle-orm'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = getRouterParam(event, 'id') || ''
  const db = useDb(event)

  const [session] = await db.select({ id: schema.chatSessions.id })
    .from(schema.chatSessions)
    .where(and(eq(schema.chatSessions.id, id), eq(schema.chatSessions.ownerUserId, user.id)))
    .limit(1)

  if (!session) throw createError({ statusCode: 404, message: '对话不存在' })

  // routing_decisions 外键没有 CASCADE，需要先删
  await db.delete(schema.routingDecisions)
    .where(eq(schema.routingDecisions.sessionId, id))

  await db.delete(schema.chatSessions)
    .where(and(eq(schema.chatSessions.id, id), eq(schema.chatSessions.ownerUserId, user.id)))

  return { deleted: true }
})
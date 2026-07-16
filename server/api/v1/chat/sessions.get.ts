import { desc, eq } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  return useDb(event).select({
    id: schema.chatSessions.id,
    title: schema.chatSessions.title,
    contextType: schema.chatSessions.contextType,
    contextId: schema.chatSessions.contextId,
    status: schema.chatSessions.status,
    updatedAt: schema.chatSessions.updatedAt,
    createdAt: schema.chatSessions.createdAt
  }).from(schema.chatSessions)
    .where(eq(schema.chatSessions.ownerUserId, user.id))
    .orderBy(desc(schema.chatSessions.updatedAt))
    .limit(30)
})

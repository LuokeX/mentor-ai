import { desc, eq } from 'drizzle-orm'
import { apiContext } from '../../../utils/handler'
import { schema } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const { user, db } = await apiContext(event, ['teacher'])
  return db.select({
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

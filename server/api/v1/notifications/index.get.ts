import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const unreadOnly = z.coerce.boolean().optional().parse(getQuery(event).unreadOnly) || false
  const conditions = [eq(schema.notifications.userId, user.id)]
  if (unreadOnly) conditions.push(isNull(schema.notifications.readAt))
  return useDb(event).select().from(schema.notifications)
    .where(and(...conditions)).orderBy(desc(schema.notifications.createdAt)).limit(50)
})

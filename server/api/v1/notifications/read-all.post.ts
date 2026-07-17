import { and, eq, isNull } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const rows = await useDb(event).update(schema.notifications).set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt))).returning({ id: schema.notifications.id })
  return { ok: true, updated: rows.length }
})

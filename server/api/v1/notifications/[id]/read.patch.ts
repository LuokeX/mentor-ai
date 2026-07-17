import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const [updated] = await useDb(event).update(schema.notifications).set({ readAt: new Date() })
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, user.id))).returning({ id: schema.notifications.id })
  if (!updated) throw createError({ statusCode: 404, message: '通知不存在' })
  return { ok: true }
})

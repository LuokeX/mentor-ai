import { and, eq } from 'drizzle-orm'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = getRouterParam(event, 'id') || ''
  const db = useDb(event)

  const [attempt] = await db.select({ id: schema.assessmentAttempts.id })
    .from(schema.assessmentAttempts)
    .where(and(eq(schema.assessmentAttempts.id, id), eq(schema.assessmentAttempts.ownerUserId, user.id)))
    .limit(1)

  if (!attempt) throw createError({ statusCode: 404, message: '评估记录不存在' })

  await db.delete(schema.assessmentAttempts)
    .where(and(eq(schema.assessmentAttempts.id, id), eq(schema.assessmentAttempts.ownerUserId, user.id)))

  return { deleted: true }
})
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../../utils/auth'
import { schema, useDb } from '../../../../../../utils/db'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const schoolId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const [school] = await useDb(event).select({ id: schema.schools.id }).from(schema.schools).where(eq(schema.schools.id, schoolId)).limit(1)
  if (!school) throw createError({ statusCode: 404, message: '学校不存在' })
  return useDb(event).select({
    id: schema.users.id,
    name: schema.users.name,
    phone: schema.users.phone,
    status: schema.users.status,
    lastLoginAt: schema.users.lastLoginAt,
    createdAt: schema.users.createdAt
  }).from(schema.users).where(and(eq(schema.users.schoolId, schoolId), eq(schema.users.role, 'school_admin')))
})

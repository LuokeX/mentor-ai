import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../../utils/auth'
import { schema, useDb } from '../../../../../../utils/db'
import { userHasRole } from '../../../../../../domain/user-roles'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const schoolId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const [school] = await db.select({ id: schema.schools.id }).from(schema.schools).where(eq(schema.schools.id, schoolId)).limit(1)
  if (!school) throw createError({ statusCode: 404, message: '学校不存在' })
  return db.select({
    id: schema.users.id,
    name: schema.users.name,
    phone: schema.users.phone,
    status: schema.users.status,
    lastLoginAt: schema.users.lastLoginAt,
    createdAt: schema.users.createdAt
  }).from(schema.users).where(and(
    eq(schema.users.schoolId, schoolId),
    // 学校管理员以 user_roles 判定：兼任管理员的账号也要列出
    userHasRole(db, 'school_admin')
  ))
})

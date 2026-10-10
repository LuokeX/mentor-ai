import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { userHasRole } from '../../../../domain/user-roles'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const [school] = await db.select().from(schema.schools).where(eq(schema.schools.id, id)).limit(1)
  if (!school) throw createError({ statusCode: 404, message: '学校不存在' })
  const [[users], [teachers], [classes], [students], admins] = await Promise.all([
    db.select({ value: count() }).from(schema.users).where(eq(schema.users.schoolId, id)),
    db.select({ value: count() }).from(schema.users).where(and(
      eq(schema.users.schoolId, id),
      // 教师数量以 user_roles 判定：兼任教师的账号也要计入
      userHasRole(db, 'teacher')
    )),
    db.select({ value: count() }).from(schema.classes).where(eq(schema.classes.schoolId, id)),
    db.select({ value: count() }).from(schema.students).where(eq(schema.students.schoolId, id)),
    db.select({
      id: schema.users.id,
      name: schema.users.name,
      phone: schema.users.phone,
      status: schema.users.status,
      lastLoginAt: schema.users.lastLoginAt
    }).from(schema.users).where(and(
      eq(schema.users.schoolId, id),
      // 学校管理员以 user_roles 判定：兼任管理员的账号也要列出
      userHasRole(db, 'school_admin')
    ))
  ])
  return {
    school,
    stats: {
      users: users?.value || 0,
      teachers: teachers?.value || 0,
      classes: classes?.value || 0,
      students: students?.value || 0
    },
    admins
  }
})

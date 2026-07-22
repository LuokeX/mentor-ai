import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)
  const [school] = await db.select().from(schema.schools).where(eq(schema.schools.id, id)).limit(1)
  if (!school) throw createError({ statusCode: 404, message: '学校不存在' })
  const [[users], [teachers], [classes], [students], admins, grants] = await Promise.all([
    db.select({ value: count() }).from(schema.users).where(eq(schema.users.schoolId, id)),
    db.select({ value: count() }).from(schema.users).where(and(eq(schema.users.schoolId, id), eq(schema.users.role, 'teacher'))),
    db.select({ value: count() }).from(schema.classes).where(eq(schema.classes.schoolId, id)),
    db.select({ value: count() }).from(schema.students).where(eq(schema.students.schoolId, id)),
    db.select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      status: schema.users.status,
      lastLoginAt: schema.users.lastLoginAt
    }).from(schema.users).where(and(eq(schema.users.schoolId, id), eq(schema.users.role, 'school_admin'))),
    db.select().from(schema.delegatedManagementGrants).where(eq(schema.delegatedManagementGrants.schoolId, id)).limit(20)
  ])
  return {
    school,
    stats: {
      users: users?.value || 0,
      teachers: teachers?.value || 0,
      classes: classes?.value || 0,
      students: students?.value || 0
    },
    admins,
    delegatedManagement: grants
  }
})

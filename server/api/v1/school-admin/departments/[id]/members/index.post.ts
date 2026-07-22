import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { schoolAdminDepartmentMemberSchema } from '../../../../../../../shared/contracts'
import { requireSchoolManagement } from '../../../../../../domain/school-management'
import { writeAudit } from '../../../../../../utils/audit'
import { schema, useDb } from '../../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['departments'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = schoolAdminDepartmentMemberSchema.parse(await readBody(event))
  const db = useDb(event)
  const [[department], [member]] = await Promise.all([
    db.select({ id: schema.departments.id }).from(schema.departments).where(and(
      eq(schema.departments.id, id),
      eq(schema.departments.schoolId, schoolId),
      eq(schema.departments.status, 'active')
    )).limit(1),
    db.select({ id: schema.users.id }).from(schema.users).where(and(
      eq(schema.users.id, body.userId),
      eq(schema.users.schoolId, schoolId),
      inArray(schema.users.role, ['teacher', 'psychologist', 'school_admin']),
      eq(schema.users.status, 'active')
    )).limit(1)
  ])
  if (!department) throw createError({ statusCode: 404, message: '部门不存在或不可用' })
  if (!member) throw createError({ statusCode: 422, message: '成员不存在或不可用' })
  try {
    await db.insert(schema.departmentMembers).values({
      departmentId: id,
      userId: body.userId,
      schoolId,
      memberRole: body.memberRole || null
    })
    await writeAudit(event, {
      schoolId, actorId: actor.id, action: 'school_admin.department.member.add',
      targetType: 'department', targetId: id,
      metadata: { userId: body.userId, memberRole: body.memberRole, delegatedGrantId }
    })
    return { ok: true }
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '成员已在该部门' })
    throw error
  }
})

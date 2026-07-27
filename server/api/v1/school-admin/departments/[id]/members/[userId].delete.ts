import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireSchoolManagement } from '../../../../../../domain/school-management'
import { writeAudit } from '../../../../../../utils/audit'
import { schema, useDb } from '../../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['departments'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const userId = z.string().uuid().parse(getRouterParam(event, 'userId'))
  const db = useDb(event)

  // 部门成员关系不物理删除，改为标记为 removed
  const [member] = await db.select({ departmentId: schema.departmentMembers.departmentId, userId: schema.departmentMembers.userId })
    .from(schema.departmentMembers).where(and(
      eq(schema.departmentMembers.departmentId, id),
      eq(schema.departmentMembers.userId, userId),
      eq(schema.departmentMembers.schoolId, schoolId),
      eq(schema.departmentMembers.status, 'active')
    )).limit(1)

  if (!member) throw createError({ statusCode: 404, message: '部门成员关系不存在或已移除' })

  await db.update(schema.departmentMembers).set({ status: 'removed' }).where(and(
    eq(schema.departmentMembers.departmentId, id),
    eq(schema.departmentMembers.userId, userId),
    eq(schema.departmentMembers.schoolId, schoolId),
    eq(schema.departmentMembers.status, 'active'),
  ))

  await writeAudit(event, {
    schoolId, actorId: actor.id, action: 'school_admin.department.member.remove',
    targetType: 'department', targetId: id,
    metadata: { userId, delegatedGrantId }
  })

  return { ok: true }
})

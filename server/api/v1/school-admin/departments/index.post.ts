import { and, eq } from 'drizzle-orm'
import { schoolAdminDepartmentCreateSchema } from '../../../../../shared/contracts'
import { assertActiveTeacher, requireSchoolManagement } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['departments'])
  const body = schoolAdminDepartmentCreateSchema.parse(await readBody(event))
  const db = useDb(event)
  if (body.parentId) {
    const [parent] = await db.select({ id: schema.departments.id }).from(schema.departments).where(and(
      eq(schema.departments.id, body.parentId),
      eq(schema.departments.schoolId, schoolId),
      eq(schema.departments.status, 'active')
    )).limit(1)
    if (!parent) throw createError({ statusCode: 422, message: '上级部门不存在或不可用' })
  }
  if (body.leaderUserId) await assertActiveTeacher(event, schoolId, body.leaderUserId)
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(schema.departments).values({
        schoolId,
        parentId: body.parentId || null,
        leaderUserId: body.leaderUserId || null,
        name: body.name,
        code: body.code || null,
        type: body.type,
        description: body.description || null
      }).returning()
      if (!created) throw createError({ statusCode: 500, message: '部门创建失败' })
      await writeAudit(event, {
        schoolId, actorId: actor.id, action: 'school_admin.department.create',
        targetType: 'department', targetId: created.id,
        metadata: { type: created.type, delegatedGrantId }
      }, tx)
      return created
    })
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '部门编号已存在' })
    throw error
  }
})

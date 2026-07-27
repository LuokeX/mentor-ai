import { schoolAdminClassCreateSchema } from '../../../../../shared/contracts'
import { assertActiveDepartment, assertActiveTeacher, requireSchoolManagement } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['classes'])
  const body = schoolAdminClassCreateSchema.parse(await readBody(event))
  await assertActiveTeacher(event, schoolId, body.ownerUserId)
  await assertActiveDepartment(event, schoolId, body.departmentId)
  const db = useDb(event)
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(schema.classes).values({
        schoolId,
        departmentId: body.departmentId || null,
        ownerUserId: body.ownerUserId,
        name: body.name,
        grade: body.grade,
        externalCode: body.externalCode || null,
        studentCount: body.studentCount,
        establishedAt: body.establishedAt ? new Date(body.establishedAt) : null
      }).returning()
      if (!created) throw createError({ statusCode: 500, message: '班级创建失败' })
      await writeAudit(event, {
        schoolId, actorId: actor.id, action: 'school_admin.class.create',
        targetType: 'class', targetId: created.id,
        metadata: { ownerUserId: created.ownerUserId, departmentId: created.departmentId, delegatedGrantId }
      }, tx)
      return created
    })
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '班级外部编号已存在' })
    throw error
  }
})

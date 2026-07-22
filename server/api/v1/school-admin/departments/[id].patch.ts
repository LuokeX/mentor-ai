import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schoolAdminDepartmentUpdateSchema } from '../../../../../shared/contracts'
import { assertActiveTeacher, requireSchoolManagement } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['departments'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = schoolAdminDepartmentUpdateSchema.parse(await readBody(event))
  const db = useDb(event)
  const [department] = await db.select().from(schema.departments).where(and(eq(schema.departments.id, id), eq(schema.departments.schoolId, schoolId))).limit(1)
  if (!department) throw createError({ statusCode: 404, message: '部门不存在' })
  if (body.parentId === id) throw createError({ statusCode: 422, message: '上级部门不能选择自己' })
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
    const patch: Partial<typeof schema.departments.$inferInsert> = { updatedAt: new Date() }
    if (body.name !== undefined) patch.name = body.name
    if (body.code !== undefined) patch.code = body.code || null
    if (body.type !== undefined) patch.type = body.type
    if (body.parentId !== undefined) patch.parentId = body.parentId || null
    if (body.leaderUserId !== undefined) patch.leaderUserId = body.leaderUserId || null
    if (body.description !== undefined) patch.description = body.description || null
    if (body.status !== undefined) patch.status = body.status
    const [updated] = await db.update(schema.departments).set(patch).where(eq(schema.departments.id, id)).returning()
    if (!updated) throw createError({ statusCode: 500, message: '部门更新失败' })
    await writeAudit(event, {
      schoolId, actorId: actor.id, action: 'school_admin.department.update',
      targetType: 'department', targetId: id,
      metadata: { status: body.status, delegatedGrantId }
    })
    return updated
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '部门编号已存在' })
    throw error
  }
})

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schoolAdminDepartmentUpdateSchema } from '../../../../../shared/contracts'
import { assertActiveTeacher, requireSchoolManagement } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { matchesExpectedUpdatedAt, updatedAtMatches } from '../../../../utils/concurrency'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['departments'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = schoolAdminDepartmentUpdateSchema.parse(await readBody(event))
  const expectedUpdatedAt = z.string().datetime().optional().parse(getQuery(event).expectedUpdatedAt)
  const db = useDb(event)
  const [department] = await db.select().from(schema.departments).where(and(eq(schema.departments.id, id), eq(schema.departments.schoolId, schoolId))).limit(1)
  if (!department) throw createError({ statusCode: 404, message: '部门不存在' })
  if (expectedUpdatedAt && !matchesExpectedUpdatedAt(department.updatedAt, expectedUpdatedAt)) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '部门已被其他管理员修改，请刷新后重试' })
  }
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
    if (body.shortName !== undefined) patch.shortName = body.shortName || null
    if (body.scope !== undefined) patch.scope = body.scope
    if (body.leaderTitle !== undefined) patch.leaderTitle = body.leaderTitle || null
    if (body.location !== undefined) patch.location = body.location || null
    if (body.phone !== undefined) patch.phone = body.phone || null
    if (body.headcountLimit !== undefined) patch.headcountLimit = body.headcountLimit || null
    if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder
    if (body.status !== undefined) patch.status = body.status
    const finalConditions = [eq(schema.departments.id, id), eq(schema.departments.schoolId, schoolId)]
    if (expectedUpdatedAt) finalConditions.push(updatedAtMatches(schema.departments.updatedAt, expectedUpdatedAt))
    return await db.transaction(async (tx) => {
      const [updated] = await tx.update(schema.departments).set(patch).where(and(...finalConditions)).returning()
      if (!updated) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '部门已被其他管理员修改，请刷新后重试' })
      await writeAudit(event, {
        schoolId, actorId: actor.id, action: 'school_admin.department.update',
        targetType: 'department', targetId: id,
        metadata: { status: body.status, delegatedGrantId }
      }, tx)
      return updated
    })
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '部门编号已存在' })
    throw error
  }
})

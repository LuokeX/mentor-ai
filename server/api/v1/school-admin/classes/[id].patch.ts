import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schoolAdminClassUpdateSchema } from '../../../../../shared/contracts'
import { assertActiveDepartment, assertActiveTeacher, requireSchoolManagement, transferClassOwner } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['classes'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = schoolAdminClassUpdateSchema.parse(await readBody(event))
  const db = useDb(event)
  const [klass] = await db.select().from(schema.classes).where(and(eq(schema.classes.id, id), eq(schema.classes.schoolId, schoolId))).limit(1)
  if (!klass) throw createError({ statusCode: 404, message: '班级不存在' })
  if (body.ownerUserId) await assertActiveTeacher(event, schoolId, body.ownerUserId)
  if (body.departmentId !== undefined) await assertActiveDepartment(event, schoolId, body.departmentId)
  try {
    const updated = await db.transaction(async (tx) => {
      const patch: Partial<typeof schema.classes.$inferInsert> = {
        updatedAt: new Date()
      }
      if (body.name !== undefined) patch.name = body.name
      if (body.grade !== undefined) patch.grade = body.grade
      if (body.departmentId !== undefined) patch.departmentId = body.departmentId || null
      if (body.externalCode !== undefined) patch.externalCode = body.externalCode || null
      if (body.studentCount !== undefined) patch.studentCount = body.studentCount
      if (body.establishedAt !== undefined) patch.establishedAt = body.establishedAt ? new Date(body.establishedAt) : null
      if (body.status !== undefined) patch.status = body.status
      const [row] = await tx.update(schema.classes).set(patch).where(eq(schema.classes.id, id)).returning()
      if (!row) throw new Error('班级更新失败')
      if (body.ownerUserId && body.ownerUserId !== klass.ownerUserId) {
        await transferClassOwner(tx as ReturnType<typeof useDb>, {
          schoolId,
          classId: id,
          fromUserId: klass.ownerUserId,
          toUserId: body.ownerUserId,
          assignedBy: actor.id,
          reason: body.reason
        })
      }
      return row
    })
    await writeAudit(event, {
      schoolId, actorId: actor.id, action: 'school_admin.class.update',
      targetType: 'class', targetId: id,
      metadata: { status: body.status, departmentId: body.departmentId, ownerChanged: Boolean(body.ownerUserId && body.ownerUserId !== klass.ownerUserId), reason: body.reason, delegatedGrantId }
    })
    return updated
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '班级外部编号已存在' })
    throw error
  }
})

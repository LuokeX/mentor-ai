import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schoolAdminClassUpdateSchema } from '../../../../../shared/contracts'
import { uuidParam } from '../../../../utils/params'
import { assertActiveDepartment, assertActiveTeacher, requireSchoolManagement, transferClassOwner } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { encryptSensitive } from '../../../../utils/crypto'
import { matchesExpectedUpdatedAt, updatedAtMatches } from '../../../../utils/concurrency'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['classes'])
  const id = uuidParam(event, 'id')
  const body = schoolAdminClassUpdateSchema.parse(await readBody(event))
  const expectedUpdatedAt = z.string().datetime().optional().parse(getQuery(event).expectedUpdatedAt)
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [klass] = await db.select().from(schema.classes).where(and(eq(schema.classes.id, id), eq(schema.classes.schoolId, schoolId))).limit(1)
  if (!klass) throw createError({ statusCode: 404, message: '班级不存在' })
  if (expectedUpdatedAt && !matchesExpectedUpdatedAt(klass.updatedAt, expectedUpdatedAt)) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '班级已被其他管理员修改，请刷新后重试' })
  }
  if (body.ownerUserId) await assertActiveTeacher(event, schoolId, body.ownerUserId)
  if (body.departmentId !== undefined) await assertActiveDepartment(event, schoolId, body.departmentId)
  if (body.deputyOwnerUserId !== undefined && body.deputyOwnerUserId !== null) {
    await assertActiveTeacher(event, schoolId, body.deputyOwnerUserId)
  }
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
      if (body.section !== undefined) patch.section = body.section || null
      if (body.classType !== undefined) patch.classType = body.classType
      if (body.deputyOwnerUserId !== undefined) patch.deputyOwnerUserId = body.deputyOwnerUserId || null
      if (body.location !== undefined) patch.location = body.location || null
      if (body.schoolYear !== undefined) patch.schoolYear = body.schoolYear || null
      if (body.notes !== undefined) patch.notesEnc = body.notes ? encryptSensitive(body.notes, secret) : null
      if (body.overrides !== undefined) {
        const merged = { ...(klass.overrides || {}), ...body.overrides }
        for (const [k, v] of Object.entries(merged)) if (!v) delete merged[k]
        patch.overrides = merged
      }
      const finalConditions = [eq(schema.classes.id, id), eq(schema.classes.schoolId, schoolId)]
      if (expectedUpdatedAt) finalConditions.push(updatedAtMatches(schema.classes.updatedAt, expectedUpdatedAt))
      const [row] = await tx.update(schema.classes).set(patch).where(and(...finalConditions)).returning()
      if (!row) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '班级已被其他管理员修改，请刷新后重试' })
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
      await writeAudit(event, {
        schoolId, actorId: actor.id, action: 'school_admin.class.update',
        targetType: 'class', targetId: id,
        metadata: {
          status: body.status,
          departmentId: body.departmentId,
          ownerChanged: Boolean(body.ownerUserId && body.ownerUserId !== klass.ownerUserId),
          reason: body.reason,
          delegatedGrantId,
        }
      }, tx)
      return row
    })
    return updated
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '班级外部编号已存在' })
    throw error
  }
})

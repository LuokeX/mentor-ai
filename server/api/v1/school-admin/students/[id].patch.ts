import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schoolAdminStudentUpdateSchema } from '../../../../../shared/contracts'
import { assertActiveTeacher, requireSchoolManagement, resolveClassOwner, transferPlans, writeAssignment } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { encryptSensitive, searchableHash } from '../../../../utils/crypto'
import { matchesExpectedUpdatedAt, updatedAtMatches } from '../../../../utils/concurrency'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['students'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = schoolAdminStudentUpdateSchema.parse(await readBody(event))
  const expectedUpdatedAt = z.string().datetime().optional().parse(getQuery(event).expectedUpdatedAt)
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [student] = await db.select().from(schema.students).where(and(eq(schema.students.id, id), eq(schema.students.schoolId, schoolId))).limit(1)
  if (!student) throw createError({ statusCode: 404, message: '学生不存在' })
  if (expectedUpdatedAt && !matchesExpectedUpdatedAt(student.updatedAt, expectedUpdatedAt)) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '学生档案已被其他管理员修改，请刷新后重试' })
  }

  let nextClassId = student.classId
  let nextOwnerUserId = student.ownerUserId
  if (body.classId !== undefined) {
    const owner = await resolveClassOwner(event, schoolId, body.classId, body.ownerUserId || undefined)
    nextClassId = owner.classId
    nextOwnerUserId = owner.ownerUserId
  } else if (body.ownerUserId) {
    await assertActiveTeacher(event, schoolId, body.ownerUserId)
    nextOwnerUserId = body.ownerUserId
  }

  try {
    const updated = await db.transaction(async (tx) => {
      const patch: Partial<typeof schema.students.$inferInsert> = { updatedAt: new Date() }
      if (body.name !== undefined) {
        patch.nameEnc = encryptSensitive(body.name, secret)
        patch.nameSearch = searchableHash(body.name, secret)
      }
      if (body.gender !== undefined) patch.gender = body.gender || null
      if (body.profile !== undefined) patch.profileEnc = body.profile ? encryptSensitive(body.profile, secret) : null
      if (body.notes !== undefined) patch.notesEnc = body.notes ? encryptSensitive(body.notes, secret) : null
      if (body.externalRef !== undefined) {
        patch.externalRefEnc = body.externalRef ? encryptSensitive(body.externalRef, secret) : null
        patch.externalRefSearch = body.externalRef ? searchableHash(body.externalRef, secret) : null
      }
      if (body.birthDate !== undefined) patch.birthDate = body.birthDate ? new Date(body.birthDate) : null
      if (body.studentNo !== undefined) {
        patch.studentNoEnc = body.studentNo ? encryptSensitive(body.studentNo, secret) : null
        patch.studentNoSearch = body.studentNo ? searchableHash(body.studentNo, secret) : null
      }
      if (body.ethnicity !== undefined) patch.ethnicity = body.ethnicity || null
      if (body.enrolledAt !== undefined) patch.enrolledAt = body.enrolledAt ? new Date(body.enrolledAt) : null
      if (body.boardingType !== undefined) patch.boardingType = body.boardingType || null
      if (body.address !== undefined) patch.addressEnc = body.address ? encryptSensitive(body.address, secret) : null
      if (body.overrides !== undefined) {
        const merged = { ...(student.overrides || {}), ...body.overrides }
        for (const [k, v] of Object.entries(merged)) if (!v) delete merged[k]
        patch.overrides = merged
      }
      if (body.status !== undefined) patch.status = body.status
      if (body.classId !== undefined) patch.classId = nextClassId
      if (nextOwnerUserId !== student.ownerUserId) patch.ownerUserId = nextOwnerUserId
      const finalConditions = [eq(schema.students.id, id), eq(schema.students.schoolId, schoolId)]
      if (expectedUpdatedAt) finalConditions.push(updatedAtMatches(schema.students.updatedAt, expectedUpdatedAt))
      const [row] = await tx.update(schema.students).set(patch).where(and(...finalConditions)).returning({ id: schema.students.id })
      if (!row) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '学生档案已被其他管理员修改，请刷新后重试' })
      if (nextOwnerUserId !== student.ownerUserId) {
        await tx.update(schema.communications).set({ ownerUserId: nextOwnerUserId, updatedAt: new Date() }).where(and(eq(schema.communications.studentId, id), eq(schema.communications.schoolId, schoolId)))
        await transferPlans(tx as ReturnType<typeof useDb>, schoolId, nextOwnerUserId, eq(schema.plans.studentId, id))
        await writeAssignment(tx as ReturnType<typeof useDb>, {
          schoolId,
          targetType: 'student',
          targetId: id,
          fromUserId: student.ownerUserId,
          toUserId: nextOwnerUserId,
          assignedBy: actor.id,
          reason: body.reason,
          metadata: { classChanged: body.classId !== undefined }
        })
      }
      await writeAudit(event, {
        schoolId, actorId: actor.id, action: 'school_admin.student.update',
        targetType: 'student', targetId: id,
        metadata: {
          status: body.status,
          classChanged: body.classId !== undefined,
          ownerChanged: nextOwnerUserId !== student.ownerUserId,
          reason: body.reason,
          delegatedGrantId,
        }
      }, tx)
      return row
    })
    return { ok: true, id: updated.id }
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '学生外部编号已存在' })
    throw error
  }
})

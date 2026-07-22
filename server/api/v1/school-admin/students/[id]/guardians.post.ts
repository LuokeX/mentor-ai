import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schoolAdminStudentGuardianSchema } from '../../../../../../shared/contracts'
import { assertActiveTeacher, requireSchoolManagement } from '../../../../../domain/school-management'
import { writeAudit } from '../../../../../utils/audit'
import { encryptSensitive, searchableHash } from '../../../../../utils/crypto'
import { schema, useDb } from '../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['guardians', 'students'])
  const studentId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = schoolAdminStudentGuardianSchema.parse(await readBody(event))
  const db = useDb(event)
  const [student] = await db.select({ id: schema.students.id, ownerUserId: schema.students.ownerUserId }).from(schema.students)
    .where(and(eq(schema.students.id, studentId), eq(schema.students.schoolId, schoolId))).limit(1)
  if (!student) throw createError({ statusCode: 404, message: '学生不存在' })
  const secret = useRuntimeConfig(event).encryptionKey
  let guardianId = body.guardianId
  if (guardianId) {
    const [guardian] = await db.select({ id: schema.guardians.id }).from(schema.guardians)
      .where(and(eq(schema.guardians.id, guardianId), eq(schema.guardians.schoolId, schoolId))).limit(1)
    if (!guardian) throw createError({ statusCode: 404, message: '家长不存在' })
  } else if (body.guardian) {
    const ownerUserId = body.guardian.ownerUserId || student.ownerUserId
    await assertActiveTeacher(event, schoolId, ownerUserId)
    const [created] = await db.insert(schema.guardians).values({
      schoolId,
      ownerUserId,
      nameEnc: encryptSensitive(body.guardian.name, secret),
      nameSearch: searchableHash(body.guardian.name, secret),
      phoneEnc: body.guardian.phone ? encryptSensitive(body.guardian.phone, secret) : null,
      relation: body.guardian.relation || null,
      externalRefEnc: body.guardian.externalRef ? encryptSensitive(body.guardian.externalRef, secret) : null,
      externalRefSearch: body.guardian.externalRef ? searchableHash(body.guardian.externalRef, secret) : null
    }).returning({ id: schema.guardians.id })
    if (!created) throw createError({ statusCode: 500, message: '家长创建失败' })
    guardianId = created.id
  }
  if (!guardianId) throw createError({ statusCode: 422, message: '家长信息不完整' })
  await db.insert(schema.studentGuardians).values({ studentId, guardianId }).onConflictDoNothing()
  await writeAudit(event, {
    schoolId, actorId: actor.id, action: 'school_admin.student_guardian.link',
    targetType: 'student', targetId: studentId,
    metadata: { guardianId, delegatedGrantId }
  })
  return { ok: true, guardianId }
})

import { schoolAdminStudentCreateSchema } from '../../../../../shared/contracts'
import { requireSchoolManagement, resolveClassOwner } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { encryptSensitive, searchableHash } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['students'])
  const body = schoolAdminStudentCreateSchema.parse(await readBody(event))
  const secret = useRuntimeConfig(event).encryptionKey
  const owner = await resolveClassOwner(event, schoolId, body.classId, body.ownerUserId)
  const db = useDb(event)
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(schema.students).values({
        schoolId,
        ownerUserId: owner.ownerUserId,
        classId: owner.classId,
        nameEnc: encryptSensitive(body.name, secret),
        nameSearch: searchableHash(body.name, secret),
        gender: body.gender || null,
        profileEnc: body.profile ? encryptSensitive(body.profile, secret) : null,
        notesEnc: body.notes ? encryptSensitive(body.notes, secret) : null,
        externalRefEnc: body.externalRef ? encryptSensitive(body.externalRef, secret) : null,
        externalRefSearch: body.externalRef ? searchableHash(body.externalRef, secret) : null
      }).returning({ id: schema.students.id })
      if (!created) throw createError({ statusCode: 500, message: '学生创建失败' })
      await writeAudit(event, {
        schoolId, actorId: actor.id, action: 'school_admin.student.create',
        targetType: 'student', targetId: created.id,
        metadata: { classId: owner.classId, ownerUserId: owner.ownerUserId, delegatedGrantId }
      }, tx)
      return { ok: true, id: created.id }
    })
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '学生外部编号已存在' })
    throw error
  }
})

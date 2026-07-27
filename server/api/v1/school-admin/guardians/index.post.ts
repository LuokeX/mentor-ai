import { schoolAdminGuardianCreateSchema } from '../../../../../shared/contracts'
import { assertActiveTeacher, requireSchoolManagement } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { encryptSensitive, searchableHash } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['guardians'])
  const body = schoolAdminGuardianCreateSchema.parse(await readBody(event))
  if (!body.ownerUserId) throw createError({ statusCode: 422, message: '请选择负责教师' })
  const ownerUserId = body.ownerUserId
  await assertActiveTeacher(event, schoolId, ownerUserId)
  const secret = useRuntimeConfig(event).encryptionKey
  const db = useDb(event)

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(schema.guardians).values({
        schoolId,
        ownerUserId,
        nameEnc: encryptSensitive(body.name, secret),
        nameSearch: searchableHash(body.name, secret),
        phoneEnc: body.phone ? encryptSensitive(body.phone, secret) : null,
        relation: body.relation || null,
        externalRefEnc: body.externalRef ? encryptSensitive(body.externalRef, secret) : null,
        externalRefSearch: body.externalRef ? searchableHash(body.externalRef, secret) : null,
      }).returning({ id: schema.guardians.id })
      if (!created) throw createError({ statusCode: 500, message: '家长创建失败' })
      await writeAudit(event, {
        schoolId,
        actorId: actor.id,
        action: 'school_admin.guardian.create',
        targetType: 'guardian',
        targetId: created.id,
        metadata: { ownerUserId, delegatedGrantId },
      }, tx)
      return { ok: true, id: created.id }
    })
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') throw createError({ statusCode: 409, message: '家长外部编号已存在' })
    throw error
  }
})

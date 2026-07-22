import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { managedRecordStatusSchema, schoolAdminGuardianCreateSchema } from '../../../../../shared/contracts'
import { assertActiveTeacher, requireSchoolManagement, transferPlans, writeAssignment } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { encryptSensitive, searchableHash } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

const bodySchema = schoolAdminGuardianCreateSchema.partial().extend({
  status: managedRecordStatusSchema.optional(),
  reason: z.string().trim().max(500).optional()
}).refine(value => Object.keys(value).length > 0)

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['guardians'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [guardian] = await db.select().from(schema.guardians).where(and(eq(schema.guardians.id, id), eq(schema.guardians.schoolId, schoolId))).limit(1)
  if (!guardian) throw createError({ statusCode: 404, message: '家长不存在' })
  if (body.ownerUserId) await assertActiveTeacher(event, schoolId, body.ownerUserId)
  try {
    await db.transaction(async (tx) => {
      const patch: Partial<typeof schema.guardians.$inferInsert> = { updatedAt: new Date() }
      if (body.name !== undefined) {
        patch.nameEnc = encryptSensitive(body.name, secret)
        patch.nameSearch = searchableHash(body.name, secret)
      }
      if (body.phone !== undefined) patch.phoneEnc = body.phone ? encryptSensitive(body.phone, secret) : null
      if (body.relation !== undefined) patch.relation = body.relation || null
      if (body.externalRef !== undefined) {
        patch.externalRefEnc = body.externalRef ? encryptSensitive(body.externalRef, secret) : null
        patch.externalRefSearch = body.externalRef ? searchableHash(body.externalRef, secret) : null
      }
      if (body.status !== undefined) patch.status = body.status
      if (body.ownerUserId) patch.ownerUserId = body.ownerUserId
      await tx.update(schema.guardians).set(patch).where(eq(schema.guardians.id, id))
      if (body.ownerUserId && body.ownerUserId !== guardian.ownerUserId) {
        await tx.update(schema.communications).set({ ownerUserId: body.ownerUserId, updatedAt: new Date() }).where(and(eq(schema.communications.guardianId, id), eq(schema.communications.schoolId, schoolId)))
        await transferPlans(tx as ReturnType<typeof useDb>, schoolId, body.ownerUserId, eq(schema.plans.guardianId, id))
        await writeAssignment(tx as ReturnType<typeof useDb>, {
          schoolId,
          targetType: 'guardian',
          targetId: id,
          fromUserId: guardian.ownerUserId,
          toUserId: body.ownerUserId,
          assignedBy: actor.id,
          reason: body.reason
        })
      }
    })
    await writeAudit(event, {
      schoolId, actorId: actor.id, action: 'school_admin.guardian.update',
      targetType: 'guardian', targetId: id,
      metadata: { status: body.status, ownerChanged: Boolean(body.ownerUserId && body.ownerUserId !== guardian.ownerUserId), reason: body.reason, delegatedGrantId }
    })
    return { ok: true, id }
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '家长外部编号已存在' })
    throw error
  }
})

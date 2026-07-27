import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { encryptSensitive, searchableHash } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  phone: z.string().max(40).optional(),
  relation: z.string().max(40).optional()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const expectedUpdatedAt = z.string().datetime().optional().parse(getQuery(event).expectedUpdatedAt)
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [guardian] = await db.select({
    id: schema.guardians.id,
    updatedAt: schema.guardians.updatedAt,
  }).from(schema.guardians).where(and(
    eq(schema.guardians.id, id),
    eq(schema.guardians.ownerUserId, user.id),
    eq(schema.guardians.schoolId, user.schoolId!),
  )).limit(1)
  if (!guardian) throw createError({ statusCode: 404, message: '家长不存在' })
  if (expectedUpdatedAt && guardian.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '家长档案已被其他用户修改，请刷新后重试' })
  }
  const patch: Partial<typeof schema.guardians.$inferInsert> = { updatedAt: new Date() }
  if (body.name !== undefined) {
    patch.nameEnc = encryptSensitive(body.name, secret)
    patch.nameSearch = searchableHash(body.name, secret)
  }
  if (body.phone !== undefined) patch.phoneEnc = body.phone ? encryptSensitive(body.phone, secret) : null
  if (body.relation !== undefined) patch.relation = body.relation
  const finalConditions = [
    eq(schema.guardians.id, id),
    eq(schema.guardians.ownerUserId, user.id),
    eq(schema.guardians.schoolId, user.schoolId!),
  ]
  if (expectedUpdatedAt) finalConditions.push(eq(schema.guardians.updatedAt, new Date(expectedUpdatedAt)))
  const [updated] = await db.update(schema.guardians).set(patch).where(and(...finalConditions)).returning({ id: schema.guardians.id })
  if (!updated) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '家长档案已被其他用户修改，请刷新后重试' })
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'information.guardian.update', targetType: 'guardian', targetId: id })
  return { ok: true }
})

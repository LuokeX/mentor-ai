import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { encryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

const bodySchema = z.object({
  summary: z.string().trim().min(5).max(3000).optional(),
  parentType: z.string().trim().max(20).nullable().optional(),
  attitudeType: z.string().trim().max(20).nullable().optional(),
  containerLevel: z.number().int().min(-4).max(4).nullable().optional(),
  riskLevel: z.string().trim().max(20).nullable().optional(),
}).refine(body => Object.keys(body).length > 0)

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const expectedUpdatedAt = z.string().datetime().parse(getQuery(event).expectedUpdatedAt)
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const patch: Partial<typeof schema.communications.$inferInsert> = { updatedAt: new Date() }
  if (body.summary !== undefined) patch.summaryEnc = encryptSensitive(body.summary, useRuntimeConfig(event).encryptionKey)
  if (body.parentType !== undefined) patch.parentType = body.parentType
  if (body.attitudeType !== undefined) patch.attitudeType = body.attitudeType
  if (body.containerLevel !== undefined) patch.containerLevel = body.containerLevel
  if (body.riskLevel !== undefined) patch.riskLevel = body.riskLevel

  const [updated] = await db.update(schema.communications).set(patch).where(and(
    eq(schema.communications.id, id),
    eq(schema.communications.schoolId, user.schoolId),
    eq(schema.communications.ownerUserId, user.id),
    eq(schema.communications.status, 'active'),
    eq(schema.communications.updatedAt, new Date(expectedUpdatedAt)),
  )).returning({ id: schema.communications.id })
  if (!updated) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '沟通记录已被修改或归档，请刷新后重试' })
  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'information.communication.update',
    targetType: 'communication',
    targetId: id,
  })
  return { ok: true, id }
})

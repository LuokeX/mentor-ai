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
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [guardian] = await db.select({ id: schema.guardians.id }).from(schema.guardians).where(and(eq(schema.guardians.id, id), eq(schema.guardians.ownerUserId, user.id), eq(schema.guardians.schoolId, user.schoolId!))).limit(1)
  if (!guardian) throw createError({ statusCode: 404, message: '家长不存在' })
  const patch: Partial<typeof schema.guardians.$inferInsert> = { updatedAt: new Date() }
  if (body.name !== undefined) {
    patch.nameEnc = encryptSensitive(body.name, secret)
    patch.nameSearch = searchableHash(`${body.name}-${body.phone || ''}`, secret)
  }
  if (body.phone !== undefined) patch.phoneEnc = body.phone ? encryptSensitive(body.phone, secret) : null
  if (body.relation !== undefined) patch.relation = body.relation
  await db.update(schema.guardians).set(patch).where(eq(schema.guardians.id, id))
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'information.guardian.update', targetType: 'guardian', targetId: id })
  return { ok: true }
})

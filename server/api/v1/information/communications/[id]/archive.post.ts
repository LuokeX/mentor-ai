import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { updatedAtMatches } from '../../../../../utils/concurrency'
import { schema, useDb } from '../../../../../utils/db'

const bodySchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  reason: z.string().trim().min(10).max(500),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  await db.transaction(async (tx) => {
    const [updated] = await tx.update(schema.communications).set({
      status: 'archived',
      archivedAt: new Date(),
      archivedBy: user.id,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.communications.id, id),
      eq(schema.communications.schoolId, user.schoolId!),
      eq(schema.communications.ownerUserId, user.id),
      eq(schema.communications.status, 'active'),
      updatedAtMatches(schema.communications.updatedAt, body.expectedUpdatedAt),
    )).returning({ id: schema.communications.id })
    if (!updated) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '沟通记录已被修改或归档，请刷新后重试' })
    await writeAudit(event, {
      schoolId: user.schoolId,
      actorId: user.id,
      action: 'information.communication.archive',
      targetType: 'communication',
      targetId: id,
      metadata: { reason: body.reason },
    }, tx)
  })
  return { ok: true }
})

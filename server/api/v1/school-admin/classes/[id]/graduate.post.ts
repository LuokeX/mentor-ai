import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireSchoolManagement } from '../../../../../domain/school-management'
import { writeAudit } from '../../../../../utils/audit'
import { schema, useDb } from '../../../../../utils/db'

const bodySchema = z.object({ expectedUpdatedAt: z.string().datetime(), reason: z.string().trim().min(10).max(500) })

export default defineEventHandler(async (event) => {
  const { actor, schoolId } = await requireSchoolManagement(event, ['classes'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  await db.transaction(async (tx) => {
    const [updated] = await tx.update(schema.classes).set({
      status: 'graduated',
      updatedAt: new Date(),
    }).where(and(
      eq(schema.classes.id, id),
      eq(schema.classes.schoolId, schoolId),
      eq(schema.classes.status, 'active'),
      eq(schema.classes.updatedAt, new Date(body.expectedUpdatedAt)),
    )).returning({ id: schema.classes.id })
    if (!updated) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '班级已被修改或不处于在读状态，请刷新后重试' })
    await writeAudit(event, {
      schoolId,
      actorId: actor.id,
      action: 'school_admin.class.graduate',
      targetType: 'class',
      targetId: id,
      metadata: { reason: body.reason },
    }, tx)
  })
  return { ok: true }
})

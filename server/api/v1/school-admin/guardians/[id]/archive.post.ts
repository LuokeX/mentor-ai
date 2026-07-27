import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { archiveRecord } from '../../../../../domain/lifecycle'
import { requireSchoolManagement } from '../../../../../domain/school-management'
import { schema, useDb } from '../../../../../utils/db'

const bodySchema = z.object({ expectedUpdatedAt: z.string().datetime(), reason: z.string().trim().min(10).max(500) })
export default defineEventHandler(async (event) => {
  const { actor, schoolId } = await requireSchoolManagement(event, ['guardians'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const [record] = await useDb(event).select({ ownerUserId: schema.guardians.ownerUserId }).from(schema.guardians).where(and(eq(schema.guardians.id, id), eq(schema.guardians.schoolId, schoolId))).limit(1)
  if (!record) throw createError({ statusCode: 404, message: '家长不存在' })
  await archiveRecord(event, schema.guardians, id, schoolId, record.ownerUserId, actor.id, body.expectedUpdatedAt, body.reason)
  return { ok: true }
})

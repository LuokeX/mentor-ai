import { z } from 'zod'
import { restoreRecord } from '../../../../../domain/lifecycle'
import { requireSchoolManagement } from '../../../../../domain/school-management'
import { schema } from '../../../../../utils/db'

const bodySchema = z.object({ expectedUpdatedAt: z.string().datetime(), reason: z.string().trim().min(10).max(500) })
export default defineEventHandler(async (event) => {
  const { actor, schoolId } = await requireSchoolManagement(event, ['guardians'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  await restoreRecord(event, schema.guardians, id, schoolId, actor.id, body.expectedUpdatedAt, body.reason)
  return { ok: true }
})

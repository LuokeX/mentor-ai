import { z } from 'zod'
import { targetTypeSchema } from '../../../../shared/contracts'
import { requireAdminGrant } from '../../../domain/admin-access'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

const eventSchema = z.object({
  targetType: targetTypeSchema,
  targetId: z.string().uuid(),
  action: z.enum(['print_attempt', 'export_attempt']),
  metadata: z.record(z.string(), z.unknown()).optional()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin', 'platform_admin'])
  const body = eventSchema.parse(await readBody(event))
  const grant = await requireAdminGrant(event, user, body.targetType, body.targetId)
  await useDb(event).insert(schema.adminAccessEvents).values({
    schoolId: grant.schoolId,
    actorId: user.id,
    grantId: grant.id,
    targetType: body.targetType,
    targetId: body.targetId,
    action: body.action,
    path: event.path,
    metadata: { ...body.metadata, role: user.role }
  })
  return { ok: true }
})

import { delegatedManagementRequestSchema } from '../../../../../../shared/contracts'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { schema, useDb } from '../../../../../utils/db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const body = delegatedManagementRequestSchema.parse(await readBody(event))
  const db = useDb(event)
  const [school] = await db.select({ id: schema.schools.id }).from(schema.schools).where(eq(schema.schools.id, body.schoolId)).limit(1)
  if (!school) throw createError({ statusCode: 404, message: '学校不存在' })
  const [request] = await db.insert(schema.delegatedManagementGrants).values({
    schoolId: body.schoolId,
    requesterId: admin.id,
    scopes: body.scopes,
    reason: body.reason,
    status: 'pending'
  }).returning()
  if (!request) throw createError({ statusCode: 500, message: '代管申请创建失败' })
  await writeAudit(event, {
    schoolId: body.schoolId, actorId: admin.id, action: 'platform_admin.delegated_management.request',
    targetType: 'delegated_management_grant', targetId: request.id,
    metadata: { scopes: body.scopes }
  })
  return request
})

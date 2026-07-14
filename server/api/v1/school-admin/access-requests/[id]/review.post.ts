import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { useDb, schema } from '../../../../../utils/db'
import { writeAudit } from '../../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = z.object({ decision: z.enum(['approved', 'rejected']) }).parse(await readBody(event))
  const db = useDb(event)
  const [request] = await db.select().from(schema.adminAccessRequests).where(and(
    eq(schema.adminAccessRequests.id, id), eq(schema.adminAccessRequests.schoolId, admin.schoolId!), eq(schema.adminAccessRequests.status, 'pending')
  )).limit(1)
  if (!request) throw createError({ statusCode: 404, message: '待审批申请不存在' })
  if (request.requesterId === admin.id) throw createError({ statusCode: 403, message: '不能审批自己的申请' })
  const expiresAt = body.decision === 'approved' ? new Date(Date.now() + 30 * 60 * 1000) : null
  const grant = await db.transaction(async (tx) => {
    await tx.update(schema.adminAccessRequests).set({
      status: body.decision, reviewerId: admin.id, reviewedAt: new Date(), expiresAt
    }).where(eq(schema.adminAccessRequests.id, request.id))
    if (!expiresAt) return null
    const [created] = await tx.insert(schema.adminAccessGrants).values({
      requestId: request.id, schoolId: request.schoolId, userId: request.requesterId,
      targetType: request.targetType, targetId: request.targetId, expiresAt
    }).returning()
    if (!created) throw new Error('访问授权创建失败')
    return created
  })
  await writeAudit(event, { schoolId: admin.schoolId, actorId: admin.id, action: `admin_access.request.${body.decision}`, targetType: request.targetType, targetId: request.targetId, metadata: { requestId: request.id } })
  return { ok: true, grant }
})

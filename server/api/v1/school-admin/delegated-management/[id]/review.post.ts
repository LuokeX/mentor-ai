import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { delegatedManagementReviewSchema } from '../../../../../../shared/contracts'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { schema, useDb } from '../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = delegatedManagementReviewSchema.parse(await readBody(event))
  const db = useDb(event)
  const [request] = await db.select().from(schema.delegatedManagementGrants).where(and(
    eq(schema.delegatedManagementGrants.id, id),
    eq(schema.delegatedManagementGrants.schoolId, admin.schoolId)
  )).limit(1)
  if (!request) throw createError({ statusCode: 404, message: '代管申请不存在' })
  if (request.requesterId === admin.id) throw createError({ statusCode: 403, message: '不能审批自己的代管申请' })
  if (body.decision === 'revoked' ? request.status !== 'approved' : request.status !== 'pending') {
    throw createError({ statusCode: 409, message: '代管申请状态已变化，请刷新后重试' })
  }
  const now = new Date()
  const expiresAt = body.decision === 'approved' ? new Date(now.getTime() + 30 * 60 * 1000) : null
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(schema.delegatedManagementGrants).set({
      status: body.decision === 'revoked' ? 'revoked' : body.decision,
      reviewerId: admin.id,
      reviewedAt: now,
      expiresAt,
      revokedAt: body.decision === 'revoked' ? now : null,
      updatedAt: now
    }).where(and(
      eq(schema.delegatedManagementGrants.id, id),
      eq(schema.delegatedManagementGrants.schoolId, admin.schoolId!),
      eq(schema.delegatedManagementGrants.status, request.status),
    )).returning()
    if (!row) throw createError({ statusCode: 409, message: '代管申请状态已变化，请刷新后重试' })
    await writeAudit(event, {
      schoolId: admin.schoolId, actorId: admin.id, action: `delegated_management.${body.decision}`,
      targetType: 'delegated_management_grant', targetId: id,
      metadata: { requesterId: request.requesterId, scopes: request.scopes, expiresAt: expiresAt?.toISOString() }
    }, tx)
    return row
  })
  return updated
})

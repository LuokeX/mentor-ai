import { adminAccessRequestSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { resolveTargetSchool } from '../../../domain/admin-access'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin', 'platform_admin'])
  const body = adminAccessRequestSchema.parse(await readBody(event))
  const targetSchool = await resolveTargetSchool(event, body.targetType, body.targetId)
  if (!targetSchool) throw createError({ statusCode: 404, message: '目标记录不存在' })
  if (user.role === 'school_admin' && targetSchool !== user.schoolId) throw createError({ statusCode: 403, message: '不能访问其他学校数据' })
  if (body.schoolId && body.schoolId !== targetSchool) throw createError({ statusCode: 422, message: '学校与目标记录不匹配' })
  const db = useDb(event)
  const autoApprove = user.role === 'school_admin'
  const expiresAt = autoApprove ? new Date(Date.now() + 15 * 60 * 1000) : null
  const { request, grant } = await db.transaction(async (tx) => {
    const [request] = await tx.insert(schema.adminAccessRequests).values({
      schoolId: targetSchool,
      requesterId: user.id,
      targetType: body.targetType,
      targetId: body.targetId,
      reasonCategory: body.reasonCategory,
      reasonText: body.reasonText,
      status: autoApprove ? 'approved' : 'pending',
      reviewerId: autoApprove ? user.id : null,
      reviewedAt: autoApprove ? new Date() : null,
      expiresAt
    }).returning()
    if (!request) throw new Error('访问申请创建失败')
    let grant = null
    if (autoApprove && expiresAt) {
      [grant] = await tx.insert(schema.adminAccessGrants).values({
        requestId: request.id, schoolId: targetSchool, userId: user.id,
        targetType: body.targetType, targetId: body.targetId, expiresAt
      }).returning()
      if (!grant) throw new Error('访问授权创建失败')
    }
    return { request, grant }
  })
  await writeAudit(event, {
    schoolId: targetSchool, actorId: user.id, action: autoApprove ? 'admin_access.grant.created' : 'admin_access.request.created',
    targetType: body.targetType, targetId: body.targetId, metadata: { reasonCategory: body.reasonCategory, requestId: request.id }
  })
  return { request, grant }
})

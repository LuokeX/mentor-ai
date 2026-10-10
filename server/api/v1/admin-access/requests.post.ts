/**
 * 敏感访问授权申请。
 *
 * 三类调用方：
 * - 学校管理员（本校）：自填事由（≥10 字）自动通过，15 分钟目标级只读；
 * - 平台管理员：生成待审批申请，由目标学校管理员在「访问申请」里批准（最长 30 分钟）；
 * - 数据驾驶舱角色（学部校长 / 德育主任 / 年级主任）：仅在已开通 `view_sensitive`
 *   且目标学生落在本人看板范围内时，可对学生自填事由自动通过，15 分钟有效（PRD 4.2 原则 4）。
 */
import { adminAccessRequestSchema } from '../../../../shared/contracts'
import type { DashboardIndividualTargetType } from '../../../../shared/dashboard'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { resolveTargetSchool } from '../../../domain/admin-access'
import { requireDashboardIndividualTarget } from '../../../domain/dashboard-individual'
import { writeAudit } from '../../../utils/audit'

const DASHBOARD_GRANT_ROLES = ['division_principal', 'moral_education_director', 'grade_director'] as const
const DASHBOARD_GRANT_TARGET_TYPES: ReadonlySet<string> = new Set(['student', 'teacher_profile', 'guardian'])

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin', 'platform_admin', ...DASHBOARD_GRANT_ROLES])
  const body = adminAccessRequestSchema.parse(await readBody(event))
  const isDashboardRole = (DASHBOARD_GRANT_ROLES as readonly string[]).includes(user.role)

  if (isDashboardRole) {
    if (!DASHBOARD_GRANT_TARGET_TYPES.has(body.targetType)) {
      throw createError({ statusCode: 403, message: '看板角色只能申请查看学生、负责教师或家长的个体明细' })
    }
    // 能力（view_sensitive）与范围（学校 + 班级集合 + 口径）校验，越界按不存在处理
    await requireDashboardIndividualTarget(event, user, body.targetType as DashboardIndividualTargetType, body.targetId)
  }

  const targetSchool = await resolveTargetSchool(event, body.targetType, body.targetId)
  if (!targetSchool) throw createError({ statusCode: 404, message: '目标记录不存在' })
  if (user.role === 'school_admin' && targetSchool !== user.schoolId) throw createError({ statusCode: 403, message: '不能访问其他学校数据' })
  if (body.schoolId && body.schoolId !== targetSchool) throw createError({ statusCode: 422, message: '学校与目标记录不匹配' })
  const db = useDb(event)
  const autoApprove = user.role === 'school_admin' || isDashboardRole
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
    targetType: body.targetType, targetId: body.targetId,
    metadata: { reasonCategory: body.reasonCategory, requestId: request.id, role: user.role }
  })
  return { request, grant }
})

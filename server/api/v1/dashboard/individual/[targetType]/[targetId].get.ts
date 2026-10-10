/**
 * 数据驾驶舱 · 个体明细（PRD 4.2 原则 3/4、4.4 与 W7）。
 *
 * 支持三类目标：`student`（学生）/ `teacher_profile`（负责教师）/ `guardian`（家长），
 * 三类共用同一套三层门禁：看板页权限 → `view_sensitive` 能力（平台后台按校开通，默认关闭）
 * → 15 分钟事由授权（`X-Admin-Access-Grant` 头，复用管理员受控只读的授权表与校验）。
 * 每次读取写管理员访问事件（action=read）与审计 `dashboard.individual_view`；
 * 响应 no-store，前端按返回的 watermark 展示操作人 + 时间 + 授权编号。
 */
import { z } from 'zod'
import {
  DASHBOARD_INDIVIDUAL_TARGET_LABELS,
  DASHBOARD_INDIVIDUAL_TARGET_TYPES,
  type DashboardIndividualDetailResponse
} from '../../../../../../shared/dashboard'
import { requireAdminGrant } from '../../../../../domain/admin-access'
import {
  loadDashboardIndividualDetail,
  requireDashboardIndividualTarget
} from '../../../../../domain/dashboard-individual'
import { writeAudit } from '../../../../../utils/audit'
import { requireUser } from '../../../../../utils/auth'
import { schema, useDb } from '../../../../../utils/db'
import { formatDateTime } from '../../../../../utils/format-time'

const targetTypeSchema = z.enum(DASHBOARD_INDIVIDUAL_TARGET_TYPES)

export default defineEventHandler(async (event): Promise<DashboardIndividualDetailResponse> => {
  const user = await requireUser(event)
  const targetType = targetTypeSchema.parse(getRouterParam(event, 'targetType'))
  const targetId = z.string().uuid().parse(getRouterParam(event, 'targetId'))

  // 入口权限 + view_sensitive 能力 + 目标落在本人看板范围内（越界 404）
  const target = await requireDashboardIndividualTarget(event, user, targetType, targetId)
  // 15 分钟目标级授权（操作者 + 学校 + 目标类型 + 目标 ID）
  const grant = await requireAdminGrant(event, user, targetType, targetId)

  const db = useDb(event)
  const detail = await loadDashboardIndividualDetail(db, event, target)

  const fields = detail.targetType === 'student'
    ? ['student', 'studentEvents', 'plans', 'communications', 'assessments', 'aiQuestions']
    : detail.targetType === 'guardian'
      ? ['guardian', 'communications']
      : ['teacher']

  await db.insert(schema.adminAccessEvents).values({
    schoolId: grant.schoolId,
    actorId: user.id,
    grantId: grant.id,
    targetType,
    targetId,
    action: 'read',
    path: event.path,
    fields,
    metadata: { role: user.role, source: 'dashboard_individual', targetType }
  })
  await writeAudit(event, {
    schoolId: grant.schoolId,
    actorId: user.id,
    action: 'dashboard.individual_view',
    targetType,
    targetId,
    metadata: {
      grantId: grant.id,
      targetLabel: DASHBOARD_INDIVIDUAL_TARGET_LABELS[targetType],
      ...(detail.targetType === 'student'
        ? {
            studentEvents: detail.studentEvents.length,
            plans: detail.plans.length,
            communications: detail.communications.length,
            assessments: detail.assessments.length,
            aiQuestions: detail.aiQuestions.length
          }
        : {}),
      ...(detail.targetType === 'guardian' ? { communications: detail.communications.length } : {}),
      ...(detail.targetType === 'teacher_profile' ? { windowDays: detail.teacher.windowDays } : {})
    }
  })

  setResponseHeader(event, 'cache-control', 'no-store, private')
  return {
    ...detail,
    access: {
      grantId: grant.id,
      expiresAt: grant.expiresAt.toISOString(),
      watermark: `${user.name} · ${formatDateTime(new Date())} · ${grant.id.slice(0, 8)}`
    }
  } as DashboardIndividualDetailResponse
})

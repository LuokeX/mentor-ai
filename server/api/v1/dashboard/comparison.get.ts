/**
 * 数据驾驶舱 · 年级 / 班级对比（PRD W8「聚合横向对比」）。
 *
 * 不传 grade 时按年级聚合（默认层级），传 grade 时下钻到该年级的班级对比；
 * 三页口径与数据总览一致（提问按记录人主班级、方案/事件按记录自带班级），
 * 范围与权限统一走 requireDashboardScope（页面级权限键 `dashboard`），
 * 路由不自行拼班级范围，也不接受前端传入的年级范围之外的班级。
 * 区间上限沿用总览的 31 天；查看行为写产品事件 dashboard_view。
 */
import { z } from 'zod'
import {
  DASHBOARD_COMPARISON_METRICS,
  DASHBOARD_DEFAULT_DAYS,
  DASHBOARD_PERIOD_LIMITS,
  type DashboardComparisonMetric
} from '../../../../shared/dashboard'
import {
  loadDashboardComparison,
  parseClassIdParam,
  parseComparisonMetricParam,
  resolveDashboardRange
} from '../../../domain/dashboard-metrics'
import { requireDashboardScope } from '../../../domain/dashboard-scope'
import { trackDashboardView } from '../../../domain/dashboard-tracking'
import { requireUser } from '../../../utils/auth'
import { useDb } from '../../../utils/db'

const querySchema = z.object({
  start: z.string().trim().max(10).optional(),
  end: z.string().trim().max(10).optional(),
  grade: z.coerce.number().int().min(1).max(12).optional(),
  classIds: z.string().trim().max(4000).optional(),
  metric: z.enum(DASHBOARD_COMPARISON_METRICS).optional(),
  order: z.enum(['asc', 'desc']).default('desc')
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = querySchema.parse(getQuery(event))
  const scope = await requireDashboardScope(event, user, 'dashboard')
  const range = resolveDashboardRange(query, {
    defaultDays: DASHBOARD_DEFAULT_DAYS.overview,
    maxDays: DASHBOARD_PERIOD_LIMITS.overview
  })
  // 年级主任只能看所辖年级：前端传了别的年级时按空结果处理（不泄露其他年级是否存在）
  const requestedGrade = query.grade
  const grade = requestedGrade && scope.grades.some(item => item.grade === requestedGrade) ? requestedGrade : undefined
  const metric: DashboardComparisonMetric = parseComparisonMetricParam(query.metric) ?? 'aiQuestions'
  await trackDashboardView(event, {
    user,
    page: 'dashboard',
    rangeDays: range.days,
    line: scope.line,
    grade: grade ?? null,
    classFilterCount: parseClassIdParam(query.classIds)?.length ?? 0
  })
  return loadDashboardComparison(useDb(event), scope, range, {
    grade,
    classIds: parseClassIdParam(query.classIds),
    metric,
    order: query.order
  })
})

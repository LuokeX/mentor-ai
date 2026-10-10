/**
 * 数据驾驶舱 · 数据总览。
 *
 * 默认统计「今天」，最长 31 天；只返回本学部（division_principal 的 scope.section）聚合数据。
 * 学部范围解析与角色校验统一走 requireDashboardScope，路由不自行拼班级范围；
 * 页面级权限对应 roles.permissions 的 `dashboard` 目标类型（平台后台可取消）。
 * 支持全局下钻的 grade / classIds 过滤（与二级页共用同一套状态），
 * compare 决定环比对照区间（滚动等长区间 / 上一自然周 / 上一自然月）。
 * 聚合卡（analysis）只下发当前账号可访问的看板页对应的分组：二级页被取消后
 * 其聚合卡与导航、入口卡一起收敛（可见页来自 requireDashboardEntry）。
 * 查看行为写审计与产品事件 dashboard_view（低敏聚合，见 dashboard-tracking.ts）。
 */
import { z } from 'zod'
import { DASHBOARD_COMPARE_KINDS, DASHBOARD_DEFAULT_DAYS, DASHBOARD_PERIOD_LIMITS, type OverviewResponse } from '../../../../shared/dashboard'
import { loadOverview, loadOverviewAnalysis, parseClassIdParam, resolveDashboardRange } from '../../../domain/dashboard-metrics'
import { requireDashboardEntry, requireDashboardScope } from '../../../domain/dashboard-scope'
import { trackDashboardView } from '../../../domain/dashboard-tracking'
import { requireUser } from '../../../utils/auth'
import { useDb } from '../../../utils/db'

const querySchema = z.object({
  start: z.string().trim().max(10).optional(),
  end: z.string().trim().max(10).optional(),
  compare: z.enum(DASHBOARD_COMPARE_KINDS).optional(),
  grade: z.coerce.number().int().min(1).max(12).optional(),
  classIds: z.string().trim().max(4000).optional()
})

export default defineEventHandler(async (event): Promise<OverviewResponse> => {
  const user = await requireUser(event)
  const query = querySchema.parse(getQuery(event))
  const scope = await requireDashboardScope(event, user, 'dashboard')
  // 可见看板页：决定总览页聚合卡下发哪几组（requireDashboardScope 已保证本页在列）
  const pages = await requireDashboardEntry(event, user)
  const filters = { grade: query.grade, classIds: parseClassIdParam(query.classIds) }
  const range = resolveDashboardRange(query, {
    defaultDays: DASHBOARD_DEFAULT_DAYS.overview,
    maxDays: DASHBOARD_PERIOD_LIMITS.overview
  })
  await trackDashboardView(event, {
    user,
    page: 'dashboard',
    rangeDays: range.days,
    line: scope.line,
    grade: filters.grade ?? null,
    classFilterCount: filters.classIds?.length ?? 0
  })
  const db = useDb(event)
  const [overview, analysis] = await Promise.all([
    loadOverview(db, scope, range, filters),
    loadOverviewAnalysis(db, scope, range, filters, pages)
  ])
  return { ...overview, analysis }
})

/**
 * 数据驾驶舱 · 量表与方案分析。
 *
 * 统计本学部周期内的方案分布：按日趋势（方案数 + 量表作答数 + 完成度 + 回填率）、模块分布、
 * 风险等级分布与明细表（按班级 + 量表分类 + 日期聚合）。
 * 完成度 = 已完成执行项 / 方案总执行项数（PRD 9）；回填率 = 有回填执行项 / 已确认纳入执行项。
 * 默认近 7 天，最长 90 天。
 */
import { z } from 'zod'
import { DEFAULT_PAGE_SIZE } from '../../../../shared/management'
import { DASHBOARD_COMPARE_KINDS, DASHBOARD_DEFAULT_DAYS, DASHBOARD_PERIOD_LIMITS } from '../../../../shared/dashboard'
import {
  loadPlans,
  parseClassIdParam,
  parseQuestionCategoryParam,
  parseTableDimParam,
  resolveDashboardRange,
  type DashboardTableQuery,
  type PlanFilters
} from '../../../domain/dashboard-metrics'
import { requireDashboardScope } from '../../../domain/dashboard-scope'
import { trackDashboardView } from '../../../domain/dashboard-tracking'
import { requireUser } from '../../../utils/auth'
import { useDb } from '../../../utils/db'

const querySchema = z.object({
  start: z.string().trim().max(10).optional(),
  end: z.string().trim().max(10).optional(),
  compare: z.enum(DASHBOARD_COMPARE_KINDS).optional(),
  grade: z.coerce.number().int().min(1).max(12).optional(),
  classIds: z.string().trim().max(4000).optional(),
  categories: z.string().trim().max(400).optional(),
  dims: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(value => [20, 50, 100].includes(value)).default(DEFAULT_PAGE_SIZE),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc')
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = querySchema.parse(getQuery(event))
  const scope = await requireDashboardScope(event, user, 'dashboard_plans')
  const range = resolveDashboardRange(query, {
    defaultDays: DASHBOARD_DEFAULT_DAYS.plans,
    maxDays: DASHBOARD_PERIOD_LIMITS.plans
  })
  const filters: PlanFilters = {
    grade: query.grade,
    classIds: parseClassIdParam(query.classIds),
    categories: parseQuestionCategoryParam(query.categories)
  }
  const table: DashboardTableQuery = {
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort ?? 'date',
    order: query.order,
    dims: parseTableDimParam(query.dims)
  }
  await trackDashboardView(event, {
    user,
    page: 'dashboard_plans',
    rangeDays: range.days,
    line: scope.line,
    grade: filters.grade ?? null,
    classFilterCount: filters.classIds?.length ?? 0
  })
  return loadPlans(useDb(event), scope, range, filters, table)
})

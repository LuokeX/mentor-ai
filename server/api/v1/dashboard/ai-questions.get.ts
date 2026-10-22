/**
 * 数据驾驶舱 · AI 问答分析。
 *
 * 统计本学部教师在周期内的提问分布：按日趋势、6 分类分布、关键词 Top 榜、
 * 推荐量表作答转化与明细表（按班级 + 分类 + 日期聚合，不返回提问原文）。
 * 默认近 7 天，固定窗口最长 30 天；上限 31 用于容纳 31 天的自然月「本月」。
 */
import { z } from 'zod'
import { DEFAULT_PAGE_SIZE } from '../../../../shared/management'
import { DASHBOARD_COMPARE_KINDS, DASHBOARD_DEFAULT_DAYS, DASHBOARD_PERIOD_LIMITS } from '../../../../shared/dashboard'
import {
  loadAiQuestions,
  parseClassIdParam,
  parseQuestionCategoryParam,
  parseTableDimParam,
  resolveDashboardRange,
  type AiQuestionFilters,
  type DashboardTableQuery
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
  const scope = await requireDashboardScope(event, user, 'dashboard_ai_questions')
  const range = resolveDashboardRange(query, {
    defaultDays: DASHBOARD_DEFAULT_DAYS.aiQuestions,
    maxDays: DASHBOARD_PERIOD_LIMITS.aiQuestions
  })
  const filters: AiQuestionFilters = {
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
    page: 'dashboard_ai_questions',
    rangeDays: range.days,
    line: scope.line,
    grade: filters.grade ?? null,
    classFilterCount: filters.classIds?.length ?? 0
  })
  return loadAiQuestions(useDb(event), scope, range, filters, table)
})

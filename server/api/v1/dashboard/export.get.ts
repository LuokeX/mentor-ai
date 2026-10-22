/**
 * 数据驾驶舱 · 导出（CSV）。
 *
 * 三类：AI 问答明细、量表与方案明细、数据总览 KPI（本期/上期，供汇报归档）；
 * 预警明细不提供导出（学生标号只在页面内展示）。
 * 明细导出的表头跟随页面的「表头维度」勾选（未勾选的维度列不导出，全不勾时给统计区间 + 周期总计一行）。
 * 文件名带操作人与东八区时间戳，内容末尾追加数据水印行（导出人/时间/数据范围/区间），
 * 每次导出写审计 dashboard.export（类型、区间、行数与筛选）。
 */
import { z } from 'zod'
import { DASHBOARD_COMPARE_KINDS, DASHBOARD_DEFAULT_DAYS, DASHBOARD_EXPORT_TYPES, DASHBOARD_EXPORT_LABELS, DASHBOARD_PERIOD_LIMITS, type DashboardExportType } from '../../../../shared/dashboard'
import {
  buildCsv,
  exportFileName,
  exportWatermarkRow,
  loadAiQuestionExportRows,
  loadOverview,
  loadPlanExportRows,
  parseClassIdParam,
  parseQuestionCategoryParam,
  parseTableDimParam,
  resolveDashboardRange
} from '../../../domain/dashboard-metrics'
import { requireDashboardScope } from '../../../domain/dashboard-scope'
import { writeAudit } from '../../../utils/audit'
import { requireUser } from '../../../utils/auth'
import { useDb } from '../../../utils/db'

const querySchema = z.object({
  type: z.enum(DASHBOARD_EXPORT_TYPES),
  start: z.string().trim().max(10).optional(),
  end: z.string().trim().max(10).optional(),
  compare: z.enum(DASHBOARD_COMPARE_KINDS).optional(),
  grade: z.coerce.number().int().min(1).max(12).optional(),
  classIds: z.string().trim().max(4000).optional(),
  categories: z.string().trim().max(400).optional(),
  dims: z.string().trim().max(120).optional()
})

/** 导出类型 → 所需页面级权限 / 区间上限 / 表头。 */
const EXPORT_CONFIG: Record<DashboardExportType, {
  page: 'dashboard' | 'dashboard_ai_questions' | 'dashboard_plans'
  limits: { defaultDays: number, maxDays: number }
}> = {
  'ai-questions': {
    page: 'dashboard_ai_questions',
    limits: { defaultDays: DASHBOARD_DEFAULT_DAYS.aiQuestions, maxDays: DASHBOARD_PERIOD_LIMITS.aiQuestions }
  },
  plans: {
    page: 'dashboard_plans',
    limits: { defaultDays: DASHBOARD_DEFAULT_DAYS.plans, maxDays: DASHBOARD_PERIOD_LIMITS.plans }
  },
  overview: {
    page: 'dashboard',
    limits: { defaultDays: DASHBOARD_DEFAULT_DAYS.overview, maxDays: DASHBOARD_PERIOD_LIMITS.overview }
  }
}

const OVERVIEW_HEADERS = ['指标', '本期', '上期']

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = querySchema.parse(getQuery(event))
  // 导出按所导页面校验权限：AI 问答导出需要 AI 问答分析的查看权限，方案导出需要量表与方案的查看权限
  const config = EXPORT_CONFIG[query.type]
  const scope = await requireDashboardScope(event, user, config.page)
  const range = resolveDashboardRange(query, config.limits)
  const db = useDb(event)
  const classIds = parseClassIdParam(query.classIds)
  const dims = parseTableDimParam(query.dims)

  let headers: string[]
  let rows: Array<Array<string | number | null>>

  if (query.type === 'ai-questions') {
    const table = await loadAiQuestionExportRows(db, scope, range, {
      grade: query.grade,
      classIds,
      categories: parseQuestionCategoryParam(query.categories)
    }, dims)
    headers = table.headers
    rows = table.rows
  } else if (query.type === 'plans') {
    const table = await loadPlanExportRows(db, scope, range, {
      grade: query.grade,
      classIds,
      categories: parseQuestionCategoryParam(query.categories)
    }, dims)
    headers = table.headers
    rows = table.rows
  } else {
    // 总览导出：KPI 本期 + 上期（口径说明见页面卡片 hint，这里只导数值）
    const overview = await loadOverview(db, scope, range)
    const kpis = overview.kpis
    const previous = overview.previousKpis
    headers = OVERVIEW_HEADERS
    rows = [
      ['AI 问答次数', kpis.aiQuestions, previous.aiQuestions],
      ['推荐量表作答率(%)', kpis.recommendationAnswerRate ?? '—', previous.recommendationAnswerRate ?? '—'],
      ['总体方案量', kpis.planTotal, previous.planTotal],
      ['方案完成度(%)', kpis.planCompletionRate ?? '—', previous.planCompletionRate ?? '—'],
      ['方案执行及时率(%)', kpis.planTimelyRate ?? '—', previous.planTimelyRate ?? '—'],
      ['高危未闭环', kpis.highRiskOpen, previous.highRiskOpen]
    ]
  }

  const watermark = exportWatermarkRow({ operatorName: user.name, scopeLabel: scope.sectionLabel, period: range.period })
  const fileName = exportFileName(query.type, user.name)
  await writeAudit(event, {
    schoolId: scope.schoolId,
    actorId: user.id,
    action: 'dashboard.export',
    targetType: 'dashboard',
    metadata: {
      page: config.page,
      type: query.type,
      typeLabel: DASHBOARD_EXPORT_LABELS[query.type],
      period: `${range.startKey}~${range.endKey}`,
      rowCount: rows.length,
      grade: query.grade ?? null,
      classCount: classIds?.length ?? scope.classIds.length,
      // 表头维度勾选：未勾选的维度列不导出（全不勾时只导周期总计一行）
      dims: query.type === 'overview' ? null : (dims ?? null)
    }
  })

  setHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
  setHeader(event, 'cache-control', 'no-store, private')
  return buildCsv(headers, [...rows, [], watermark])
})

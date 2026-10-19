/**
 * 数据驾驶舱（学部校长）的统计口径实现。
 *
 * 口径来源：产品在 2026-09-28 确认的六条约定（见计划与 docs/ROLE_MATRIX.md），
 * 全部落在本模块的纯函数与查询里；路由只负责认证、参数校验与审计，不自行拼口径。
 *
 * 关键约定：
 * 1. 统计范围永远是「学校 + 班级集合」：先经 dashboard-scope 的 resolveDashboardScope
 *    拿到 classIds（默认本校全部班级，账号显式配置了学部时按该学部收窄），
 *    所有查询都带上 schoolId + classIds，不把范围交给调用方拼。
 * 2. 归属：问答按记录人的主班级（全校范围内最早的 active 班级）归属，主班级不在本学部的
 *    问答不计入本看板；量表/方案/学生事件/沟通优先用记录自带班级（plans.class_id、
 *    students.class_id、communications.student_id → students.class_id），缺失回落到记录人主班级。
 * 3. 分母为 0 的比率一律返回 null（前端展示为「—」），不返回 0 以免误导。
 * 4. 时间一律按东八区自然日切分（created_at 是 timestamptz，展示与分组都走 Asia/Shanghai）。
 * 5. 学生列脱敏：预警明细只给「学生 A/B/C」，标号按周期内首次出现顺序稳定编号，不给姓名。
 */
import { sql, type SQL } from 'drizzle-orm'
import { communicationChannelLabels, type CommunicationChannel } from '../../shared/contracts'
import { createSortWhitelist, validateSort, type ManagedListResult } from '../../shared/management'
import { gradeLabel } from '../../shared/school-section'
import {
  ALERT_SOURCES,
  addDays,
  daysBetween,
  enumerateDateKeys,
  parseDateKey,
  previousMonthRange,
  previousWeekRange,
  shanghaiDateKey,
  shanghaiDayEnd,
  shanghaiDayStart,
  AI_QUESTION_TABLE_DIMENSION_LABELS,
  ALERT_OVERDUE_RISK_LABEL,
  ALERT_SOURCE_LABELS,
  ASSESSMENT_LEVEL_RISK,
  COMMUNICATION_CHANNEL_UNLABELED,
  COMMUNICATION_HIGH_RISK_LEVELS,
  COMMUNICATION_RISK_LABELS,
  DASHBOARD_COMPARISON_METRICS,
  DASHBOARD_COMPARE_KINDS,
  DASHBOARD_EXPORT_LABELS,
  DASHBOARD_MODULE_LABELS,
  DASHBOARD_MORAL_LINE,
  DASHBOARD_STUDENT_RISK_LABELS,
  DASHBOARD_STUDENT_RISK_LEVELS,
  DASHBOARD_TABLE_DIMENSIONS,
  DASHBOARD_TABLE_DIMS_NONE,
  MODULE_TO_QUESTION_CATEGORY,
  PLAN_QUESTION_CATEGORIES,
  PLAN_RISK_DISTRIBUTION_LEVELS,
  PLAN_TABLE_DIMENSION_LABELS,
  alertRiskLevelMatches,
  isOverdueAlertSource,
  moralLineIncludes,
  PLAN_RISK_LABELS,
  STUDENT_EVENT_RISK_LABELS,
  type AiQuestionCategoryStat,
  type AiQuestionKeywordStat,
  type AiQuestionKpis,
  type AiQuestionRecommendationStat,
  type AiQuestionRow,
  type AiQuestionsResponse,
  type AlertByDay,
  type AlertCommunicationStats,
  type AlertEventTypeStat,
  type AlertKpis,
  type AlertRiskLevelFilter,
  type AlertRow,
  type AlertSource,
  type AlertsResponse,
  type CommunicationByDay,
  type CommunicationChannelStat,
  type CommunicationRiskStat,
  type DashboardComparisonMetric,
  type DashboardExportType,
  type DashboardComparisonResponse,
  type DashboardComparisonRow,
  type DashboardCompareKind,
  type DashboardLine,
  type DashboardPageKey,
  type DashboardPeriod,
  type DashboardTableDimension,
  type OverviewAnalysis,
  type OverviewKpis,
  type OverviewSummary,
  type PlanByDay,
  type PlanCategoryStat,
  type PlanKpis,
  type PlanRiskDistributionLevel,
  type PlanRiskStat,
  type PlanRow,
  type PlansResponse,
  type PlanStudentRiskStat,
  type PlanRiskSeverity,
  type QuestionCategoryValue
} from '../../shared/dashboard'
import { paginateResult } from '../utils/pagination'
import type { DbClient } from '../utils/db'
import type { DashboardScope } from './dashboard-scope'
import { QUESTION_CATEGORIES, QUESTION_CATEGORY_OTHER } from './question-category'

// ===== 口径常量 =====

/**
 * 安全事件的高危判定：现行 createSafetyReferral 写死 severity='red'，
 * 保留 high/crisis 以兼容后续分级；都是「需要关注」的事件。
 */
export const SAFETY_HIGH_RISK_SEVERITIES = ['red', 'high', 'crisis'] as const
/** 学生事件的高危判定（severity 取值：低/中/高/严重）。 */
export const STUDENT_EVENT_HIGH_RISK_SEVERITIES = ['高', '严重'] as const
/** 未闭环：安全事件与学生事件的 status 都是 open/resolved/closed，未闭环即非 closed。 */
export const OPEN_EVENT_STATUS = 'closed'
/**
 * 方案终态：completed / closed / archived 之外都算「未闭环」（与方案列表口径一致）。
 * 方案逾期（执行项逾期 / 复盘逾期）只在未闭环方案上产生。
 */
export const PLAN_CLOSED_STATUSES = ['completed', 'closed', 'archived'] as const

/** 单次查询在内存中合并的预警条数上限（预警看板是合并两表后内存分页）。 */
export const ALERT_MERGE_LIMIT = 5000
/** 导出单次最多导出的明细行数（与 ALERT_MERGE_LIMIT 同级的保护上限）。 */
export const EXPORT_ROW_LIMIT = 10000
/** AI 问答页关键词 Top 榜的条数（二级页展示）。 */
export const AI_QUESTION_KEYWORD_LIMIT = 20
/** 总览页「AI 问答分布」卡片上文字行展示的 TOP 问题关键词条数。 */
export const OVERVIEW_TOP_KEYWORD_LIMIT = 6

/** 明细表排序字段（服务端映射为 SQL 片段，不接受用户输入直接进 SQL）。 */
const AI_QUESTION_SORT_FIELDS = ['grade', 'className', 'category', 'date', 'count', 'highRisk'] as const
const PLAN_SORT_FIELDS = ['grade', 'className', 'category', 'date', 'planTotal', 'completionRate', 'executionRate', 'high', 'medium', 'low'] as const
const ALERT_SORT_FIELDS = ['occurredAt', 'source', 'studentLabel', 'grade', 'className', 'keyword', 'teacherName', 'status', 'riskLevel', 'type'] as const

/** 排序白名单：沿用统一管理框架的 createSortWhitelist + validateSort，杜绝用户输入直接进 SQL。 */
export const AI_QUESTION_SORT_WHITELIST = createSortWhitelist(...AI_QUESTION_SORT_FIELDS)
export const PLAN_SORT_WHITELIST = createSortWhitelist(...PLAN_SORT_FIELDS)
export const ALERT_SORT_WHITELIST = createSortWhitelist(...ALERT_SORT_FIELDS)

// ===== 纯函数（单测覆盖） =====

// 东八区自然日工具定义在 shared/dashboard.ts（前端同款逻辑），这里转出供测试与路由使用。
export { addDays, daysBetween, enumerateDateKeys, parseDateKey, previousMonthRange, previousWeekRange, shanghaiDateKey, shanghaiDayEnd, shanghaiDayStart }

/** 百分比（0-100，保留 1 位小数）；分母为 0 返回 null。 */
export function percentage(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

/** 平均值（保留 1 位小数）；分母为 0 返回 null（用于人均提问、平均会话轮次等）。 */
export function average(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null
  return Math.round((numerator / denominator) * 10) / 10
}

/** 方案执行项汇总（PRD 9 与看板口径的分母/分子都从这里取）。 */
export interface PlanActionTotals {
  /** 方案总执行项数（含未确认与已排除项；完成度分母） */
  total: number
  /** 已完成执行项（status = completed，与「剩余未执行项」互补） */
  completed: number
  /** 已确认纳入的执行项（回填率与及时率的分母，即「应执行项」） */
  included: number
  /** 有回填的执行项（有执行时间或证据） */
  executed: number
  /** 按期执行项：已完成且未超过截止时间，或尚未到截止时间（及时率分子） */
  timely: number
}/**
 * 方案执行指标（PRD 9）：
 * - 完成度 = 已完成执行项 / 方案总执行项数；
 * - 回填率 = 有回填的执行项 / 已确认纳入执行项（应回填）；
 * - 及时率 = 按期执行项 / 已确认纳入执行项。
 *   「按期」= 已完成且完成时间不晚于截止时间，或尚未到截止时间；
 *   逾期后补完成、以及未完成且已过期的项都算不及时。
 */
export function planActionRates(input: PlanActionTotals): {
  completionRate: number | null
  executionRate: number | null
  timelyRate: number | null
} {
  return {
    completionRate: percentage(input.completed, input.total),
    executionRate: percentage(input.executed, input.included),
    timelyRate: percentage(input.timely, input.included)
  }
}

/** 从方案报告 JSON 里取风险等级，缺失或非法按低风险处理。 */
export function planRiskSeverity(report: unknown): PlanRiskSeverity {
  const severity = (report as { risk?: { severity?: unknown } } | null)?.risk?.severity
  return severity === 'low' || severity === 'medium' || severity === 'high' || severity === 'crisis' ? severity : 'low'
}

/** 方案风险等级中文标签。 */
export function planRiskLabel(severity: string | null | undefined): string {
  return PLAN_RISK_LABELS[severity as PlanRiskSeverity] ?? PLAN_RISK_LABELS.low
}

/**
 * 方案报告的四级风险 → 分布三档：crisis（安全关注）并入高风险。
 * 与明细表的高 / 中 / 低风险列同源，避免同一风险在两个展示里口径不一。
 */
export function planRiskBucket(severity: PlanRiskSeverity): PlanRiskDistributionLevel {
  return severity === 'crisis' ? 'high' : severity
}

/** 方案风险等级分布（三档固定顺序，缺失档补 0）。 */
function buildPlanRiskDistribution(rows: ReadonlyArray<{ severity: string | null, value: number }>): PlanRiskStat[] {
  const counts = new Map<PlanRiskDistributionLevel, number>()
  for (const row of rows) {
    const level = planRiskBucket(planRiskSeverity({ risk: { severity: row.severity } }))
    counts.set(level, (counts.get(level) ?? 0) + row.value)
  }
  return PLAN_RISK_DISTRIBUTION_LEVELS.map(level => ({ level, label: PLAN_RISK_LABELS[level], count: counts.get(level) ?? 0 }))
}

/** 学生事件严重度 → 看板风险等级标签。 */
export function studentEventRiskLabel(severity: string | null | undefined): string {
  return STUDENT_EVENT_RISK_LABELS[severity ?? ''] ?? '中风险'
}

/** 安全事件的安全等级标签（不暴露内部分类）。 */
export const SAFETY_RISK_LABEL = '安全关注'

/** 按出现顺序给学生编号（学生 A/B/C…），同一学生在同一周期内保持稳定。 */
export function assignStudentLabels(studentIds: readonly (string | null | undefined)[]): Map<string, string> {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const map = new Map<string, string>()
  for (const id of studentIds) {
    if (!id || map.has(id)) continue
    const index = map.size
    map.set(id, index < letters.length ? `学生 ${letters[index]}` : `学生 ${index + 1}`)
  }
  return map
}

/** 模块 ID → 问答题分类（推荐量表按分类折算时用）。 */
export function moduleQuestionCategory(module: string | null | undefined): QuestionCategoryValue {
  return MODULE_TO_QUESTION_CATEGORY[module ?? ''] ?? QUESTION_CATEGORY_OTHER
}

/**
 * 模块 → 量表分类的 SQL 表达式（量表与方案页的筛选与明细分组用）。
 * 与 moduleQuestionCategory() 同源：分支由 MODULE_TO_QUESTION_CATEGORY 生成，
 * 未映射模块（含 NULL）落到「其他类」，避免两处口径漂移。
 */
function moduleCategorySql(column: SQL): SQL {
  const branches = Object.entries(MODULE_TO_QUESTION_CATEGORY).map(([module, category]) => sql`when ${module} then ${category}`)
  return sql`case ${column} ${sql.join(branches, sql` `)} else ${QUESTION_CATEGORY_OTHER} end`
}

/** 量表分类筛选条件；未勾选时返回 null（不加条件）。 */
function categoryCondition(column: SQL, categories?: readonly string[]): SQL | null {
  if (!categories?.length) return null
  return sql`${moduleCategorySql(column)} in (${sql.join(categories.map(item => sql`${item}`), sql`, `)})`
}

/** 方案模块 ID → 中文名（分类统计与明细行展示）。 */
export function moduleLabel(module: string | null | undefined): string {
  if (!module) return '未标注'
  return DASHBOARD_MODULE_LABELS[module] ?? module
}

/** 预警来源 → 中文标签。 */
export function alertSourceLabel(source: AlertSource): string {
  return ALERT_SOURCE_LABELS[source]
}

/** 安全事件来源类型（chat/assessment）折算成看板来源枚举。 */
export function safetySourceOf(sourceType: string | null | undefined): AlertSource {
  return sourceType === 'assessment' ? 'safety_assessment' : 'safety_chat'
}

/**
 * 预警是否属于「高危」：安全事件全量、高风险家校沟通全量、学生事件取高/严重。
 * 方案逾期不计入高危口径（它统计在 overdueOpen 里），避免「高危未闭环」指标被逾期项稀释。
 */
export function isHighRiskAlert(input: { source: AlertSource, severity: string | null | undefined }): boolean {
  if (isOverdueAlertSource(input.source)) return false
  // 高风险家校沟通只在 risk_level = crisis / high 时进预警，因此该来源恒为高危
  if (input.source === 'communication_risk') return true
  if (input.source === 'student_event') {
    return STUDENT_EVENT_HIGH_RISK_SEVERITIES.includes((input.severity ?? '') as typeof STUDENT_EVENT_HIGH_RISK_SEVERITIES[number])
  }
  return SAFETY_HIGH_RISK_SEVERITIES.includes((input.severity ?? '') as typeof SAFETY_HIGH_RISK_SEVERITIES[number])
}

/** 预警来源 → 趋势分组（安全事项 / 学生事件 / 高风险家校沟通 / 方案逾期）。 */
export type AlertTrendGroup = 'safety' | 'studentEvent' | 'communication' | 'overdue'

export function alertTrendGroup(source: AlertSource): AlertTrendGroup {
  if (isOverdueAlertSource(source)) return 'overdue'
  if (source === 'student_event') return 'studentEvent'
  if (source === 'communication_risk') return 'communication'
  return 'safety'
}

/**
 * 预警状态归一：安全事件只有 open/closed，统一给成 open/resolved/closed 三态。
 * 高风险家校沟通没有处理态，取记录自身的生命周期：未归档 = 待解决，已归档 = 已关闭（见 loadCommunicationAlertsRaw）。
 */
export function normalizeAlertStatus(status: string | null | undefined): 'open' | 'resolved' | 'closed' {
  if (status === 'resolved' || status === 'closed') return status
  return 'open'
}

/** CSV 文本（带 UTF-8 BOM，逗号转义，CRLF 换行，Excel 直接打开不乱码）。 */
export function buildCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
  const escape = (value: string | number | null) => {
    if (value === null || value === undefined) return ''
    const text = String(value)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return '\uFEFF' + [headers, ...rows].map(row => row.map(escape).join(',')).join('\r\n')
}

// ===== 统计区间 =====

export interface DashboardRange {
  startKey: string
  endKey: string
  start: Date
  end: Date
  days: number
  period: DashboardPeriod
  /** 环比对照方式（见 shared/dashboard.ts 的 DASHBOARD_COMPARE_KINDS）。 */
  compare: DashboardCompareKind
}

/**
 * 抛错：Nitro 路由里 createError 是运行时全局，能带上 HTTP 状态码；
 * 单测（vitest，无 Nitro 全局）里退化为普通 Error，方便对纯函数做断言。
 */
function fail(statusCode: number, message: string): never {
  if (typeof createError === 'function') throw createError({ statusCode, message })
  throw new Error(message)
}

/**
 * 解析看板统计区间：默认「近 defaultDays 天」（overview 传 0 表示只统计今天），
 * 超出 maxDays 抛 400。非法日期也抛 400，不做静默兜底。
 * compare 决定环比对照区间（滚动等长区间 / 上一自然周 / 上一自然月），只影响对照区间，不影响本期校验。
 */
export function resolveDashboardRange(
  input: { start?: string, end?: string, compare?: string },
  options: { defaultDays: number, maxDays: number, now?: Date }
): DashboardRange {
  const todayKey = shanghaiDateKey(options.now ?? new Date())
  const endKey = input.end ? parseDateKey(input.end) : todayKey
  if (!endKey) fail(400, '统计结束日期格式不正确（应为 YYYY-MM-DD）')
  const fallbackStart = options.defaultDays > 0 ? addDays(endKey, -(options.defaultDays - 1)) : endKey
  const startKey = input.start ? parseDateKey(input.start) : fallbackStart
  if (!startKey) fail(400, '统计开始日期格式不正确（应为 YYYY-MM-DD）')
  if (startKey > endKey) fail(400, '统计开始日期不能晚于结束日期')
  const days = daysBetween(startKey, endKey)
  if (days > options.maxDays) fail(400, `统计区间最长 ${options.maxDays} 天，请缩小范围后重试`)
  const compare: DashboardCompareKind = (DASHBOARD_COMPARE_KINDS as readonly string[]).includes(input.compare ?? '')
    ? input.compare as DashboardCompareKind
    : 'rolling'
  return {
    startKey,
    endKey,
    start: shanghaiDayStart(startKey),
    end: shanghaiDayEnd(endKey),
    days,
    period: { start: startKey, end: endKey },
    compare
  }
}

/**
 * 环比对照区间（用于总览 / AI / 量表页 KPI 的「较上期」）：
 * - rolling：紧邻当前区间之前、长度相同的上一个区间；
 * - week：当前区间起点所在自然周的上一自然周；
 * - month：当前区间起点所在自然月的上一自然月。
 */
export function previousRange(range: DashboardRange): DashboardRange {
  const span = range.compare === 'week'
    ? previousWeekRange(range.startKey)
    : range.compare === 'month'
      ? previousMonthRange(range.startKey)
      : { start: addDays(range.startKey, -(range.days)), end: addDays(range.startKey, -1) }
  const startKey = span.start
  const endKey = span.end
  return {
    startKey,
    endKey,
    start: shanghaiDayStart(startKey),
    end: shanghaiDayEnd(endKey),
    days: daysBetween(startKey, endKey),
    period: { start: startKey, end: endKey },
    compare: range.compare
  }
}

// ===== SQL 片段 =====

/**
 * 计数与偏移：与 server/domain/school-management.ts 的 countSql / offsetFrom 语义一致。
 * 这里本地定义，避免 import school-management（它依赖 utils/auth → h3，单测环境解析不到，
 * 会把看板口径的纯函数测试一起拖挂）。
 */
const countSql = sql<number>`count(*)::int`
function offsetFrom(page: number, pageSize: number): number {
  return (page - 1) * pageSize
}

/** 记录人主班级子查询：全校范围内最早的 active 班级（口径第 2 条）。 */
function primaryClassSource(schoolId: string): SQL {
  return sql`(select distinct on (c.owner_user_id) c.owner_user_id, c.id, c.name, c.grade
    from classes c
    where c.school_id = ${schoolId} and c.status = 'active'
    order by c.owner_user_id, c.created_at asc, c.id asc)`
}

/** classIds 的 IN 列表（空数组不允许调用，调用前先短路）。 */
function classIdIn(classIds: readonly string[]): SQL {
  return sql`in (${sql.join(classIds.map(id => sql`${id}::uuid`), sql`, `)})`
}

/** 学部班级集合与前端传的班级筛选取交集（前端传了学部外的班级 → 该班级不出数据）。 */
export function intersectClassIds(scopeIds: readonly string[], requested?: readonly string[] | null): string[] {
  if (!requested?.length) return [...scopeIds]
  const allowed = new Set(scopeIds)
  return requested.filter(id => allowed.has(id))
}

/** 把 SQL 时间条件收敛在一处，避免各处口径漂移。 */
function timeWindow(column: SQL, range: DashboardRange): SQL {
  return sql`${column} >= ${range.start} and ${column} <= ${range.end}`
}

// ===== 德育口径（PRD 5.2 / 8.2.1）=====
// 德育主任（moral_education_director）只看德育线：按提问分类、方案/量表模块、学生事件类型
// 三组白名单裁剪（取值集中在 shared/dashboard.ts 的 DASHBOARD_MORAL_LINE，改口径只改一处）。
// 安全事项不裁剪（安全优先）；趋势与年级/班级对比不裁剪。
// 三个函数返回条件（SQL）或 null（不裁剪）；内联到 where 子句时用 andSql() 拼前导 and。

export function moralQuestionCondition(column: SQL, line: DashboardLine): SQL | null {
  if (line !== 'moral') return null
  return sql`coalesce(nullif(${column}, ''), ${QUESTION_CATEGORY_OTHER}) in (${sql.join(DASHBOARD_MORAL_LINE.questionCategories.map(value => sql`${value}`), sql`, `)})`
}

export function moralModuleCondition(column: SQL, line: DashboardLine): SQL | null {
  if (line !== 'moral') return null
  return sql`${column} in (${sql.join(DASHBOARD_MORAL_LINE.modules.map(value => sql`${value}`), sql`, `)})`
}

export function moralStudentEventCondition(column: SQL, line: DashboardLine): SQL | null {
  if (line !== 'moral') return null
  return sql`${column} in (${sql.join(DASHBOARD_MORAL_LINE.studentEventTypes.map(value => sql`${value}`), sql`, `)})`
}

/** 条件为空时返回空片段，便于直接内联在 where 子句尾部。 */
export function andSql(condition: SQL | null): SQL {
  return condition ? sql` and ${condition}` : sql``
}

/**
 * 提问分类图例的可见分类：德育口径只展示德育线白名单里的分类（不显示恒为 0 的其他分类），
 * 全量口径展示全部 6 类（5 大类 + 德育类问题）。二级页与总览聚合卡共用同一份图例。
 */
export function visibleQuestionCategories(line: DashboardLine): readonly QuestionCategoryValue[] {
  return line === 'moral'
    ? QUESTION_CATEGORIES.filter(category => moralLineIncludes('questionCategory', category))
    : QUESTION_CATEGORIES
}

async function rowsOf<T>(query: Promise<{ rows: unknown[] }>): Promise<T[]> {
  const result = await query
  return result.rows as T[]
}

interface ScopedQuery {
  schoolId: string
  classIds: string[]
  range: DashboardRange
  /** 数据口径：德育主任为 moral（德育线），其余为 all。 */
  line: DashboardLine
}

/** 校验 scope 与班级交集，返回 null 表示「交集为空，直接返回空结果」。 */
function scopeGuard(scope: DashboardScope, requestedClassIds?: readonly string[] | null): string[] | null {
  const ids = intersectClassIds(scope.classIds, requestedClassIds)
  if (!scope.classIds.length || !ids.length) return null
  return ids
}

// ===== 总览 =====

/** 总览的空结果（无班级范围时的兜底，含环比字段）。 */
function emptyOverview(range: DashboardRange, previous: DashboardRange): OverviewSummary {
  const dates = enumerateDateKeys(range.startKey, range.endKey)
  const kpis: OverviewKpis = {
    aiQuestions: 0,
    recommendationAnswerRate: null,
    planTotal: 0,
    planCompletionRate: null,
    planTimelyRate: null,
    highRiskOpen: 0
  }
  return {
    period: range.period,
    previousPeriod: previous.period,
    kpis,
    previousKpis: { ...kpis },
    trend: { dates, aiQuestions: dates.map(() => 0), planTotal: dates.map(() => 0) }
  }
}

/**
 * 总览的全局下钻过滤：年级 +（多选）班级。
 * 折成班级集合后交给既有查询：SQL 里的 `pc.id / coalesce(记录自带班级, pc.id) in classIds`
 * 与二级页在 SQL 里叠加的「年级条件」等价（主班级与记录自带班级同属一个年级）。
 */
export interface OverviewFilters {
  grade?: number
  classIds?: string[]
}

function narrowClassIds(scope: DashboardScope, filters?: OverviewFilters): string[] {
  const requested = filters?.classIds?.length
    ? new Set(intersectClassIds(scope.classIds, filters.classIds))
    : null
  const gradeClasses = filters?.grade
    ? new Set(scope.classes.filter(item => item.grade === filters.grade).map(item => item.id))
    : null
  return scope.classIds.filter(id => (!requested || requested.has(id)) && (!gradeClasses || gradeClasses.has(id)))
}

/**
 * 总览 = 当前区间 + 环比对照区间：两期各算一套同口径 KPI，
 * 环比差值交给前端（计数与比率的变化口径不同，服务端不预先合成）。
 */
export async function loadOverview(
  db: DbClient,
  scope: DashboardScope,
  range: DashboardRange,
  filters?: OverviewFilters
): Promise<OverviewSummary> {
  const previous = previousRange(range)
  const classIds = narrowClassIds(scope, filters)
  if (!classIds.length) return emptyOverview(range, previous)
  // 过滤折成班级集合后复用同一条查询链路，保证与二级页口径一致
  const effectiveScope: DashboardScope = { ...scope, classIds }

  const [current, previousKpis] = await Promise.all([
    loadOverviewSlice(db, effectiveScope, range),
    loadOverviewSlice(db, effectiveScope, previous)
  ])

  return {
    period: range.period,
    previousPeriod: previous.period,
    kpis: current.kpis,
    previousKpis: previousKpis.kpis,
    trend: current.trend
  }
}

/** 单个区间的总览指标与每日趋势（当前区间与环比区间共用同一套查询）。 */
async function loadOverviewSlice(
  db: DbClient,
  scope: DashboardScope,
  range: DashboardRange
): Promise<{ kpis: OverviewKpis, trend: OverviewSummary['trend'] }> {
  const dates = enumerateDateKeys(range.startKey, range.endKey)
  const query: ScopedQuery = { schoolId: scope.schoolId, classIds: scope.classIds, range, line: scope.line }
  const [questionDays, planDays, actionTotals, recommendation, safetyOpen, studentEventOpen] = await Promise.all([
    countQuestionsByDay(db, query),
    countPlansByDay(db, query),
    planActionTotals(db, query),
    // 推荐量表作答率与 AI 问答分析页同源（推荐埋点 + 同教师同量表的作答道次）
    loadRecommendationSummary(db, query, {}),
    countOpenSafetyEvents(db, query),
    countOpenStudentEvents(db, query)
  ])

  const questionMap = new Map(questionDays.map(row => [row.day, row.value]))
  const planMap = new Map(planDays.map(row => [row.day, row.value]))
  const rates = planActionRates(actionTotals)

  return {
    kpis: {
      aiQuestions: questionDays.reduce((sum, row) => sum + row.value, 0),
      recommendationAnswerRate: percentage(recommendation.totalAnswered, recommendation.totalRecommended),
      planTotal: planDays.reduce((sum, row) => sum + row.value, 0),
      planCompletionRate: rates.completionRate,
      planTimelyRate: rates.timelyRate,
      highRiskOpen: safetyOpen + studentEventOpen
    },
    trend: {
      dates,
      aiQuestions: dates.map(key => questionMap.get(key) ?? 0),
      planTotal: dates.map(key => planMap.get(key) ?? 0)
    }
  }
}

async function countQuestionsByDay(db: DbClient, query: ScopedQuery): Promise<Array<{ day: string, value: number }>> {
  const { schoolId, classIds, range, line } = query
  const moral = andSql(moralQuestionCondition(sql`cm.question_category`, line))
  return rowsOf(db.execute(sql`
    select to_char((cm.created_at at time zone 'Asia/Shanghai')::date, 'YYYY-MM-DD') as day,
           count(*)::int as value
    from chat_messages cm
    join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = cm.owner_user_id
    where cm.school_id = ${schoolId} and cm.role = 'user' and cm.deleted_at is null
      and ${timeWindow(sql`cm.created_at`, range)} and pc.id ${classIdIn(classIds)}${moral}
    group by 1
  `))
}

async function countPlansByDay(db: DbClient, query: ScopedQuery): Promise<Array<{ day: string, value: number }>> {
  const { schoolId, classIds, range, line } = query
  const moral = andSql(moralModuleCondition(sql`p.module`, line))
  return rowsOf(db.execute(sql`
    select to_char((p.created_at at time zone 'Asia/Shanghai')::date, 'YYYY-MM-DD') as day,
           count(*)::int as value
    from plans p
    left join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = p.owner_user_id
    where p.school_id = ${schoolId} and ${timeWindow(sql`p.created_at`, range)}
      and coalesce(p.class_id, pc.id) ${classIdIn(classIds)}${moral}
    group by 1
  `))
}

/**
 * 执行项的分子/分母表达式（计数片段与明细排序键共用，避免口径漂移）：
 * total / completed / included / executed / timely，含义见 PlanActionTotals。
 * timely 用 not(...) 表达「按期」：逾期后补完成与未完成且已过期都不算按期。
 */
function planActionCountSql(kind: keyof PlanActionTotals): SQL {
  if (kind === 'total') return sql`count(pa.id)`
  if (kind === 'completed') return sql`count(pa.id) filter (where pa.status = 'completed')`
  if (kind === 'included') return sql`count(pa.id) filter (where pa.decision = 'included')`
  if (kind === 'executed') {
    return sql`count(pa.id) filter (where pa.decision = 'included' and (pa.executed_at is not null or pa.evidence_type <> 'none'))`
  }
  return sql`count(pa.id) filter (
        where pa.decision = 'included' and not (
          (pa.status = 'completed' and pa.due_at is not null and pa.completed_at is not null and pa.completed_at > pa.due_at)
          or (pa.status <> 'completed' and pa.due_at is not null and pa.due_at < now())
        )
      )`
}

/**
 * 执行项计数片段（四个查询共用，避免口径漂移）：
 * total / completed / included / executed / timely，含义见 PlanActionTotals。
 */
function planActionCountersSql(): SQL {
  return sql`
      ${planActionCountSql('total')}::int as total,
      ${planActionCountSql('completed')}::int as completed,
      ${planActionCountSql('included')}::int as included,
      ${planActionCountSql('executed')}::int as executed,
      ${planActionCountSql('timely')}::int as timely
  `
}

/**
 * 明细表的比率排序列（完成度 / 回填率）：与 planActionRates 同一组分子分母，
 * 只作为分组子查询的排序键存在（展示仍走 planActionRates 的纯函数结果）。
 * 没有这列时，页面给出排序入口、服务端 order by 会报「列不存在」。
 */
function planActionRateSortSql(): SQL {
  return sql`
      round(${planActionCountSql('completed')}::numeric * 100 / nullif(${planActionCountSql('total')}, 0), 1) as completion_rate,
      round(${planActionCountSql('executed')}::numeric * 100 / nullif(${planActionCountSql('included')}, 0), 1) as execution_rate
  `
}

/**
 * 方案执行项汇总。
 * - total：方案全部执行项（含未确认与已排除，PRD 9 的完成度分母）；
 * - completed / executed / included 与明细页口径一致；
 * - timely：按期执行项（按当前时刻判断）。预警看板的逾期是「截止时间落在统计区间内」的
 *   区间口径，两者用途不同，不要互相替换。
 */
async function planActionTotals(db: DbClient, query: ScopedQuery): Promise<PlanActionTotals> {
  const { schoolId, classIds, range, line } = query
  const moral = andSql(moralModuleCondition(sql`p.module`, line))
  const [row] = await rowsOf<PlanActionTotals>(db.execute(sql`
    select ${planActionCountersSql()}
    from plans p
    left join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = p.owner_user_id
    left join plan_actions pa on pa.plan_id = p.id
    where p.school_id = ${schoolId} and ${timeWindow(sql`p.created_at`, range)}
      and coalesce(p.class_id, pc.id) ${classIdIn(classIds)}${moral}
  `))
  return row ?? { total: 0, completed: 0, included: 0, executed: 0, timely: 0 }
}

async function countOpenSafetyEvents(db: DbClient, query: ScopedQuery): Promise<number> {
  const { schoolId, classIds, range } = query
  const [row] = await rowsOf<{ value: number }>(db.execute(sql`
    select count(*)::int as value
    from safety_events se
    join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = se.owner_user_id
    where se.school_id = ${schoolId} and se.status <> 'closed'
      and se.severity in (${sql.join(SAFETY_HIGH_RISK_SEVERITIES.map(item => sql`${item}`), sql`, `)})
      and ${timeWindow(sql`se.created_at`, range)} and pc.id ${classIdIn(classIds)}
  `))
  return row?.value ?? 0
}

async function countOpenStudentEvents(db: DbClient, query: ScopedQuery): Promise<number> {
  const { schoolId, classIds, range, line } = query
  const moral = andSql(moralStudentEventCondition(sql`se.event_type`, line))
  const [row] = await rowsOf<{ value: number }>(db.execute(sql`
    select count(*)::int as value
    from student_events se
    join students st on st.id = se.student_id
    left join classes stc on stc.id = st.class_id
    join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = se.owner_user_id
    where se.school_id = ${schoolId} and se.status <> 'closed'
      and se.severity in (${sql.join(STUDENT_EVENT_HIGH_RISK_SEVERITIES.map(item => sql`${item}`), sql`, `)})
      and ${timeWindow(sql`coalesce(se.occurred_at, se.created_at)`, range)}
      and coalesce(stc.id, pc.id) ${classIdIn(classIds)}${moral}
  `))
  return row?.value ?? 0
}

// ===== 总览页聚合卡（W2 / W3 / W4-1 / W4-2 / W5）=====

export interface OverviewAnalysisFilters {
  grade?: number
  classIds?: string[]
}

/**
 * 总览页聚合卡：只计算 `pages`（当前账号可访问的看板页，来自 requireDashboardEntry）对应的分组——
 * 二级页被平台后台取消后，其聚合卡与导航、入口卡一起收敛，服务端不返回无权页的数据。
 * 口径与三个二级页完全一致：复用同一批过滤构造与聚合函数，不维护第二套统计；
 * `dashboard_alerts` 一页承载 W4-1 / W4-2 / W5 三组。
 */
export async function loadOverviewAnalysis(
  db: DbClient,
  scope: DashboardScope,
  range: DashboardRange,
  filters: OverviewAnalysisFilters,
  pages: readonly DashboardPageKey[]
): Promise<Partial<OverviewAnalysis>> {
  const wantAi = pages.includes('dashboard_ai_questions')
  const wantPlans = pages.includes('dashboard_plans')
  const wantAlerts = pages.includes('dashboard_alerts')
  const scopeIds = scopeGuard(scope, filters.classIds)
  if (!scopeIds) return emptyOverviewAnalysis({ ai: wantAi, plans: wantPlans, alerts: wantAlerts, line: scope.line })

  const query: ScopedQuery = { schoolId: scope.schoolId, classIds: scopeIds, range, line: scope.line }
  const alertFilters: AlertScopeFilters = { grade: filters.grade }
  const dates = enumerateDateKeys(range.startKey, range.endKey)
  const [aiQuestions, plans, studentEvents, communication, alertSummary] = await Promise.all([
    wantAi ? loadOverviewAiQuestions(db, query, filters) : undefined,
    wantPlans ? loadOverviewPlans(db, query, filters) : undefined,
    wantAlerts ? loadOverviewStudentEvents(db, query, alertFilters) : undefined,
    wantAlerts ? loadOverviewCommunication(db, query, dates, alertFilters) : undefined,
    wantAlerts ? loadOverviewAlerts(db, query, alertFilters) : undefined
  ])

  const result: Partial<OverviewAnalysis> = {}
  if (aiQuestions) result.aiQuestions = aiQuestions
  if (plans) result.plans = plans
  if (studentEvents) result.studentEvents = studentEvents
  if (communication) result.communication = communication
  if (alertSummary) result.alerts = alertSummary
  return result
}

/** 无班级范围（本校没有班级，或筛选后为空）时的聚合卡兜底：结构与正常返回一致，数值全 0。 */
export function emptyOverviewAnalysis(input: {
  ai: boolean
  plans: boolean
  alerts: boolean
  line: DashboardLine
}): Partial<OverviewAnalysis> {
  const result: Partial<OverviewAnalysis> = {}
  if (input.ai) {
    result.aiQuestions = {
      total: 0,
      byCategory: visibleQuestionCategories(input.line).map(category => ({ category, count: 0 })),
      topKeywords: []
    }
  }
  if (input.plans) result.plans = { total: 0, byQuestionCategory: buildPlanCategoryStats([]) }
  if (input.alerts) {
    result.studentEvents = { total: 0, byType: [] }
    result.communication = { total: 0, channels: [] }
    result.alerts = { highRiskOpen: 0, overdueOpen: 0 }
  }
  return result
}

/** W2：AI 问答分布（6 类，德育主任按白名单裁剪）+ TOP 问题关键词。 */
async function loadOverviewAiQuestions(
  db: DbClient,
  query: ScopedQuery,
  filters: OverviewAnalysisFilters
): Promise<OverviewAnalysis['aiQuestions']> {
  const filter = buildQuestionFilter(query, filters)
  const [rows, topKeywords] = await Promise.all([
    loadQuestionCategoryRows(db, query.schoolId, filter),
    loadQuestionKeywords(db, query.schoolId, filter, OVERVIEW_TOP_KEYWORD_LIMIT)
  ])
  return {
    total: rows.reduce((sum, row) => sum + row.value, 0),
    byCategory: buildQuestionCategoryStats(rows, visibleQuestionCategories(query.line)),
    topKeywords
  }
}

/** W3：心理测评与方案执行——方案按模块折算的 5 大类（与量表与方案页「量表分类占比」同源）。 */
async function loadOverviewPlans(
  db: DbClient,
  query: ScopedQuery,
  filters: OverviewAnalysisFilters
): Promise<OverviewAnalysis['plans']> {
  const rows = await loadPlanCategoryRows(db, query.schoolId, buildPlanFilter(query, filters))
  const byQuestionCategory = buildPlanCategoryStats(rows)
  return {
    total: byQuestionCategory.reduce((sum, item) => sum + item.count, 0),
    byQuestionCategory
  }
}

/** W4-1：学生事件类型分布（E1–E6）与事件总量。 */
async function loadOverviewStudentEvents(
  db: DbClient,
  query: ScopedQuery,
  filters: AlertScopeFilters
): Promise<OverviewAnalysis['studentEvents']> {
  const byType = await loadStudentEventTypeCounts(db, query, filters)
  return { total: byType.reduce((sum, item) => sum + item.count, 0), byType }
}

/** W4-2：家校沟通渠道分布与总量（只读渠道等结构化字段，不读正文与摘要）。 */
async function loadOverviewCommunication(
  db: DbClient,
  query: ScopedQuery,
  dates: readonly string[],
  filters: AlertScopeFilters
): Promise<OverviewAnalysis['communication']> {
  const stats = await loadCommunicationStats(db, query, dates, filters)
  return { total: stats.total, channels: stats.channels }
}

/** W5：预警摘要——高危未闭环与方案逾期未闭环（与预警看板 KPI 同一段 SQL）。 */
async function loadOverviewAlerts(
  db: DbClient,
  query: ScopedQuery,
  filters: AlertScopeFilters
): Promise<OverviewAnalysis['alerts']> {
  const [highRiskOpen, overdueOpen] = await Promise.all([
    countOpenHighRiskAlerts(db, query, filters),
    countPlanOverdueAlerts(db, query, filters)
  ])
  return { highRiskOpen, overdueOpen }
}

// ===== AI 问答分析 =====

export interface AiQuestionFilters {
  grade?: number
  classIds?: string[]
  categories?: string[]
}

export interface DashboardTableQuery {
  page: number
  pageSize: number
  sort: string
  order: 'asc' | 'desc'
  /**
   * 表头维度勾选结果：
   * - undefined = 全部维度参与聚合（页面默认全勾，也是旧调用方的行为）；
   * - 空数组 = 一个维度都不勾，只出一行「周期总计」（原型语义）。
   */
  dims?: readonly DashboardTableDimension[]
}

interface RecommendationSummary {
  totalRecommended: number
  totalAnswered: number
  byCategory: Map<string, { recommended: number, answered: number }>
}

export async function loadAiQuestions(
  db: DbClient,
  scope: DashboardScope,
  range: DashboardRange,
  filters: AiQuestionFilters,
  table: DashboardTableQuery
): Promise<AiQuestionsResponse> {
  const dates = enumerateDateKeys(range.startKey, range.endKey)
  const scopeIds = scopeGuard(scope, filters.classIds)
  // 德育口径下分类图例只展示德育线白名单里的分类，不显示恒为 0 的其他分类
  const visibleCategories = visibleQuestionCategories(scope.line)
  const emptyTable: ManagedListResult<AiQuestionRow> = { rows: [], page: table.page, pageSize: table.pageSize, total: 0, capabilities: [] }
  const previous = previousRange(range)
  const emptyKpis: AiQuestionKpis = {
    aiQuestions: 0,
    recommended: 0,
    answered: 0,
    recommendationRate: null,
    answeredRate: null,
    highRiskQuestions: 0,
    activeTeachers: 0,
    questionsPerTeacher: null,
    turnsPerSession: null
  }
  if (!scopeIds) {
    return {
      period: range.period,
      previousPeriod: previous.period,
      kpis: emptyKpis,
      previousKpis: { ...emptyKpis },
      byDay: dates.map(date => ({ date, count: 0 })),
      byCategory: visibleCategories.map(category => ({ category, count: 0 })),
      topKeywords: [],
      recommendation: buildRecommendationRows(visibleCategories),
      table: emptyTable
    }
  }

  const query: ScopedQuery = { schoolId: scope.schoolId, classIds: scopeIds, range, line: scope.line }
  const filter = buildQuestionFilter(query, filters)
  const [current, previousBundle, byDayRows, byCategoryRows, topKeywords, tableResult] = await Promise.all([
    loadAiQuestionKpis(db, query, filters),
    // 环比：同一套口径在紧邻的等长区间上再算一次
    loadAiQuestionKpis(db, { ...query, range: previous }, filters),
    rowsOf<{ day: string, value: number }>(db.execute(sql`
      select to_char((cm.created_at at time zone 'Asia/Shanghai')::date, 'YYYY-MM-DD') as day, count(*)::int as value
      from chat_messages cm
      join ${primaryClassSource(query.schoolId)} pc on pc.owner_user_id = cm.owner_user_id
      where ${filter}
      group by 1 order by 1
    `)),
    loadQuestionCategoryRows(db, query.schoolId, filter),
    loadQuestionKeywords(db, query.schoolId, filter, AI_QUESTION_KEYWORD_LIMIT),
    loadQuestionTable(db, query, filter, table)
  ])

  const byDayMap = new Map(byDayRows.map(row => [row.day, row.value]))
  const allCategories = buildQuestionCategoryStats(byCategoryRows, visibleCategories)
  const categoryMap = new Map(allCategories.map(item => [item.category, item.count]))

  const recommendations = [
    ...visibleCategories.map(category => buildRecommendationRow(category, categoryMap.get(category) ?? 0, current.byCategory.get(category)))
  ]

  return {
    period: range.period,
    previousPeriod: previous.period,
    kpis: current.kpis,
    previousKpis: previousBundle.kpis,
    byDay: dates.map(date => ({ date, count: byDayMap.get(date) ?? 0 })),
    byCategory: allCategories,
    topKeywords,
    recommendation: recommendations,
    table: tableResult
  }
}

/** 分类占比的原始计数（分类为空的提问归「其他类」）；图文与聚合卡共用。 */
async function loadQuestionCategoryRows(
  db: DbClient,
  schoolId: string,
  filter: SQL
): Promise<Array<{ category: string, value: number }>> {
  return rowsOf<{ category: string, value: number }>(db.execute(sql`
    select coalesce(nullif(cm.question_category, ''), ${QUESTION_CATEGORY_OTHER}) as category, count(*)::int as value
    from chat_messages cm
    join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = cm.owner_user_id
    where ${filter}
    group by 1 order by 2 desc, 1 asc
  `))
}

/** TOP 问题关键词（提问的 jsonb 关键词数组展开后计数）。 */
async function loadQuestionKeywords(
  db: DbClient,
  schoolId: string,
  filter: SQL,
  limit: number
): Promise<AiQuestionKeywordStat[]> {
  const rows = await rowsOf<{ keyword: string, value: number }>(db.execute(sql`
    select kw as keyword, count(*)::int as value
    from chat_messages cm
    join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = cm.owner_user_id,
         jsonb_array_elements_text(cm.question_keywords) as kw
    where ${filter}
    group by 1 order by 2 desc, 1 asc limit ${limit}
  `))
  return rows.map(row => ({ keyword: row.keyword, count: row.value }))
}

/**
 * 分类占比图例补齐：白名单分类恒展示（缺失补 0），
 * 闭集外的历史分类追加在最后（与旧数据的兼容展示）。
 */
function buildQuestionCategoryStats(
  rows: ReadonlyArray<{ category: string, value: number }>,
  visibleCategories: readonly QuestionCategoryValue[]
): AiQuestionCategoryStat[] {
  const categoryMap = new Map(rows.map(row => [row.category, row.value]))
  const stats: AiQuestionCategoryStat[] = visibleCategories.map(category => ({ category, count: categoryMap.get(category) ?? 0 }))
  for (const row of rows) {
    if ((visibleCategories as readonly string[]).includes(row.category)) continue
    if ((QUESTION_CATEGORIES as readonly string[]).includes(row.category)) stats.push({ category: row.category, count: row.value })
  }
  return stats
}

interface AiQuestionKpiBundle {
  kpis: AiQuestionKpis
  /** 分类维度的「推荐 → 作答」明细（推荐量表作答转化表用） */
  byCategory: Map<string, { recommended: number, answered: number }>
}

/**
 * AI 问答页的 KPI（当期与环比区间共用同一函数，保证两期口径完全一致）。
 * 三个数来自三处：提问条数（chat_messages）、推荐/作答（埋点 + 同教师同量表的作答）、
 * 高风险提问数（该提问所在会话当天命中高危安全事项，与明细表 highRisk 列同一判定）。
 */
async function loadAiQuestionKpis(
  db: DbClient,
  query: ScopedQuery,
  filters: AiQuestionFilters
): Promise<AiQuestionKpiBundle> {
  const { schoolId } = query
  const filter = buildQuestionFilter(query, filters)
  const [questionTotal, recommendation, highRiskTotal] = await Promise.all([
    rowsOf<{ value: number, teachers: number, sessions: number }>(db.execute(sql`
      select count(*)::int as value,
             count(distinct cm.owner_user_id)::int as teachers,
             count(distinct cm.session_id)::int as sessions
      from chat_messages cm
      join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = cm.owner_user_id
      where ${filter}
    `)),
    loadRecommendationSummary(db, query, filters),
    rowsOf<{ value: number }>(db.execute(sql`
      select count(*)::int as value
      from chat_messages cm
      join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = cm.owner_user_id
      where ${filter}
        and exists (
          select 1 from safety_events se
          where se.school_id = ${schoolId} and se.source_type = 'chat'
            and se.source_id = cm.session_id
            and se.severity in (${sql.join(SAFETY_HIGH_RISK_SEVERITIES.map(item => sql`${item}`), sql`, `)})
            and (se.created_at at time zone 'Asia/Shanghai')::date = (cm.created_at at time zone 'Asia/Shanghai')::date
        )
    `))
  ])

  const totals = questionTotal[0] ?? { value: 0, teachers: 0, sessions: 0 }
  const aiQuestions = totals.value
  return {
    kpis: {
      aiQuestions,
      recommended: recommendation.totalRecommended,
      answered: recommendation.totalAnswered,
      recommendationRate: percentage(recommendation.totalRecommended, aiQuestions),
      answeredRate: percentage(recommendation.totalAnswered, recommendation.totalRecommended),
      highRiskQuestions: highRiskTotal[0]?.value ?? 0,
      activeTeachers: totals.teachers,
      questionsPerTeacher: average(aiQuestions, totals.teachers),
      turnsPerSession: average(aiQuestions, totals.sessions)
    },
    byCategory: recommendation.byCategory
  }
}

function buildQuestionFilter(query: ScopedQuery, filters: AiQuestionFilters): SQL {
  const conditions: SQL[] = [
    sql`cm.school_id = ${query.schoolId}`,
    sql`cm.role = 'user'`,
    sql`cm.deleted_at is null`,
    timeWindow(sql`cm.created_at`, query.range),
    sql`pc.id ${classIdIn(query.classIds)}`
  ]
  if (filters.grade) conditions.push(sql`pc.grade = ${filters.grade}`)
  if (filters.categories?.length) {
    conditions.push(sql`coalesce(nullif(cm.question_category, ''), ${QUESTION_CATEGORY_OTHER}) in (${sql.join(filters.categories.map(item => sql`${item}`), sql`, `)})`)
  }
  // 德育口径：与前端分类筛选叠加，而不是相互覆盖
  const moral = moralQuestionCondition(sql`cm.question_category`, query.line)
  if (moral) conditions.push(moral)
  return sql.join(conditions, sql` and `)
}

function buildRecommendationRow(
  category: string,
  aiQuestions: number,
  entry?: { recommended: number, answered: number }
): AiQuestionRecommendationStat {
  const recommended = entry?.recommended ?? 0
  const answered = entry?.answered ?? 0
  return {
    category,
    aiQuestions,
    recommended,
    recommendRate: percentage(recommended, aiQuestions),
    answered,
    answerRate: percentage(answered, recommended)
  }
}

function buildRecommendationRows(categories: readonly QuestionCategoryValue[] = QUESTION_CATEGORIES): AiQuestionRecommendationStat[] {
  return categories.map(category => buildRecommendationRow(category, 0))
}

/**
 * 推荐量表埋点与作答转化。
 * 推荐次数 = assistant_assessment_recommended 事件数（按模块折算到分类）；
 * 作答数 = 同教师、同区间内提交的、量表编码出现在其推荐记录里的作答道数（按道次去重）。
 */
async function loadRecommendationSummary(db: DbClient, query: ScopedQuery, filters: AiQuestionFilters): Promise<RecommendationSummary> {
  const { schoolId, classIds, range } = query
  const gradeCondition = filters.grade ? sql` and pc.grade = ${filters.grade}` : sql``
  const [events, attempts] = await Promise.all([
    rowsOf<{ user_id: string, module: string | null, instruments: string | null }>(db.execute(sql`
      select pe.user_id, pe.metadata->>'module' as module, pe.metadata->>'instruments' as instruments
      from product_events pe
      join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = pe.user_id
      where pe.school_id = ${schoolId} and pe.event_name = 'assistant_assessment_recommended'
        and ${timeWindow(sql`pe.created_at`, range)} and pc.id ${classIdIn(classIds)}${gradeCondition}
    `)),
    rowsOf<{ id: string, owner_user_id: string, assessment_code: string }>(db.execute(sql`
      select aa.id, aa.owner_user_id, aa.assessment_code
      from assessment_attempts aa
      join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = aa.owner_user_id
      where aa.school_id = ${schoolId} and aa.status = 'submitted'
        and ${timeWindow(sql`coalesce(aa.submitted_at, aa.created_at)`, range)} and pc.id ${classIdIn(classIds)}${gradeCondition}
    `))
  ])

  const byCategory = new Map<string, { recommended: number, answered: number }>()
  const bump = (category: string, key: 'recommended' | 'answered') => {
    const entry = byCategory.get(category) ?? { recommended: 0, answered: 0 }
    entry[key] += 1
    byCategory.set(category, entry)
  }

  const recommendedCodesByUser = new Map<string, Set<string>>()
  const categoriesByUserCode = new Map<string, string>()
  const moral = query.line === 'moral'
  for (const event of events) {
    const category = moduleQuestionCategory(event.module)
    // 德育口径：分类不在白名单的推荐记录不计入（其触发的作答也随之不计）
    if (moral && !moralLineIncludes('questionCategory', category)) continue
    bump(category, 'recommended')
    const codes = (event.instruments ?? '').split(',').map(code => code.trim()).filter(Boolean)
    const bucket = recommendedCodesByUser.get(event.user_id) ?? new Set<string>()
    for (const code of codes) {
      bucket.add(code)
      categoriesByUserCode.set(`${event.user_id}:${code}`, category)
    }
    recommendedCodesByUser.set(event.user_id, bucket)
  }

  let totalAnswered = 0
  const countedAttempts = new Set<string>()
  for (const attempt of attempts) {
    if (countedAttempts.has(attempt.id)) continue
    const codes = recommendedCodesByUser.get(attempt.owner_user_id)
    if (!codes?.has(attempt.assessment_code)) continue
    countedAttempts.add(attempt.id)
    const category = categoriesByUserCode.get(`${attempt.owner_user_id}:${attempt.assessment_code}`) ?? QUESTION_CATEGORY_OTHER
    bump(category, 'answered')
    totalAnswered += 1
  }

  return { totalRecommended: events.length, totalAnswered, byCategory }
}

// ===== 明细表「表头维度」（两张明细表共用同一套分组实现）=====
//
// 原型「表头维度勾选」的语义：勾选的维度进入 group by，未勾选的维度不参与聚合
// （select 里输出空值，保证列形状与排序字段稳定）；全部不勾时不带 group by，
// 整段聚合为一行周期总计。

/**
 * 明细表的 select 列顺序与对应的 group by 列序号（两张明细表共用同一套顺序：
 * 班级 1-2 / 年级 3 / 分类 4 / 日期 5）。
 */
const TABLE_DIMENSION_COLUMNS: ReadonlyArray<{ dimension: DashboardTableDimension, positions: readonly number[] }> = [
  { dimension: 'className', positions: [1, 2] },
  { dimension: 'grade', positions: [3] },
  { dimension: 'category', positions: [4] },
  { dimension: 'date', positions: [5] }
]

/** 勾选结果：未传时默认全部维度（页面默认全勾）。 */
function tableDims(dims?: readonly DashboardTableDimension[]): readonly DashboardTableDimension[] {
  return dims ?? DASHBOARD_TABLE_DIMENSIONS
}

/**
 * 只对勾选的维度做 group by（全不勾时返回空片段，聚合为一行周期总计）。
 * 列序号来自上面的静态映射，不拼接任何用户输入。
 */
function tableGroupBy(dims: readonly DashboardTableDimension[]): SQL {
  const indexes = TABLE_DIMENSION_COLUMNS
    .filter(column => dims.includes(column.dimension))
    .flatMap(column => [...column.positions])
  return indexes.length ? sql`group by ${sql.raw(indexes.join(', '))}` : sql``
}

/** 明细行 id：由参与聚合的维度值拼成（周期总计行固定为 total）。 */
function tableRowId(parts: Array<string | null | undefined>): string {
  const values = parts.filter(part => part !== null && part !== undefined && part !== '')
  return values.length ? values.join(':') : 'total'
}

/** AI 问答明细的维度列（未勾选的维度输出空值，不参与聚合也不展示）。 */
function questionDimensionSql(dimension: DashboardTableDimension, dims: readonly DashboardTableDimension[]): SQL {
  const on = dims.includes(dimension)
  if (dimension === 'grade') return on ? sql`pc.grade as grade` : sql`null::int as grade`
  if (dimension === 'className') {
    return on ? sql`pc.id as class_id, pc.name as class_name` : sql`null::uuid as class_id, '' as class_name`
  }
  if (dimension === 'category') {
    return on ? sql`coalesce(nullif(cm.question_category, ''), ${QUESTION_CATEGORY_OTHER}) as category` : sql`'' as category`
  }
  return on
    ? sql`to_char((cm.created_at at time zone 'Asia/Shanghai')::date, 'YYYY-MM-DD') as day`
    : sql`'' as day`
}

/** 量表与方案明细的维度列（口径：优先记录自带班级，缺失回落记录人主班级）。 */
function planDimensionSql(dimension: DashboardTableDimension, dims: readonly DashboardTableDimension[]): SQL {
  const on = dims.includes(dimension)
  if (dimension === 'grade') return on ? sql`coalesce(c.grade, pc.grade) as grade` : sql`null::int as grade`
  if (dimension === 'className') {
    return on ? sql`coalesce(c.id, pc.id) as class_id, coalesce(c.name, pc.name) as class_name` : sql`null::uuid as class_id, '' as class_name`
  }
  if (dimension === 'category') {
    return on ? sql`${moduleCategorySql(sql`p.module`)} as category` : sql`'' as category`
  }
  return on
    ? sql`to_char((p.created_at at time zone 'Asia/Shanghai')::date, 'YYYY-MM-DD') as day`
    : sql`'' as day`
}

const AI_QUESTION_SORT_SQL: Record<typeof AI_QUESTION_SORT_FIELDS[number], SQL> = {
  grade: sql`grade`,
  className: sql`class_name`,
  category: sql`category`,
  date: sql`day`,
  count: sql`value`,
  highRisk: sql`high_risk`
}

/** 明细表：按勾选的表头维度聚合提问条数（不是逐条提问，保护教师提问原文）。 */
async function loadQuestionTable(
  db: DbClient,
  query: ScopedQuery,
  filter: SQL,
  table: DashboardTableQuery
): Promise<ManagedListResult<AiQuestionRow>> {
  const dims = tableDims(table.dims)
  const grouped = sql`
    select ${sql.join(TABLE_DIMENSION_COLUMNS.map(column => questionDimensionSql(column.dimension, dims)), sql`, `)},
           count(*)::int as value,
           -- 空分组（区间内没有提问）时 bool_or 返回 null，这里兜底成 false，保持列契约是 boolean
           coalesce(bool_or(exists (
             select 1 from safety_events se
             where se.school_id = cm.school_id and se.source_type = 'chat'
               and se.source_id = cm.session_id
               and se.severity in (${sql.join(SAFETY_HIGH_RISK_SEVERITIES.map(item => sql`${item}`), sql`, `)})
               and (se.created_at at time zone 'Asia/Shanghai')::date = (cm.created_at at time zone 'Asia/Shanghai')::date
           )), false) as high_risk
    from chat_messages cm
    join ${primaryClassSource(query.schoolId)} pc on pc.owner_user_id = cm.owner_user_id
    where ${filter}
    ${tableGroupBy(dims)}
  `
  const sortKey = validateSort(table.sort, AI_QUESTION_SORT_WHITELIST, 'date') as typeof AI_QUESTION_SORT_FIELDS[number]
  const direction = table.order === 'asc' ? sql`asc` : sql`desc`
  const result = await paginateResult({
    dataQuery: rowsOf<{ class_id: string | null, class_name: string, grade: number | null, category: string, day: string, value: number, high_risk: boolean }>(db.execute(sql`
      select * from (${grouped}) t
      order by ${AI_QUESTION_SORT_SQL[sortKey]} ${direction}, grade asc nulls last, class_name asc, category asc, day asc
      limit ${table.pageSize} offset ${offsetFrom(table.page, table.pageSize)}
    `)),
    countQuery: rowsOf<{ value: number }>(db.execute(sql`select ${countSql} as value from (${grouped}) t`)),
    page: table.page,
    pageSize: table.pageSize
  })

  return {
    rows: result.rows.map(row => ({
      id: tableRowId([row.class_id, row.category, row.day]),
      grade: row.grade,
      gradeLabel: gradeLabelOf(row.grade),
      className: row.class_name ?? '',
      category: row.category,
      date: row.day,
      count: row.value,
      highRisk: row.high_risk,
      // 看板是只读聚合视图：行级能力恒为空数组（不参与统一管理框架）
      _capabilities: []
    })),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    capabilities: []
  }
}

function gradeLabelOf(grade: number | null): string {
  if (!grade) return '未归属'
  return gradeLabel(grade)
}

// ===== 量表与方案分析 =====

export interface PlanFilters {
  grade?: number
  classIds?: string[]
  /** 量表分类（提问 6 分类口径）；未勾选表示全部 */
  categories?: string[]
}

export async function loadPlans(
  db: DbClient,
  scope: DashboardScope,
  range: DashboardRange,
  filters: PlanFilters,
  table: DashboardTableQuery
): Promise<PlansResponse> {
  const dates = enumerateDateKeys(range.startKey, range.endKey)
  const scopeIds = scopeGuard(scope, filters.classIds)
  const emptyTable: ManagedListResult<PlanRow> = { rows: [], page: table.page, pageSize: table.pageSize, total: 0, capabilities: [] }
  const previous = previousRange(range)
  const emptyKpis: PlanKpis = {
    planTotal: 0,
    planCompletionRate: null,
    executionRate: null,
    highRiskPlans: 0,
    assessmentTotal: 0,
    acceptanceRate: null,
    reminderReadRate: null
  }
  if (!scopeIds) {
    return {
      period: range.period,
      previousPeriod: previous.period,
      kpis: emptyKpis,
      previousKpis: { ...emptyKpis },
      byDay: dates.map(date => ({ date, planTotal: 0, completionRate: null, executionRate: null, assessmentCount: 0 })),
      byModule: [],
      byQuestionCategory: buildPlanCategoryStats([]),
      studentRiskDistribution: DASHBOARD_STUDENT_RISK_LEVELS.map(level => ({ level, label: DASHBOARD_STUDENT_RISK_LABELS[level], count: 0 })),
      riskDistribution: buildPlanRiskDistribution([]),
      table: emptyTable
    }
  }

  const query: ScopedQuery = { schoolId: scope.schoolId, classIds: scopeIds, range, line: scope.line }
  const filter = buildPlanFilter(query, filters)
  const [dayRows, moduleRows, categoryRows, riskRows, totalRow, assessmentRows, studentRiskRows, tableResult, previousKpis, conversion] = await Promise.all([
    rowsOf<{ day: string, plan_total: number } & PlanActionTotals>(db.execute(sql`
      select to_char((p.created_at at time zone 'Asia/Shanghai')::date, 'YYYY-MM-DD') as day,
             count(distinct p.id)::int as plan_total,
             ${planActionCountersSql()}
      from plans p
      left join ${primaryClassSource(query.schoolId)} pc on pc.owner_user_id = p.owner_user_id
      left join plan_actions pa on pa.plan_id = p.id
      where ${filter}
      group by 1 order by 1
    `)),
    rowsOf<{ module: string | null, value: number }>(db.execute(sql`
      select p.module as module, count(*)::int as value
      from plans p
      left join ${primaryClassSource(query.schoolId)} pc on pc.owner_user_id = p.owner_user_id
      where ${filter}
      group by 1 order by 2 desc, 1 asc
    `)),
    // 量表分类占比：与明细表的「量表分类」列同一折算（模块 → 提问分类）
    loadPlanCategoryRows(db, query.schoolId, filter),
    rowsOf<{ severity: string | null, value: number }>(db.execute(sql`
      select coalesce(p.report->'risk'->>'severity', 'low') as severity, count(*)::int as value
      from plans p
      left join ${primaryClassSource(query.schoolId)} pc on pc.owner_user_id = p.owner_user_id
      where ${filter}
      group by 1
    `)),
    rowsOf<{ plan_total: number } & PlanActionTotals>(db.execute(sql`
      select count(distinct p.id)::int as plan_total,
             ${planActionCountersSql()}
      from plans p
      left join ${primaryClassSource(query.schoolId)} pc on pc.owner_user_id = p.owner_user_id
      left join plan_actions pa on pa.plan_id = p.id
      where ${filter}
    `)),
    countAssessmentByDay(db, query, filters),
    countStudentRiskLevels(db, query, filters),
    loadPlanTable(db, query, filter, table),
    // 环比：同一套口径在紧邻的等长区间上再算一次（三个标量查询，不含明细）
    loadPlanKpis(db, { ...query, range: previous }, filters),
    // 接受率与提醒触达率（与 loadPlanKpis 共用同一实现，避免两处口径漂移）
    loadPlanConversionKpis(db, query, filters)
  ])

  const byDayMap = new Map(dayRows.map(row => [row.day, row]))
  const assessmentMap = new Map(assessmentRows.map(row => [row.day, row.value]))
  const total = totalRow[0] ?? { plan_total: 0, total: 0, completed: 0, included: 0, executed: 0, timely: 0 }
  const totalRates = planActionRates(total)
  const assessmentTotal = assessmentRows.reduce((sum, row) => sum + row.value, 0)
  const byDay: PlanByDay[] = dates.map(date => {
    const row = byDayMap.get(date)
    const rates = planActionRates(row ?? { total: 0, completed: 0, included: 0, executed: 0, timely: 0 })
    return { date, planTotal: row?.plan_total ?? 0, completionRate: rates.completionRate, executionRate: rates.executionRate, assessmentCount: assessmentMap.get(date) ?? 0 }
  })

  const riskMap = new Map(riskRows.map(row => [planRiskSeverity({ risk: { severity: row.severity } }), row.value]))
  const riskDistribution = buildPlanRiskDistribution(riskRows)
  const byModule: PlanCategoryStat[] = moduleRows.map(row => ({ category: moduleLabel(row.module), count: row.value }))
  const byQuestionCategory = buildPlanCategoryStats(categoryRows)
  const studentRiskCounts = new Map<string, number>()
  for (const row of studentRiskRows) {
    const level = ASSESSMENT_LEVEL_RISK[row.level_code]
    if (!level) continue
    studentRiskCounts.set(level, (studentRiskCounts.get(level) ?? 0) + row.value)
  }
  const studentRiskDistribution: PlanStudentRiskStat[] = DASHBOARD_STUDENT_RISK_LEVELS.map(level => ({
    level,
    label: DASHBOARD_STUDENT_RISK_LABELS[level],
    count: studentRiskCounts.get(level) ?? 0
  }))

  const kpis: PlanKpis = {
    planTotal: total.plan_total,
    planCompletionRate: totalRates.completionRate,
    executionRate: totalRates.executionRate,
    highRiskPlans: (riskMap.get('high') ?? 0) + (riskMap.get('crisis') ?? 0),
    assessmentTotal,
    ...conversion
  }

  return {
    period: range.period,
    previousPeriod: previous.period,
    kpis,
    previousKpis,
    byDay,
    byModule,
    byQuestionCategory,
    studentRiskDistribution,
    riskDistribution,
    table: tableResult
  }
}

/**
 * 学生心理风险分布（PRD 9「心理风险分布」按人数）：
 * 只统计「评估对象绑定了具体学生」的量表作答（assessment_sessions.context_type = 'student'，
 * 班级系统 / 自我成长这类面向班级或教师本人的评估没有学生对象，进不了分布）；
 * 周期内每个学生取最近一次提交，等级码按 ASSESSMENT_LEVEL_RISK 折成四档，未登记的码不计入。
 * 归属：学生所在班级优先，缺失回落记录人主班级；不读原始作答，只读等级码。
 */
async function countStudentRiskLevels(
  db: DbClient,
  query: ScopedQuery,
  filters: PlanFilters
): Promise<Array<{ level_code: string, value: number }>> {
  const { schoolId, classIds, range, line } = query
  const submittedAt = sql`coalesce(aa.submitted_at, aa.created_at)`
  const gradeCondition = filters.grade ? sql` and coalesce(c.grade, pc.grade) = ${filters.grade}` : sql``
  const category = categoryCondition(sql`aa.module`, filters.categories)
  const categorySql = category ? sql` and ${category}` : sql``
  const moralSql = andSql(moralModuleCondition(sql`aa.module`, line))
  return rowsOf(db.execute(sql`
    select level_code, count(*)::int as value from (
      select distinct on (st.id) coalesce(aa.result->>'level', '') as level_code
      from assessment_attempts aa
      join assessment_session_attempts asa on asa.assessment_attempt_id = aa.id
      join assessment_sessions ases on ases.id = asa.assessment_session_id
      join students st on st.id = ases.context_id
      left join classes c on c.id = st.class_id
      join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = aa.owner_user_id
      where aa.school_id = ${schoolId} and aa.status = 'submitted'
        and ases.context_type = 'student'
        and ${timeWindow(submittedAt, range)}
        and coalesce(c.id, pc.id) ${classIdIn(classIds)}${gradeCondition}${categorySql}${moralSql}
      order by st.id, ${submittedAt} desc, aa.id desc
    ) latest
    where level_code <> ''
    group by 1
  `))
}

/**
 * 量表与方案页的 KPI（当期与环比区间共用同一函数，保证两期口径完全一致）：
 * 方案数 / 完成度 / 回填率 / 高风险方案数（report.risk.severity = high | crisis）/ 量表作答数。
 */
async function loadPlanKpis(db: DbClient, query: ScopedQuery, filters: PlanFilters): Promise<PlanKpis> {
  const filter = buildPlanFilter(query, filters)
  const [totalRow, riskRows, assessmentRows, conversion] = await Promise.all([
    rowsOf<{ plan_total: number } & PlanActionTotals>(db.execute(sql`
      select count(distinct p.id)::int as plan_total,
             ${planActionCountersSql()}
      from plans p
      left join ${primaryClassSource(query.schoolId)} pc on pc.owner_user_id = p.owner_user_id
      left join plan_actions pa on pa.plan_id = p.id
      where ${filter}
    `)),
    rowsOf<{ severity: string | null, value: number }>(db.execute(sql`
      select coalesce(p.report->'risk'->>'severity', 'low') as severity, count(*)::int as value
      from plans p
      left join ${primaryClassSource(query.schoolId)} pc on pc.owner_user_id = p.owner_user_id
      where ${filter}
      group by 1
    `)),
    countAssessmentByDay(db, query, filters),
    loadPlanConversionKpis(db, query, filters)
  ])
  const total = totalRow[0] ?? { plan_total: 0, total: 0, completed: 0, included: 0, executed: 0, timely: 0 }
  const rates = planActionRates(total)
  const riskMap = new Map(riskRows.map(row => [planRiskSeverity({ risk: { severity: row.severity } }), row.value]))
  return {
    planTotal: total.plan_total,
    planCompletionRate: rates.completionRate,
    executionRate: rates.executionRate,
    highRiskPlans: (riskMap.get('high') ?? 0) + (riskMap.get('crisis') ?? 0),
    assessmentTotal: assessmentRows.reduce((sum, row) => sum + row.value, 0),
    ...conversion
  }
}

/**
 * 方案接受率与提醒触达率（PRD 6.1）：
 * - 接受率 = acceptance_decision = 'accepted' 的方案数 / 方案总数（接受动作由方案接受接口写入）；
 * - 提醒触达率 = 周期内站内通知已读数 / 通知总数（通知挂在教师账号上，按记录人主班级归属；
 *   站内口径，不含短信与外呼送达）。
 * 当前区间与环比区间共用同一实现，保证两期口径一致。
 */
async function loadPlanConversionKpis(
  db: DbClient,
  query: ScopedQuery,
  filters: PlanFilters
): Promise<Pick<PlanKpis, 'acceptanceRate' | 'reminderReadRate'>> {
  const filter = buildPlanFilter(query, filters)
  const [acceptanceRow, reminderRow] = await Promise.all([
    rowsOf<{ total: number, accepted: number }>(db.execute(sql`
      select count(*)::int as total,
             count(*) filter (where p.acceptance_decision = 'accepted')::int as accepted
      from plans p
      left join ${primaryClassSource(query.schoolId)} pc on pc.owner_user_id = p.owner_user_id
      where ${filter}
    `)),
    rowsOf<{ total: number, read: number }>(db.execute(sql`
      select count(*)::int as total,
             count(*) filter (where n.read_at is not null)::int as read
      from notifications n
      join ${primaryClassSource(query.schoolId)} pc on pc.owner_user_id = n.user_id
      where n.school_id = ${query.schoolId}
        and ${timeWindow(sql`n.created_at`, query.range)}
        and pc.id ${classIdIn(query.classIds)}
        ${filters.grade ? sql` and pc.grade = ${filters.grade}` : sql``}
    `))
  ])
  const acceptance = acceptanceRow[0] ?? { total: 0, accepted: 0 }
  const reminder = reminderRow[0] ?? { total: 0, read: 0 }
  return {
    acceptanceRate: percentage(acceptance.accepted, acceptance.total),
    reminderReadRate: percentage(reminder.read, reminder.total)
  }
}

/**
 * 量表作答分日统计：status = submitted 的作答，按提交时间（缺失回落创建时间）
 * 落东八区自然日，归属按记录人主班级（assessment_attempts 没有自带班级）。
 */
async function countAssessmentByDay(
  db: DbClient,
  query: ScopedQuery,
  filters: PlanFilters
): Promise<Array<{ day: string, value: number }>> {
  const submittedAt = sql`coalesce(aa.submitted_at, aa.created_at)`
  const gradeCondition = filters.grade ? sql` and pc.grade = ${filters.grade}` : sql``
  const category = categoryCondition(sql`aa.module`, filters.categories)
  const categorySql = category ? sql` and ${category}` : sql``
  // 德育口径：只统计德育线模块的作答
  const moralSql = andSql(moralModuleCondition(sql`aa.module`, query.line))
  return rowsOf<{ day: string, value: number }>(db.execute(sql`
    select to_char((${submittedAt} at time zone 'Asia/Shanghai')::date, 'YYYY-MM-DD') as day,
           count(*)::int as value
    from assessment_attempts aa
    left join ${primaryClassSource(query.schoolId)} pc on pc.owner_user_id = aa.owner_user_id
    where aa.school_id = ${query.schoolId} and aa.status = 'submitted'
      and ${timeWindow(submittedAt, query.range)}
      and pc.id ${classIdIn(query.classIds)}${gradeCondition}${categorySql}${moralSql}
    group by 1 order by 1
  `))
}

function buildPlanFilter(query: ScopedQuery, filters: PlanFilters): SQL {
  const conditions: SQL[] = [
    sql`p.school_id = ${query.schoolId}`,
    timeWindow(sql`p.created_at`, query.range),
    sql`coalesce(p.class_id, pc.id) ${classIdIn(query.classIds)}`
  ]
  if (filters.grade) conditions.push(sql`pc.grade = ${filters.grade}`)
  const category = categoryCondition(sql`p.module`, filters.categories)
  if (category) conditions.push(category)
  // 德育口径：与前端分类筛选叠加，而不是相互覆盖
  const moral = moralModuleCondition(sql`p.module`, query.line)
  if (moral) conditions.push(moral)
  return sql.join(conditions, sql` and `)
}

/** 方案的「量表分类」原始计数（模块 → 5 大类折算，口径与明细表的分类列一致）。 */
async function loadPlanCategoryRows(
  db: DbClient,
  schoolId: string,
  filter: SQL
): Promise<Array<{ category: string, value: number }>> {
  return rowsOf<{ category: string, value: number }>(db.execute(sql`
    select ${moduleCategorySql(sql`p.module`)} as category, count(*)::int as value
    from plans p
    left join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = p.owner_user_id
    where ${filter}
    group by 1
  `))
}

/** 量表分类占比图例：5 大类固定顺序（不含德育类问题），缺失分类补 0。 */
function buildPlanCategoryStats(rows: ReadonlyArray<{ category: string, value: number }>): PlanCategoryStat[] {
  const counts = new Map(rows.map(row => [row.category, row.value]))
  return PLAN_QUESTION_CATEGORIES.map(category => ({ category, count: counts.get(category) ?? 0 }))
}

const PLAN_SORT_SQL: Record<typeof PLAN_SORT_FIELDS[number], SQL> = {
  grade: sql`grade`,
  className: sql`class_name`,
  category: sql`category`,
  date: sql`day`,
  planTotal: sql`plan_total`,
  completionRate: sql`completion_rate`,
  executionRate: sql`execution_rate`,
  high: sql`high`,
  medium: sql`medium`,
  low: sql`low`
}

async function loadPlanTable(
  db: DbClient,
  query: ScopedQuery,
  filter: SQL,
  table: DashboardTableQuery
): Promise<ManagedListResult<PlanRow>> {
  const dims = tableDims(table.dims)
  const grouped = sql`
    select ${sql.join(TABLE_DIMENSION_COLUMNS.map(column => planDimensionSql(column.dimension, dims)), sql`, `)},
           count(distinct p.id)::int as plan_total,
           count(distinct p.id) filter (where coalesce(p.report->'risk'->>'severity', 'low') in ('high', 'crisis'))::int as high,
           count(distinct p.id) filter (where coalesce(p.report->'risk'->>'severity', 'low') = 'medium')::int as medium,
           count(distinct p.id) filter (where coalesce(p.report->'risk'->>'severity', 'low') = 'low')::int as low,
           ${planActionCountersSql()},
           ${planActionRateSortSql()}
    from plans p
    left join ${primaryClassSource(query.schoolId)} pc on pc.owner_user_id = p.owner_user_id
    left join classes c on c.id = p.class_id
    left join plan_actions pa on pa.plan_id = p.id
    where ${filter}
    ${tableGroupBy(dims)}
  `
  const sortKey = validateSort(table.sort, PLAN_SORT_WHITELIST, 'date') as typeof PLAN_SORT_FIELDS[number]
  const direction = table.order === 'asc' ? sql`asc` : sql`desc`
  const result = await paginateResult({
    dataQuery: rowsOf<{
      class_id: string | null
      class_name: string
      grade: number | null
      category: string
      day: string
      plan_total: number
      high: number
      medium: number
      low: number
    } & PlanActionTotals>(db.execute(sql`
      select * from (${grouped}) t
      order by ${PLAN_SORT_SQL[sortKey]} ${direction}, grade asc nulls last, class_name asc, category asc, day asc
      limit ${table.pageSize} offset ${offsetFrom(table.page, table.pageSize)}
    `)),
    countQuery: rowsOf<{ value: number }>(db.execute(sql`select ${countSql} as value from (${grouped}) t`)),
    page: table.page,
    pageSize: table.pageSize
  })

  return {
    rows: result.rows.map(row => {
      const rates = planActionRates({ total: row.total, completed: row.completed, included: row.included, executed: row.executed, timely: row.timely })
      return {
        id: tableRowId([row.class_id, row.category, row.day]),
        grade: row.grade,
        gradeLabel: gradeLabelOf(row.grade),
        className: row.class_name ?? '',
        category: row.category,
        date: row.day,
        planTotal: row.plan_total,
        completionRate: rates.completionRate,
        executionRate: rates.executionRate,
        high: row.high,
        medium: row.medium,
        low: row.low,
        // 看板是只读聚合视图：行级能力恒为空数组（不参与统一管理框架）
        _capabilities: []
      }
    }),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    capabilities: []
  }
}

// ===== 预警看板 =====

export interface AlertFilters {
  grade?: number
  classIds?: string[]
  status: 'open' | 'resolved' | 'closed' | 'all'
  sources?: AlertSource[]
  /**
   * 明细表的风险等级档位（默认只看高风险，见 `ALERT_DEFAULT_RISK_LEVEL`）。
   * 与 status 一样只作用于明细表：KPI、趋势与沟通分析区块保持统计范围口径，
   * 否则「筛高风险」时卡片会与明细行数恒等、失去汇总意义。
   */
  riskLevel: AlertRiskLevelFilter
}

/**
 * 聚合口径（DB 侧）消费的预警筛选：只认年级——家校沟通分析、高危闭环率、
 * 心理高风险学生数与事件导入教师数都只看统计范围，不吃明细表的筛选；
 * KPI 卡与 byDay 趋势则跟随来源筛选收口（见 loadAlerts）。
 */
export type AlertScopeFilters = Pick<AlertFilters, 'grade'>

export interface RawAlert {
  id: string
  source: AlertSource
  type: string
  severity: string | null
  status: string | null
  occurredAt: Date
  keyword: string
  studentId: string | null
  studentLabel: string
  /** 负责教师（安全事项 / 学生事件 / 方案逾期的 owner_user_id） */
  teacherId: string
  teacherName: string
  grade: number | null
  className: string
}

export async function loadAlerts(
  db: DbClient,
  scope: DashboardScope,
  range: DashboardRange,
  filters: AlertFilters,
  table: DashboardTableQuery,
  options: { includeStudentId?: boolean } = {}
): Promise<AlertsResponse> {
  const dates = enumerateDateKeys(range.startKey, range.endKey)
  const scopeIds = scopeGuard(scope, filters.classIds)
  const emptyCommunication: AlertCommunicationStats = {
    total: 0,
    channels: [],
    riskLevels: [],
    byDay: dates.map(date => ({ date, count: 0 })),
    crisisCount: 0,
    coverageRate: null,
    keyStudents: 0,
    keyStudentMessages: 0,
    keyStudentMessagesPerStudent: null
  }
  const empty: AlertsResponse = {
    period: range.period,
    kpis: { total: 0, open: 0, highRiskOpen: 0, overdueOpen: 0, highRiskClosedRate: null, studentRiskHigh: 0 },
    byDay: dates.map(date => ({ date, safety: 0, studentEvent: 0, communication: 0, overdue: 0 })),
    studentEventTypes: [],
    studentEvents: { importers: 0 },
    communication: emptyCommunication,
    table: { rows: [], page: table.page, pageSize: table.pageSize, total: 0, capabilities: [] }
  }
  if (!scopeIds) return empty

  const query: ScopedQuery = { schoolId: scope.schoolId, classIds: scopeIds, range, line: scope.line }
  const [safetyRows, studentRows, communicationRows, overdueRows, communicationBase, coverage, keyStudents, insights] = await Promise.all([
    loadSafetyAlertsRaw(db, query, filters),
    loadStudentAlertsRaw(db, query, filters),
    loadCommunicationAlertsRaw(db, query, filters),
    loadPlanOverdueAlertsRaw(db, query, filters),
    loadCommunicationStats(db, query, dates, filters),
    loadCommunicationCoverage(db, query, filters),
    loadKeyStudentCommunicationStats(db, query, filters),
    loadAlertInsights(db, query, filters)
  ])

  // 编号在「周期 + 班级范围 + 来源筛选」的全集上生成，再叠加状态筛选，保证同一学生的标号稳定
  const ordered = [...safetyRows, ...studentRows, ...communicationRows, ...overdueRows]
    .filter(row => !filters.sources?.length || filters.sources.includes(row.source))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id))
  const labels = assignStudentLabels(ordered.map(row => row.studentId || null))
  const all = ordered.map(row => ({
    id: row.id,
    type: row.type,
    source: row.source,
    sourceLabel: alertSourceLabel(row.source),
    studentLabel: row.studentId ? labels.get(row.studentId) ?? '' : '',
    // 学生 / 教师 ID 只在具备个体明细查看能力（view_sensitive）时下发，供「查看个体」申请授权用
    studentId: options.includeStudentId ? row.studentId : null,
    teacherId: options.includeStudentId ? row.teacherId : null,
    grade: row.grade,
    gradeLabel: row.grade ? gradeLabelOf(row.grade) : '未归属',
    className: row.className || '未归属',
    keyword: row.keyword,
    teacherName: row.teacherName,
    occurredAt: row.occurredAt.toISOString(),
    status: normalizeAlertStatus(row.status),
    riskLevel: isOverdueAlertSource(row.source)
      ? ALERT_OVERDUE_RISK_LABEL
      : row.source === 'communication_risk'
        ? (COMMUNICATION_RISK_LABELS[row.severity ?? ''] ?? SAFETY_RISK_LABEL)
        : row.source === 'student_event' ? studentEventRiskLabel(row.severity) : SAFETY_RISK_LABEL,
    // 看板是只读聚合视图：行级能力恒为空数组（不参与统一管理框架）
    _capabilities: []
  }))

  const openRows = ordered.filter(row => normalizeAlertStatus(row.status) !== 'closed')
  const kpis: AlertKpis = {
    total: ordered.length,
    open: openRows.length,
    highRiskOpen: openRows.filter(row => isHighRiskAlert({ source: row.source, severity: row.severity })).length,
    overdueOpen: openRows.filter(row => isOverdueAlertSource(row.source)).length,
    highRiskClosedRate: percentage(insights.highRiskClosed, insights.highRiskTotal),
    studentRiskHigh: insights.studentRiskHigh
  }

  const communication: AlertCommunicationStats = {
    ...communicationBase,
    // 危机沟通数直接由风险等级分布得出，避免多查一次
    crisisCount: communicationBase.riskLevels
      .filter(item => (COMMUNICATION_HIGH_RISK_LEVELS as readonly string[]).includes(item.riskLevel))
      .reduce((sum, item) => sum + item.count, 0),
    coverageRate: percentage(coverage.covered, coverage.total),
    keyStudents: keyStudents.keyStudents,
    keyStudentMessages: keyStudents.keyStudentMessages,
    keyStudentMessagesPerStudent: average(keyStudents.keyStudentMessages, keyStudents.keyStudents)
  }

  // 明细表筛选：风险档位与状态都只作用于明细行（KPI / 趋势 / 分析区块保持统计范围口径）
  const filtered = all
    .filter(row => alertRiskLevelMatches(row.riskLevel, filters.riskLevel))
    .filter(row => filters.status === 'all' || row.status === filters.status)
  const sorted = sortAlerts(filtered, table.sort, table.order)
  const offset = (table.page - 1) * table.pageSize
  const pageRows = sorted.slice(offset, offset + table.pageSize)

  return {
    period: range.period,
    kpis,
    byDay: buildAlertByDay(dates, ordered),
    studentEventTypes: buildStudentEventTypeStats(ordered),
    studentEvents: { importers: insights.studentEventImporters },
    communication,
    table: { rows: pageRows, page: table.page, pageSize: table.pageSize, total: sorted.length, capabilities: [] }
  }
}

/** 预警每日趋势：按安全事项 / 学生事件 / 高风险家校沟通 / 方案逾期四类分组（周期内全部状态，与 KPI 卡口径一致）。 */
export function buildAlertByDay(dates: readonly string[], rows: readonly RawAlert[]): AlertByDay[] {
  const buckets = new Map<string, AlertByDay>(dates.map(date => [date, { date, safety: 0, studentEvent: 0, communication: 0, overdue: 0 }]))
  for (const row of rows) {
    const day = shanghaiDateKey(row.occurredAt)
    const bucket = buckets.get(day)
    if (!bucket) continue
    bucket[alertTrendGroup(row.source)] += 1
  }
  return dates.map(date => buckets.get(date)!)
}

/**
 * 学生事件的公共 FROM + WHERE 片段（明细行 / E1–E6 类型分布 / 录入教师数三处共用）：
 * 归属学生所在班级优先、缺失回落记录人主班级；德育主任按事件类型白名单裁剪。
 * 调用方在片段之后追加 order by / group by / limit。
 */
function studentEventScopeFromSql(
  schoolId: string,
  classIds: readonly string[],
  range: DashboardRange,
  filters: AlertScopeFilters,
  line: DashboardLine
): SQL {
  const gradeCondition = filters.grade ? sql` and coalesce(c.grade, pc.grade) = ${filters.grade}` : sql``
  // 德育口径：学生事件只保留行为类（安全事项在另一个查询里，不做裁剪）
  const moralSql = andSql(moralStudentEventCondition(sql`se.event_type`, line))
  return sql`
    from student_events se
    join users u on u.id = se.owner_user_id
    join students st on st.id = se.student_id
    left join classes c on c.id = st.class_id
    join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = se.owner_user_id
    where se.school_id = ${schoolId} and ${timeWindow(sql`coalesce(se.occurred_at, se.created_at)`, range)}
      and coalesce(c.id, pc.id) ${classIdIn(classIds)}${gradeCondition}${moralSql}
  `
}

/** 学生事件类型分布（E1–E6）的聚合计数（总览聚合卡用；口径与预警看板的类型分布一致）。 */
async function loadStudentEventTypeCounts(
  db: DbClient,
  query: ScopedQuery,
  filters: AlertScopeFilters
): Promise<AlertEventTypeStat[]> {
  const { schoolId, classIds, range, line } = query
  const rows = await rowsOf<{ event_type: string, value: number }>(db.execute(sql`
    select coalesce(nullif(se.event_type, ''), '未标注') as event_type, count(*)::int as value
    ${studentEventScopeFromSql(schoolId, classIds, range, filters, line)}
    group by 1
  `))
  return buildStudentEventTypeStatsFromCounts(rows.map(row => ({ eventType: row.event_type, count: row.value })))
}

/**
 * 学生事件类型分布的整理（E1–E6）：空类型归「未标注」，
 * 按计数降序、同数按中文序（与明细行的类型列同一份标签）。
 */
export function buildStudentEventTypeStatsFromCounts(
  rows: ReadonlyArray<{ eventType: string | null, count: number }>
): AlertEventTypeStat[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const eventType = row.eventType || '未标注'
    counts.set(eventType, (counts.get(eventType) ?? 0) + row.count)
  }
  return [...counts.entries()]
    .map(([eventType, count]) => ({ eventType, count }))
    .sort((a, b) => b.count - a.count || a.eventType.localeCompare(b.eventType, 'zh-Hans-CN'))
}

/** 学生事件类型分布（E1–E6）；德育主任已被 SQL 白名单裁剪，这里只做计数。 */
export function buildStudentEventTypeStats(rows: readonly RawAlert[]): AlertEventTypeStat[] {
  return buildStudentEventTypeStatsFromCounts(rows
    .filter(row => row.source === 'student_event')
    .map(row => ({ eventType: row.keyword, count: 1 })))
}

function sortAlerts<T extends AlertRow>(rows: T[], sort: string, order: 'asc' | 'desc'): T[] {
  const key = validateSort(sort, ALERT_SORT_WHITELIST, 'occurredAt') as typeof ALERT_SORT_FIELDS[number]
  const factor = order === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const left = a[key]
    const right = b[key]
    if (left === right) return b.occurredAt.localeCompare(a.occurredAt)
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor
    return String(left ?? '').localeCompare(String(right ?? ''), 'zh-Hans-CN') * factor
  })
}

async function loadSafetyAlertsRaw(db: DbClient, query: ScopedQuery, filters: AlertFilters): Promise<RawAlert[]> {
  const { schoolId, classIds, range } = query
  const gradeCondition = filters.grade ? sql` and pc.grade = ${filters.grade}` : sql``
  const rows = await rowsOf<{
    id: string
    source_type: string | null
    severity: string | null
    status: string | null
    occurred_at: Date
    class_name: string | null
    grade: number | null
    teacher_id: string
    teacher_name: string
  }>(db.execute(sql`
    select se.id, se.source_type, se.severity, se.status, se.created_at as occurred_at,
           pc.name as class_name, pc.grade as grade, u.id as teacher_id, u.name as teacher_name
    from safety_events se
    join users u on u.id = se.owner_user_id
    join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = se.owner_user_id
    where se.school_id = ${schoolId} and ${timeWindow(sql`se.created_at`, range)} and pc.id ${classIdIn(classIds)}${gradeCondition}
    order by se.created_at desc
    limit ${ALERT_MERGE_LIMIT}
  `))
  return rows.map(row => ({
    id: row.id,
    source: safetySourceOf(row.source_type),
    type: '安全事项',
    severity: row.severity,
    status: row.status,
    occurredAt: new Date(row.occurred_at),
    keyword: '',
    studentId: null,
    studentLabel: '',
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    grade: row.grade,
    className: row.class_name ?? ''
  }))
}

async function loadStudentAlertsRaw(db: DbClient, query: ScopedQuery, filters: AlertFilters): Promise<RawAlert[]> {
  const { schoolId, classIds, range } = query
  const rows = await rowsOf<{
    id: string
    event_type: string | null
    severity: string | null
    status: string | null
    occurred_at: Date
    student_id: string | null
    class_name: string | null
    grade: number | null
    teacher_id: string
    teacher_name: string
  }>(db.execute(sql`
    select se.id, se.event_type, se.severity, se.status,
           coalesce(se.occurred_at, se.created_at) as occurred_at,
           se.student_id, coalesce(c.name, pc.name) as class_name, coalesce(c.grade, pc.grade) as grade,
           u.id as teacher_id, u.name as teacher_name
    ${studentEventScopeFromSql(schoolId, classIds, range, filters, query.line)}
    order by coalesce(se.occurred_at, se.created_at) desc
    limit ${ALERT_MERGE_LIMIT}
  `))
  return rows.map(row => ({
    id: row.id,
    source: 'student_event' as AlertSource,
    type: '学生事件',
    severity: row.severity,
    status: row.status,
    occurredAt: new Date(row.occurred_at),
    keyword: row.event_type ?? '',
    studentId: row.student_id,
    studentLabel: '',
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    grade: row.grade,
    className: row.class_name ?? ''
  }))
}

/**
 * 方案逾期（PRD W5「高危事件 + 方案逾期」）：
 * - 执行项逾期：`plan_actions.decision = 'included'` 且未完成，`due_at` 落在统计区间内；
 * - 复盘逾期：方案未闭环且 `next_review_at` 落在统计区间内。
 * 两类都以「到期时间」为准（与安全/学生事件的记录时间口径一致），
 * 已闭环（completed / closed / archived）的方案不再产生逾期预警。
 * keyword 只给方案模块中文名，不返回方案标题与执行项正文（看板不展示业务正文）。
 */
/**
 * 方案逾期的合并集合（执行项逾期 / 复盘逾期）：明细行与总览聚合卡的计数共用这段 SQL，
 * 避免两处口径漂移。只投影看板需要的结构化字段，不含方案标题与执行项正文。
 */
function planOverdueUnionSql(
  schoolId: string,
  classIds: readonly string[],
  range: DashboardRange,
  filters: AlertScopeFilters,
  line: DashboardLine
): SQL {
  const gradeCondition = filters.grade ? sql` and coalesce(c.grade, pc.grade) = ${filters.grade}` : sql``
  const moral = andSql(moralModuleCondition(sql`p.module`, line))
  const closedStatuses = sql.join(PLAN_CLOSED_STATUSES.map(item => sql`${item}`), sql`, `)
  return sql`
    select pa.id, 'plan_action_overdue'::text as source_kind, pa.due_at as occurred_at,
           p.module, p.student_id,
           coalesce(c.name, pc.name) as class_name, coalesce(c.grade, pc.grade) as grade,
           u.id as teacher_id, u.name as teacher_name
    from plan_actions pa
    join plans p on p.id = pa.plan_id
    join users u on u.id = pa.owner_user_id
    left join students st on st.id = p.student_id
    left join classes c on c.id = coalesce(p.class_id, st.class_id)
    join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = pa.owner_user_id
    where pa.school_id = ${schoolId}
      and p.status not in (${closedStatuses})
      and pa.decision = 'included'
      and pa.status <> 'completed'
      and pa.due_at is not null
      and ${timeWindow(sql`pa.due_at`, range)}
      and coalesce(c.id, pc.id) ${classIdIn(classIds)}${gradeCondition}${moral}
    union all
    select p.id, 'plan_review_overdue'::text, p.next_review_at,
           p.module, p.student_id,
           coalesce(c.name, pc.name), coalesce(c.grade, pc.grade),
           u.id, u.name
    from plans p
    join users u on u.id = p.owner_user_id
    left join students st on st.id = p.student_id
    left join classes c on c.id = coalesce(p.class_id, st.class_id)
    join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = p.owner_user_id
    where p.school_id = ${schoolId}
      and p.status not in (${closedStatuses})
      and p.next_review_at is not null
      and ${timeWindow(sql`p.next_review_at`, range)}
      and coalesce(c.id, pc.id) ${classIdIn(classIds)}${gradeCondition}${moral}
  `
}

/** 方案逾期未闭环数（执行项逾期 + 复盘逾期；与预警看板 KPI 同一段 SQL）。 */
async function countPlanOverdueAlerts(db: DbClient, query: ScopedQuery, filters: AlertScopeFilters): Promise<number> {
  const { schoolId, classIds, range, line } = query
  const [row] = await rowsOf<{ value: number }>(db.execute(sql`
    select count(*)::int as value from (${planOverdueUnionSql(schoolId, classIds, range, filters, line)}) overdue
  `))
  return row?.value ?? 0
}

/**
 * 方案逾期（PRD W5「高危事件 + 方案逾期」）：
 * - 执行项逾期：`plan_actions.decision = 'included'` 且未完成，`due_at` 落在统计区间内；
 * - 复盘逾期：方案未闭环且 `next_review_at` 落在统计区间内。
 * 两类都以「到期时间」为准（与安全/学生事件的记录时间口径一致），
 * 已闭环（completed / closed / archived）的方案不再产生逾期预警。
 * keyword 只给方案模块中文名，不返回方案标题与执行项正文（看板不展示业务正文）。
 */
async function loadPlanOverdueAlertsRaw(db: DbClient, query: ScopedQuery, filters: AlertFilters): Promise<RawAlert[]> {
  const { schoolId, classIds, range, line } = query
  const rows = await rowsOf<{
    id: string
    source_kind: AlertSource
    occurred_at: Date
    module: string | null
    student_id: string | null
    class_name: string | null
    grade: number | null
    teacher_id: string
    teacher_name: string
  }>(db.execute(sql`
    select * from (${planOverdueUnionSql(schoolId, classIds, range, filters, line)}) overdue
    order by occurred_at desc
    limit ${ALERT_MERGE_LIMIT}
  `))
  return rows.map(row => ({
    id: row.id,
    source: row.source_kind,
    type: row.source_kind === 'plan_action_overdue' ? '执行项逾期' : '复盘逾期',
    severity: null,
    status: 'open',
    occurredAt: new Date(row.occurred_at),
    keyword: moduleLabel(row.module),
    studentId: row.student_id,
    studentLabel: '',
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    grade: row.grade,
    className: row.class_name ?? ''
  }))
}

/**
 * 高风险家校沟通（PRD 原型把「家校沟通记录」列为预警来源）：
 * 只取 `risk_level` 为 crisis / high 的沟通记录（对应「安全关注 / 高风险」），
 * 不返回沟通正文与摘要；渠道、风险等级、时间与学生归属是结构化字段。
 * 状态取记录自身生命周期：未归档 = 待解决（open），已归档 = 已关闭（closed）——
 * 沟通记录没有「处理中」，归档是唯一收口动作，因此这些行会一直停在待解决直到归档。
 * 归属：学生所在班级优先，缺失回落记录人主班级；学生为空（家长维度记录）时不参与脱敏编号。
 */
async function loadCommunicationAlertsRaw(db: DbClient, query: ScopedQuery, filters: AlertFilters): Promise<RawAlert[]> {
  const { schoolId, classIds, range } = query
  const gradeCondition = filters.grade ? sql` and coalesce(c.grade, pc.grade) = ${filters.grade}` : sql``
  const levels = sql.join(COMMUNICATION_HIGH_RISK_LEVELS.map(item => sql`${item}`), sql`, `)
  const rows = await rowsOf<{
    id: string
    risk_level: string | null
    channel: string | null
    occurred_at: Date
    archived_at: Date | null
    student_id: string | null
    class_name: string | null
    grade: number | null
    teacher_id: string
    teacher_name: string
  }>(db.execute(sql`
    select cm.id, cm.risk_level, cm.channel, cm.occurred_at, cm.archived_at,
           cm.student_id,
           coalesce(c.name, pc.name) as class_name, coalesce(c.grade, pc.grade) as grade,
           u.id as teacher_id, u.name as teacher_name
    from communications cm
    join users u on u.id = cm.owner_user_id
    left join students st on st.id = cm.student_id
    left join classes c on c.id = st.class_id
    join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = cm.owner_user_id
    where cm.school_id = ${schoolId}
      and cm.risk_level in (${levels})
      and ${timeWindow(sql`cm.occurred_at`, range)}
      and coalesce(c.id, pc.id) ${classIdIn(classIds)}${gradeCondition}
    order by cm.occurred_at desc
    limit ${ALERT_MERGE_LIMIT}
  `))
  return rows.map(row => ({
    id: row.id,
    source: 'communication_risk' as AlertSource,
    type: '家校沟通',
    severity: row.risk_level,
    status: row.archived_at ? 'closed' : 'open',
    occurredAt: new Date(row.occurred_at),
    keyword: communicationChannelLabels[(row.channel ?? '') as CommunicationChannel] ?? COMMUNICATION_CHANNEL_UNLABELED,
    studentId: row.student_id,
    studentLabel: '',
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    grade: row.grade,
    className: row.class_name ?? ''
  }))
}

/**
 * 家校事件记录分析（W4-2）：沟通渠道分布 + 风险等级分布 + 每日趋势。
 * 只读结构化字段（渠道 / 风险等级 / 时间 / 学生班级归属），不读 summary_enc 正文；
 * 口径与明细一致：本校、未归档、status = active，班级取学生班级、缺失回落负责教师主班级。
 * 德育主任不裁剪沟通记录（德育线白名单没有沟通维度），与「安全事项不裁剪」同理。
 */
/**
 * 沟通分布基础口径（渠道 / 风险等级 / 每日趋势）；
 * 危机沟通数、覆盖率与重点学生口径在 loadAlerts 里按需补充（见 AlertCommunicationStats）。
 */
type CommunicationBaseStats = Omit<
  AlertCommunicationStats,
  'crisisCount' | 'coverageRate' | 'keyStudents' | 'keyStudentMessages' | 'keyStudentMessagesPerStudent'
>

async function loadCommunicationStats(
  db: DbClient,
  query: ScopedQuery,
  dates: readonly string[],
  filters: AlertScopeFilters = {}
): Promise<CommunicationBaseStats> {
  const { schoolId, classIds, range } = query
  const gradeCondition = filters.grade ? sql` and coalesce(c.grade, pc.grade) = ${filters.grade}` : sql``
  const scopeWhere = sql`cm.school_id = ${schoolId} and cm.status = 'active' and cm.archived_at is null
    and ${timeWindow(sql`cm.occurred_at`, range)} and coalesce(c.id, pc.id) ${classIdIn(classIds)}${gradeCondition}`
  const baseFrom = sql`from communications cm
    left join students st on st.id = cm.student_id
    left join classes c on c.id = st.class_id
    join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = cm.owner_user_id`

  const [channelRows, riskRows, dayRows] = await Promise.all([
    rowsOf<{ channel: string | null, value: number }>(db.execute(sql`
      select cm.channel as channel, count(*)::int as value
      ${baseFrom}
      where ${scopeWhere}
      group by 1 order by 2 desc, 1 asc
    `)),
    rowsOf<{ risk_level: string | null, value: number }>(db.execute(sql`
      select cm.risk_level as risk_level, count(*)::int as value
      ${baseFrom}
      where ${scopeWhere}
      group by 1 order by 2 desc, 1 asc
    `)),
    rowsOf<{ day: string, value: number }>(db.execute(sql`
      select to_char((cm.occurred_at at time zone 'Asia/Shanghai')::date, 'YYYY-MM-DD') as day, count(*)::int as value
      ${baseFrom}
      where ${scopeWhere}
      group by 1 order by 1
    `))
  ])

  const channels: CommunicationChannelStat[] = channelRows.map(row => ({
    channel: row.channel ?? '',
    label: row.channel ? communicationChannelLabels[row.channel as CommunicationChannel] ?? row.channel : COMMUNICATION_CHANNEL_UNLABELED,
    count: row.value
  }))
  const riskLevels: CommunicationRiskStat[] = riskRows.map(row => ({
    riskLevel: row.risk_level ?? '',
    label: row.risk_level ? COMMUNICATION_RISK_LABELS[row.risk_level] ?? row.risk_level : COMMUNICATION_CHANNEL_UNLABELED,
    count: row.value
  }))
  const dayMap = new Map(dayRows.map(row => [row.day, row.value]))
  const byDay: CommunicationByDay[] = dates.map(date => ({ date, count: dayMap.get(date) ?? 0 }))

  return {
    total: channels.reduce((sum, item) => sum + item.count, 0),
    channels,
    riskLevels,
    byDay
  }
}

/**
 * 沟通覆盖率的分母与分子：分子 = 周期内有沟通记录的去重学生数（学生级记录，家长级不计），
 * 分母 = 范围内在册学生数。没有在册学生时返回 null（前端显示「—」）。
 */
async function loadCommunicationCoverage(
  db: DbClient,
  query: ScopedQuery,
  filters: AlertScopeFilters = {}
): Promise<{ covered: number, total: number }> {
  const { schoolId, classIds, range } = query
  const grade = filters.grade
  const coveredGrade = grade ? sql` and coalesce(c.grade, pc.grade) = ${grade}` : sql``
  const totalGrade = grade ? sql` and sc.grade = ${grade}` : sql``
  const [row] = await rowsOf<{ covered: number, total: number }>(db.execute(sql`
    select (
      select count(distinct cm.student_id)::int
      from communications cm
      left join students st on st.id = cm.student_id
      left join classes c on c.id = st.class_id
      join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = cm.owner_user_id
      where cm.school_id = ${schoolId} and cm.status = 'active' and cm.archived_at is null
        and cm.student_id is not null
        and ${timeWindow(sql`cm.occurred_at`, range)}
        and coalesce(c.id, pc.id) ${classIdIn(classIds)}${coveredGrade}
    ) as covered,
    (
      select count(*)::int from students st
      join classes sc on sc.id = st.class_id
      where st.school_id = ${schoolId} and st.status = 'active' and st.class_id ${classIdIn(classIds)}${totalGrade}
    ) as total
  `))
  return { covered: row?.covered ?? 0, total: row?.total ?? 0 }
}

/**
 * 重点学生口径（确定性）：「周期内」出现任一类记录的学生——
 * 高危学生事件（严重度 高/严重）、高风险量表等级（ASSESSMENT_LEVEL_RISK 折算为 high）、
 * 高风险沟通（risk_level = crisis/high）。指标给重点学生数与其沟通条数。
 */
async function loadKeyStudentCommunicationStats(
  db: DbClient,
  query: ScopedQuery,
  filters: AlertScopeFilters = {}
): Promise<{ keyStudents: number, keyStudentMessages: number }> {
  const { schoolId, classIds, range } = query
  const grade = filters.grade
  const eventGrade = grade ? sql` and coalesce(kc.grade, pc.grade) = ${grade}` : sql``
  const attemptGrade = grade ? sql` and coalesce(kc.grade, pc.grade) = ${grade}` : sql``
  const communicationGrade = grade ? sql` and coalesce(kc.grade, pc.grade) = ${grade}` : sql``
  const messageGrade = grade ? sql` and coalesce(c.grade, pc.grade) = ${grade}` : sql``
  const highRiskLevels = Object.entries(ASSESSMENT_LEVEL_RISK)
    .filter(([, level]) => level === 'high')
    .map(([code]) => code)
  const rows = await rowsOf<{ student_id: string }>(db.execute(sql`
    with key_students as (
      select distinct se.student_id as student_id
      from student_events se
      join students st on st.id = se.student_id
      left join classes kc on kc.id = st.class_id
      join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = se.owner_user_id
      where se.school_id = ${schoolId}
        and se.severity in (${sql.join(STUDENT_EVENT_HIGH_RISK_SEVERITIES.map(item => sql`${item}`), sql`, `)})
        and ${timeWindow(sql`coalesce(se.occurred_at, se.created_at)`, range)}
        and coalesce(kc.id, pc.id) ${classIdIn(classIds)}${eventGrade}
      union
      select distinct st.id
      from assessment_attempts aa
      join assessment_session_attempts asa on asa.assessment_attempt_id = aa.id
      join assessment_sessions ases on ases.id = asa.assessment_session_id
      join students st on st.id = ases.context_id
      left join classes kc on kc.id = st.class_id
      join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = aa.owner_user_id
      where aa.school_id = ${schoolId} and aa.status = 'submitted' and ases.context_type = 'student'
        and coalesce(aa.result->>'level', '') in (${sql.join(highRiskLevels.map(code => sql`${code}`), sql`, `)})
        and ${timeWindow(sql`coalesce(aa.submitted_at, aa.created_at)`, range)}
        and coalesce(kc.id, pc.id) ${classIdIn(classIds)}${attemptGrade}
      union
      select distinct cm.student_id
      from communications cm
      left join students st on st.id = cm.student_id
      left join classes kc on kc.id = st.class_id
      join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = cm.owner_user_id
      where cm.school_id = ${schoolId} and cm.status = 'active' and cm.archived_at is null
        and cm.student_id is not null
        and cm.risk_level in (${sql.join(COMMUNICATION_HIGH_RISK_LEVELS.map(level => sql`${level}`), sql`, `)})
        and ${timeWindow(sql`cm.occurred_at`, range)}
        and coalesce(kc.id, pc.id) ${classIdIn(classIds)}${communicationGrade}
    )
    select student_id from key_students
  `))
  const studentIds = rows.map(row => row.student_id)
  if (!studentIds.length) return { keyStudents: 0, keyStudentMessages: 0 }

  const [counted] = await rowsOf<{ value: number }>(db.execute(sql`
    select count(*)::int as value
    from communications cm
    left join students st on st.id = cm.student_id
    left join classes c on c.id = st.class_id
    join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = cm.owner_user_id
    where cm.school_id = ${schoolId} and cm.status = 'active' and cm.archived_at is null
      and ${timeWindow(sql`cm.occurred_at`, range)}
      and cm.student_id in (${sql.join(studentIds.map(id => sql`${id}::uuid`), sql`, `)})
      and coalesce(c.id, pc.id) ${classIdIn(classIds)}${messageGrade}
  `))
  return { keyStudents: studentIds.length, keyStudentMessages: counted?.value ?? 0 }
}

/**
 * 预警页的补充指标（与列表筛选无关，按范围与周期固定口径）：
 * - 高危闭环率：已关闭高危 / 高危总数（高危口径与 highRiskOpen 同源，含已关闭记录，
 *   因此不受页面「状态」筛选影响；家校沟通按归档与否折算 open/closed）；
 * - 事件导入教师数：周期内录入学生事件的去重教师；
 * - 心理高风险学生数：复用量表页的学生心理风险口径（每人取最近一次提交的等级）。
 */
async function loadAlertInsights(
  db: DbClient,
  query: ScopedQuery,
  filters: AlertScopeFilters = {}
): Promise<{ highRiskTotal: number, highRiskClosed: number, studentEventImporters: number, studentRiskHigh: number }> {
  const { schoolId, classIds, range, line } = query
  const [highRiskRows, studentEventImporters, riskRows] = await Promise.all([
    rowsOf<{ total: number, closed: number }>(db.execute(sql`
      select count(*)::int as total,
             count(*) filter (where status = 'closed')::int as closed
      from (${highRiskAlertUnionSql(schoolId, classIds, range, filters, line)}) high_risk
    `)),
    countStudentEventImporters(db, query, filters),
    // 年级筛选与学生风险口径一致（筛选改变范围时「心理高风险学生」同步收窄）
    countStudentRiskLevels(db, query, filters.grade ? { grade: filters.grade } : {})
  ])
  const highRisk = highRiskRows[0] ?? { total: 0, closed: 0 }
  return {
    highRiskTotal: highRisk.total,
    highRiskClosed: highRisk.closed,
    studentEventImporters,
    studentRiskHigh: riskRows
      .filter(row => ASSESSMENT_LEVEL_RISK[row.level_code] === 'high')
      .reduce((sum, row) => sum + row.value, 0)
  }
}

/**
 * 高危预警的合并集合（安全事项 + 高/严重学生事件 + 高风险家校沟通）：
 * 只投影 status 列（open/resolved/closed），供「高危总数 / 已闭环 / 未闭环」三处共用，
 * 避免同一高危口径在多处各写一遍。德育主任按学生事件类型白名单裁剪，安全事项不裁剪。
 */
function highRiskAlertUnionSql(
  schoolId: string,
  classIds: readonly string[],
  range: DashboardRange,
  filters: AlertScopeFilters,
  line: DashboardLine
): SQL {
  const moralStudent = andSql(moralStudentEventCondition(sql`se.event_type`, line))
  const grade = filters.grade
  const safetyGrade = grade ? sql` and pc.grade = ${grade}` : sql``
  const studentGrade = grade ? sql` and coalesce(stc.grade, pc.grade) = ${grade}` : sql``
  const communicationGrade = grade ? sql` and coalesce(c.grade, pc.grade) = ${grade}` : sql``
  return sql`
      select se.status as status
      from safety_events se
      join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = se.owner_user_id
      where se.school_id = ${schoolId}
        and se.severity in (${sql.join(SAFETY_HIGH_RISK_SEVERITIES.map(item => sql`${item}`), sql`, `)})
        and ${timeWindow(sql`se.created_at`, range)}
        and pc.id ${classIdIn(classIds)}${safetyGrade}
      union all
      select se.status
      from student_events se
      join students st on st.id = se.student_id
      left join classes stc on stc.id = st.class_id
      join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = se.owner_user_id
      where se.school_id = ${schoolId}
        and se.severity in (${sql.join(STUDENT_EVENT_HIGH_RISK_SEVERITIES.map(item => sql`${item}`), sql`, `)})
        and ${timeWindow(sql`coalesce(se.occurred_at, se.created_at)`, range)}
        and coalesce(stc.id, pc.id) ${classIdIn(classIds)}${studentGrade}${moralStudent}
      union all
      select case when cm.archived_at is null then 'open' else 'closed' end as status
      from communications cm
      left join students st on st.id = cm.student_id
      left join classes c on c.id = st.class_id
      join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = cm.owner_user_id
      where cm.school_id = ${schoolId}
        and cm.risk_level in (${sql.join(COMMUNICATION_HIGH_RISK_LEVELS.map(level => sql`${level}`), sql`, `)})
        and ${timeWindow(sql`cm.occurred_at`, range)}
        and coalesce(c.id, pc.id) ${classIdIn(classIds)}${communicationGrade}
  `
}

/** 高危未闭环数（status 非 closed 的合并集合；与预警看板 KPI 同一段 SQL）。 */
async function countOpenHighRiskAlerts(db: DbClient, query: ScopedQuery, filters: AlertScopeFilters): Promise<number> {
  const { schoolId, classIds, range, line } = query
  const [row] = await rowsOf<{ value: number }>(db.execute(sql`
    select count(*)::int as value
    from (${highRiskAlertUnionSql(schoolId, classIds, range, filters, line)}) high_risk
    where status is distinct from 'closed'
  `))
  return row?.value ?? 0
}

/** 周期内录入学生事件的教师数（与预警看板的「事件导入教师数」同一口径）。 */
async function countStudentEventImporters(db: DbClient, query: ScopedQuery, filters: AlertScopeFilters = {}): Promise<number> {
  const { schoolId, classIds, range, line } = query
  const [row] = await rowsOf<{ value: number }>(db.execute(sql`
    select count(distinct se.owner_user_id)::int as value
    ${studentEventScopeFromSql(schoolId, classIds, range, filters, line)}
  `))
  return row?.value ?? 0
}

// ===== 年级 / 班级对比（W8）=====

export interface DashboardComparisonFilters {
  /** 下钻到某个年级（不传表示年级对比） */
  grade?: number
  classIds?: string[]
  metric: DashboardComparisonMetric
  order: 'asc' | 'desc'
}

/**
 * 年级 / 班级对比（PRD W8「聚合横向对比」）：
 * - 不传 grade：按年级聚合（默认层级），行内班级数 + 三个指标；
 * - 传 grade：下钻到该年级，按班级输出。
 * 范围仍是 schoolId + classIds 双约束，只返回班级维度的计数（不返回任何业务正文）；
 * 年级主任的 scope 已被 requireDashboardScope 收窄到所辖年级，因此只会出现本年级的行。
 * 德育主任按提问分类 / 方案模块 / 学生事件类型三组白名单折算（与其它页面同一套口径）。
 */
export async function loadDashboardComparison(
  db: DbClient,
  scope: DashboardScope,
  range: DashboardRange,
  filters: DashboardComparisonFilters
): Promise<DashboardComparisonResponse> {
  const drilldownGrade = filters.grade ?? null
  const scopeIds = scopeGuard(scope, filters.classIds)
  const base: DashboardComparisonResponse = {
    period: range.period,
    metric: filters.metric,
    level: drilldownGrade ? 'class' : 'grade',
    drilldownGrade,
    rows: []
  }
  if (!scopeIds) return base

  const query: ScopedQuery = { schoolId: scope.schoolId, classIds: scopeIds, range, line: scope.line }
  const [questionRows, planRows, timelyRows, riskRows] = await Promise.all([
    countQuestionsByClass(db, query, drilldownGrade),
    countPlansByClass(db, query, drilldownGrade),
    countPlanTimelyByClass(db, query, drilldownGrade),
    countHighRiskOpenByClass(db, query, drilldownGrade)
  ])
  const questionMap = new Map(questionRows.map(row => [row.class_id, row.value]))
  const planMap = new Map(planRows.map(row => [row.class_id, row.value]))
  const timelyMap = new Map(timelyRows.map(row => [row.class_id, row]))
  const riskMap = new Map(riskRows.map(row => [row.class_id, row.value]))

  const classes = scope.classes.filter(item => !drilldownGrade || item.grade === drilldownGrade)
  if (drilldownGrade) {
    const rows: DashboardComparisonRow[] = classes.map(item => {
      const actions = timelyMap.get(item.id)
      return {
        key: item.id,
        label: item.name,
        grade: item.grade,
        gradeLabel: item.gradeLabel,
        classId: item.id,
        classCount: 1,
        aiQuestions: questionMap.get(item.id) ?? 0,
        plans: planMap.get(item.id) ?? 0,
        // 该班周期内没有「已确认纳入」的执行项时为 null（前端显示「—」）
        planTimelyRate: percentage(actions?.timely ?? 0, actions?.included ?? 0),
        highRiskOpen: riskMap.get(item.id) ?? 0
      }
    })
    return { ...base, rows: sortComparisonRows(rows, filters.metric, filters.order) }
  }

  const includedByGrade = new Map<number, number>()
  const timelyByGrade = new Map<number, number>()
  for (const item of classes) {
    const actions = timelyMap.get(item.id)
    includedByGrade.set(item.grade, (includedByGrade.get(item.grade) ?? 0) + (actions?.included ?? 0))
    timelyByGrade.set(item.grade, (timelyByGrade.get(item.grade) ?? 0) + (actions?.timely ?? 0))
  }

  const byGrade = new Map<number, DashboardComparisonRow>()
  for (const item of classes) {
    const row = byGrade.get(item.grade) ?? {
      key: `grade:${item.grade}`,
      label: gradeLabelOf(item.grade),
      grade: item.grade,
      gradeLabel: item.gradeLabel,
      classId: null,
      classCount: 0,
      aiQuestions: 0,
      plans: 0,
      // 年级行按年级内所有班级的执行项汇总后再算比率，不是各班比率的平均
      planTimelyRate: percentage(timelyByGrade.get(item.grade) ?? 0, includedByGrade.get(item.grade) ?? 0),
      highRiskOpen: 0
    }
    row.classCount += 1
    row.aiQuestions += questionMap.get(item.id) ?? 0
    row.plans += planMap.get(item.id) ?? 0
    row.highRiskOpen += riskMap.get(item.id) ?? 0
    byGrade.set(item.grade, row)
  }
  return { ...base, rows: sortComparisonRows([...byGrade.values()], filters.metric, filters.order) }
}

/**
 * 对比表排序：按所选指标 + 升降序，指标相同按年级/班级顺序稳定排列。
 * 比率指标的 null（该范围没有应执行执行项）按 0 参与排序，降序时自然排在最后。
 */
export function sortComparisonRows(
  rows: readonly DashboardComparisonRow[],
  metric: DashboardComparisonMetric,
  order: 'asc' | 'desc'
): DashboardComparisonRow[] {
  const factor = order === 'asc' ? 1 : -1
  const valueOf = (row: DashboardComparisonRow) => row[metric] ?? 0
  return [...rows].sort((a, b) => (valueOf(a) - valueOf(b)) * factor || a.key.localeCompare(b.key, 'zh-Hans-CN'))
}

async function countQuestionsByClass(db: DbClient, query: ScopedQuery, grade: number | null): Promise<Array<{ class_id: string, value: number }>> {
  const { schoolId, classIds, range, line } = query
  const gradeCondition = grade ? sql` and pc.grade = ${grade}` : sql``
  const moral = andSql(moralQuestionCondition(sql`cm.question_category`, line))
  return rowsOf(db.execute(sql`
    select pc.id as class_id, count(*)::int as value
    from chat_messages cm
    join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = cm.owner_user_id
    where cm.school_id = ${schoolId} and cm.role = 'user' and cm.deleted_at is null
      and ${timeWindow(sql`cm.created_at`, range)} and pc.id ${classIdIn(classIds)}${gradeCondition}${moral}
    group by 1
  `))
}

async function countPlansByClass(db: DbClient, query: ScopedQuery, grade: number | null): Promise<Array<{ class_id: string, value: number }>> {
  const { schoolId, classIds, range, line } = query
  const gradeCondition = grade ? sql` and coalesce(c.grade, pc.grade) = ${grade}` : sql``
  const moral = andSql(moralModuleCondition(sql`p.module`, line))
  return rowsOf(db.execute(sql`
    select coalesce(p.class_id, pc.id) as class_id, count(distinct p.id)::int as value
    from plans p
    left join students st on st.id = p.student_id
    left join classes c on c.id = coalesce(p.class_id, st.class_id)
    left join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = p.owner_user_id
    where p.school_id = ${schoolId} and ${timeWindow(sql`p.created_at`, range)}
      and coalesce(p.class_id, pc.id) ${classIdIn(classIds)}${gradeCondition}${moral}
    group by 1
  `))
}

/** 方案及时率分子/分母：按班级分组的「已确认纳入」与「按期执行项」。 */
async function countPlanTimelyByClass(
  db: DbClient,
  query: ScopedQuery,
  grade: number | null
): Promise<Array<{ class_id: string, included: number, timely: number }>> {
  const { schoolId, classIds, range, line } = query
  const gradeCondition = grade ? sql` and coalesce(c.grade, pc.grade) = ${grade}` : sql``
  const moral = andSql(moralModuleCondition(sql`p.module`, line))
  return rowsOf(db.execute(sql`
    select coalesce(p.class_id, pc.id) as class_id,
           count(pa.id) filter (where pa.decision = 'included')::int as included,
           count(pa.id) filter (
             where pa.decision = 'included' and not (
               (pa.status = 'completed' and pa.due_at is not null and pa.completed_at is not null and pa.completed_at > pa.due_at)
               or (pa.status <> 'completed' and pa.due_at is not null and pa.due_at < now())
             )
           )::int as timely
    from plans p
    left join students st on st.id = p.student_id
    left join classes c on c.id = coalesce(p.class_id, st.class_id)
    left join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = p.owner_user_id
    left join plan_actions pa on pa.plan_id = p.id
    where p.school_id = ${schoolId} and ${timeWindow(sql`p.created_at`, range)}
      and coalesce(p.class_id, pc.id) ${classIdIn(classIds)}${gradeCondition}${moral}
    group by 1
  `))
}

/** 未闭环高危：安全事项（严重度 red/high/crisis）+ 学生事件（高/严重），按班级分组。 */
async function countHighRiskOpenByClass(db: DbClient, query: ScopedQuery, grade: number | null): Promise<Array<{ class_id: string, value: number }>> {
  const { schoolId, classIds, range, line } = query
  const safetyGrade = grade ? sql` and pc.grade = ${grade}` : sql``
  const eventGrade = grade ? sql` and coalesce(c.grade, pc.grade) = ${grade}` : sql``
  const moral = andSql(moralStudentEventCondition(sql`se.event_type`, line))
  return rowsOf(db.execute(sql`
    select class_id, sum(value)::int as value from (
      select pc.id as class_id, count(*)::int as value
      from safety_events se
      join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = se.owner_user_id
      where se.school_id = ${schoolId} and se.status <> 'closed'
        and se.severity in (${sql.join(SAFETY_HIGH_RISK_SEVERITIES.map(item => sql`${item}`), sql`, `)})
        and ${timeWindow(sql`se.created_at`, range)} and pc.id ${classIdIn(classIds)}${safetyGrade}
      group by 1
      union all
      select coalesce(c.id, pc.id) as class_id, count(*)::int as value
      from student_events se
      join students st on st.id = se.student_id
      left join classes c on c.id = st.class_id
      join ${primaryClassSource(schoolId)} pc on pc.owner_user_id = se.owner_user_id
      where se.school_id = ${schoolId} and se.status <> 'closed'
        and se.severity in (${sql.join(STUDENT_EVENT_HIGH_RISK_SEVERITIES.map(item => sql`${item}`), sql`, `)})
        and ${timeWindow(sql`coalesce(se.occurred_at, se.created_at)`, range)}
        and coalesce(c.id, pc.id) ${classIdIn(classIds)}${eventGrade}${moral}
      group by 1
    ) merged
    group by class_id
  `))
}

// ===== 导出 =====

/** 导出表：表头与数据行一起返回，保证两者按同一份维度勾选生成。 */
export interface DashboardExportTable {
  headers: string[]
  rows: Array<Array<string | number | null>>
}

/** 维度勾选 → 导出表头：未勾选的维度列不出现；全不勾时用「统计区间」列承载周期总计。 */
function exportDimensionHeaders(
  dims: readonly DashboardTableDimension[],
  labels: Record<DashboardTableDimension, string>
): string[] {
  return dims.length ? dims.map(dimension => labels[dimension]) : ['统计区间']
}

/** 维度勾选 → 导出单元格（与表头同一份 dims，全不勾时给统计区间标签）。 */
function exportDimensionCells(
  dims: readonly DashboardTableDimension[],
  row: { gradeLabel: string, className: string, category: string, date: string },
  periodLabel: string
): Array<string | number | null> {
  if (!dims.length) return [periodLabel]
  return dims.map(dimension => {
    if (dimension === 'grade') return row.gradeLabel
    if (dimension === 'className') return row.className
    if (dimension === 'category') return row.category
    return row.date
  })
}

/** 导出用的统计区间标签（维度全不勾时放在「统计区间」列）。 */
function exportPeriodLabel(range: DashboardRange): string {
  return `${range.period.start} ~ ${range.period.end}`
}

/** AI 问答导出（不受分页限制，最多 EXPORT_ROW_LIMIT 行；表头跟随表头维度勾选）。 */
export async function loadAiQuestionExportRows(
  db: DbClient,
  scope: DashboardScope,
  range: DashboardRange,
  filters: AiQuestionFilters,
  dims?: readonly DashboardTableDimension[]
): Promise<DashboardExportTable> {
  const selected = tableDims(dims)
  const headers = [...exportDimensionHeaders(selected, AI_QUESTION_TABLE_DIMENSION_LABELS), '提问数', '含安全关注提问']
  const scopeIds = scopeGuard(scope, filters.classIds)
  if (!scopeIds) return { headers, rows: [] }
  const query: ScopedQuery = { schoolId: scope.schoolId, classIds: scopeIds, range, line: scope.line }
  const filter = buildQuestionFilter(query, filters)
  const result = await loadQuestionTable(db, query, filter, {
    page: 1,
    pageSize: EXPORT_ROW_LIMIT,
    sort: selected.includes('date') ? 'date' : 'count',
    order: 'desc',
    dims: selected
  })
  const periodLabel = exportPeriodLabel(range)
  return {
    headers,
    rows: result.rows.map(row => [
      ...exportDimensionCells(selected, row, periodLabel),
      row.count,
      row.highRisk ? '是' : '否'
    ])
  }
}

/** 方案导出（不受分页限制，最多 EXPORT_ROW_LIMIT 行；表头跟随表头维度勾选）。 */
export async function loadPlanExportRows(
  db: DbClient,
  scope: DashboardScope,
  range: DashboardRange,
  filters: PlanFilters,
  dims?: readonly DashboardTableDimension[]
): Promise<DashboardExportTable> {
  const selected = tableDims(dims)
  const headers = [
    ...exportDimensionHeaders(selected, PLAN_TABLE_DIMENSION_LABELS),
    '方案数',
    '完成度(%)',
    '回填率(%)',
    '高风险',
    '中风险',
    '低风险'
  ]
  const scopeIds = scopeGuard(scope, filters.classIds)
  if (!scopeIds) return { headers, rows: [] }
  const query: ScopedQuery = { schoolId: scope.schoolId, classIds: scopeIds, range, line: scope.line }
  const filter = buildPlanFilter(query, filters)
  const result = await loadPlanTable(db, query, filter, {
    page: 1,
    pageSize: EXPORT_ROW_LIMIT,
    sort: selected.includes('date') ? 'date' : 'planTotal',
    order: 'desc',
    dims: selected
  })
  const periodLabel = exportPeriodLabel(range)
  return {
    headers,
    rows: result.rows.map(row => [
      ...exportDimensionCells(selected, row, periodLabel),
      row.planTotal,
      row.completionRate ?? '—',
      row.executionRate ?? '—',
      row.high,
      row.medium,
      row.low
    ])
  }
}

/**
 * 导出文件名：带操作人与时间戳（东八区），并做文件名安全化。
 */
export function exportFileName(type: DashboardExportType, operatorName: string, now = new Date()): string {
  const safeOperator = operatorName.replace(/[\\/:*?"<>|\s]+/g, '') || '未知操作人'
  const stamp = `${shanghaiDateKey(now).replace(/-/g, '')}-${now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour12: false }).replace(/:/g, '')}`
  return `数据驾驶舱-${DASHBOARD_EXPORT_LABELS[type]}-${safeOperator}-${stamp}.csv`
}

/**
 * 导出文件内容里的水印行（原型要求「导出文件自动加水印（操作人+时间）」）：
 * 追加在数据行之后，含操作人、东八区导出时间、数据范围与统计区间，
 * 便于文件脱离系统后仍能追溯来源。返回单元素行，交给 buildCsv 做转义。
 */
export function exportWatermarkRow(input: {
  operatorName: string
  scopeLabel: string
  period: DashboardPeriod
  now?: Date
}): Array<string | number | null> {
  const now = input.now ?? new Date()
  const stamp = `${shanghaiDateKey(now)} ${now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour12: false })}`
  return [`数据水印：导出人 ${input.operatorName} · 导出时间 ${stamp}（东八区） · 数据范围 ${input.scopeLabel} · 统计区间 ${input.period.start}~${input.period.end} · 仅限校内使用`]
}

/** 问答题分类合法性（路由参数校验用）。 */
export function isQuestionCategoryValue(value: string): value is QuestionCategoryValue {
  return (QUESTION_CATEGORIES as readonly string[]).includes(value)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 逗号分隔的班级 UUID 列表（非法值直接 400，不静默丢弃）。 */
export function parseClassIdParam(value?: string | null): string[] | undefined {
  if (!value) return undefined
  const parts = value.split(',').map(item => item.trim()).filter(Boolean)
  if (!parts.length) return undefined
  if (parts.length > 200) throw createError({ statusCode: 400, message: '班级筛选过多，请减少后重试' })
  for (const part of parts) {
    if (!UUID_RE.test(part)) throw createError({ statusCode: 400, message: '班级筛选包含非法的班级标识' })
  }
  return parts
}

/** 逗号分隔的 6 分类名称（不认识的分类直接 400）。 */
export function parseQuestionCategoryParam(value?: string | null): string[] | undefined {
  if (!value) return undefined
  const parts = value.split(',').map(item => item.trim()).filter(Boolean)
  if (!parts.length) return undefined
  for (const part of parts) {
    if (!isQuestionCategoryValue(part)) throw createError({ statusCode: 400, message: `未知的提问分类：${part}` })
  }
  return parts
}

/** 逗号分隔的表头维度（`none` = 一个维度都不勾，只出周期总计一行；不认识的维度直接 400）。 */
export function parseTableDimParam(value?: string | null): DashboardTableDimension[] | undefined {
  if (value === undefined || value === null) return undefined
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed === DASHBOARD_TABLE_DIMS_NONE) return []
  const parts = trimmed.split(',').map(item => item.trim()).filter(Boolean)
  const allowed = new Set<string>(DASHBOARD_TABLE_DIMENSIONS)
  for (const part of parts) {
    if (!allowed.has(part)) throw createError({ statusCode: 400, message: `未知的表头维度：${part}` })
  }
  // 去重但保持页面上的维度顺序（顺序即列顺序）
  return DASHBOARD_TABLE_DIMENSIONS.filter(dimension => parts.includes(dimension))
}

/** 逗号分隔的预警来源（不认识的来源直接 400）。 */
export function parseAlertSourceParam(value?: string | null): AlertSource[] | undefined {
  if (!value) return undefined
  const parts = value.split(',').map(item => item.trim()).filter(Boolean)
  if (!parts.length) return undefined
  const allowed = new Set<string>(ALERT_SOURCES)
  for (const part of parts) {
    if (!allowed.has(part)) throw createError({ statusCode: 400, message: `未知的预警来源：${part}` })
  }
  return parts as AlertSource[]
}

/** 年级 / 班级对比的排序指标（不认识的指标直接 400）。 */
export function parseComparisonMetricParam(value?: string | null): DashboardComparisonMetric | undefined {
  if (!value) return undefined
  if (!(DASHBOARD_COMPARISON_METRICS as readonly string[]).includes(value)) {
    throw createError({ statusCode: 400, message: `未知的对比指标：${value}` })
  }
  return value as DashboardComparisonMetric
}

/** 供路由复用的分页参数默认值。 */
export const DASHBOARD_TABLE_DEFAULTS = { page: 1, pageSize: 20, sort: '', order: 'desc' as const }


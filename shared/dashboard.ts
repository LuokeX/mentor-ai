// 数据驾驶舱（学部校长）：前后端共享的接口契约与展示标签。
//
// 口径由产品在 2026-09-28 确认（见 AGENTS.md 与 docs/ROLE_MATRIX.md）：
//  - 问答按记录人的「主班级」归属，量表/方案/学生事件/沟通优先用记录自带班级；
//  - 推荐量表作答率来自 assistant_assessment_recommended 埋点，只对上线后数据有效；
//  - 风险等级用 plans.report.risk.severity 的四级 low/medium/high/crisis；
//  - 预警明细的学生列按周期内稳定编号脱敏为「学生 A/B/C」。
//
// 契约冻结后前后端并行开发：服务端返回结构以本文件类型为准，
// 前端不要自行推断字段，也不要在页面里复制服务端口径。
import type { ManagedListResult } from './management'

/** 各看板页面允许的最长统计天数（服务端按此校验，超出返回 400）。 */
export const DASHBOARD_PERIOD_LIMITS = {
  /**
   * 数据总览：默认今天，固定窗口最长 30 天。
   * 这里保留 31 是为了容纳 31 天的自然月「本月」预设；界面上不提供「近 31 天」。
   */
  overview: 31,
  /**
   * AI 问答分析：默认近 7 天，固定窗口最长 30 天。
   * 与总览一致，上限 31 只为容纳 31 天的自然月「本月」，界面上不提供「近 31 天」。
   */
  aiQuestions: 31,
  /** 量表与方案分析：默认近 7 天，最长 90 天 */
  plans: 90,
  /** 预警看板：默认近 7 天，最长 365 天 */
  alerts: 365
} as const

/** 各看板页面的默认统计天数（0 表示「今天」当天）。 */
export const DASHBOARD_DEFAULT_DAYS = {
  overview: 0,
  aiQuestions: 7,
  plans: 7,
  alerts: 7
} as const

// ===== 看板页面与权限键（PRD 5.2 角色 × 看板模块矩阵）=====
// 四个页面各对应 roles.permissions 里的一个页面级目标类型（见 shared/management.ts）。
// 平台后台「角色权限配置」按角色逐页勾选「查看」，取消后该页接口返回 403、导航不再出现。
export const DASHBOARD_PAGE_KEYS = [
  'dashboard',
  'dashboard_ai_questions',
  'dashboard_plans',
  'dashboard_alerts'
] as const
export type DashboardPageKey = typeof DASHBOARD_PAGE_KEYS[number]

/** 页面键 → 一级页面标识（接口按页校验用）。 */
export const DASHBOARD_PAGE_IDS: Record<DashboardPageKey, 'overview' | 'aiQuestions' | 'plans' | 'alerts'> = {
  dashboard: 'overview',
  dashboard_ai_questions: 'aiQuestions',
  dashboard_plans: 'plans',
  dashboard_alerts: 'alerts'
}

/** 页面键 → 页面标题与路由（导航与无权限提示共用）。 */
export const DASHBOARD_PAGES: ReadonlyArray<{ key: DashboardPageKey, label: string, to: string }> = [
  { key: 'dashboard', label: '数据总览', to: '/dashboard' },
  { key: 'dashboard_ai_questions', label: 'AI 问答分析', to: '/dashboard/ai-questions' },
  { key: 'dashboard_plans', label: '量表与方案', to: '/dashboard/plans' },
  { key: 'dashboard_alerts', label: '预警看板', to: '/dashboard/alerts' }
]

// ===== 德育口径（PRD 5.2 / 8.2.1）=====
// 德育主任（moral_education_director）只看德育线数据：分类、模块与学生事件类型三组白名单。
// 安全事项不裁剪（安全优先），趋势与年级/班级对比不裁剪。
// 口径调整只改这里一处，服务端过滤与前端徽标都以本常量为准。
export const DASHBOARD_MORAL_LINE = {
  /** AI 问答分类：德育类问题 + 班级系统建设（PRD 5.2「德育/班级类」） */
  questionCategories: ['德育类问题', '班级系统建设'],
  /** 量表与方案模块：班级系统 + 学生个案（PRD 5.2「德育模块」） */
  modules: ['class_system', 'student_case'],
  /** 学生事件类型：行为为主（PRD 5.2 学生事件「行为为主」） */
  studentEventTypes: ['课堂秩序类', '行为规范类', '欺凌侵害类']
} as const

/** 看板数据口径：all = 全量（校长/年级主任），moral = 德育线（德育主任）。 */
export type DashboardLine = 'all' | 'moral'

export const DASHBOARD_LINE_LABELS: Record<DashboardLine, string> = {
  all: '全量口径',
  moral: '德育口径'
}

/**
 * 德育口径白名单判定（服务端过滤与前端展示共用同一份常量，单测覆盖边界）。
 * 三个维度：提问分类 / 方案与量表模块 / 学生事件类型。
 */
export function moralLineIncludes(
  kind: 'questionCategory' | 'module' | 'studentEventType',
  value: string | null | undefined
): boolean {
  if (!value) return false
  if (kind === 'questionCategory') return (DASHBOARD_MORAL_LINE.questionCategories as readonly string[]).includes(value)
  if (kind === 'module') return (DASHBOARD_MORAL_LINE.modules as readonly string[]).includes(value)
  return (DASHBOARD_MORAL_LINE.studentEventTypes as readonly string[]).includes(value)
}

/** 统计周期（东八区自然日，YYYY-MM-DD）。 */
export interface DashboardPeriod {
  start: string
  end: string
}

// ===== 自然日工具（东八区）=====
// 前后端共用：服务端用它切分统计区间，前端用它渲染默认区间与预设按钮，
// 保证「今天」「近 7 天」在两端的边界完全一致。

/** 把时刻折算成东八区自然日（YYYY-MM-DD）。 */
export function shanghaiDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

/** 东八区某个自然日的起点（00:00:00.000 +08:00）。 */
export function shanghaiDayStart(key: string): Date {
  return new Date(`${key}T00:00:00.000+08:00`)
}

/** 东八区某个自然日的终点（23:59:59.999 +08:00）。 */
export function shanghaiDayEnd(key: string): Date {
  return new Date(`${key}T23:59:59.999+08:00`)
}

/** 自然日在东八区内的加减天数（用于默认区间与补齐趋势坐标）。 */
export function addDays(key: string, delta: number): string {
  return shanghaiDateKey(new Date(shanghaiDayStart(key).getTime() + delta * 86_400_000))
}

/** 解析 YYYY-MM-DD；非法返回 null（含 2026-02-31 这类会滚动的日期）。 */
export function parseDateKey(key: string | undefined | null): string | null {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  const parsed = new Date(`${key}T00:00:00+08:00`)
  if (Number.isNaN(parsed.getTime())) return null
  return shanghaiDateKey(parsed) === key ? key : null
}

/** 两个自然日之间的天数（含首尾）。 */
export function daysBetween(startKey: string, endKey: string): number {
  return Math.round((shanghaiDayStart(endKey).getTime() - shanghaiDayStart(startKey).getTime()) / 86_400_000) + 1
}

/** 枚举区间内的自然日（含首尾，最多 limit 个，超出截断保护）。 */
export function enumerateDateKeys(startKey: string, endKey: string, limit = 400): string[] {
  const keys: string[] = []
  let cursor = startKey
  while (cursor <= endKey && keys.length < limit) {
    keys.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return keys
}

/** 自然日对应的星期（0 = 周日 … 6 = 周六，按东八区日期本身计算）。 */
function weekdayOfKey(key: string): number {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()
}

/** 自然日所在自然周的周一（YYYY-MM-DD）。 */
export function startOfWeekKey(key: string): string {
  const offset = (weekdayOfKey(key) + 6) % 7
  return addDays(key, -offset)
}

/** 自然日所在自然月的 1 日（YYYY-MM-DD）。 */
export function startOfMonthKey(key: string): string {
  return `${key.slice(0, 7)}-01`
}

/** 自然日所在自然月的最后一天（YYYY-MM-DD）。 */
export function endOfMonthKey(key: string): string {
  const [year, month] = key.split('-').map(Number)
  const nextMonthFirst = month === 12 ? `${year! + 1}-01-01` : `${year}-${String(month! + 1).padStart(2, '0')}-01`
  return addDays(nextMonthFirst, -1)
}

/**
 * 环比对照方式：
 * - rolling：紧邻当前区间之前、长度相同的上一个区间（默认，配合「近 N 天」这类滚动窗口）；
 * - week：当前区间起点所在自然周的上一自然周（周一到周日）；
 * - month：当前区间起点所在自然月的上一自然月。
 */
export const DASHBOARD_COMPARE_KINDS = ['rolling', 'week', 'month'] as const
export type DashboardCompareKind = typeof DASHBOARD_COMPARE_KINDS[number]

export const DASHBOARD_COMPARE_LABELS: Record<DashboardCompareKind, string> = {
  rolling: '上一等长区间',
  week: '上一自然周',
  month: '上一自然月'
}

/** 上一个自然周（周一至周日）：以「包含 startKey - 1 天的那一周」为准。 */
export function previousWeekRange(startKey: string): { start: string, end: string } {
  const end = addDays(startOfWeekKey(startKey), -1)
  return { start: startOfWeekKey(end), end }
}

/** 上一个自然月：以「包含 startKey - 1 天的那个月」为准。 */
export function previousMonthRange(startKey: string): { start: string, end: string } {
  const end = addDays(startOfMonthKey(startKey), -1)
  return { start: startOfMonthKey(end), end }
}

/** 看板筛选用的班级选项（本校范围内，按年级分组展示）。 */
export interface DashboardClassOption {
  id: string
  name: string
  grade: number
  gradeLabel: string
}

/** 首页 context 接口。 */
export interface DashboardContext {
  /** 收窄后的学部（未配置学部时为 all，表示本校全部班级） */
  managedSection: string
  /** 「数据范围」展示标签：配置了学部时是学部名，否则是学校名 */
  sectionLabel: string
  grades: Array<{ grade: number, label: string, classCount: number }>
  classCount: number
  /** 本校班级清单，供「班级（多选）」筛选使用 */
  classes: DashboardClassOption[]
  /** 当前账号可见的看板页（按角色权限配置解析，导航据此过滤） */
  pages: DashboardPageKey[]
  /** 数据口径：德育主任为 moral（德育线），其余为 all */
  line: DashboardLine
  /** 口径展示标签（「全量口径」/「德育口径」） */
  lineLabel: string
  /** 是否具备个体明细查看能力（view_sensitive，默认关闭，平台后台按校开通） */
  canViewIndividual: boolean
}

// ===== 数据总览 =====

export interface OverviewKpis {
  /** 周期内教师提问条数（不含软删） */
  aiQuestions: number
  /** 推荐量表作答率 = 推荐后完成作答数 / 推荐次数，百分比；没有推荐记录（或埋点缺失）时 null */
  recommendationAnswerRate: number | null
  /** 周期内新建方案数 */
  planTotal: number
  /** 方案完成度 = 已完成执行项 / 方案总执行项数，百分比（PRD 9 口径） */
  planCompletionRate: number | null
  /** 方案执行及时率 = 未逾期执行项 / 已确认纳入执行项，百分比（截至当前时刻） */
  planTimelyRate: number | null
  /** 未闭环高风险：未关闭安全事件 + 高/严重且未关闭学生事件 */
  highRiskOpen: number
}

export interface OverviewResponse extends OverviewSummary {
  /**
   * 总览页聚合卡（W2 / W3 / W4-1 / W4-2 / W5）：只下发当前账号有权限的看板页对应的分组，
   * 二级页被平台后台取消后其聚合卡与导航、入口卡一起收敛（服务端不返回无权页的数据）。
   * 口径与三个二级页完全一致，不维护第二套统计。
   */
  analysis: Partial<OverviewAnalysis>
}

/** 总览接口的 KPI、环比与趋势部分（聚合卡由 `loadOverviewAnalysis` 单独计算，路由合并后返回）。 */
export interface OverviewSummary {
  period: DashboardPeriod
  /** 环比对照区间：紧邻当前区间之前、长度相同的上一个区间 */
  previousPeriod: DashboardPeriod
  kpis: OverviewKpis
  /**
   * 上一区间的同口径指标。环比差值由前端计算：计数类看相对变化，
   * 比率类看百分点差，两种口径不能混在一个字段里。
   */
  previousKpis: OverviewKpis
  trend: {
    dates: string[]
    aiQuestions: number[]
    planTotal: number[]
  }
}

/**
 * 总览页聚合卡（对齐原型总览页 W2 / W3 / W4-1 / W4-2 / W5，2026-10-10 补齐）。
 * 键的存在与否表示该看板页是否可访问：`dashboard_alerts` 一页承载 W4-1 / W4-2 / W5 三组。
 */
export interface OverviewAnalysis {
  /** W2 AI 问答分布：6 类（5 大类 + 德育类问题），德育主任按德育线白名单裁剪 */
  aiQuestions: {
    /** 周期内提问总条数（等于分类分布各行之和，与 KPI 同源） */
    total: number
    byCategory: AiQuestionCategoryStat[]
    /** TOP 问题关键词（最多 6 个，供卡片文字行展示） */
    topKeywords: AiQuestionKeywordStat[]
  }
  /** W3 心理测评与方案执行：方案按模块折算的 5 大类（不含德育类问题），与量表与方案页「量表分类占比」同源 */
  plans: {
    /** 周期内新建方案数 */
    total: number
    byQuestionCategory: PlanCategoryStat[]
  }
  /** W4-1 学生事件记录分析：E1–E6 类型分布（德育主任按事件类型白名单裁剪） */
  studentEvents: {
    total: number
    byType: AlertEventTypeStat[]
  }
  /** W4-2 家校事件记录分析：触达渠道分布 + 总量（只读结构化字段，不含正文与摘要） */
  communication: {
    total: number
    channels: CommunicationChannelStat[]
  }
  /** W5 预警摘要：高危未闭环与方案逾期未闭环（口径与预警看板 KPI 一致） */
  alerts: {
    highRiskOpen: number
    overdueOpen: number
  }
}

/** 环比色彩语义：上升代表好事（绿）/ 需关注（红）/ 中性（灰）。 */
export type DashboardKpiUpTone = 'better' | 'worse' | 'neutral'
export type DashboardKpiDeltaTone = 'positive' | 'negative' | 'neutral'

export interface DashboardKpiDelta {
  text: string
  tone: DashboardKpiDeltaTone
}

/**
 * 看板 KPI 环比文案（总览、AI 问答分析、量表与方案三个页面共用；
 * 各指标的口径说明写在对应卡片的 hint 里，这里只负责差值）：
 * - kind = count：计数类看相对变化百分比；上期为 0 时不给百分比（「较上期新增」/「与上期持平」）；
 * - kind = rate：比率类看百分点差，避免「完成度 5% → 10%」被算成 +100%；
 * - 任一期数值缺失（分母为 0 的比率）时不显示环比。
 */
export function dashboardKpiDelta(input: {
  kind: 'count' | 'rate'
  upTone: DashboardKpiUpTone
  current: number | null
  previous: number | null
}): DashboardKpiDelta | null {
  const { kind, upTone, current, previous } = input
  if (current === null || previous === null) return null
  if (kind === 'count') {
    if (previous === 0) return { text: current === 0 ? '与上期持平' : '较上期新增', tone: 'neutral' }
    return formatKpiDelta(((current - previous) / previous) * 100, kind, upTone)
  }
  return formatKpiDelta(current - previous, kind, upTone)
}

function formatKpiDelta(change: number, kind: 'count' | 'rate', upTone: DashboardKpiUpTone): DashboardKpiDelta {
  const rounded = Math.round(change * 10) / 10
  if (rounded === 0) return { text: '与上期持平', tone: 'neutral' }
  const rising = rounded > 0
  const tone: DashboardKpiDeltaTone = upTone === 'neutral'
    ? 'neutral'
    : (rising === (upTone === 'better') ? 'positive' : 'negative')
  return { text: `较上期 ${rising ? '↑' : '↓'} ${Math.abs(rounded)}${kind === 'rate' ? ' 个百分点' : '%'}`, tone }
}

// ===== AI 问答分析 =====

export interface AiQuestionKpis {
  aiQuestions: number
  /** 量表推荐次数（assistant_assessment_recommended 埋点） */
  recommended: number
  /** 推荐后完成作答的推荐次数（同一推荐提交任一所推量表即算一次，最多计入一次） */
  answered: number
  /** 量表推荐次数 / 提问条数 */
  recommendationRate: number | null
  /** 推荐后完成作答数 / 推荐次数（整体转化，分类明细见 recommendation） */
  answeredRate: number | null
  /** 含安全关注的提问条数（与明细表 highRisk 列同一判定，来源为对话助手安全事项） */
  highRiskQuestions: number
  /** 周期内有提问的去重教师数（PRD 6.1「活跃教师数」） */
  activeTeachers: number
  /** 人均提问 = 提问条数 / 活跃教师数（PRD 6.1「人均提问」；无提问时 null） */
  questionsPerTeacher: number | null
  /** 平均会话轮次 = 提问条数 / 有提问的会话数（轮次按提问次数计；无会话时 null） */
  turnsPerSession: number | null
}

export interface AiQuestionByDay {
  date: string
  count: number
}

export interface AiQuestionCategoryStat {
  category: string
  count: number
}

export interface AiQuestionKeywordStat {
  keyword: string
  count: number
}

/** 分类维度的「推荐 → 作答」转化（推荐量来自埋点，只统计上线后数据）。 */
export interface AiQuestionRecommendationStat {
  category: string
  aiQuestions: number
  recommended: number
  recommendRate: number | null
  answered: number
  answerRate: number | null
}

/**
 * 6 个问答题分类（顺序即看板图例顺序）。
 * 与 server/domain/question-category.ts 的 QUESTION_CATEGORIES 必须一致，
 * tests/dashboard-metrics.test.ts 有对齐断言防止两处漂移。
 */
export const QUESTION_CATEGORY_VALUES = [
  '学生学习问题',
  '学生个体问题',
  '班级系统建设',
  '自我成长赋能',
  '德育类问题',
  '其他类'
] as const

export type QuestionCategoryValue = typeof QUESTION_CATEGORY_VALUES[number]

export interface AiQuestionRow {
  id: string
  grade: number | null
  gradeLabel: string
  className: string
  category: string
  /** 周期内的自然日 YYYY-MM-DD；未勾选「日期」维度时为空串（周期总计行由页面/导出展示统计区间） */
  date: string
  count: number
  /** 该分组内是否出现由安全事件标记的高风险提问 */
  highRisk: boolean
}

export interface AiQuestionsResponse {
  period: DashboardPeriod
  /** 环比对照区间：紧邻当前区间之前、长度相同的上一个区间 */
  previousPeriod: DashboardPeriod
  kpis: AiQuestionKpis
  /** 上一区间的同口径 KPI（环比差值由前端 dashboardKpiDelta 计算） */
  previousKpis: AiQuestionKpis
  byDay: AiQuestionByDay[]
  byCategory: AiQuestionCategoryStat[]
  topKeywords: AiQuestionKeywordStat[]
  recommendation: AiQuestionRecommendationStat[]
  /** 明细表：按勾选的表头维度聚合，不是逐条提问；维度全不勾时只有一行周期总计 */
  table: ManagedListResult<AiQuestionRow>
}

// ===== 量表与方案分析 =====

export interface PlanKpis {
  planTotal: number
  planCompletionRate: number | null
  executionRate: number | null
  /** 周期内新建方案里风险等级为高/安全关注（report.risk.severity = high | crisis）的数量 */
  highRiskPlans: number
  /** 周期内提交的量表作答总数（assessment_attempts 中 status = submitted） */
  assessmentTotal: number
  /** 方案接受率 = 已接受方案数 / 方案总数（%）（PRD 6.1「方案接受率」） */
  acceptanceRate: number | null
  /** 提醒触达率 = 周期内站内通知已读数 / 通知总数（%，站内已读口径，不含短信/外呼送达） */
  reminderReadRate: number | null
}

export interface PlanByDay {
  date: string
  planTotal: number
  completionRate: number | null
  executionRate: number | null
  /** 当天提交的量表作答数 */
  assessmentCount: number
}

export interface PlanCategoryStat {
  /** 分类中文名：模块分布为方案模块名；量表分类占比为提问 5 分类口径（家校沟通并入自我成长赋能） */
  category: string
  count: number
}

/**
 * 量表分类占比用的 5 大类口径（PRD 原型 v2「按 5 大类分布，不含德育类」）：
 * 德育类问题没有方案模块命中，因此不在量表口径里。
 */
export const PLAN_QUESTION_CATEGORIES = [
  '学生学习问题',
  '学生个体问题',
  '班级系统建设',
  '自我成长赋能',
  '其他类'
] as const

// ===== 学生心理风险分布（PRD 9「心理风险分布」：各风险等级人数占比）=====

/** 四档风险等级（PRD 原型的低/中/高/健康）。 */
export const DASHBOARD_STUDENT_RISK_LEVELS = ['healthy', 'low', 'medium', 'high'] as const
export type DashboardStudentRiskLevel = typeof DASHBOARD_STUDENT_RISK_LEVELS[number]

export const DASHBOARD_STUDENT_RISK_LABELS: Record<DashboardStudentRiskLevel, string> = {
  healthy: '健康',
  low: '低风险',
  medium: '中风险',
  high: '高风险'
}

/**
 * 量表等级码 → 统一风险档。各量表的等级词表不同（见 shared/assessments.ts 的 LEVEL_LABELS /
 * LEVEL_COLORS），这里做一次折算，未登记的等级码不计入分布（例如家校模块的复合值 P3-C）。
 */
export const ASSESSMENT_LEVEL_RISK: Record<string, DashboardStudentRiskLevel> = {
  green: 'healthy',
  blue: 'low',
  yellow: 'medium',
  orange: 'medium',
  red: 'high',
  purple: 'high',
  survival: 'high',
  norming: 'medium',
  operating: 'low',
  mature: 'healthy',
  L1: 'low',
  L2: 'medium',
  L3: 'high',
  LP1: 'low',
  LP2: 'medium',
  LP3: 'high'
}

/** 学生心理风险分布的一档（人数）。 */
export interface PlanStudentRiskStat {
  level: DashboardStudentRiskLevel
  label: string
  count: number
}

export type PlanRiskSeverity = 'low' | 'medium' | 'high' | 'crisis'

export interface PlanRow {
  id: string
  grade: number | null
  gradeLabel: string
  className: string
  /** 量表分类（提问 6 分类口径，由方案模块折算） */
  category: string
  /** 周期内的自然日 YYYY-MM-DD；未勾选「日期」维度时为空串（周期总计行由页面/导出展示统计区间） */
  date: string
  planTotal: number
  completionRate: number | null
  executionRate: number | null
  high: number
  medium: number
  low: number
}

export interface PlansResponse {
  period: DashboardPeriod
  /** 环比对照区间：紧邻当前区间之前、长度相同的上一个区间 */
  previousPeriod: DashboardPeriod
  kpis: PlanKpis
  /** 上一区间的同口径 KPI（环比差值由前端 dashboardKpiDelta 计算） */
  previousKpis: PlanKpis
  byDay: PlanByDay[]
  /** 模块分布（按方案模块单独统计） */
  byModule: PlanCategoryStat[]
  /** 量表分类占比（5 大类口径，与明细表的「量表分类」列一致） */
  byQuestionCategory: PlanCategoryStat[]
  /** 学生心理风险分布（按人数；周期内每个学生取其最近一次学生对象量表的等级折算） */
  studentRiskDistribution: PlanStudentRiskStat[]
  /** 方案风险等级分布（与明细表的高/中/低风险列同源：安全关注并入高风险，「健康」并入低风险） */
  riskDistribution: PlanRiskStat[]
  table: ManagedListResult<PlanRow>
}

/**
 * 方案风险等级分布的档位（原型「问题风险等级分布」，2026-10-10 补齐）：
 * 与明细表的高 / 中 / 低风险三列完全同源——`report.risk.severity` 的 crisis（安全关注）
 * 并入高风险，原型四档里的「健康」在现行方案报告口径中没有独立取值，并入低风险。
 */
export const PLAN_RISK_DISTRIBUTION_LEVELS = ['high', 'medium', 'low'] as const
export type PlanRiskDistributionLevel = typeof PLAN_RISK_DISTRIBUTION_LEVELS[number]

export interface PlanRiskStat {
  level: PlanRiskDistributionLevel
  label: string
  count: number
}

// ===== 年级 / 班级对比（W8）=====

/**
 * 对比指标（PRD W8「聚合横向对比」）：AI 提问数 / 方案数 / 方案及时率 / 高危未闭环数。
 * 方案及时率是比率，只进排名表（分组柱状图仍只画三个计数指标，避免量纲混用）。
 */
export const DASHBOARD_COMPARISON_METRICS = ['aiQuestions', 'plans', 'planTimelyRate', 'highRiskOpen'] as const
export type DashboardComparisonMetric = typeof DASHBOARD_COMPARISON_METRICS[number]

/** 分组柱状图绘制的计数指标（比率指标不入图）。 */
export const DASHBOARD_COMPARISON_CHART_METRICS = ['aiQuestions', 'plans', 'highRiskOpen'] as const

export const DASHBOARD_COMPARISON_METRIC_LABELS: Record<DashboardComparisonMetric, string> = {
  aiQuestions: 'AI 提问数',
  plans: '方案数',
  planTimelyRate: '方案及时率',
  highRiskOpen: '高危未闭环'
}

/** 对比行：年级维度（level=grade）或下钻后的班级维度（level=class）。指标都返回，供排名表与分组柱状展示。 */
export interface DashboardComparisonRow {
  /** 年级行用 `grade:<n>`；班级行用 classId */
  key: string
  label: string
  grade: number | null
  gradeLabel: string
  classId: string | null
  /** 年级行的班级数；班级行固定 1 */
  classCount: number
  aiQuestions: number
  plans: number
  /** 方案及时率（按期执行项 / 已确认纳入执行项）；该范围没有应执行执行项时为 null */
  planTimelyRate: number | null
  highRiskOpen: number
}

export interface DashboardComparisonResponse {
  period: DashboardPeriod
  /** 排名表当前排序依据的指标（全部指标都在行里返回） */
  metric: DashboardComparisonMetric
  /** 当前层级：grade = 年级对比；class = 已下钻到该年级的班级对比 */
  level: 'grade' | 'class'
  drilldownGrade: number | null
  rows: DashboardComparisonRow[]
}

// ===== 预警看板 =====

/**
 * 预警来源：安全事件（对话 / 量表）、学生事件（E1–E6）与方案逾期两类
 * （执行项逾期 plan_action_overdue / 复盘逾期 plan_review_overdue，口径见 PRD W5）。
 */
export type AlertSource =
  | 'safety_chat'
  | 'safety_assessment'
  | 'student_event'
  | 'communication_risk'
  | 'plan_action_overdue'
  | 'plan_review_overdue'
export const ALERT_SOURCES = [
  'safety_chat',
  'safety_assessment',
  'student_event',
  'communication_risk',
  'plan_action_overdue',
  'plan_review_overdue'
] as const

export const ALERT_SOURCE_LABELS: Record<AlertSource, string> = {
  safety_chat: '对话助手安全事项',
  safety_assessment: '量表提交安全事项',
  student_event: '学生事件',
  communication_risk: '高风险家校沟通',
  plan_action_overdue: '执行项逾期',
  plan_review_overdue: '复盘逾期'
}

/**
 * 高风险家校沟通：`communications.risk_level` 取这两个值，
 * 与 `COMMUNICATION_RISK_LABELS` 的「安全关注 / 高风险」一致。
 */
export const COMMUNICATION_HIGH_RISK_LEVELS = ['crisis', 'high'] as const

/** 逾期来源（方案逾期），用于趋势分组与明细展示。 */
export const ALERT_OVERDUE_SOURCES = ['plan_action_overdue', 'plan_review_overdue'] as const

export function isOverdueAlertSource(source: AlertSource): boolean {
  return (ALERT_OVERDUE_SOURCES as readonly string[]).includes(source)
}

export interface AlertKpis {
  total: number
  open: number
  highRiskOpen: number
  /** 未闭环的方案逾期项（执行项逾期 + 复盘逾期），不计入 highRiskOpen。 */
  overdueOpen: number
  /**
   * 高危闭环率 = 已关闭高危 / 高危总数（%，与 highRiskOpen 同源：安全事项 + 高/严重学生事件 + 高风险沟通）；
   * 该指标不受页面「状态」筛选影响（否则筛「待解决」时恒为 0）。没有任何高危记录时为 null。
   */
  highRiskClosedRate: number | null
  /** 周期内出现高风险量表等级的学生数（PRD W5「N 名心理高风险学生」；与量表页学生心理风险分布同源） */
  studentRiskHigh: number
}

/**
 * 预警每日趋势：按四类来源分组（安全事项 / 学生事件 / 高风险家校沟通 / 方案逾期），
 * 日期与区间一致（东八区自然日，缺失日补 0）。
 */
export interface AlertByDay {
  date: string
  safety: number
  studentEvent: number
  communication: number
  overdue: number
}

/** 学生事件类型分布（E1–E6，德育主任按学生事件白名单裁剪）。 */
export interface AlertEventTypeStat {
  eventType: string
  count: number
}

/** 家校沟通渠道分布（W4-2；渠道为空归「未标注」）。 */
export interface CommunicationChannelStat {
  channel: string
  label: string
  count: number
}

/** 家校沟通风险等级分布（仅结构化字段，不涉及正文）。 */
export interface CommunicationRiskStat {
  riskLevel: string
  label: string
  count: number
}

/** 家校沟通每日趋势。 */
export interface CommunicationByDay {
  date: string
  count: number
}

/** 家校沟通风险等级标签（看板口径：crisis / high / medium / low）。 */
export const COMMUNICATION_RISK_LABELS: Record<string, string> = {
  crisis: '安全关注',
  high: '高风险',
  medium: '中风险',
  low: '低风险'
}

/** 家校沟通风险等级（看板与录入共用的规范取值）。 */
export const COMMUNICATION_RISK_LEVELS = ['crisis', 'high', 'medium', 'low'] as const
export type CommunicationRiskLevel = (typeof COMMUNICATION_RISK_LEVELS)[number]

/** 沟通风险等级下拉选项：值统一写英文码，显示中文标签。 */
export const COMMUNICATION_RISK_OPTIONS: ReadonlyArray<{ label: string, value: CommunicationRiskLevel }> = [
  { label: '安全关注', value: 'crisis' },
  { label: '高风险', value: 'high' },
  { label: '中风险', value: 'medium' },
  { label: '低风险', value: 'low' }
]

/**
 * 沟通风险等级归一：历史记录里存在「高 / 低 / 无 / D」等自由文本，
 * 统一折算到看板口径；空值与无法识别的值返回 null（按「未标注」展示，不进入高危口径）。
 */
export function canonicalCommunicationRiskLevel(value: string | null | undefined): CommunicationRiskLevel | null {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return null
  const lower = text.toLowerCase()
  if (lower === 'crisis' || text === '安全关注') return 'crisis'
  if (lower === 'high' || text === '高' || text === '高风险') return 'high'
  if (lower === 'medium' || text === '中' || text === '中风险') return 'medium'
  if (lower === 'low' || text === '低' || text === '低风险' || text === '无' || lower === 'd') return 'low'
  return null
}

/** 风险等级展示名（兼容历史自由文本；无法识别时原样展示，空值显示「未标注」）。 */
export function communicationRiskLabel(value: string | null | undefined): string {
  const canonical = canonicalCommunicationRiskLevel(value)
  if (canonical) return COMMUNICATION_RISK_LABELS[canonical]!
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw || COMMUNICATION_CHANNEL_UNLABELED
}

/**
 * 高危沟通在数据库里的实际取值：除规范码外，还兼容历史中文标签。
 * 只用于 SQL 过滤，避免历史「高」记录被高危口径漏掉。
 */
export const COMMUNICATION_HIGH_RISK_DB_VALUES = ['crisis', 'high', '安全关注', '高', '高风险'] as const

/** 家校沟通未标注渠道的展示标签。 */
export const COMMUNICATION_CHANNEL_UNLABELED = '未标注'

/** 家校事件记录分析（W4-2 / W11）：渠道分布 + 风险等级分布 + 每日趋势 + 覆盖与重点学生口径。 */
export interface AlertCommunicationStats {
  /** 周期内本校沟通记录总数（不含已归档） */
  total: number
  channels: CommunicationChannelStat[]
  riskLevels: CommunicationRiskStat[]
  byDay: CommunicationByDay[]
  /** 危机沟通数（risk_level = crisis / high，与预警来源 communication_risk 同判定） */
  crisisCount: number
  /** 沟通覆盖率 = 有沟通记录的去重学生数 / 范围内在册学生数（%）；没有学生记录时为 null */
  coverageRate: number | null
  /** 重点学生数（周期内出现高危学生事件 / 高风险量表等级 / 高风险沟通的学生） */
  keyStudents: number
  /** 重点学生在周期内的沟通条数 */
  keyStudentMessages: number
  /** 重点学生人均沟通条数（重点学生数为 0 时 null） */
  keyStudentMessagesPerStudent: number | null
}

/** 预警明细行里「方案逾期」的展示风险标签（不计入高危口径）。 */
export const ALERT_OVERDUE_RISK_LABEL = '逾期未闭环'

export interface AlertRow {
  id: string
  /** 记录类型中文名：安全事项 / 学生事件 / 执行项逾期 / 复盘逾期 */
  type: string
  source: AlertSource
  sourceLabel: string
  /** 脱敏学生标号：学生 A / 学生 B …（周期内稳定） */
  studentLabel: string
  /**
   * 学生 ID：只在操作者具备个体明细查看能力（view_sensitive，默认关闭）时返回，
   * 供「查看个体」入口申请 15 分钟授权；未开通时为 null。安全事项没有学生关联，恒为 null。
   */
  studentId: string | null
  /**
   * 负责教师 ID：同样只在具备 view_sensitive 能力时返回，供「查看教师个体」入口使用；
   * 未开通时为 null。
   */
  teacherId: string | null
  grade: number | null
  gradeLabel: string
  className: string
  /** 学生事件为事件类型；方案逾期为方案模块中文名；安全事项不展示内部分类，留空 */
  keyword: string
  teacherName: string
  occurredAt: string
  status: 'open' | 'resolved' | 'closed'
  /** 人类可读风险等级：低风险 / 中风险 / 高风险 / 安全关注 / 逾期未闭环 */
  riskLevel: string
}

export interface AlertsResponse {
  period: DashboardPeriod
  kpis: AlertKpis
  /** 每日趋势（按安全事项 / 学生事件 / 家校沟通 / 方案逾期四类分组） */
  byDay: AlertByDay[]
  /** 学生事件类型分布（E1–E6；德育主任按学生事件白名单裁剪） */
  studentEventTypes: AlertEventTypeStat[]
  /** 学生事件录入情况（PRD 6.1「事件导入教师数」） */
  studentEvents: { importers: number }
  /** 家校事件记录分析（W4-2）：沟通渠道与风险等级分布、每日趋势 */
  communication: AlertCommunicationStats
  table: ManagedListResult<AlertRow>
}

// ===== 个体明细下钻（PRD 4.2 原则 3/4、4.4、W7；默认关闭，按配置 + 事由授权）=====

/**
 * 个体明细支持的目标类型（PRD 5.1 W7「具体学生 / 教师 / 家长」）：
 * - `student`：学生（身份 + 学生事件 + 方案 + 沟通 + 量表测评 + 问答摘要）
 * - `teacher_profile`：负责教师（身份 + 负责范围 + 近期计数，不含业务正文）
 * - `guardian`：家长（身份 + 关系 + 关联学生 + 沟通结构化字段）
 * 三类共用同一套三层门禁：看板页权限 → `view_sensitive` 能力 → 15 分钟事由授权。
 */
export const DASHBOARD_INDIVIDUAL_TARGET_TYPES = ['student', 'teacher_profile', 'guardian'] as const
export type DashboardIndividualTargetType = typeof DASHBOARD_INDIVIDUAL_TARGET_TYPES[number]

export const DASHBOARD_INDIVIDUAL_TARGET_LABELS: Record<DashboardIndividualTargetType, string> = {
  student: '学生',
  teacher_profile: '教师',
  guardian: '家长'
}

/** 教师个体投影的统计窗口（天）：计数只覆盖最近这段区间，页面按此标注。 */
export const DASHBOARD_INDIVIDUAL_TEACHER_WINDOW_DAYS = 30

/** AI 问答个体口径的摘要截断长度（只给摘要，不返回助手回答正文）。 */
export const DASHBOARD_INDIVIDUAL_QUESTION_EXCERPT_LENGTH = 80

export interface DashboardIndividualStudent {
  id: string
  /** 学生姓名（已按授权解密；未授权时不返回本接口） */
  name: string
  grade: number | null
  gradeLabel: string
  className: string
  status: string
}

/** 学生事件（个体级）：类型、严重度、发生时间与状态；不含处理正文与备注。 */
export interface DashboardIndividualEvent {
  id: string
  eventType: string
  severity: string
  occurredAt: string
  status: string
}

/** 该学生的方案（个体级）：模块与风险等级，用于「心理测评与方案」的个体口径。 */
export interface DashboardIndividualPlan {
  id: string
  module: string
  moduleLabel: string
  riskSeverity: PlanRiskSeverity
  riskLabel: string
  status: string
  createdAt: string
}

/** 该学生的量表测评（个体级）：量表名、等级与主归因摘要；不返回原始作答。 */
export interface DashboardIndividualAssessment {
  id: string
  moduleLabel: string
  instrumentName: string
  /** 等级中文标签（assessmentBadge 口径） */
  levelLabel: string
  /** 主归因名称；无归因时为空字符串 */
  attribution: string
  submittedAt: string
}

/** 该学生相关的 AI 提问（个体级）：摘要 + 分类 + 关键词；不返回助手回答正文。 */
export interface DashboardIndividualQuestion {
  id: string
  /** 提问摘要（≤ 80 字，已脱敏） */
  excerpt: string
  category: string
  keywords: string[]
  createdAt: string
}

/** 该学生的沟通记录（个体级）：渠道、风险等级与时间；不返回沟通正文与摘要。 */
export interface DashboardIndividualCommunication {
  id: string
  channel: string | null
  channelLabel: string
  riskLevel: string | null
  occurredAt: string
  /** 关联家长：供从学生明细继续下钻到家长个体（需要该家长的独立授权） */
  guardianId: string | null
}

/**
 * 教师个体投影（最小披露）：身份 + 负责范围 + 统计窗口内的计数。
 * 不返回该教师的提问原文、方案/事件正文与任何学生名单。
 */
export interface DashboardIndividualTeacher {
  id: string
  name: string
  /** 任教年级（users.teaching_grades 折算的中文标签） */
  teachingGradeLabels: string[]
  classCount: number
  studentCount: number
  /** 以下计数的统计窗口（天） */
  windowDays: number
  aiQuestions: number
  plans: number
  studentEvents: number
}

/** 家长个体投影里的关联学生（编号 + 关系，不返回学生联系方式）。 */
export interface DashboardIndividualGuardianStudent {
  id: string
  name: string
  gradeLabel: string
  className: string
  /** 该家长对这个学生的关系（student_guardians.relation） */
  relation: string | null
}

/** 家长个体投影：身份 + 关联学生 + 沟通结构化字段（另一个接口片段）。 */
export interface DashboardIndividualGuardian {
  id: string
  name: string
  /** 档案里的关系（guardians.relation） */
  relation: string | null
  students: DashboardIndividualGuardianStudent[]
}

/** 个体明细响应的公共部分：授权信息与水印 + 每类明细上限。 */
export interface DashboardIndividualDetailBase {
  /** 授权信息与水印：页面按水印展示操作人 + 时间 + 授权编号前缀 */
  access: { grantId: string, expiresAt: string, watermark: string }
  /** 每类明细的返回上限与截断标记 */
  limits: { perCollection: number, truncated: boolean }
}

export interface DashboardIndividualStudentDetail extends DashboardIndividualDetailBase {
  targetType: 'student'
  student: DashboardIndividualStudent
  studentEvents: DashboardIndividualEvent[]
  plans: DashboardIndividualPlan[]
  communications: DashboardIndividualCommunication[]
  assessments: DashboardIndividualAssessment[]
  aiQuestions: DashboardIndividualQuestion[]
}

export interface DashboardIndividualTeacherDetail extends DashboardIndividualDetailBase {
  targetType: 'teacher_profile'
  teacher: DashboardIndividualTeacher
}

export interface DashboardIndividualGuardianDetail extends DashboardIndividualDetailBase {
  targetType: 'guardian'
  guardian: DashboardIndividualGuardian
  communications: DashboardIndividualCommunication[]
}

export type DashboardIndividualDetailResponse =
  | DashboardIndividualStudentDetail
  | DashboardIndividualTeacherDetail
  | DashboardIndividualGuardianDetail

// ===== 明细表「表头维度」（原型：勾选的维度参与聚合，固定指标列不参与勾选）=====
//
// 两张明细表（AI 问答 / 量表与方案）的可勾选维度一致，只有分类列的标签不同：
// 勾选的维度进入服务端 group by，未勾选的维度既不出现在表头、也不参与聚合；
// 全部不勾时只出一行「周期总计」（日期列展示统计区间）。
// 固定指标列（提问数 / 方案数 / 完成度 / 回填率 / 风险分级）不参与勾选。

/** 明细表可勾选的聚合维度，顺序即页面上的展示顺序。 */
export const DASHBOARD_TABLE_DIMENSIONS = ['grade', 'className', 'category', 'date'] as const
export type DashboardTableDimension = typeof DASHBOARD_TABLE_DIMENSIONS[number]

/**
 * 「一个维度都不勾」的参数值：空串会被前端查询串压缩掉（compactDashboardQuery），
 * 所以用一个固定关键词表达「只出周期总计一行」。
 */
export const DASHBOARD_TABLE_DIMS_NONE = 'none'

/** AI 问答明细的表头维度标签（分类列 = 提问分类）。 */
export const AI_QUESTION_TABLE_DIMENSION_LABELS: Record<DashboardTableDimension, string> = {
  grade: '年级',
  className: '班级',
  category: '提问分类',
  date: '日期'
}

/** 量表与方案明细的表头维度标签（分类列 = 量表分类）。 */
export const PLAN_TABLE_DIMENSION_LABELS: Record<DashboardTableDimension, string> = {
  grade: '年级',
  className: '班级',
  category: '量表分类',
  date: '日期'
}

// ===== 导出 =====

export type DashboardExportType = 'ai-questions' | 'plans' | 'overview'
export const DASHBOARD_EXPORT_TYPES = ['ai-questions', 'plans', 'overview'] as const

/** 导出文件与审计里的页面名（文件名与审计 metadata 共用一份标签）。 */
export const DASHBOARD_EXPORT_LABELS: Record<DashboardExportType, string> = {
  'ai-questions': 'AI问答分析',
  plans: '量表与方案分析',
  overview: '数据总览'
}

// ===== 展示标签 =====

/** 方案风险等级（plans.report.risk.severity）标签。 */
export const PLAN_RISK_LABELS: Record<PlanRiskSeverity, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  crisis: '安全关注'
}

/** 学生事件严重度（低/中/高/严重）到看板风险等级的映射。 */
export const STUDENT_EVENT_RISK_LABELS: Record<string, string> = {
  低: '低风险',
  中: '中风险',
  高: '高风险',
  严重: '严重'
}

// ===== 预警明细的风险等级档位（筛选与列色共用一份口径） =====

/**
 * 预警明细行的风险等级档位。
 * 「高风险」档与 KPI 的高危口径同源（`isHighRiskAlert`）：安全关注（安全事项 / 危机沟通）、
 * 高风险、以及学生事件的「严重」；方案逾期行展示「逾期未闭环」，单独一档（不计入高危）。
 */
export type AlertRiskLevelFilter = 'high' | 'medium' | 'low' | 'overdue' | 'all'

export const ALERT_RISK_LEVEL_FILTERS = ['high', 'medium', 'low', 'overdue', 'all'] as const satisfies readonly AlertRiskLevelFilter[]

/** 预警看板风险等级筛选的默认档位：只看高风险（含安全关注 / 严重）。 */
export const ALERT_DEFAULT_RISK_LEVEL: AlertRiskLevelFilter = 'high'

/**
 * 筛选下拉的展示文案：高风险档显式标注含安全关注与「严重」，
 * 避免与明细行展示的「安全关注」对不上（档位归并不改展示标签）。
 */
export const ALERT_RISK_LEVEL_FILTER_LABELS: Record<AlertRiskLevelFilter, string> = {
  high: '高风险（含安全关注 / 严重）',
  medium: '中风险',
  low: '低风险',
  overdue: ALERT_OVERDUE_RISK_LABEL,
  all: '全部风险等级'
}

/** 各档位命中的展示标签（由现有标签映射去重归并，避免与来源口径漂移）。 */
const ALERT_RISK_LEVEL_GROUPS: Record<'high' | 'medium' | 'low', readonly string[]> = {
  high: [...new Set([
    PLAN_RISK_LABELS.high,
    PLAN_RISK_LABELS.crisis,
    COMMUNICATION_RISK_LABELS['high']!,
    COMMUNICATION_RISK_LABELS['crisis']!,
    STUDENT_EVENT_RISK_LABELS['高']!,
    STUDENT_EVENT_RISK_LABELS['严重']!
  ])],
  medium: [...new Set([PLAN_RISK_LABELS.medium, COMMUNICATION_RISK_LABELS['medium']!, STUDENT_EVENT_RISK_LABELS['中']!])],
  low: [...new Set([PLAN_RISK_LABELS.low, COMMUNICATION_RISK_LABELS['low']!, STUDENT_EVENT_RISK_LABELS['低']!])]
}

/** 明细行风险等级所属档位；未知标签归 'other'（只在「全部风险等级」档出现）。 */
export type AlertRiskLevelTone = 'high' | 'medium' | 'low' | 'overdue' | 'other'

export function alertRiskLevelTone(riskLevel: string): AlertRiskLevelTone {
  if (riskLevel === ALERT_OVERDUE_RISK_LABEL) return 'overdue'
  if (ALERT_RISK_LEVEL_GROUPS.high.includes(riskLevel)) return 'high'
  if (ALERT_RISK_LEVEL_GROUPS.medium.includes(riskLevel)) return 'medium'
  if (ALERT_RISK_LEVEL_GROUPS.low.includes(riskLevel)) return 'low'
  return 'other'
}

/** 明细行是否命中当前风险档位（'all' 不过滤）。 */
export function alertRiskLevelMatches(riskLevel: string, filter: AlertRiskLevelFilter): boolean {
  return filter === 'all' || alertRiskLevelTone(riskLevel) === filter
}

/**
 * 模块 → 问答题分类的折算（推荐量表作答率按分类统计时用）。
 * 家校沟通类提问在分类口径里并入「自我成长赋能」（含沟通话术类）。
 */
export const MODULE_TO_QUESTION_CATEGORY: Record<string, QuestionCategoryValue> = {
  learning_problem: '学生学习问题',
  student_case: '学生个体问题',
  class_system: '班级系统建设',
  self_growth: '自我成长赋能',
  home_school: '自我成长赋能'
}

/** 方案模块 → 中文名（看板分类统计用，与 useDisplayLabels 的 module 映射保持一致）。 */
export const DASHBOARD_MODULE_LABELS: Record<string, string> = {
  self_growth: '自我成长',
  class_system: '班级系统',
  home_school: '家校沟通',
  student_case: '学生个案',
  learning_problem: '学习问题'
}

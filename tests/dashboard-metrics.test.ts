import { describe, expect, it } from 'vitest'
import {
  addDays,
  alertTrendGroup,
  assignStudentLabels,
  buildAlertByDay,
  buildCsv,
  buildStudentEventTypeStats,
  buildStudentEventTypeStatsFromCounts,
  daysBetween,
  emptyOverviewAnalysis,
  enumerateDateKeys,
  exportFileName,
  average,
  isHighRiskAlert,
  moduleLabel,
  moduleQuestionCategory,
  normalizeAlertStatus,
  parseAlertSourceParam,
  parseComparisonMetricParam,
  parseDateKey,
  parseTableDimParam,
  percentage,
  planActionRates,
  planRiskBucket,
  planRiskLabel,
  planRiskSeverity,
  previousRange,
  previousMonthRange,
  previousWeekRange,
  resolveDashboardRange,
  safetySourceOf,
  shanghaiDateKey,
  shanghaiDayEnd,
  shanghaiDayStart,
  sortComparisonRows,
  studentEventRiskLabel,
  visibleQuestionCategories,
  DASHBOARD_TABLE_DEFAULTS,
  type DashboardComparisonRow,
  type RawAlert
} from '../server/domain/dashboard-metrics'
import {
  AI_QUESTION_TABLE_DIMENSION_LABELS,
  DASHBOARD_COMPARISON_METRIC_LABELS,
  DASHBOARD_COMPARISON_CHART_METRICS,
  DASHBOARD_COMPARISON_METRICS,
  DASHBOARD_DEFAULT_DAYS,
  DASHBOARD_LINE_LABELS,
  DASHBOARD_MODULE_LABELS,
  DASHBOARD_MORAL_LINE,
  DASHBOARD_PAGES,
  DASHBOARD_PAGE_IDS,
  DASHBOARD_PAGE_KEYS,
  DASHBOARD_PERIOD_LIMITS,
  DASHBOARD_TABLE_DIMENSIONS,
  DASHBOARD_TABLE_DIMS_NONE,
  PLAN_QUESTION_CATEGORIES,
  PLAN_RISK_DISTRIBUTION_LEVELS,
  PLAN_RISK_LABELS,
  PLAN_TABLE_DIMENSION_LABELS,
  QUESTION_CATEGORY_VALUES,
  isOverdueAlertSource,
  moralLineIncludes,
  dashboardKpiDelta,
  startOfMonthKey,
  startOfWeekKey
} from '../shared/dashboard'
import { QUESTION_CATEGORIES } from '../server/domain/question-category'
import { MANAGED_TARGET_TYPES } from '../shared/management'
import { studentEventTypes } from '../shared/contracts'

/** 固定的「现在」：2026-09-28 17:00（东八区），用于区间默认值断言。 */
const NOW = new Date('2026-09-28T17:00:00+08:00')

describe('统计区间与自然日换算（东八区）', () => {
  it('时刻折算成东八区自然日', () => {
    // 东八区 2026-09-29 07:00 的 UTC 时刻是 2026-09-28T23:00Z，必须归到 29 日
    expect(shanghaiDateKey(new Date('2026-09-28T23:00:00Z'))).toBe('2026-09-29')
    expect(shanghaiDateKey(new Date('2026-09-28T15:59:59Z'))).toBe('2026-09-28')
  })

  it('自然日边界落在 +08:00 的零点与末刻', () => {
    expect(shanghaiDayStart('2026-09-28').toISOString()).toBe('2026-09-27T16:00:00.000Z')
    expect(shanghaiDayEnd('2026-09-28').toISOString()).toBe('2026-09-28T15:59:59.999Z')
  })

  it('加减天数与区间天数按自然日计算（跨月不偏差）', () => {
    expect(addDays('2026-09-28', -6)).toBe('2026-09-22')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-09-22', '2026-09-28')).toBe(7)
    expect(daysBetween('2026-09-28', '2026-09-28')).toBe(1)
  })

  it('日期解析拒绝非法与滚动的日期', () => {
    expect(parseDateKey('2026-09-28')).toBe('2026-09-28')
    expect(parseDateKey('2026-9-28')).toBeNull()
    expect(parseDateKey('2026-02-31')).toBeNull()
    expect(parseDateKey(undefined)).toBeNull()
  })

  it('枚举区间含首尾且按升序', () => {
    expect(enumerateDateKeys('2026-09-25', '2026-09-28')).toEqual(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'])
  })

  it('默认区间：总览按「今天」，二级页按近 N 天', () => {
    const overview = resolveDashboardRange({}, { defaultDays: DASHBOARD_DEFAULT_DAYS.overview, maxDays: DASHBOARD_PERIOD_LIMITS.overview, now: NOW })
    expect(overview.period).toEqual({ start: '2026-09-28', end: '2026-09-28' })
    const aiQuestions = resolveDashboardRange({}, { defaultDays: DASHBOARD_DEFAULT_DAYS.aiQuestions, maxDays: DASHBOARD_PERIOD_LIMITS.aiQuestions, now: NOW })
    expect(aiQuestions.period).toEqual({ start: '2026-09-22', end: '2026-09-28' })
    expect(aiQuestions.days).toBe(7)
  })

  it('超出上限的区间直接抛错（不静默截断）', () => {
    expect(() => resolveDashboardRange(
      { start: '2026-08-01', end: '2026-09-28' },
      { defaultDays: 7, maxDays: DASHBOARD_PERIOD_LIMITS.aiQuestions, now: NOW }
    )).toThrow(/最长 30 天/)
    expect(() => resolveDashboardRange(
      { start: '2026-09-29', end: '2026-09-28' },
      { defaultDays: 7, maxDays: 30, now: NOW }
    )).toThrow(/不能晚于/)
    expect(() => resolveDashboardRange(
      { start: '2026-02-31', end: '2026-09-28' },
      { defaultDays: 7, maxDays: 30, now: NOW }
    )).toThrow(/格式不正确/)
  })

  it('环比对照区间是紧邻当前区间之前的等长区间', () => {
    const week = resolveDashboardRange(
      { start: '2026-09-22', end: '2026-09-28' },
      { defaultDays: 7, maxDays: 31, now: NOW }
    )
    const previousWeek = previousRange(week)
    expect(previousWeek.period).toEqual({ start: '2026-09-15', end: '2026-09-21' })
    expect(previousWeek.days).toBe(week.days)
    // 跨月与单日区间同样成立
    const single = resolveDashboardRange({ start: '2026-03-01', end: '2026-03-01' }, { defaultDays: 1, maxDays: 31, now: NOW })
    expect(previousRange(single).period).toEqual({ start: '2026-02-28', end: '2026-02-28' })
  })

  it('环比对照随 compare 切换：自然周取上一整周、自然月取上一整月', () => {
    // 2026-09-28 是周一：本周 = 09-28 ~ 10-04，上一自然周 = 09-21 ~ 09-27
    const week = resolveDashboardRange(
      { start: '2026-09-28', end: '2026-10-04', compare: 'week' },
      { defaultDays: 7, maxDays: 31, now: NOW }
    )
    expect(week.compare).toBe('week')
    expect(previousRange(week).period).toEqual({ start: '2026-09-21', end: '2026-09-27' })

    // 本月 = 10-01 ~ 10-09（截至今天），上一自然月 = 09-01 ~ 09-30
    const month = resolveDashboardRange(
      { start: '2026-10-01', end: '2026-10-09', compare: 'month' },
      { defaultDays: 0, maxDays: 31, now: NOW }
    )
    expect(previousRange(month).period).toEqual({ start: '2026-09-01', end: '2026-09-30' })
    // 对照区间长度可以与本期间不同（自然月），days 按对照区间自身计算
    expect(previousRange(month).days).toBe(30)

    // 非法值回落滚动口径，不报错
    const fallback = resolveDashboardRange({ start: '2026-09-22', end: '2026-09-28', compare: 'quarter' }, { defaultDays: 7, maxDays: 31, now: NOW })
    expect(fallback.compare).toBe('rolling')
    expect(previousRange(fallback).period).toEqual({ start: '2026-09-15', end: '2026-09-21' })
  })

  it('自然周 / 自然月的起点与上一区间工具', () => {
    expect(startOfWeekKey('2026-09-28')).toBe('2026-09-28')
    expect(startOfWeekKey('2026-10-04')).toBe('2026-09-28')
    expect(startOfWeekKey('2026-10-05')).toBe('2026-10-05')
    expect(startOfMonthKey('2026-10-09')).toBe('2026-10-01')
    expect(previousWeekRange('2026-10-05')).toEqual({ start: '2026-09-28', end: '2026-10-04' })
    expect(previousMonthRange('2026-03-01')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })
})

describe('比率与执行指标（分母为 0 返回 null）', () => {
  it('百分比保留 1 位小数', () => {
    expect(percentage(1, 3)).toBe(33.3)
    expect(percentage(2, 3)).toBe(66.7)
    expect(percentage(1, 1)).toBe(100)
    expect(percentage(0, 5)).toBe(0)
    expect(percentage(3, 0)).toBeNull()
    expect(percentage(0, 0)).toBeNull()
  })

  it('人均类指标保留 1 位小数（人均提问 / 平均会话轮次）', () => {
    expect(average(13, 4)).toBe(3.3)
    expect(average(13, 1)).toBe(13)
    expect(average(0, 5)).toBe(0)
    expect(average(5, 0)).toBeNull()
  })

  it('完成度除以方案总执行项数，回填率与及时率除以已确认纳入项', () => {
    expect(planActionRates({ total: 10, completed: 3, included: 4, executed: 2, timely: 3 }))
      .toEqual({ completionRate: 30, executionRate: 50, timelyRate: 75 })
    expect(planActionRates({ total: 0, completed: 0, included: 0, executed: 0, timely: 0 }))
      .toEqual({ completionRate: null, executionRate: null, timelyRate: null })
  })

  it('逾期后补完成不计入按期，及时率按分子直接算', () => {
    // 4 项应执行：2 项按期、1 项逾期才补完成、1 项未完成已过期 → 50%
    expect(planActionRates({ total: 6, completed: 3, included: 4, executed: 3, timely: 2 }).timelyRate).toBe(50)
  })

  it('全部按期时及时率为 100%', () => {
    expect(planActionRates({ total: 3, completed: 2, included: 3, executed: 2, timely: 3 }).timelyRate).toBe(100)
  })
})

describe('总览 KPI 环比（计数看相对变化，比率看百分点差）', () => {
  it('计数类按相对变化给出百分比与方向', () => {
    expect(dashboardKpiDelta({ kind: 'count', upTone: 'neutral', current: 12, previous: 10 }))
      .toEqual({ text: '较上期 ↑ 20%', tone: 'neutral' })
    expect(dashboardKpiDelta({ kind: 'count', upTone: 'neutral', current: 8, previous: 10 }))
      .toEqual({ text: '较上期 ↓ 20%', tone: 'neutral' })
    // 高危未闭环上升是坏事：红
    expect(dashboardKpiDelta({ kind: 'count', upTone: 'worse', current: 6, previous: 4 }))
      .toEqual({ text: '较上期 ↑ 50%', tone: 'negative' })
    expect(dashboardKpiDelta({ kind: 'count', upTone: 'worse', current: 2, previous: 4 }))
      .toEqual({ text: '较上期 ↓ 50%', tone: 'positive' })
  })

  it('比率类按百分点差，不把 5%→10% 算成 +100%', () => {
    expect(dashboardKpiDelta({ kind: 'rate', upTone: 'better', current: 10, previous: 5 }))
      .toEqual({ text: '较上期 ↑ 5 个百分点', tone: 'positive' })
    expect(dashboardKpiDelta({ kind: 'rate', upTone: 'better', current: 3, previous: 5 }))
      .toEqual({ text: '较上期 ↓ 2 个百分点', tone: 'negative' })
  })

  it('上期为 0 时不给百分比；两期都空（分母为 0 的比率）不显示环比', () => {
    expect(dashboardKpiDelta({ kind: 'count', upTone: 'neutral', current: 3, previous: 0 }))
      .toEqual({ text: '较上期新增', tone: 'neutral' })
    expect(dashboardKpiDelta({ kind: 'count', upTone: 'neutral', current: 0, previous: 0 }))
      .toEqual({ text: '与上期持平', tone: 'neutral' })
    expect(dashboardKpiDelta({ kind: 'rate', upTone: 'better', current: 0, previous: 0 }))
      .toEqual({ text: '与上期持平', tone: 'neutral' })
    expect(dashboardKpiDelta({ kind: 'rate', upTone: 'better', current: null, previous: 0 })).toBeNull()
    expect(dashboardKpiDelta({ kind: 'count', upTone: 'neutral', current: 5, previous: null })).toBeNull()
  })
})

describe('方案风险等级与预警风险映射', () => {
  it('从方案报告里取四级风险，缺失或非法回落低风险', () => {
    expect(planRiskSeverity({ risk: { severity: 'crisis' } })).toBe('crisis')
    expect(planRiskSeverity({ risk: { severity: 'high' } })).toBe('high')
    expect(planRiskSeverity({ risk: { severity: '严重' } })).toBe('low')
    expect(planRiskSeverity({})).toBe('low')
    expect(planRiskSeverity(null)).toBe('low')
  })

  it('风险标签与共享契约一致（PRD 的「健康」并入低风险）', () => {
    expect(planRiskLabel('low')).toBe(PLAN_RISK_LABELS.low)
    expect(planRiskLabel('crisis')).toBe('安全关注')
    expect(planRiskLabel('unknown')).toBe('低风险')
  })

  it('学生事件严重度与安全事件来源折算', () => {
    expect(studentEventRiskLabel('严重')).toBe('严重')
    expect(studentEventRiskLabel('高')).toBe('高风险')
    expect(studentEventRiskLabel(null)).toBe('中风险')
    expect(safetySourceOf('chat')).toBe('safety_chat')
    expect(safetySourceOf('assessment')).toBe('safety_assessment')
    expect(safetySourceOf(null)).toBe('safety_chat')
  })

  it('高危判定：安全事件看安全等级，学生事件只看高/严重', () => {
    expect(isHighRiskAlert({ source: 'safety_chat', severity: 'red' })).toBe(true)
    expect(isHighRiskAlert({ source: 'safety_assessment', severity: 'high' })).toBe(true)
    expect(isHighRiskAlert({ source: 'student_event', severity: '高' })).toBe(true)
    expect(isHighRiskAlert({ source: 'student_event', severity: '严重' })).toBe(true)
    expect(isHighRiskAlert({ source: 'student_event', severity: '中' })).toBe(false)
    expect(isHighRiskAlert({ source: 'student_event', severity: '低' })).toBe(false)
  })

  it('预警状态归一：安全事件的 open 与三态学生事件统一输出', () => {
    expect(normalizeAlertStatus('open')).toBe('open')
    expect(normalizeAlertStatus('resolved')).toBe('resolved')
    expect(normalizeAlertStatus('closed')).toBe('closed')
    expect(normalizeAlertStatus(undefined)).toBe('open')
  })
})

describe('学生标号脱敏与模块折算', () => {
  it('按首次出现顺序编号且同一学生稳定、跨 26 人继续用数字', () => {
    const map = assignStudentLabels([null, 's1', 's2', 's1', undefined, 's3'])
    expect(map.get('s1')).toBe('学生 A')
    expect(map.get('s2')).toBe('学生 B')
    expect(map.get('s3')).toBe('学生 C')
    expect(map.size).toBe(3)
    const many = assignStudentLabels(Array.from({ length: 27 }, (_, index) => `id-${index}`))
    expect(many.get('id-25')).toBe('学生 Z')
    expect(many.get('id-26')).toBe('学生 27')
  })

  it('模块折算到 6 分类：家校沟通并入自我成长赋能，未知模块回落其他类', () => {
    expect(moduleQuestionCategory('learning_problem')).toBe('学生学习问题')
    expect(moduleQuestionCategory('student_case')).toBe('学生个体问题')
    expect(moduleQuestionCategory('class_system')).toBe('班级系统建设')
    expect(moduleQuestionCategory('self_growth')).toBe('自我成长赋能')
    expect(moduleQuestionCategory('home_school')).toBe('自我成长赋能')
    expect(moduleQuestionCategory('unknown_module')).toBe('其他类')
    expect(moduleQuestionCategory(null)).toBe('其他类')
  })

  it('量表分类筛选口径：模块只落 4 类，德育类问题对方案永远为空', () => {
    const reachable = new Set(
      ['learning_problem', 'student_case', 'class_system', 'self_growth', 'home_school', 'unknown_module', null]
        .map(module => moduleQuestionCategory(module))
    )
    expect([...reachable].sort()).toEqual(['学生学习问题', '学生个体问题', '班级系统建设', '自我成长赋能', '其他类'].sort())
    // 筛选下拉复用 6 分类全集，德育类问题没有模块命中，只会在明细里展示「暂无数据」
    expect(reachable.has('德育类问题')).toBe(false)
    expect(QUESTION_CATEGORY_VALUES).toContain('德育类问题')
  })

  it('方案模块中文名与前端展示标签一致', () => {
    expect(moduleLabel('self_growth')).toBe('自我成长')
    expect(moduleLabel('class_system')).toBe('班级系统')
    expect(moduleLabel(null)).toBe('未标注')
  })
})

describe('CSV 导出', () => {
  it('带 BOM、转义逗号/引号/换行并使用 CRLF', () => {
    const csv = buildCsv(['年级', '班级'], [['三年级', '三(1)班,实验'], ['三年级', '含"引号"']])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"三(1)班,实验"')
    expect(csv).toContain('"含""引号"""')
    expect(csv.split('\r\n')).toHaveLength(3)
  })

  it('空值与数字按原样输出', () => {
    const csv = buildCsv(['完成度'], [[null], [0], [66.7]])
    const lines = csv.replace('\uFEFF', '').split('\r\n')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('0')
    expect(lines[3]).toBe('66.7')
  })

  it('文件名带操作人与时间戳并去除不安全字符', () => {
    const name = exportFileName('ai-questions', '张 三/校长', new Date('2026-09-28T10:05:00+08:00'))
    expect(name).toBe('数据驾驶舱-AI问答分析-张三校长-20260928-100500.csv')
    expect(exportFileName('plans', '', NOW)).toContain('量表与方案分析-未知操作人')
  })
})

describe('看板契约常量', () => {
  it('分页默认值与共享管理框架一致', () => {
    expect(DASHBOARD_TABLE_DEFAULTS).toEqual({ page: 1, pageSize: 20, sort: '', order: 'desc' })
  })

  it('问答题分类清单与服务端 QUESTION_CATEGORIES 完全一致（防两处漂移）', () => {
    expect([...QUESTION_CATEGORY_VALUES]).toEqual([...QUESTION_CATEGORIES])
  })

  it('周期上限：AI 问答 30 天、方案 90 天、预警 1 年、总览 31 天', () => {
    expect(DASHBOARD_PERIOD_LIMITS.aiQuestions).toBe(30)
    expect(DASHBOARD_PERIOD_LIMITS.plans).toBe(90)
    expect(DASHBOARD_PERIOD_LIMITS.alerts).toBe(365)
    expect(DASHBOARD_PERIOD_LIMITS.overview).toBe(31)
  })
})

describe('看板权限键与德育口径（PRD 4.1 / 5.2 / 8.2.1）', () => {
  it('四个页面键都是受管目标类型，且页面元数据齐全（导航、路由、一级页面 ID）', () => {
    for (const key of DASHBOARD_PAGE_KEYS) {
      expect(MANAGED_TARGET_TYPES, `${key} 应在 MANAGED_TARGET_TYPES 中`).toContain(key)
      expect(DASHBOARD_PAGE_IDS[key], `${key} 缺少一级页面 ID`).toBeTruthy()
    }
    expect(DASHBOARD_PAGES.map(page => page.key)).toEqual([...DASHBOARD_PAGE_KEYS])
    expect(DASHBOARD_PAGES.map(page => page.to)).toEqual([
      '/dashboard',
      '/dashboard/ai-questions',
      '/dashboard/plans',
      '/dashboard/alerts'
    ])
    expect(Object.values(DASHBOARD_PAGE_IDS).sort()).toEqual(['aiQuestions', 'alerts', 'overview', 'plans'])
  })

  it('德育口径白名单都是合法取值（分类 / 模块 / 学生事件类型）', () => {
    for (const category of DASHBOARD_MORAL_LINE.questionCategories) {
      expect(QUESTION_CATEGORIES, `分类 ${category}`).toContain(category)
    }
    for (const module of DASHBOARD_MORAL_LINE.modules) {
      expect(Object.keys(DASHBOARD_MODULE_LABELS), `模块 ${module}`).toContain(module)
    }
    for (const eventType of DASHBOARD_MORAL_LINE.studentEventTypes) {
      expect(studentEventTypes as readonly string[], `事件类型 ${eventType}`).toContain(eventType)
    }
  })

  it('moralLineIncludes 三个维度的边界：命中、未命中与空值', () => {
    expect(moralLineIncludes('questionCategory', '德育类问题')).toBe(true)
    expect(moralLineIncludes('questionCategory', '班级系统建设')).toBe(true)
    expect(moralLineIncludes('questionCategory', '学生学习问题')).toBe(false)
    expect(moralLineIncludes('questionCategory', '')).toBe(false)
    expect(moralLineIncludes('questionCategory', null)).toBe(false)

    expect(moralLineIncludes('module', 'class_system')).toBe(true)
    expect(moralLineIncludes('module', 'home_school')).toBe(false)
    expect(moralLineIncludes('module', undefined)).toBe(false)

    expect(moralLineIncludes('studentEventType', '行为规范类')).toBe(true)
    expect(moralLineIncludes('studentEventType', '学业纪律类')).toBe(false)
    expect(moralLineIncludes('studentEventType', null)).toBe(false)
  })

  it('口径标签：全量与德育各一条，德育主任用德育口径', () => {
    expect(DASHBOARD_LINE_LABELS.all).toBe('全量口径')
    expect(DASHBOARD_LINE_LABELS.moral).toBe('德育口径')
  })

  it('德育口径与方案模块折算一致：白名单模块折算到展示用的分类', () => {
    for (const module of DASHBOARD_MORAL_LINE.modules) {
      expect(moduleQuestionCategory(module), `模块 ${module} 折算`).not.toBe('其他类')
    }
  })
})

describe('方案逾期与预警趋势（W4-1 / W5 / W6）', () => {
  const rawAlert = (overrides: Partial<RawAlert> & Pick<RawAlert, 'id' | 'source' | 'occurredAt'>): RawAlert => ({
    type: '学生事件',
    severity: null,
    status: 'open',
    keyword: '',
    studentId: null,
    studentLabel: '',
    teacherId: 'teacher-1',
    teacherName: '张老师',
    grade: 3,
    className: '三年级一班',
    ...overrides
  })

  it('逾期来源不参与高危口径（避免稀释「高危未闭环」）', () => {
    expect(isHighRiskAlert({ source: 'plan_action_overdue', severity: null })).toBe(false)
    expect(isHighRiskAlert({ source: 'plan_review_overdue', severity: null })).toBe(false)
    expect(isHighRiskAlert({ source: 'safety_chat', severity: 'red' })).toBe(true)
    expect(isHighRiskAlert({ source: 'student_event', severity: '严重' })).toBe(true)
    expect(isHighRiskAlert({ source: 'student_event', severity: '低' })).toBe(false)
  })

  it('趋势分组把六类来源归到安全事项 / 学生事件 / 高风险家校沟通 / 方案逾期', () => {
    expect(alertTrendGroup('safety_chat')).toBe('safety')
    expect(alertTrendGroup('safety_assessment')).toBe('safety')
    expect(alertTrendGroup('student_event')).toBe('studentEvent')
    expect(alertTrendGroup('communication_risk')).toBe('communication')
    expect(alertTrendGroup('plan_action_overdue')).toBe('overdue')
    expect(alertTrendGroup('plan_review_overdue')).toBe('overdue')
    expect(isOverdueAlertSource('plan_review_overdue')).toBe(true)
    expect(isOverdueAlertSource('student_event')).toBe(false)
    // 高风险家校沟通只在 risk_level = crisis / high 时进预警，因此恒为高危
    expect(isHighRiskAlert({ source: 'communication_risk', severity: 'high' })).toBe(true)
    expect(isHighRiskAlert({ source: 'communication_risk', severity: 'crisis' })).toBe(true)
  })

  it('每日趋势按东八区自然日补齐并分组计数（区间外的记录丢弃）', () => {
    const dates = ['2026-09-28', '2026-09-29', '2026-09-30']
    const rows = [
      rawAlert({ id: 'a', source: 'safety_chat', occurredAt: new Date('2026-09-28T09:00:00+08:00') }),
      rawAlert({ id: 'b', source: 'safety_assessment', occurredAt: new Date('2026-09-28T23:30:00+08:00') }),
      rawAlert({ id: 'c', source: 'student_event', occurredAt: new Date('2026-09-29T08:00:00+08:00') }),
      rawAlert({ id: 'g', source: 'communication_risk', occurredAt: new Date('2026-09-29T10:00:00+08:00') }),
      rawAlert({ id: 'd', source: 'plan_action_overdue', occurredAt: new Date('2026-09-29T20:00:00+08:00') }),
      rawAlert({ id: 'e', source: 'plan_review_overdue', occurredAt: new Date('2026-09-30T08:00:00+08:00') }),
      // 区间外：不应出现在趋势里
      rawAlert({ id: 'f', source: 'student_event', occurredAt: new Date('2026-09-27T08:00:00+08:00') })
    ]
    const byDay = buildAlertByDay(dates, rows)
    expect(byDay).toEqual([
      { date: '2026-09-28', safety: 2, studentEvent: 0, communication: 0, overdue: 0 },
      { date: '2026-09-29', safety: 0, studentEvent: 1, communication: 1, overdue: 1 },
      { date: '2026-09-30', safety: 0, studentEvent: 0, communication: 0, overdue: 1 }
    ])
  })

  it('学生事件类型分布按事件类型计数排序，空类型归「未标注」', () => {
    const rows = [
      rawAlert({ id: 'a', source: 'student_event', keyword: '行为规范类', occurredAt: new Date() }),
      rawAlert({ id: 'b', source: 'student_event', keyword: '行为规范类', occurredAt: new Date() }),
      rawAlert({ id: 'c', source: 'student_event', keyword: '课堂秩序类', occurredAt: new Date() }),
      rawAlert({ id: 'd', source: 'student_event', keyword: '', occurredAt: new Date() }),
      rawAlert({ id: 'e', source: 'safety_chat', occurredAt: new Date() })
    ]
    expect(buildStudentEventTypeStats(rows)).toEqual([
      { eventType: '行为规范类', count: 2 },
      { eventType: '课堂秩序类', count: 1 },
      { eventType: '未标注', count: 1 }
    ])
  })

  it('预警来源解析接受逾期来源，未知来源抛 400', () => {
    expect(parseAlertSourceParam('student_event,plan_action_overdue')).toEqual(['student_event', 'plan_action_overdue'])
    expect(parseAlertSourceParam(null)).toBeUndefined()
    expect(() => parseAlertSourceParam('unknown_source')).toThrow()
  })
})

describe('年级 / 班级对比（W8）', () => {
  const row = (overrides: Partial<DashboardComparisonRow> & Pick<DashboardComparisonRow, 'key'>): DashboardComparisonRow => ({
    label: overrides.key,
    grade: 1,
    gradeLabel: '一年级',
    classId: null,
    classCount: 1,
    aiQuestions: 0,
    plans: 0,
    highRiskOpen: 0,
    ...overrides
  })

  it('按所选指标升降序排序，指标相同按 key 稳定排列', () => {
    const rows = [
      row({ key: 'grade:1', aiQuestions: 5, plans: 1 }),
      row({ key: 'grade:2', aiQuestions: 9, plans: 3 }),
      row({ key: 'grade:3', aiQuestions: 5, plans: 2 })
    ]
    expect(sortComparisonRows(rows, 'aiQuestions', 'desc').map(item => item.key)).toEqual(['grade:2', 'grade:1', 'grade:3'])
    expect(sortComparisonRows(rows, 'aiQuestions', 'asc').map(item => item.key)).toEqual(['grade:1', 'grade:3', 'grade:2'])
    expect(sortComparisonRows(rows, 'plans', 'desc').map(item => item.key)).toEqual(['grade:2', 'grade:3', 'grade:1'])
  })

  it('对比指标解析：合法值直通，非法值抛 400', () => {
    expect(parseComparisonMetricParam('plans')).toBe('plans')
    expect(parseComparisonMetricParam('planTimelyRate')).toBe('planTimelyRate')
    expect(parseComparisonMetricParam(undefined)).toBeUndefined()
    expect(() => parseComparisonMetricParam('unknown')).toThrow()
    expect(DASHBOARD_COMPARISON_METRICS).toEqual(['aiQuestions', 'plans', 'planTimelyRate', 'highRiskOpen'])
    // 柱状图只画计数指标，比率指标不入图
    expect(DASHBOARD_COMPARISON_CHART_METRICS).toEqual(['aiQuestions', 'plans', 'highRiskOpen'])
    for (const metric of DASHBOARD_COMPARISON_METRICS) {
      expect(DASHBOARD_COMPARISON_METRIC_LABELS[metric]).toBeTruthy()
    }
  })

  it('方案及时率为空（没有应执行执行项）时按 0 参与排序，降序排在最后', () => {
    const rows: DashboardComparisonRow[] = [
      { key: 'grade:1', label: '一年级', grade: 1, gradeLabel: '一年级', classId: null, classCount: 1, aiQuestions: 0, plans: 1, planTimelyRate: null, highRiskOpen: 0 },
      { key: 'grade:2', label: '二年级', grade: 2, gradeLabel: '二年级', classId: null, classCount: 1, aiQuestions: 0, plans: 1, planTimelyRate: 40, highRiskOpen: 0 }
    ]
    expect(sortComparisonRows(rows, 'planTimelyRate', 'desc').map(item => item.key)).toEqual(['grade:2', 'grade:1'])
  })
})

describe('明细表表头维度（原型「表头维度勾选」的聚合语义）', () => {
  it('未传参数 = 全部维度参与聚合；none / 空串 = 全不勾（只出周期总计一行）', () => {
    expect(parseTableDimParam(undefined)).toBeUndefined()
    expect(parseTableDimParam(null)).toBeUndefined()
    expect(parseTableDimParam('')).toEqual([])
    expect(parseTableDimParam('   ')).toEqual([])
    expect(parseTableDimParam(DASHBOARD_TABLE_DIMS_NONE)).toEqual([])
    expect(parseTableDimParam(' none ')).toEqual([])
  })

  it('按页面维度顺序归一化并去重（顺序即列顺序）', () => {
    expect(parseTableDimParam('date,className')).toEqual(['className', 'date'])
    expect(parseTableDimParam('category,grade,category')).toEqual(['grade', 'category'])
    expect(parseTableDimParam('grade,className,category,date')).toEqual([...DASHBOARD_TABLE_DIMENSIONS])
  })

  it('未知维度直接 400，不静默丢弃', () => {
    expect(() => parseTableDimParam('grade,unknown')).toThrow()
  })

  it('两张明细表共用同一份维度清单，标签齐全（分类列分别是提问分类 / 量表分类）', () => {
    expect([...DASHBOARD_TABLE_DIMENSIONS]).toEqual(['grade', 'className', 'category', 'date'])
    expect(DASHBOARD_TABLE_DIMS_NONE).toBe('none')
    for (const dimension of DASHBOARD_TABLE_DIMENSIONS) {
      expect(AI_QUESTION_TABLE_DIMENSION_LABELS[dimension], `AI 缺少 ${dimension} 标签`).toBeTruthy()
      expect(PLAN_TABLE_DIMENSION_LABELS[dimension], `方案缺少 ${dimension} 标签`).toBeTruthy()
    }
    expect(AI_QUESTION_TABLE_DIMENSION_LABELS.category).toBe('提问分类')
    expect(PLAN_TABLE_DIMENSION_LABELS.category).toBe('量表分类')
  })
})

describe('总览页聚合卡（W2 / W3 / W4-1 / W4-2 / W5）', () => {
  it('学生事件类型分布按计数合并、空类型归「未标注」，按计数降序同数按中文序', () => {
    expect(buildStudentEventTypeStatsFromCounts([
      { eventType: '学业纪律类', count: 3 },
      { eventType: null, count: 1 },
      { eventType: '学业纪律类', count: 2 },
      { eventType: '', count: 1 },
      { eventType: '课堂秩序类', count: 6 }
    ])).toEqual([
      { eventType: '课堂秩序类', count: 6 },
      { eventType: '学业纪律类', count: 5 },
      { eventType: '未标注', count: 2 }
    ])
  })

  it('无班级范围时聚合卡结构与正常返回一致、数值全 0，且只含可见看板页的分组', () => {
    const analysis = emptyOverviewAnalysis({ ai: true, plans: false, alerts: true, line: 'all' })
    expect(Object.keys(analysis).sort()).toEqual(['aiQuestions', 'alerts', 'communication', 'studentEvents'])
    expect(analysis.plans).toBeUndefined()
    expect(analysis.aiQuestions?.total).toBe(0)
    expect(analysis.aiQuestions?.topKeywords).toEqual([])
    expect(analysis.aiQuestions?.byCategory.map(item => item.category)).toEqual([...QUESTION_CATEGORY_VALUES])
    expect(analysis.aiQuestions?.byCategory.every(item => item.count === 0)).toBe(true)
    expect(analysis.studentEvents).toEqual({ total: 0, byType: [] })
    expect(analysis.communication).toEqual({ total: 0, channels: [] })
    expect(analysis.alerts).toEqual({ highRiskOpen: 0, overdueOpen: 0 })
  })

  it('方案风险分档：安全关注（crisis）并入高风险，其余三级直通（与明细表三列同源）', () => {
    expect(planRiskBucket('crisis')).toBe('high')
    expect(planRiskBucket('high')).toBe('high')
    expect(planRiskBucket('medium')).toBe('medium')
    expect(planRiskBucket('low')).toBe('low')
    expect([...PLAN_RISK_DISTRIBUTION_LEVELS]).toEqual(['high', 'medium', 'low'])
    expect(PLAN_RISK_LABELS[planRiskBucket('crisis')]).toBe('高风险')
  })

  it('德育口径的聚合卡图例只含德育线分类；量表分类图例恒为 5 大类（不含德育类问题）', () => {
    const analysis = emptyOverviewAnalysis({ ai: true, plans: true, alerts: false, line: 'moral' })
    const categories = analysis.aiQuestions?.byCategory.map(item => item.category) ?? []
    expect(categories.length).toBeGreaterThan(0)
    expect(categories.every(category => moralLineIncludes('questionCategory', category))).toBe(true)
    expect(analysis.plans?.byQuestionCategory.map(item => item.category)).toEqual([...PLAN_QUESTION_CATEGORIES])
  })

  it('分类图例：全量口径 6 类（5 大类 + 德育类问题），德育口径只留白名单分类', () => {
    expect(visibleQuestionCategories('all')).toEqual([...QUESTION_CATEGORIES])
    const moralCategories = visibleQuestionCategories('moral')
    expect(moralCategories.length).toBeGreaterThan(0)
    expect(moralCategories.length).toBeLessThan(QUESTION_CATEGORIES.length)
    expect(moralCategories.every(category => moralLineIncludes('questionCategory', category))).toBe(true)
  })
})

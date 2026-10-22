import {
  addDays,
  daysBetween,
  parseDateKey,
  shanghaiDateKey,
  startOfMonthKey,
  startOfWeekKey,
  type DashboardCompareKind,
  type DashboardPeriod
} from '#shared/dashboard'

/**
 * 统计区间的预设：滚动窗口（含今天在内的最近 N 天）或自然周 / 自然月（周一起、月 1 日起）。
 * 自然周 / 自然月预设同时决定环比对照口径（上一自然周 / 上一自然月，见 shared/dashboard.ts）。
 */
export interface DashboardPeriodPreset {
  label: string
  /** 滚动窗口天数（与 calendar 二选一） */
  days?: number
  /** 自然周 / 自然月（与 days 二选一） */
  calendar?: 'week' | 'month'
}

/**
 * 四个看板页共用的快捷周期顺序（统一顺序与文案，避免各页各写一套）。
 * 页面按自己的上限过滤：自然月最多 31 天、自然周最多 7 天。
 * 总览与 AI 问答页的上限都放宽到 31 以容纳 31 天的自然月「本月」，但都不提供「近 31 天」。
 */
export const DASHBOARD_PERIOD_PRESETS: readonly DashboardPeriodPreset[] = [
  { label: '今天', days: 1 },
  { label: '本周', calendar: 'week' },
  { label: '本月', calendar: 'month' },
  { label: '近 7 天', days: 7 },
  { label: '近 30 天', days: 30 },
  { label: '近 90 天', days: 90 },
  { label: '近半年', days: 180 },
  { label: '近 1 年', days: 365 }
]

/** 按页面上限过滤后的快捷周期（顺序与文案统一）。 */
export function dashboardPeriodPresets(maxDays: number): DashboardPeriodPreset[] {
  return DASHBOARD_PERIOD_PRESETS.filter((preset) => {
    if (typeof preset.days === 'number') return preset.days <= maxDays
    if (preset.calendar === 'month') return maxDays >= 31
    if (preset.calendar === 'week') return maxDays >= 7
    return false
  })
}

/** 计算某个快捷周期对应的起止日期（用于组件内判断当前高亮项）。 */
export function dashboardPresetRange(
  preset: DashboardPeriodPreset,
  today: string
): { start: string, end: string } {
  if (typeof preset.days === 'number') {
    return {
      start: preset.days <= 1 ? today : addDays(today, -(preset.days - 1)),
      end: today
    }
  }
  if (preset.calendar === 'week') return { start: startOfWeekKey(today), end: today }
  return { start: startOfMonthKey(today), end: today }
}

/**
 * 数据驾驶舱的统计区间状态（四个看板页面共用）。
 *
 * 默认区间按页面口径给定（总览「今天」、二级页「近 7 天」），
 * 上限校验与服务端一致（超限时前端先提示，服务端仍会独立校验）。
 * 预设规则：只有在该页上限内放得下的粒度才在页面上提供（自然月按 31 天判断能否放下）。
 */
export function useDashboardRange(options: { defaultDays: number, maxDays: number }) {
  const today = shanghaiDateKey(new Date())
  const start = ref(options.defaultDays > 0 ? addDays(today, -(options.defaultDays - 1)) : today)
  const end = ref(today)
  /** 环比对照方式：随预设切换（滚动窗口 = 上一等长区间，自然周/月 = 上一自然周/月）。 */
  const compare = ref<DashboardCompareKind>('rolling')

  const rangeDays = computed(() => {
    if (!parseDateKey(start.value) || !parseDateKey(end.value) || start.value > end.value) return 0
    return daysBetween(start.value, end.value)
  })

  const rangeError = computed(() => {
    if (!parseDateKey(start.value) || !parseDateKey(end.value)) return '日期格式应为 YYYY-MM-DD'
    if (start.value > end.value) return '开始日期不能晚于结束日期'
    if (rangeDays.value > options.maxDays) return `统计区间最长 ${options.maxDays} 天`
    return null
  })

  const period = computed<DashboardPeriod>(() => ({ start: start.value, end: end.value }))
  /** 快捷区间：按「含今天在内的最近 N 天」计算（滚动窗口，环比对照上一等长区间）。 */
  const applyDays = (days: number) => {
    compare.value = 'rolling'
    end.value = today
    start.value = days <= 1 ? today : addDays(today, -(days - 1))
  }

  /** 自然周（本周一至今）/ 自然月（本月 1 日至今）：环比对照相应改为上一自然周 / 上一自然月。 */
  const applyCalendar = (kind: 'week' | 'month') => {
    compare.value = kind
    end.value = today
    start.value = kind === 'week' ? startOfWeekKey(today) : startOfMonthKey(today)
  }

  const applyPreset = (preset: DashboardPeriodPreset) => {
    if (preset.calendar) applyCalendar(preset.calendar)
    else if (typeof preset.days === 'number') applyDays(preset.days)
  }

  return { today, start, end, compare, period, rangeDays, rangeError, applyDays, applyCalendar, applyPreset }
}

/** 去掉空值，避免把空字符串或空数组当筛选参数发给服务端；数字统一转字符串。 */
export function compactDashboardQuery(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (value.length) out[key] = value.join(',')
      continue
    }
    out[key] = String(value)
  }
  return out
}

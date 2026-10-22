<script setup lang="ts">
/**
 * 数据驾驶舱 · AI 问答分析（默认近 7 天，固定窗口最长 30 天；「本月」按自然月最多 31 天）。
 *
 * 统计本校教师的提问分布：趋势、6 分类分布、关键词 Top 榜、推荐量表作答转化，
 * 以及按「表头维度」勾选聚合的明细表（不展示提问原文；全不勾时只出周期总计一行）。
 * 能力与数据范围都由服务端决定，页面只负责展示与筛选。
 */
import {
  AI_QUESTION_TABLE_DIMENSION_LABELS,
  DASHBOARD_MORAL_LINE,
  DASHBOARD_PERIOD_LIMITS,
  DASHBOARD_TABLE_DIMENSIONS,
  DASHBOARD_TABLE_DIMS_NONE,
  QUESTION_CATEGORY_VALUES,
  dashboardKpiDelta,
  type AiQuestionKpis,
  type AiQuestionsResponse,
  type DashboardKpiUpTone,
  type DashboardTableDimension
} from '#shared/dashboard'
import { dashboardPeriodPresets, type DashboardPeriodPreset } from '~/composables/useDashboardRange'

const { start, end, period, rangeError, compare, applyPreset } = useDashboardRange({
  defaultDays: 7,
  maxDays: DASHBOARD_PERIOD_LIMITS.aiQuestions
})
const { context } = await useDashboardPageAccess('dashboard_ai_questions')
/** 全局下钻（学校 › 年级 › 班级）：状态在 URL 查询里，四个页面共用。 */
const { grade, classIds } = useDashboardFilters()

const categories = ref<string[]>([])
/** 表头维度勾选：勾选的维度进入服务端聚合与表头；全不勾时只出一行周期总计。 */
const dims = ref<DashboardTableDimension[]>([...DASHBOARD_TABLE_DIMENSIONS])
const page = ref(1)
const pageSize = ref(20)
const sort = ref('date')
const order = ref<'asc' | 'desc'>('desc')

const params = computed(() => compactDashboardQuery({
  start: start.value,
  end: end.value,
  compare: compare.value,
  grade: grade.value === '' ? undefined : grade.value,
  classIds: classIds.value,
  categories: categories.value,
  // 全不勾时用固定关键词表达（空数组会被查询串压缩掉）
  dims: dims.value.length ? dims.value.join(',') : DASHBOARD_TABLE_DIMS_NONE,
  page: page.value,
  pageSize: pageSize.value,
  sort: sort.value,
  order: order.value
}))

const { data, pending, error } = await useFetch<AiQuestionsResponse>('/api/v1/dashboard/ai-questions', {
  query: params,
  watch: [params]
})

/** 班级选项：本校班级按年级分组；选了年级时只留该年级。 */
const classOptions = computed(() => (context.value?.classes ?? [])
  .filter(item => grade.value === '' || item.grade === grade.value)
  .map(item => ({ value: item.id, label: item.name, group: item.gradeLabel })))

/** 分类筛选项：德育口径下只列德育线白名单里的分类（选其他分类必然为空，不展示）。 */
const categoryOptions = computed(() => {
  const values = context.value?.line === 'moral'
    ? QUESTION_CATEGORY_VALUES.filter(category => (DASHBOARD_MORAL_LINE.questionCategories as readonly string[]).includes(category))
    : QUESTION_CATEGORY_VALUES
  return values.map(category => ({ value: category, label: category }))
})

watch(categories, () => { page.value = 1 })
watch([start, end], () => { page.value = 1 })
watch(classIds, () => { page.value = 1 })
watch(grade, () => { page.value = 1 })
// 维度勾选变化会改变服务端的聚合与总行数，回到第一页避免停留在空页
watch(dims, () => { page.value = 1 })

const kpis = computed(() => data.value?.kpis ?? null)
const previousKpis = computed(() => data.value?.previousKpis ?? null)
const previousPeriod = computed(() => data.value?.previousPeriod ?? null)
const presets: DashboardPeriodPreset[] = dashboardPeriodPresets(DASHBOARD_PERIOD_LIMITS.aiQuestions)

// ===== KPI 卡（原型「AI 问答分析」四张 + PRD 6.1 的活跃教师数 / 人均提问 / 平均会话轮次）=====
// 推荐率与作答率不单独占卡，作为对应计数卡的 hint 展示，避免同一比率出现两遍。
interface KpiCard {
  key: keyof AiQuestionKpis
  label: string
  unit: string
  kind: 'count' | 'rate'
  upTone: DashboardKpiUpTone
  hint: string
}

const KPI_CARDS: KpiCard[] = [
  { key: 'aiQuestions', label: '问答总数', unit: '条', kind: 'count', upTone: 'neutral', hint: '周期内教师提问条数（不含已删除）' },
  { key: 'activeTeachers', label: '活跃教师数', unit: '人', kind: 'count', upTone: 'neutral', hint: '周期内有提问的去重教师' },
  { key: 'questionsPerTeacher', label: '人均提问', unit: '条', kind: 'count', upTone: 'neutral', hint: '提问条数 / 活跃教师数' },
  { key: 'turnsPerSession', label: '平均会话轮次', unit: '次', kind: 'count', upTone: 'neutral', hint: '提问条数 / 有提问的会话数' },
  { key: 'recommended', label: '量表推荐次数', unit: '次', kind: 'count', upTone: 'neutral', hint: 'AI 主动推荐量表' },
  { key: 'answered', label: '推荐后完成作答', unit: '次', kind: 'count', upTone: 'better', hint: '推荐后完成作答' },
  { key: 'highRiskQuestions', label: '高风险对话数', unit: '条', kind: 'count', upTone: 'worse', hint: '命中安全关注规则的提问' }
]

const rateText = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value}%`)

/** 推荐率 / 作答率随周期变化的卡片用动态 hint。 */
function hintOf(card: KpiCard) {
  if (card.key === 'recommended') return `推荐率 ${rateText(kpis.value?.recommendationRate)}（推荐 ÷ 提问）`
  if (card.key === 'answered') return `作答率 ${rateText(kpis.value?.answeredRate)}（作答 ÷ 推荐）`
  return card.hint
}

/** 环比：差值口径与文案由 shared/dashboard.ts 的 dashboardKpiDelta 统一给出。 */
function deltaOf(card: KpiCard) {
  return dashboardKpiDelta({
    kind: card.kind,
    upTone: card.upTone,
    current: kpis.value?.[card.key] ?? null,
    previous: previousKpis.value?.[card.key] ?? null
  })
}

interface TableColumn {
  key: string
  label: string
  sortKey?: string
  align?: 'right'
}

/** 维度列：只有勾选的维度才出现在表头（与服务端 group by 一一对应）。 */
const DIMENSION_COLUMNS: Record<DashboardTableDimension, TableColumn> = {
  grade: { key: 'gradeLabel', label: AI_QUESTION_TABLE_DIMENSION_LABELS.grade, sortKey: 'grade' },
  className: { key: 'className', label: AI_QUESTION_TABLE_DIMENSION_LABELS.className, sortKey: 'className' },
  category: { key: 'category', label: AI_QUESTION_TABLE_DIMENSION_LABELS.category, sortKey: 'category' },
  date: { key: 'date', label: AI_QUESTION_TABLE_DIMENSION_LABELS.date, sortKey: 'date' }
}

/** 固定指标列（原型：问答总数为固定列，不参与勾选）。 */
const METRIC_COLUMNS: TableColumn[] = [
  { key: 'count', label: '提问数', sortKey: 'count', align: 'right' },
  { key: 'highRiskLabel', label: '含安全关注', sortKey: 'highRisk', align: 'right' }
]

/** 全不勾时只展示时间周期列（原型：未勾选维度 → 仅展示时间周期与问答总数列）。 */
const RANGE_COLUMN: TableColumn = { key: 'dateRange', label: AI_QUESTION_TABLE_DIMENSION_LABELS.date }

const columns = computed<TableColumn[]>(() => [
  ...(dims.value.length ? dims.value.map(dimension => DIMENSION_COLUMNS[dimension]) : [RANGE_COLUMN]),
  ...METRIC_COLUMNS
])

const tableTitle = computed(() => (dims.value.length
  ? `明细（按${dims.value.map(dimension => AI_QUESTION_TABLE_DIMENSION_LABELS[dimension]).join(' + ')}聚合）`
  : '明细（周期总计）'))

const rows = computed(() => (data.value?.table.rows ?? []).map(row => ({
  ...row,
  highRiskLabel: row.highRisk ? '是' : '否',
  dateRange: `${period.value.start} ~ ${period.value.end}`
})))

function toggleSort(column: TableColumn) {
  if (!column.sortKey) return
  if (sort.value === column.sortKey) {
    order.value = order.value === 'desc' ? 'asc' : 'desc'
  } else {
    sort.value = column.sortKey
    order.value = 'desc'
  }
  page.value = 1
}

const cellValue = (row: Record<string, unknown>, key: string) => {
  const value = row[key]
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

function exportCsv() {
  const query = new URLSearchParams(compactDashboardQuery({
    type: 'ai-questions',
    start: start.value,
    end: end.value,
    compare: compare.value,
    grade: grade.value === '' ? undefined : grade.value,
    classIds: classIds.value,
    categories: categories.value,
    dims: dims.value.length ? dims.value.join(',') : DASHBOARD_TABLE_DIMS_NONE
  }))
  window.open(`/api/v1/dashboard/export?${query.toString()}`, '_blank')
}

const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.table.total ?? 0) / pageSize.value)))
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-5 px-5 py-8">
    <header class="space-y-1">
      <h1 class="text-xl font-semibold text-slate-800">AI 问答分析</h1>
      <p class="text-sm text-slate-500">
        教师提问的分布与推荐量表作答转化
        <DashboardScopeSummary :context="context" />
      </p>
    </header>

    <DashboardNav />

    <section class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <DashboardPeriodPicker
        v-model:start="start"
        v-model:end="end"
        :presets="presets"
        :range-error="rangeError"
        @preset="applyPreset"
      />
      <div class="flex flex-wrap items-end gap-4">
        <label class="flex flex-col gap-1">
          <span class="text-xs text-slate-500">年级</span>
          <select
            v-model="grade"
            class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none"
          >
            <option value="">全部年级</option>
            <option v-for="item in context?.grades ?? []" :key="item.grade" :value="item.grade">{{ item.label }}</option>
          </select>
        </label>
        <DashboardMultiSelect v-model="classIds" label="班级（多选）" :options="classOptions" />
        <DashboardMultiSelect v-model="categories" label="提问分类（多选）" :options="categoryOptions" />
        <p class="pb-1 text-xs text-slate-400">
          统计口径：{{ period.start }} ~ {{ period.end }}
          <template v-if="previousPeriod">
            <span class="mx-1 text-slate-300">|</span>
            环比对照：{{ previousPeriod.start }} ~ {{ previousPeriod.end }}
          </template>
        </p>
      </div>
    </section>

    <div v-if="error" class="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
      {{ (error.data as { message?: string } | undefined)?.message || '数据加载失败，请稍后重试' }}
    </div>

    <template v-else>
      <section class="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <DashboardStatCard
          v-for="card in KPI_CARDS"
          :key="card.key"
          :label="card.label"
          :value="kpis?.[card.key] ?? null"
          :unit="card.unit"
          :hint="hintOf(card)"
          :delta="deltaOf(card)"
        />
      </section>

      <section class="grid gap-3 lg:grid-cols-2">
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">每日提问趋势</h2>
          <DashboardLineChart :labels="(data?.byDay ?? []).map(item => item.date)" :series="[{ name: '提问条数', values: (data?.byDay ?? []).map(item => item.count) }]" />
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">提问分类分布</h2>
          <DashboardDonutChart :segments="(data?.byCategory ?? []).map(item => ({ label: item.category, value: item.count }))" center-label="提问总数" />
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">关键词 Top 榜</h2>
          <DashboardRankTable :rows="(data?.topKeywords ?? []).map(item => ({ label: item.keyword, value: item.count }))" value-label="条" />
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">推荐量表作答转化</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th class="py-1.5 pr-2 font-normal">分类</th>
                  <th class="py-1.5 pr-2 text-right font-normal">提问</th>
                  <th class="py-1.5 pr-2 text-right font-normal">推荐</th>
                  <th class="py-1.5 pr-2 text-right font-normal">推荐率</th>
                  <th class="py-1.5 pr-2 text-right font-normal">作答</th>
                  <th class="py-1.5 text-right font-normal">作答率</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in data?.recommendation ?? []" :key="row.category" class="border-b border-slate-50 last:border-0">
                  <td class="py-1.5 pr-2 text-slate-700">{{ row.category }}</td>
                  <td class="py-1.5 pr-2 text-right text-slate-600">{{ row.aiQuestions }}</td>
                  <td class="py-1.5 pr-2 text-right text-slate-600">{{ row.recommended }}</td>
                  <td class="py-1.5 pr-2 text-right text-slate-600">{{ row.recommendRate ?? '—' }}<span v-if="row.recommendRate !== null" class="text-xs text-slate-400">%</span></td>
                  <td class="py-1.5 pr-2 text-right text-slate-600">{{ row.answered }}</td>
                  <td class="py-1.5 text-right text-slate-600">{{ row.answerRate ?? '—' }}<span v-if="row.answerRate !== null" class="text-xs text-slate-400">%</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="mt-2 text-[11px] text-slate-400">推荐量来自埋点，仅统计上线后的数据；更早的提问没有推荐记录。</p>
        </div>
      </section>

      <section class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-medium text-slate-700">{{ tableTitle }}</h2>
          <div class="flex items-center gap-2">
            <details class="relative">
              <summary class="cursor-pointer list-none rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">表头维度</summary>
              <div class="absolute right-0 z-20 mt-1 w-48 space-y-1.5 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                <label v-for="dimension in DASHBOARD_TABLE_DIMENSIONS" :key="dimension" class="flex items-center gap-2 text-sm text-slate-600">
                  <input v-model="dims" type="checkbox" :value="dimension" class="size-3.5 rounded border-slate-300">
                  {{ AI_QUESTION_TABLE_DIMENSION_LABELS[dimension] }}
                </label>
                <p class="text-[11px] leading-4 text-slate-400">提问数为固定列，不参与勾选；全部不勾时只出周期总计一行。</p>
              </div>
            </details>
            <button
              type="button"
              class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100"
              @click="exportCsv"
            >
              导出 CSV
            </button>
          </div>
        </div>

        <p v-if="!dims.length" class="text-[11px] text-slate-400">
          表头维度未勾选 → 仅展示时间周期与提问总数列（{{ period.start }} ~ {{ period.end }}）
        </p>

        <div class="overflow-x-auto">
          <table class="w-full min-w-[640px] text-sm">
            <thead>
              <tr class="border-b border-slate-100 text-left text-xs text-slate-500">
                <th
                  v-for="column in columns"
                  :key="column.key"
                  class="py-2 pr-3 font-normal select-none"
                  :class="[column.align === 'right' ? 'text-right' : '', column.sortKey ? 'cursor-pointer hover:text-slate-700' : '']"
                  @click="toggleSort(column)"
                >
                  {{ column.label }}
                  <span v-if="sort === column.sortKey" class="text-emerald-600">{{ order === 'desc' ? '↓' : '↑' }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id" class="border-b border-slate-50 last:border-0">
                <td
                  v-for="column in columns"
                  :key="column.key"
                  class="py-2 pr-3 text-slate-600"
                  :class="column.align === 'right' ? 'text-right' : ''"
                >
                  {{ cellValue(row, column.key) }}
                </td>
              </tr>
              <tr v-if="!rows.length">
                <td :colspan="columns.length" class="py-8 text-center text-sm text-slate-400">所选条件暂无数据</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>共 {{ data?.table.total ?? 0 }} 行，第 {{ page }} / {{ totalPages }} 页<span v-if="pending" class="ml-2 text-slate-400">加载中…</span></span>
          <div class="flex items-center gap-2">
            <select v-model="pageSize" class="rounded-lg border border-slate-200 px-2 py-1 text-xs">
              <option :value="20">20 条/页</option>
              <option :value="50">50 条/页</option>
              <option :value="100">100 条/页</option>
            </select>
            <button type="button" class="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40" :disabled="page <= 1" @click="page -= 1">上一页</button>
            <button type="button" class="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40" :disabled="page >= totalPages" @click="page += 1">下一页</button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

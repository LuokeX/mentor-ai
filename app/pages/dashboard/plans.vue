<script setup lang="ts">
/**
 * 数据驾驶舱 · 量表与方案分析（默认近 7 天，最长 90 天）。
 *
 * 口径：完成度 = 已完成执行项 / 方案总执行项数（PRD 9）；回填率 = 有回填执行项 / 已确认纳入执行项；
 * 风险等级取方案报告的四级 low/medium/high/crisis（PRD 的「健康」并入低风险）；
 * 量表作答数取 assessment_attempts 中已提交的作答，按提交时间落自然日；
 * 明细表的分类列是「量表分类」（提问 6 分类口径，家校沟通并入自我成长赋能），
 * 聚合维度由页面的「表头维度」勾选决定，全不勾时只出周期总计一行。
 */
import {
  DASHBOARD_MORAL_LINE,
  DASHBOARD_PERIOD_LIMITS,
  DASHBOARD_TABLE_DIMENSIONS,
  DASHBOARD_TABLE_DIMS_NONE,
  MODULE_TO_QUESTION_CATEGORY,
  PLAN_QUESTION_CATEGORIES,
  PLAN_TABLE_DIMENSION_LABELS,
  dashboardKpiDelta,
  type DashboardKpiUpTone,
  type DashboardTableDimension,
  type PlanKpis,
  type PlansResponse
} from '#shared/dashboard'
import { dashboardPeriodPresets, type DashboardPeriodPreset } from '~/composables/useDashboardRange'

const { start, end, period, rangeError, compare, applyPreset } = useDashboardRange({
  defaultDays: 7,
  maxDays: DASHBOARD_PERIOD_LIMITS.plans
})
const { context } = await useDashboardPageAccess('dashboard_plans')
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

const { data, pending, error } = await useFetch<PlansResponse>('/api/v1/dashboard/plans', {
  query: params,
  watch: [params]
})

/** 班级选项：本校班级按年级分组；选了年级时只留该年级。 */
const classOptions = computed(() => (context.value?.classes ?? [])
  .filter(item => grade.value === '' || item.grade === grade.value)
  .map(item => ({ value: item.id, label: item.name, group: item.gradeLabel })))

/**
 * 分类筛选项：与「量表分类占比」图同一口径——全量口径下是 5 大类（不含德育类问题，
 * 它没有方案模块命中、选了必然为空）；德育口径下只列德育线模块折算出的分类。
 * 口径与 server/domain/dashboard-metrics.ts 的 moralModuleCondition 一致。
 */
const categoryOptions = computed(() => {
  const moralCategories = new Set(DASHBOARD_MORAL_LINE.modules.map(module => MODULE_TO_QUESTION_CATEGORY[module as keyof typeof MODULE_TO_QUESTION_CATEGORY]))
  const values = context.value?.line === 'moral'
    ? PLAN_QUESTION_CATEGORIES.filter(category => moralCategories.has(category))
    : PLAN_QUESTION_CATEGORIES
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
const presets: DashboardPeriodPreset[] = dashboardPeriodPresets(DASHBOARD_PERIOD_LIMITS.plans)

// ===== KPI 卡（原型「量表与方案分析」四张 + 回填率 + PRD 6.1 的接受率 / 提醒触达率，共七张）=====
interface KpiCard {
  key: keyof PlanKpis
  label: string
  unit: string
  kind: 'count' | 'rate'
  upTone: DashboardKpiUpTone
  hint: string
}

const KPI_CARDS: KpiCard[] = [
  { key: 'assessmentTotal', label: '作答总次数', unit: '次', kind: 'count', upTone: 'neutral', hint: '周期内提交的量表作答' },
  { key: 'planTotal', label: '总体方案量', unit: '个', kind: 'count', upTone: 'neutral', hint: '周期内新建方案数' },
  { key: 'acceptanceRate', label: '方案接受率', unit: '%', kind: 'rate', upTone: 'better', hint: '已接受方案 / 方案总数' },
  { key: 'planCompletionRate', label: '方案完成度', unit: '%', kind: 'rate', upTone: 'better', hint: '已完成执行项 / 方案总执行项数' },
  { key: 'executionRate', label: '方案执行回填率', unit: '%', kind: 'rate', upTone: 'better', hint: '有回填执行项 / 已确认纳入' },
  { key: 'reminderReadRate', label: '提醒触达率', unit: '%', kind: 'rate', upTone: 'better', hint: '站内通知已读 / 通知总数（不含短信与外呼送达）' },
  { key: 'highRiskPlans', label: '高风险方案数', unit: '个', kind: 'count', upTone: 'worse', hint: '风险等级为高 / 安全关注的方案' }
]

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
  grade: { key: 'gradeLabel', label: PLAN_TABLE_DIMENSION_LABELS.grade, sortKey: 'grade' },
  className: { key: 'className', label: PLAN_TABLE_DIMENSION_LABELS.className, sortKey: 'className' },
  category: { key: 'category', label: PLAN_TABLE_DIMENSION_LABELS.category, sortKey: 'category' },
  date: { key: 'date', label: PLAN_TABLE_DIMENSION_LABELS.date, sortKey: 'date' }
}

/** 固定指标列（原型：指标列为固定列，点击表头可排序）。 */
const METRIC_COLUMNS: TableColumn[] = [
  { key: 'planTotal', label: '方案数', sortKey: 'planTotal', align: 'right' },
  { key: 'completionRateLabel', label: '完成度', sortKey: 'completionRate', align: 'right' },
  { key: 'executionRateLabel', label: '回填率', sortKey: 'executionRate', align: 'right' },
  { key: 'high', label: '高风险', sortKey: 'high', align: 'right' },
  { key: 'medium', label: '中风险', sortKey: 'medium', align: 'right' },
  { key: 'low', label: '低风险', sortKey: 'low', align: 'right' }
]

/** 全不勾时只展示时间周期列（原型：未勾选维度 → 仅展示时间周期与总数列）。 */
const RANGE_COLUMN: TableColumn = { key: 'dateRange', label: PLAN_TABLE_DIMENSION_LABELS.date }

const columns = computed<TableColumn[]>(() => [
  ...(dims.value.length ? dims.value.map(dimension => DIMENSION_COLUMNS[dimension]) : [RANGE_COLUMN]),
  ...METRIC_COLUMNS
])

const tableTitle = computed(() => (dims.value.length
  ? `明细（按${dims.value.map(dimension => PLAN_TABLE_DIMENSION_LABELS[dimension]).join(' + ')}聚合）`
  : '明细（周期总计）'))

const rows = computed(() => (data.value?.table.rows ?? []).map(row => ({
  ...row,
  completionRateLabel: row.completionRate === null ? '—' : `${row.completionRate}%`,
  executionRateLabel: row.executionRate === null ? '—' : `${row.executionRate}%`,
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
    type: 'plans',
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
      <h1 class="text-xl font-semibold text-slate-800">量表与方案分析</h1>
      <p class="text-sm text-slate-500">
        方案数量、执行进度与风险等级
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
        <DashboardMultiSelect v-model="categories" label="量表分类（多选）" :options="categoryOptions" />
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
          :hint="card.hint"
          :delta="deltaOf(card)"
        />
      </section>

      <section class="grid gap-3 lg:grid-cols-2">
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">量表作答分日图</h2>
          <DashboardLineChart
            :labels="(data?.byDay ?? []).map(item => item.date)"
            :series="[{ name: '量表作答', values: (data?.byDay ?? []).map(item => item.assessmentCount) }]"
          />
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">每日新建方案</h2>
          <DashboardGroupBarChart :labels="(data?.byDay ?? []).map(item => item.date)" :series="[{ name: '方案数', values: (data?.byDay ?? []).map(item => item.planTotal) }]" />
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">每日完成度与回填率</h2>
          <DashboardLineChart
            :labels="(data?.byDay ?? []).map(item => item.date)"
            :series="[
              { name: '完成度', values: (data?.byDay ?? []).map(item => item.completionRate ?? 0) },
              { name: '回填率', values: (data?.byDay ?? []).map(item => item.executionRate ?? 0) }
            ]"
            suffix="%"
          />
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">量表分类占比</h2>
          <DashboardDonutChart
            :segments="(data?.byQuestionCategory ?? []).map(item => ({ label: item.category, value: item.count }))"
            center-label="方案总数"
          />
          <p class="mt-2 text-[11px] text-slate-400">按 5 大类口径（与明细表的「量表分类」列一致），家校沟通并入自我成长赋能。</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">学生心理风险分布</h2>
          <DashboardDonutChart
            :segments="(data?.studentRiskDistribution ?? []).map(item => ({ label: item.label, value: item.count }))"
            center-label="学生数"
          />
          <p class="mt-2 text-[11px] text-slate-400">
            按人数：只统计周期内绑定了具体学生的量表（班级 / 自我成长类评估没有学生对象，不在内），每人取最近一次提交的等级折算。
          </p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">问题风险等级分布</h2>
          <DashboardDonutChart
            :segments="(data?.riskDistribution ?? []).map(item => ({ label: item.label, value: item.count }))"
            center-label="方案总数"
          />
          <p class="mt-2 text-[11px] leading-4 text-slate-400">
            与明细表的高 / 中 / 低风险列同源：安全关注并入高风险；原型四档里的「健康」在现行方案报告口径里没有独立取值，并入低风险。
          </p>
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
                  {{ PLAN_TABLE_DIMENSION_LABELS[dimension] }}
                </label>
                <p class="text-[11px] leading-4 text-slate-400">方案数与风险分级为固定列，不参与勾选；全部不勾时只出周期总计一行。</p>
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
          表头维度未勾选 → 仅展示时间周期与方案总数列（{{ period.start }} ~ {{ period.end }}）
        </p>

        <div class="overflow-x-auto">
          <table class="w-full min-w-[720px] text-sm">
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

        <p class="text-[11px] leading-4 text-slate-400">
          🔒 明细只展示方案结构化字段与风险分级，不含学生个体测评原始作答；导出文件自动加水印（操作人 · 时间 · 数据范围）并写入审计日志。
        </p>
      </section>
    </template>
  </div>
</template>

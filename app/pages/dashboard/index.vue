<script setup lang="ts">
/**
 * 数据驾驶舱 · 数据总览（默认「今天」，固定窗口最长 30 天；「本月」按自然月最多 31 天）。
 *
 * 只读聚合视图：KPI 卡 + 每日趋势；明细与筛选在三个二级页面。
 * 看板范围（本校全部班级，或账号显式配置的学部）由服务端 /api/v1/dashboard/context 给出，页面不自行推断。
 */
import {
  DASHBOARD_COMPARISON_METRIC_LABELS,
  DASHBOARD_COMPARISON_METRICS,
  DASHBOARD_PERIOD_LIMITS,
  dashboardKpiDelta,
  type DashboardComparisonMetric,
  type DashboardComparisonResponse,
  type DashboardKpiUpTone,
  type OverviewKpis,
  type OverviewResponse
} from '#shared/dashboard'
import { dashboardPeriodPresets, type DashboardPeriodPreset } from '~/composables/useDashboardRange'

const { start, end, period, rangeError, compare, applyPreset } = useDashboardRange({
  defaultDays: 0,
  maxDays: DASHBOARD_PERIOD_LIMITS.overview
})

const { context } = await useDashboardPageAccess('dashboard')
/** 全局下钻（学校 › 年级 › 班级）：状态在 URL 查询里，与二级页共用。 */
const { grade, classIds } = useDashboardFilters()

const params = computed(() => compactDashboardQuery({
  start: start.value,
  end: end.value,
  compare: compare.value,
  grade: grade.value === '' ? undefined : grade.value,
  classIds: classIds.value
}))
const { data, pending, error } = await useFetch<OverviewResponse>('/api/v1/dashboard/overview', {
  query: params,
  watch: [params]
})

const presets: DashboardPeriodPreset[] = dashboardPeriodPresets(DASHBOARD_PERIOD_LIMITS.overview)

const kpis = computed(() => data.value?.kpis ?? null)
const previousKpis = computed(() => data.value?.previousKpis ?? null)
const previousPeriod = computed(() => data.value?.previousPeriod ?? null)
const trend = computed(() => data.value?.trend ?? { dates: [], aiQuestions: [], planTotal: [] })

// ===== W1 概况概览（PRD 5.1 / 原型 W1，含推荐量表作答率）=====
interface KpiCard {
  key: keyof OverviewKpis
  label: string
  unit: string
  hint: string
  /** count = 计数（环比看相对变化）；rate = 比率（环比看百分点差） */
  kind: 'count' | 'rate'
  /** 数值上升代表什么：better 好事（绿）/ worse 需关注（红）/ neutral 中性（灰） */
  upTone: DashboardKpiUpTone
}

const KPI_CARDS: KpiCard[] = [
  { key: 'aiQuestions', label: 'AI 问答次数', unit: '条', kind: 'count', upTone: 'neutral', hint: '周期内教师提问条数（不含已删除）' },
  { key: 'recommendationAnswerRate', label: '推荐量表作答率', unit: '%', kind: 'rate', upTone: 'better', hint: '推荐后完成作答 / 推荐次数，埋点上线后才有数据' },
  { key: 'planTotal', label: '总体方案量', unit: '个', kind: 'count', upTone: 'neutral', hint: '周期内新建方案数' },
  { key: 'planCompletionRate', label: '方案完成度', unit: '%', kind: 'rate', upTone: 'better', hint: '已完成执行项 / 方案总执行项数' },
  { key: 'planTimelyRate', label: '方案执行及时率', unit: '%', kind: 'rate', upTone: 'better', hint: '按期完成或尚未到期 / 已确认纳入' },
  { key: 'highRiskOpen', label: '高危未闭环', unit: '项', kind: 'count', upTone: 'worse', hint: '未关闭安全事件 + 高/严重学生事件' }
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

// ===== W2 / W3 / W4-1 / W4-2 / W5 聚合卡 =====
// 服务端只下发当前账号可访问的看板页对应的分组（二级页被平台后台取消后，聚合卡与导航、
// 入口卡一起收敛）；这里按分组是否下发决定卡片是否渲染，口径与对应二级页一致。
const aiAnalysis = computed(() => data.value?.analysis?.aiQuestions ?? null)
const plansAnalysis = computed(() => data.value?.analysis?.plans ?? null)
const studentEventsAnalysis = computed(() => data.value?.analysis?.studentEvents ?? null)
const communicationAnalysis = computed(() => data.value?.analysis?.communication ?? null)
const alertsAnalysis = computed(() => data.value?.analysis?.alerts ?? null)

/** 导出当前区间的 KPI（本期 + 上期）为 CSV，导出内容带水印并写审计。 */
function exportOverview() {
  const query = new URLSearchParams(compactDashboardQuery({ type: 'overview', start: start.value, end: end.value }))
  window.open(`/api/v1/dashboard/export?${query.toString()}`, '_blank')
}

const allEntries = [
  { key: 'dashboard_ai_questions', to: '/dashboard/ai-questions', title: 'AI 问答分析', desc: '提问趋势、6 分类分布、关键词与推荐量表作答转化' },
  { key: 'dashboard_plans', to: '/dashboard/plans', title: '量表与方案', desc: '方案数量、执行完成度与回填率、风险等级分布' },
  { key: 'dashboard_alerts', to: '/dashboard/alerts', title: '预警看板', desc: '安全事项与学生事件（学生列脱敏），只看待解决' }
] as const

/** 只展示当前账号可见页面的入口卡片（平台后台可逐页取消）。 */
const entries = computed(() => {
  const pages = context.value?.pages
  if (!pages?.length) return allEntries
  return allEntries.filter(entry => pages.includes(entry.key))
})

// ===== 年级 / 班级对比（PRD W8）=====
// 默认按年级聚合，点击年级行下钻到该年级的班级对比（下钻即写全局筛选，四个页面同步生效）；
// 四个指标都返回，排序指标由表头切换（排序在服务端完成，前端不重排）。
const comparisonMetric = ref<DashboardComparisonMetric>('aiQuestions')
const comparisonOrder = ref<'asc' | 'desc'>('desc')

const comparisonParams = computed(() => compactDashboardQuery({
  start: start.value,
  end: end.value,
  grade: grade.value === '' ? undefined : grade.value,
  classIds: classIds.value,
  metric: comparisonMetric.value,
  order: comparisonOrder.value
}))
const { data: comparison, pending: comparisonPending } = await useFetch<DashboardComparisonResponse>('/api/v1/dashboard/comparison', {
  query: comparisonParams,
  watch: [comparisonParams]
})

const comparisonRows = computed(() => comparison.value?.rows ?? [])
/** 分组柱状图只画三个计数指标：及时率是比率，入图会与计数混用量纲。 */
const comparisonSeries = computed(() => [
  { name: DASHBOARD_COMPARISON_METRIC_LABELS.aiQuestions, values: comparisonRows.value.map(item => item.aiQuestions) },
  { name: DASHBOARD_COMPARISON_METRIC_LABELS.plans, values: comparisonRows.value.map(item => item.plans) },
  { name: DASHBOARD_COMPARISON_METRIC_LABELS.highRiskOpen, values: comparisonRows.value.map(item => item.highRiskOpen) }
])
const drilldownLabel = computed(() => {
  const value = comparison.value?.drilldownGrade
  if (!value) return ''
  return context.value?.grades.find(item => item.grade === value)?.label ?? `${value} 年级`
})

/** 表头点击：同一指标切换升降序，不同指标切到该指标并从高到低。 */
function toggleComparisonOrder(metric: DashboardComparisonMetric) {
  if (comparisonMetric.value === metric) {
    comparisonOrder.value = comparisonOrder.value === 'desc' ? 'asc' : 'desc'
    return
  }
  comparisonMetric.value = metric
  comparisonOrder.value = 'desc'
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-5 px-5 py-8">
    <header class="space-y-1">
      <h1 class="text-xl font-semibold text-slate-800">数据驾驶舱</h1>
      <p class="text-sm text-slate-500">
        本校数据的只读聚合视图
        <DashboardScopeSummary :context="context" />
      </p>
    </header>

    <DashboardNav />

    <section class="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <DashboardPeriodPicker
        v-model:start="start"
        v-model:end="end"
        :presets="presets"
        :range-error="rangeError"
        @preset="applyPreset"
      />
      <div class="flex flex-col items-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100"
          @click="exportOverview"
        >
          导出 KPI（CSV）
        </button>
        <p class="text-xs text-slate-400">
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
      <section class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
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

      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-medium text-slate-700">每日趋势</h2>
          <span v-if="pending" class="text-xs text-slate-400">加载中…</span>
        </div>
        <DashboardLineChart
          :labels="trend.dates"
          :series="[
            { name: 'AI 提问', values: trend.aiQuestions },
            { name: '新建方案', values: trend.planTotal }
          ]"
          :height="240"
        />
      </section>

      <!-- W2 / W3 / W4-1 / W4-2 / W5 聚合卡：只渲染服务端下发的分组（无权限的二级页不下发） -->
      <section v-if="aiAnalysis || plansAnalysis || studentEventsAnalysis || communicationAnalysis || alertsAnalysis" class="grid gap-3 lg:grid-cols-2">
        <div v-if="aiAnalysis" class="rounded-xl border border-slate-200 bg-white p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="text-sm font-medium text-slate-700">AI 问答分布</h2>
            <NuxtLink to="/dashboard/ai-questions" class="text-xs text-emerald-700 hover:underline">AI 问答分析 →</NuxtLink>
          </div>
          <DashboardDonutChart
            :segments="(aiAnalysis?.byCategory ?? []).map(item => ({ label: item.category, value: item.count }))"
            center-label="提问总数"
          />
          <p class="mt-2 text-[11px] leading-4 text-slate-400">
            <template v-if="aiAnalysis?.topKeywords?.length">
              TOP 问题：{{ (aiAnalysis?.topKeywords ?? []).map(item => item.keyword).join('、') }}
            </template>
            <template v-else>5 大类 + 德育类问题，共 6 类；周期内暂无可聚合的问题关键词。</template>
          </p>
        </div>

        <div v-if="plansAnalysis" class="rounded-xl border border-slate-200 bg-white p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="text-sm font-medium text-slate-700">心理测评与方案执行</h2>
            <NuxtLink to="/dashboard/plans" class="text-xs text-emerald-700 hover:underline">量表与方案 →</NuxtLink>
          </div>
          <DashboardDonutChart
            :segments="(plansAnalysis?.byQuestionCategory ?? []).map(item => ({ label: item.category, value: item.count }))"
            center-label="方案总数"
          />
          <p class="mt-2 text-[11px] leading-4 text-slate-400">按 5 大类分布（不含德育类问题），分类由方案模块折算，与二级页「量表分类占比」同源。</p>
        </div>

        <div v-if="studentEventsAnalysis" class="rounded-xl border border-slate-200 bg-white p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="text-sm font-medium text-slate-700">学生事件记录分析</h2>
            <NuxtLink to="/dashboard/alerts" class="text-xs text-emerald-700 hover:underline">预警看板 →</NuxtLink>
          </div>
          <DashboardDonutChart
            :segments="(studentEventsAnalysis?.byType ?? []).map(item => ({ label: item.eventType, value: item.count }))"
            center-label="事件总量"
          />
          <p class="mt-2 text-[11px] leading-4 text-slate-400">
            事件总量 {{ studentEventsAnalysis?.total ?? 0 }} · 严格按 E1–E6 六大类归集（E4/E5 默认敏感标记）。
          </p>
        </div>

        <div v-if="communicationAnalysis" class="rounded-xl border border-slate-200 bg-white p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="text-sm font-medium text-slate-700">家校事件记录分析</h2>
            <NuxtLink to="/dashboard/alerts" class="text-xs text-emerald-700 hover:underline">预警看板 →</NuxtLink>
          </div>
          <DashboardDonutChart
            :segments="(communicationAnalysis?.channels ?? []).map(item => ({ label: item.label, value: item.count }))"
            center-label="沟通记录"
          />
          <p class="mt-2 text-[11px] leading-4 text-slate-400">
            家校事件总量 {{ communicationAnalysis?.total ?? 0 }} · 按触达渠道占比分布（电话 / 企微 / 面谈 / 家访），不读取沟通正文与摘要。
          </p>
        </div>

        <div v-if="alertsAnalysis" class="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="text-sm font-medium text-slate-700">预警看板</h2>
            <NuxtLink to="/dashboard/alerts" class="text-xs text-emerald-700 hover:underline">查看明细 →</NuxtLink>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <DashboardStatCard
              label="高危未闭环"
              :value="alertsAnalysis?.highRiskOpen ?? 0"
              unit="项"
              hint="安全事项 + 高/严重学生事件 + 高风险家校沟通"
            />
            <DashboardStatCard
              label="方案逾期未闭环"
              :value="alertsAnalysis?.overdueOpen ?? 0"
              unit="项"
              hint="执行项逾期 + 复盘逾期，待回填处置"
            />
          </div>
          <p class="mt-2 text-[11px] leading-4 text-slate-400">
            含心理高风险 / 欺凌侵害等来源，需立即处置并回填方案；明细只到班级维度，学生列脱敏为「学生 A/B/C」。
          </p>
        </div>
      </section>

      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-medium text-slate-700">
            年级 / 班级对比
            <span v-if="drilldownLabel" class="ml-2 text-xs font-normal text-slate-500">{{ drilldownLabel }}各班</span>
            <span v-if="comparisonPending" class="ml-2 text-xs font-normal text-slate-400">加载中…</span>
          </h2>
          <button
            v-if="grade !== ''"
            type="button"
            class="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            @click="grade = ''"
          >
            返回年级对比
          </button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[620px] text-sm">
            <thead>
              <tr class="border-b border-slate-100 text-left text-xs text-slate-500">
                <th class="py-2 pr-3 font-normal">{{ grade === '' ? '年级' : '班级' }}</th>
                <th
                  v-for="metric in DASHBOARD_COMPARISON_METRICS"
                  :key="metric"
                  class="cursor-pointer py-2 pr-3 text-right font-normal select-none hover:text-slate-700"
                  @click="toggleComparisonOrder(metric)"
                >
                  {{ DASHBOARD_COMPARISON_METRIC_LABELS[metric] }}
                  <span v-if="comparisonMetric === metric" class="text-emerald-600">{{ comparisonOrder === 'desc' ? '↓' : '↑' }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in comparisonRows"
                :key="row.key"
                class="border-b border-slate-50 last:border-0"
                :class="row.classId ? '' : 'cursor-pointer hover:bg-slate-50'"
                @click="row.classId || !row.grade ? undefined : grade = row.grade"
              >
                <td class="py-2 pr-3 text-slate-700">
                  {{ row.label }}
                  <span v-if="!row.classId" class="ml-1 text-xs text-slate-400">（{{ row.classCount }} 个班）</span>
                </td>
                <td class="py-2 pr-3 text-right text-slate-600">{{ row.aiQuestions }}</td>
                <td class="py-2 pr-3 text-right text-slate-600">{{ row.plans }}</td>
                <td class="py-2 pr-3 text-right text-slate-600">
                  {{ row.planTimelyRate === null ? '—' : `${row.planTimelyRate}%` }}
                </td>
                <td class="py-2 pr-3 text-right text-slate-600">{{ row.highRiskOpen }}</td>
              </tr>
              <tr v-if="!comparisonRows.length">
                <td colspan="5" class="py-6 text-center text-sm text-slate-400">所选区间暂无对比数据</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="mt-4">
          <DashboardGroupBarChart :labels="comparisonRows.map(item => item.label)" :series="comparisonSeries" />
        </div>
        <p class="mt-2 text-[11px] text-slate-400">
          口径与上方指标一致：提问按记录人主班级归属，方案与高危按记录自带班级；点击年级行下钻到该年级的班级对比。
        </p>
      </section>

      <section class="grid gap-3 md:grid-cols-3">
        <NuxtLink
          v-for="entry in entries"
          :key="entry.to"
          :to="entry.to"
          class="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-emerald-200 hover:bg-emerald-50/40"
        >
          <p class="flex items-center gap-1.5 text-sm font-medium text-slate-800">
            {{ entry.title }}
            <UIcon name="i-lucide-arrow-right" class="size-3.5 text-slate-400" />
          </p>
          <p class="mt-1 text-xs leading-5 text-slate-500">{{ entry.desc }}</p>
        </NuxtLink>
      </section>
    </template>
  </div>
</template>

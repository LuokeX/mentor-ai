<script setup lang="ts">
/**
 * 数据驾驶舱 · 预警看板（默认近 7 天 + 只看待解决 + 只看高风险明细，最长 1 年）。
 *
 * 合并安全事项（对话助手 / 量表提交命中安全规则）与学生事件（E1–E6）。
 * 学生列由服务端脱敏为「学生 A/B/C」（周期内稳定编号）；本页不提供导出，
 * 避免把脱敏前的明细带出看板。
 * 状态与风险等级筛选只作用于明细表，KPI 卡与趋势保持统计范围口径。
 */
import {
  ALERT_DEFAULT_RISK_LEVEL,
  ALERT_RISK_LEVEL_FILTER_LABELS,
  ALERT_RISK_LEVEL_FILTERS,
  DASHBOARD_INDIVIDUAL_TARGET_LABELS,
  DASHBOARD_PERIOD_LIMITS,
  alertRiskLevelTone,
  type AlertRiskLevelFilter,
  type AlertsResponse,
  type AlertSource,
  type DashboardIndividualDetailResponse,
  type DashboardIndividualTargetType
} from '#shared/dashboard'

const { start, end, period, rangeDays, rangeError, applyPreset } = useDashboardRange({
  defaultDays: 7,
  maxDays: DASHBOARD_PERIOD_LIMITS.alerts
})
const { context } = await useDashboardPageAccess('dashboard_alerts')
/** 全局下钻（学校 › 年级 › 班级）：状态在 URL 查询里，四个页面共用。 */
const { grade, classIds } = useDashboardFilters()

const status = ref<'open' | 'resolved' | 'closed' | 'all'>('open')
/** 风险等级筛选：默认只看高风险（含安全关注 / 严重），与 KPI 的高危口径同源。 */
const riskLevel = ref<AlertRiskLevelFilter>(ALERT_DEFAULT_RISK_LEVEL)
/**
 * 来源默认勾选前四类（安全事项 / 学生事件 / 高风险家校沟通），方案逾期两类默认不勾。
 * 注意：全部取消勾选时服务端按「不筛选来源」处理，会显示六类来源。
 */
const sources = ref<AlertSource[]>(['safety_chat', 'safety_assessment', 'student_event', 'communication_risk'])
const page = ref(1)
const pageSize = ref(20)
const sort = ref('occurredAt')
const order = ref<'asc' | 'desc'>('desc')

const params = computed(() => compactDashboardQuery({
  start: start.value,
  end: end.value,
  grade: grade.value === '' ? undefined : grade.value,
  classIds: classIds.value,
  status: status.value,
  sources: sources.value,
  riskLevel: riskLevel.value,
  page: page.value,
  pageSize: pageSize.value,
  sort: sort.value,
  order: order.value
}))

const { data, pending, error } = await useFetch<AlertsResponse>('/api/v1/dashboard/alerts', {
  query: params,
  watch: [params]
})

/** 班级选项：本校班级按年级分组；选了年级时只留该年级。 */
const classOptions = computed(() => (context.value?.classes ?? [])
  .filter(item => grade.value === '' || item.grade === grade.value)
  .map(item => ({ value: item.id, label: item.name, group: item.gradeLabel })))

watch([status, riskLevel, sources], () => { page.value = 1 })
watch([start, end], () => { page.value = 1 })
watch(grade, () => { page.value = 1 })
watch(classIds, () => { page.value = 1 })

const kpis = computed(() => data.value?.kpis ?? null)
const trend = computed(() => data.value?.byDay ?? [])
const communication = computed(() => data.value?.communication ?? null)
const presets: DashboardPeriodPreset[] = [
  { label: '近 7 天', days: 7 },
  { label: '本周', calendar: 'week' },
  { label: '本月', calendar: 'month' },
  { label: '近 30 天', days: 30 },
  { label: '近 90 天', days: 90 },
  { label: '近半年', days: 180 },
  { label: '近 1 年', days: 365 }
]

const SOURCE_OPTIONS: Array<{ value: AlertSource, label: string }> = [
  { value: 'safety_chat', label: '对话助手安全事项' },
  { value: 'safety_assessment', label: '量表提交安全事项' },
  { value: 'student_event', label: '学生事件' },
  { value: 'communication_risk', label: '高风险家校沟通' },
  { value: 'plan_action_overdue', label: '执行项逾期' },
  { value: 'plan_review_overdue', label: '复盘逾期' }
]

interface TableColumn {
  key: string
  label: string
  sortKey?: string
  align?: 'right'
}

const COLUMNS: TableColumn[] = [
  { key: 'type', label: '类型', sortKey: 'type' },
  { key: 'sourceLabel', label: '来源', sortKey: 'source' },
  { key: 'studentLabel', label: '学生', sortKey: 'studentLabel' },
  { key: 'gradeLabel', label: '年级', sortKey: 'grade' },
  { key: 'className', label: '班级', sortKey: 'className' },
  { key: 'keyword', label: '关键词', sortKey: 'keyword' },
  { key: 'teacherName', label: '记录教师', sortKey: 'teacherName' },
  { key: 'occurredAtLabel', label: '发生时间', sortKey: 'occurredAt' },
  { key: 'statusLabel', label: '状态', sortKey: 'status' },
  { key: 'riskLevel', label: '风险等级', sortKey: 'riskLevel' }
]

const visibleKeys = ref<string[]>(COLUMNS.map(column => column.key))
const visibleColumns = computed(() => COLUMNS.filter(column => visibleKeys.value.includes(column.key)))

const STATUS_LABELS: Record<string, string> = { open: '待解决', resolved: '处理中', closed: '已关闭' }
const formatTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

const rows = computed(() => (data.value?.table.rows ?? []).map(row => ({
  ...row,
  occurredAtLabel: formatTime(row.occurredAt),
  statusLabel: STATUS_LABELS[row.status] ?? row.status
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

/** 风险等级列的文字色：高风险 / 安全关注 / 严重标红，中风险标黄，低风险与逾期未闭环保持默认灰。 */
function riskLevelClass(level: string): string {
  const tone = alertRiskLevelTone(level)
  if (tone === 'high') return 'text-red-600'
  if (tone === 'medium') return 'text-yellow-600'
  return 'text-slate-600'
}

const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.table.total ?? 0) / pageSize.value)))

// ===== 个体明细下钻（PRD 4.2 原则 4、W7）=====
// 默认关闭：只有平台后台给该角色开通 view_sensitive 后 context.canViewIndividual 才为 true。
// 开通后仍需每次填写事由（≥10 字）换取 15 分钟目标级授权；同一目标在有效期内复用授权。
// 支持三类对象：学生 / 负责教师 / 家长，均按服务端裁剪后的最小披露字段返回，
// 不含助手回答正文、沟通正文与摘要、量表原始作答。
const { reasonCategoryLabel } = useDisplayLabels()
const individualEnabled = computed(() => Boolean(context.value?.canViewIndividual))

interface GrantCacheEntry { id: string, expiresAt: number }
interface IndividualTargetRef {
  targetType: DashboardIndividualTargetType
  targetId: string
  label: string
}
const grants = ref<Record<string, GrantCacheEntry>>({})
const reasonOpen = ref(false)
const reasonTarget = ref<IndividualTargetRef | null>(null)
const reasonCategory = ref('school_duty')
const reasonText = ref('')
const reasonError = ref<string | null>(null)
const reasonSaving = ref(false)
const detailOpen = ref(false)
const detailPending = ref(false)
const detailError = ref<string | null>(null)
const detail = ref<DashboardIndividualDetailResponse | null>(null)
const detailTarget = ref<IndividualTargetRef | null>(null)

/** 类型化的分支视图，模板按 targetType 渲染对应区块。 */
const studentDetail = computed(() => (detail.value?.targetType === 'student' ? detail.value : null))
const teacherDetail = computed(() => (detail.value?.targetType === 'teacher_profile' ? detail.value : null))
const guardianDetail = computed(() => (detail.value?.targetType === 'guardian' ? detail.value : null))

const reasonOptions = ['risk_review', 'complaint_handling', 'data_correction_verification', 'school_duty', 'other']
  .map(value => ({ label: reasonCategoryLabel(value), value }))

const grantKey = (target: IndividualTargetRef) => `${target.targetType}:${target.targetId}`

/** 取有效授权（过期即作废）；没有则返回 null，由调用方弹事由框。 */
function grantOf(target: IndividualTargetRef): string | null {
  const entry = grants.value[grantKey(target)]
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    delete grants.value[grantKey(target)]
    return null
  }
  return entry.id
}

/** 打开个体明细：已有有效授权直接加载，否则弹事由框。 */
function openIndividual(target: IndividualTargetRef) {
  const existing = grantOf(target)
  if (existing) {
    void loadIndividualDetail(target, existing)
    return
  }
  reasonTarget.value = target
  reasonCategory.value = 'school_duty'
  reasonText.value = ''
  reasonError.value = null
  reasonOpen.value = true
}

/** 预警明细行里的学生 / 教师入口。 */
function openRowIndividual(targetType: 'student' | 'teacher_profile', targetId: string | null, label: string) {
  if (!targetId) return
  if (!individualEnabled.value) return
  openIndividual({ targetType, targetId, label })
}

/** 学生明细里的沟通记录 → 关联家长入口。 */
function openGuardian(guardianId: string, label: string) {
  if (!individualEnabled.value) return
  openIndividual({ targetType: 'guardian', targetId: guardianId, label })
}

async function submitReason() {
  const target = reasonTarget.value
  if (!target) return
  if (reasonText.value.trim().length < 10) {
    reasonError.value = '请填写至少 10 个字符的查看事由'
    return
  }
  reasonSaving.value = true
  reasonError.value = null
  try {
    const result = await $fetch<{ grant: { id: string, expiresAt: string } | null }>('/api/v1/admin-access/requests', {
      method: 'POST',
      body: {
        targetType: target.targetType,
        targetId: target.targetId,
        reasonCategory: reasonCategory.value,
        reasonText: reasonText.value.trim()
      }
    })
    if (!result.grant) throw new Error('未生成访问授权')
    grants.value[grantKey(target)] = { id: result.grant.id, expiresAt: new Date(result.grant.expiresAt).getTime() }
    reasonOpen.value = false
    await loadIndividualDetail(target, result.grant.id)
  } catch (error) {
    reasonError.value = (error as { data?: { message?: string } }).data?.message || '授权申请失败，请稍后重试'
  } finally {
    reasonSaving.value = false
  }
}

async function loadIndividualDetail(target: IndividualTargetRef, grantId: string) {
  detailOpen.value = true
  detailPending.value = true
  detailError.value = null
  detail.value = null
  detailTarget.value = target
  try {
    detail.value = await $fetch<DashboardIndividualDetailResponse>(
      `/api/v1/dashboard/individual/${target.targetType}/${target.targetId}`,
      { headers: { 'x-admin-access-grant': grantId } }
    )
  } catch (error) {
    detailError.value = (error as { data?: { message?: string } }).data?.message || '明细加载失败，请稍后重试'
  } finally {
    detailPending.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-5 px-5 py-8">
    <header class="space-y-1">
      <h1 class="text-xl font-semibold text-slate-800">预警看板</h1>
      <p class="text-sm text-slate-500">
        安全事项、学生事件与方案逾期（学生列脱敏为编号）
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
        <label class="flex flex-col gap-1">
          <span class="text-xs text-slate-500">状态</span>
          <select
            v-model="status"
            class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none"
          >
            <option value="open">待解决</option>
            <option value="resolved">处理中</option>
            <option value="closed">已关闭</option>
            <option value="all">全部</option>
          </select>
        </label>
        <DashboardMultiSelect v-model="classIds" label="班级（多选）" :options="classOptions" />
        <label class="flex flex-col gap-1">
          <span class="text-xs text-slate-500">风险等级</span>
          <select
            v-model="riskLevel"
            class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none"
          >
            <option v-for="value in ALERT_RISK_LEVEL_FILTERS" :key="value" :value="value">
              {{ ALERT_RISK_LEVEL_FILTER_LABELS[value] }}
            </option>
          </select>
        </label>
        <fieldset class="flex flex-col gap-1">
          <span class="text-xs text-slate-500">来源</span>
          <div class="flex flex-wrap gap-x-3 gap-y-1.5 pb-1">
            <label v-for="option in SOURCE_OPTIONS" :key="option.value" class="flex items-center gap-1.5 text-sm text-slate-600">
              <input v-model="sources" type="checkbox" :value="option.value" class="size-3.5 rounded border-slate-300">
              {{ option.label }}
            </label>
          </div>
        </fieldset>
        <p class="pb-1 text-xs text-slate-400">统计口径：{{ period.start }} ~ {{ period.end }}</p>
      </div>
    </section>

    <div v-if="error" class="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
      {{ (error.data as { message?: string } | undefined)?.message || '数据加载失败，请稍后重试' }}
    </div>

    <template v-else>
      <section class="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <DashboardStatCard label="预警总数" :value="kpis?.total ?? 0" unit="项" hint="周期内所选来源（默认前四类）" />
        <DashboardStatCard label="待解决" :value="kpis?.open ?? 0" unit="项" hint="状态不为已关闭" />
        <DashboardStatCard label="高风险未闭环" :value="kpis?.highRiskOpen ?? 0" unit="项" hint="安全事项 + 高/严重学生事件 + 高风险沟通" />
        <DashboardStatCard label="高危闭环率" :value="kpis?.highRiskClosedRate ?? null" unit="%" hint="已关闭高危 / 高危总数（不受上方状态筛选影响）" />
        <DashboardStatCard label="心理高风险学生" :value="kpis?.studentRiskHigh ?? 0" unit="人" hint="周期内最近一次量表等级折算为高风险的学生" />
        <DashboardStatCard label="方案逾期未闭环" :value="kpis?.overdueOpen ?? 0" unit="项" hint="执行项逾期 + 复盘逾期（需勾选对应来源）" />
        <DashboardStatCard label="时间范围" :value="rangeDays" unit="天" :hint="`${period.start} ~ ${period.end}（含首尾）`" />
      </section>

      <section class="grid gap-3 lg:grid-cols-2">
        <div class="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 class="mb-3 text-sm font-medium text-slate-700">预警趋势</h2>
          <DashboardLineChart
            :labels="trend.map(item => item.date)"
            :series="[
              { name: '安全事项', values: trend.map(item => item.safety) },
              { name: '学生事件', values: trend.map(item => item.studentEvent) },
              { name: '高风险家校沟通', values: trend.map(item => item.communication) },
              { name: '方案逾期', values: trend.map(item => item.overdue) }
            ]"
          />
          <p class="mt-2 text-[11px] text-slate-400">按记录时间（逾期项按到期时间）落东八区自然日；含已关闭记录，与上方 KPI 口径一致。学生事件类型分布与家校沟通渠道分布改在「数据总览」聚合卡展示。</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">家校沟通覆盖率与重点学生</h2>
          <section class="grid grid-cols-2 gap-3">
            <DashboardStatCard label="危机沟通数" :value="communication?.crisisCount ?? 0" unit="条" hint="风险等级为安全关注 / 高风险" />
            <DashboardStatCard label="沟通覆盖率" :value="communication?.coverageRate ?? null" unit="%" hint="有沟通记录的学生 / 在册学生" />
            <DashboardStatCard label="重点学生" :value="communication?.keyStudents ?? 0" unit="人" hint="高危事件 / 高风险量表 / 高风险沟通" />
            <DashboardStatCard
              label="重点学生人均沟通"
              :value="communication?.keyStudentMessagesPerStudent ?? null"
              unit="条"
              hint="重点学生的沟通条数 / 重点学生数"
            />
          </section>
          <p class="mt-2 text-[11px] text-slate-400">
            重点学生 = 周期内出现高危学生事件、高风险量表等级或高风险沟通的学生；周期内共 {{ communication?.keyStudentMessages ?? 0 }} 条重点学生沟通记录。
          </p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">家校沟通风险等级</h2>
          <DashboardRankTable
            :rows="(communication?.riskLevels ?? []).map(item => ({ label: item.label, value: item.count }))"
            value-label="条"
          />
          <p class="mt-2 text-[11px] text-slate-400">周期内共 {{ communication?.total ?? 0 }} 条沟通记录（不含已归档）。</p>
        </div>
      </section>

      <section class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-medium text-slate-700">预警明细</h2>
          <details class="relative">
            <summary class="cursor-pointer list-none rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">列设置</summary>
            <div class="absolute right-0 z-20 mt-1 w-40 space-y-1.5 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
              <label v-for="column in COLUMNS" :key="column.key" class="flex items-center gap-2 text-sm text-slate-600">
                <input v-model="visibleKeys" type="checkbox" :value="column.key" class="size-3.5 rounded border-slate-300">
                {{ column.label }}
              </label>
            </div>
          </details>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full min-w-[900px] text-sm">
            <thead>
              <tr class="border-b border-slate-100 text-left text-xs text-slate-500">
                <th
                  v-for="column in visibleColumns"
                  :key="column.key"
                  class="cursor-pointer py-2 pr-3 font-normal select-none hover:text-slate-700"
                  :class="column.align === 'right' ? 'text-right' : ''"
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
                  v-for="column in visibleColumns"
                  :key="column.key"
                  class="py-2 pr-3"
                  :class="[
                    column.align === 'right' ? 'text-right' : '',
                    column.key === 'riskLevel' ? riskLevelClass(row.riskLevel) : 'text-slate-600'
                  ]"
                >
                  <template v-if="column.key === 'studentLabel'">
                    <span>{{ cellValue(row, column.key) }}</span>
                    <button
                      v-if="individualEnabled && row.studentId"
                      type="button"
                      class="ml-2 whitespace-nowrap rounded border border-emerald-200 px-1.5 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50"
                      @click="openRowIndividual('student', row.studentId, row.studentLabel)"
                    >
                      查看个体
                    </button>
                  </template>
                  <template v-else-if="column.key === 'teacherName'">
                    <span>{{ cellValue(row, column.key) }}</span>
                    <button
                      v-if="individualEnabled && row.teacherId"
                      type="button"
                      class="ml-2 whitespace-nowrap rounded border border-emerald-200 px-1.5 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50"
                      @click="openRowIndividual('teacher_profile', row.teacherId, row.teacherName)"
                    >
                      教师个体
                    </button>
                  </template>
                  <template v-else>{{ cellValue(row, column.key) }}</template>
                </td>
              </tr>
              <tr v-if="!rows.length">
                <td :colspan="visibleColumns.length" class="py-8 text-center text-sm text-slate-400">所选条件暂无数据</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>共 {{ data?.table.total ?? 0 }} 项，第 {{ page }} / {{ totalPages }} 页<span v-if="pending" class="ml-2 text-slate-400">加载中…</span></span>
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
        <p class="text-[11px] text-slate-400">学生列按周期内首次出现顺序编号（学生 A/B/C），不展示姓名；本页不提供导出。状态与风险等级筛选只作用于明细表；KPI 与趋势按周期内所选来源累计。</p>
        <p v-if="individualEnabled" class="text-[11px] text-slate-400">
          已开通个体明细：学生、记录教师与关联家长可分别展开，需填写查看事由并获 15 分钟有效期，全程写入审计。
        </p>
      </section>
    </template>

    <!-- 查看事由（≥10 字）换 15 分钟目标级授权 -->
    <UModal :open="reasonOpen" @update:open="value => { if (!value) reasonOpen = false }">
      <template #header>
        <h3 class="text-lg font-semibold">查看个体明细</h3>
      </template>
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-slate-600">
            将查看 <strong>{{ reasonTarget?.label }}</strong>（{{ DASHBOARD_INDIVIDUAL_TARGET_LABELS[reasonTarget?.targetType ?? 'student'] }}）的个体明细。
            授权有效 15 分钟，限本次目标，查看记录写入审计与管理员访问事件。
          </p>
          <label class="flex flex-col gap-1">
            <span class="text-xs text-slate-500">事由类别</span>
            <select v-model="reasonCategory" class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700">
              <option v-for="option in reasonOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-xs text-slate-500">查看事由（至少 10 个字符）</span>
            <textarea
              v-model="reasonText"
              rows="3"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              placeholder="例如：需要了解该生近期事件处置进展，准备家校沟通"
            />
          </label>
          <p v-if="reasonError" class="text-sm text-red-600">{{ reasonError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="outline" @click="reasonOpen = false">取消</UButton>
          <UButton color="primary" :loading="reasonSaving" @click="submitReason">确认查看</UButton>
        </div>
      </template>
    </UModal>

    <!-- 个体明细（最小披露字段 + 水印，禁止外传） -->
    <UModal :open="detailOpen" @update:open="value => { if (!value) detailOpen = false }">
      <template #header>
        <div>
          <h3 class="text-lg font-semibold">
            {{ detailTarget ? `${DASHBOARD_INDIVIDUAL_TARGET_LABELS[detailTarget.targetType]}个体明细` : '个体明细' }}
          </h3>
          <p v-if="detail" class="mt-1 text-xs text-slate-400">{{ detail.access.watermark }} · 敏感数据 · 禁止外传</p>
        </div>
      </template>
      <template #body>
        <div class="space-y-4">
          <p v-if="detailPending" class="text-sm text-slate-400">加载中…</p>
          <p v-else-if="detailError" class="text-sm text-red-600">{{ detailError }}</p>

          <!-- 学生：身份 + 事件 + 方案 + 沟通 + 量表测评 + 提问摘要 -->
          <template v-else-if="studentDetail">
            <div class="rounded-lg border border-slate-200 p-3">
              <p class="text-sm font-medium text-slate-800">
                {{ studentDetail.student.name }}
                <span class="ml-2 text-xs font-normal text-slate-500">{{ studentDetail.student.gradeLabel }} · {{ studentDetail.student.className }}</span>
              </p>
            </div>

            <section class="space-y-2">
              <h4 class="text-sm font-medium text-slate-700">学生事件</h4>
              <table v-if="studentDetail.studentEvents.length" class="w-full text-sm">
                <tbody>
                  <tr v-for="event in studentDetail.studentEvents" :key="event.id" class="border-b border-slate-50 last:border-0">
                    <td class="py-1.5 pr-3 text-slate-600">{{ event.eventType }}</td>
                    <td class="py-1.5 pr-3 text-slate-600">{{ event.severity }}</td>
                    <td class="py-1.5 pr-3 text-slate-500">{{ formatTime(event.occurredAt) }}</td>
                    <td class="py-1.5 text-slate-500">{{ STATUS_LABELS[event.status] ?? event.status }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="text-xs text-slate-400">暂无学生事件</p>
            </section>

            <section class="space-y-2">
              <h4 class="text-sm font-medium text-slate-700">量表测评</h4>
              <table v-if="studentDetail.assessments.length" class="w-full text-sm">
                <tbody>
                  <tr v-for="item in studentDetail.assessments" :key="item.id" class="border-b border-slate-50 last:border-0">
                    <td class="py-1.5 pr-3 text-slate-600">{{ item.moduleLabel }}</td>
                    <td class="py-1.5 pr-3 text-slate-600">{{ item.instrumentName }}</td>
                    <td class="py-1.5 pr-3 text-slate-600">{{ item.levelLabel }}</td>
                    <td class="py-1.5 pr-3 text-slate-500">{{ item.attribution || '—' }}</td>
                    <td class="py-1.5 text-slate-500">{{ formatTime(item.submittedAt) }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="text-xs text-slate-400">暂无量表测评</p>
              <p class="text-[11px] text-slate-400">只展示等级与主归因，不展示原始作答。</p>
            </section>

            <section class="space-y-2">
              <h4 class="text-sm font-medium text-slate-700">方案与风险等级</h4>
              <table v-if="studentDetail.plans.length" class="w-full text-sm">
                <tbody>
                  <tr v-for="plan in studentDetail.plans" :key="plan.id" class="border-b border-slate-50 last:border-0">
                    <td class="py-1.5 pr-3 text-slate-600">{{ plan.moduleLabel }}</td>
                    <td class="py-1.5 pr-3 text-slate-600">{{ plan.riskLabel }}</td>
                    <td class="py-1.5 text-slate-500">{{ formatTime(plan.createdAt) }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="text-xs text-slate-400">暂无方案</p>
            </section>

            <section class="space-y-2">
              <h4 class="text-sm font-medium text-slate-700">AI 提问摘要</h4>
              <ul v-if="studentDetail.aiQuestions.length" class="space-y-1.5">
                <li v-for="item in studentDetail.aiQuestions" :key="item.id" class="rounded-lg border border-slate-100 p-2 text-sm">
                  <p class="text-slate-700">{{ item.excerpt }}</p>
                  <p class="mt-1 text-[11px] text-slate-400">
                    {{ item.category || '未分类' }}
                    <span v-if="item.keywords.length">· {{ item.keywords.join('、') }}</span>
                    · {{ formatTime(item.createdAt) }}
                  </p>
                </li>
              </ul>
              <p v-else class="text-xs text-slate-400">暂无关联提问</p>
              <p class="text-[11px] text-slate-400">只展示提问摘要（≤80 字，已脱敏），不展示助手回答正文。</p>
            </section>

            <section class="space-y-2">
              <h4 class="text-sm font-medium text-slate-700">家校沟通（不含正文）</h4>
              <table v-if="studentDetail.communications.length" class="w-full text-sm">
                <tbody>
                  <tr v-for="item in studentDetail.communications" :key="item.id" class="border-b border-slate-50 last:border-0">
                    <td class="py-1.5 pr-3 text-slate-600">{{ item.channelLabel }}</td>
                    <td class="py-1.5 pr-3 text-slate-500">{{ item.riskLevel ?? '—' }}</td>
                    <td class="py-1.5 pr-3 text-slate-500">{{ formatTime(item.occurredAt) }}</td>
                    <td class="py-1.5 text-right">
                      <button
                        v-if="item.guardianId"
                        type="button"
                        class="whitespace-nowrap rounded border border-emerald-200 px-1.5 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50"
                        @click="openGuardian(item.guardianId, '关联家长')"
                      >
                        查看家长
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="text-xs text-slate-400">暂无沟通记录</p>
            </section>

            <p v-if="studentDetail.limits.truncated" class="text-xs text-amber-600">
              每类明细最多展示 {{ studentDetail.limits.perCollection }} 条，超出部分未显示。
            </p>
          </template>

          <!-- 教师：身份 + 负责范围 + 近 30 天计数（不含业务正文） -->
          <template v-else-if="teacherDetail">
            <div class="rounded-lg border border-slate-200 p-3">
              <p class="text-sm font-medium text-slate-800">
                {{ teacherDetail.teacher.name }}
                <span class="ml-2 text-xs font-normal text-slate-500">
                  {{ teacherDetail.teacher.teachingGradeLabels.length ? `任教 ${teacherDetail.teacher.teachingGradeLabels.join('、')}` : '未填写任教年级' }}
                </span>
              </p>
            </div>
            <section class="grid grid-cols-2 gap-3">
              <DashboardStatCard label="负责班级" :value="teacherDetail.teacher.classCount" unit="个" />
              <DashboardStatCard label="负责学生" :value="teacherDetail.teacher.studentCount" unit="人" />
              <DashboardStatCard label="AI 提问数" :value="teacherDetail.teacher.aiQuestions" unit="条" :hint="`近 ${teacherDetail.teacher.windowDays} 天`" />
              <DashboardStatCard label="新建方案数" :value="teacherDetail.teacher.plans" unit="个" :hint="`近 ${teacherDetail.teacher.windowDays} 天`" />
              <DashboardStatCard label="学生事件数" :value="teacherDetail.teacher.studentEvents" unit="条" :hint="`近 ${teacherDetail.teacher.windowDays} 天`" />
            </section>
            <p class="text-[11px] text-slate-400">教师个体只展示负责范围与计数，不展示提问原文、方案与事件正文，也不展示学生名单。</p>
          </template>

          <!-- 家长：身份 + 关系 + 关联学生 + 沟通结构化字段 -->
          <template v-else-if="guardianDetail">
            <div class="rounded-lg border border-slate-200 p-3">
              <p class="text-sm font-medium text-slate-800">
                {{ guardianDetail.guardian.name }}
                <span v-if="guardianDetail.guardian.relation" class="ml-2 text-xs font-normal text-slate-500">{{ guardianDetail.guardian.relation }}</span>
              </p>
            </div>
            <section class="space-y-2">
              <h4 class="text-sm font-medium text-slate-700">关联学生</h4>
              <table v-if="guardianDetail.guardian.students.length" class="w-full text-sm">
                <tbody>
                  <tr v-for="item in guardianDetail.guardian.students" :key="item.id" class="border-b border-slate-50 last:border-0">
                    <td class="py-1.5 pr-3 text-slate-600">{{ item.name }}</td>
                    <td class="py-1.5 pr-3 text-slate-500">{{ item.gradeLabel }} · {{ item.className }}</td>
                    <td class="py-1.5 text-slate-500">{{ item.relation || '—' }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="text-xs text-slate-400">暂无关联学生</p>
            </section>
            <section class="space-y-2">
              <h4 class="text-sm font-medium text-slate-700">家校沟通（不含正文）</h4>
              <table v-if="guardianDetail.communications.length" class="w-full text-sm">
                <tbody>
                  <tr v-for="item in guardianDetail.communications" :key="item.id" class="border-b border-slate-50 last:border-0">
                    <td class="py-1.5 pr-3 text-slate-600">{{ item.channelLabel }}</td>
                    <td class="py-1.5 pr-3 text-slate-500">{{ item.riskLevel ?? '—' }}</td>
                    <td class="py-1.5 text-slate-500">{{ formatTime(item.occurredAt) }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="text-xs text-slate-400">暂无沟通记录</p>
            </section>
            <p class="text-[11px] text-slate-400">家长个体只展示结构化字段（渠道 / 风险等级 / 时间），不展示沟通正文与摘要。</p>
          </template>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <UButton variant="outline" @click="detailOpen = false">关闭</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

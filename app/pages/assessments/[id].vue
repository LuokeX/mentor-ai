<script setup lang="ts">
/**
 * 评估记录详情（专项评估 → 评估记录）。
 *
 * 补两个断点：
 * 1. 提交评估后的结论离页即失——报告正文一直存在 assessment_attempts.result.report 里，
 *    详情页重新读出来，组内多次量表合并成一份报告；
 * 2. 被安全冻结的方案不进教师方案列表——详情页自带转介处置载荷，教师点开这条记录
 *    就能重新看到当时的转介指引（与冻结方案页共用同一份查询实现）。
 *
 * 文案约束：面向教师不出现「熔断 / 危机 / 预警」，统一用「安全转介」。
 */
import { moduleMeta } from '#shared/assessments'
import type { AssessmentReport } from '#shared/reports'

interface RecordAttempt {
  id: string
  assessmentCode: string
  instrumentName: string
  submittedAt: string | null
  level: string | null
  levelName: string | null
  severity: string | null
  blocked: boolean
  hasReport: boolean
}

interface RecordPlan {
  id: string
  title: string
  titleFull: string | null
  status: string
  frozenBeforeAcceptance: boolean
}

interface RecordFuse {
  frozenAt: string
  eventId: string
  guide: string
  helpPhone: string | null
  ackMinutes: number
  escalationMinutes: number
  psychologistAssigned: boolean
}

interface AssessmentRecordDetail {
  id: string
  module: string
  moduleTitle: string
  sourceType: string
  contextType: string
  contextId: string | null
  objectLabel: string | null
  status: 'active' | 'completed' | 'referred'
  level: string | null
  levelName: string | null
  severity: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  lastSubmittedAt: string | null
  canContinue: boolean
  attempts: RecordAttempt[]
  report: AssessmentReport | null
  tools: Array<{ title: string, content: string }>
  plans: RecordPlan[]
  fuse: RecordFuse | null
  _capabilities: string[]
}

const route = useRoute()
const id = String(route.params.id || '')
const { data, pending, error } = await useFetch<AssessmentRecordDetail>(`/api/v1/assessments/records/${id}`, {
  key: `assessment-record-${id}`
})

const STATUS_TEXT: Record<string, string> = { active: '进行中', completed: '已完成', referred: '安全转介' }
type BadgeColor = 'success' | 'info' | 'warning' | 'error' | 'neutral'
const STATUS_COLOR: Record<string, BadgeColor> = { active: 'info', completed: 'success', referred: 'error' }
const SEVERITY_COLOR: Record<string, BadgeColor> = { low: 'success', medium: 'info', high: 'warning', crisis: 'error' }
const OBJECT_TYPE_TEXT: Record<string, string> = { student: '学生', class: '班级', guardian: '家长' }

const record = computed(() => data.value || null)
const isReferred = computed(() => record.value?.status === 'referred')

/**
 * 回模块页的深链：带对象时续接同一咨询对象，带 continueSession 时续接同一评估组。
 * 服务端只在组仍开放且属于本人时接受续接，否则新建组，因此这里不需要额外判断。
 */
function moduleLink(extra: Record<string, string> = {}) {
  const current = record.value
  if (!current) return '/'
  const params = new URLSearchParams()
  if (current.contextId && current.contextType && current.contextType !== 'none') {
    params.set('contextType', current.contextType)
    params.set('contextId', current.contextId)
  }
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value)
  const query = params.toString()
  return `/module/${current.module}${query ? `?${query}` : ''}`
}
const continueLink = computed(() => moduleLink({ continueSession: record.value?.id || '' }))
const restartLink = computed(() => moduleLink())

const objectText = computed(() => {
  const current = record.value
  if (!current?.objectLabel) return null
  return `${OBJECT_TYPE_TEXT[current.contextType] || '对象'} · ${current.objectLabel}`
})

function printPage() {
  window.print()
}

useHead({ title: () => (record.value ? `评估记录 · ${record.value.moduleTitle}` : '评估记录') })
</script>

<template>
  <div class="mx-auto max-w-4xl px-5 py-10">
    <div class="mb-6 flex items-center justify-between gap-3 print:hidden">
      <UButton to="/assessments" color="neutral" variant="ghost" icon="i-lucide-arrow-left" size="sm">返回评估记录</UButton>
      <UButton v-if="record?.report && !isReferred" color="neutral" variant="soft" icon="i-lucide-printer" size="sm" @click="printPage">打印报告</UButton>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="评估记录加载失败"
      :description="(error as any)?.data?.message || '请检查网络后重试；若记录已被清理，请返回列表。'"
    >
      <template #actions>
        <UButton size="xs" color="neutral" variant="ghost" to="/assessments">返回列表</UButton>
      </template>
    </UAlert>

    <div v-else-if="pending && !record" class="grid min-h-64 place-items-center text-sm text-slate-400">
      <div class="text-center">
        <UIcon name="i-lucide-loader" class="mx-auto mb-3 size-8 animate-spin" />
        <p>加载中...</p>
      </div>
    </div>

    <div v-else-if="record" class="flex flex-col gap-6">
      <!-- 记录头 -->
      <header class="panel p-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm text-slate-500">{{ record.moduleTitle }}</p>
            <h1 class="mt-1 text-2xl font-semibold text-slate-800">
              {{ record.attempts.map(item => item.instrumentName).join('、') || '评估记录' }}
            </h1>
            <p class="mt-2 text-sm text-slate-500">
              <template v-if="objectText">{{ objectText }} · </template>
              最近评估 {{ formatDateTime(record.lastSubmittedAt || record.createdAt) }}
            </p>
          </div>
          <UBadge :color="STATUS_COLOR[record.status] || 'neutral'" variant="soft" size="xl">
            {{ STATUS_TEXT[record.status] || record.status }}
          </UBadge>
        </div>
      </header>

      <!-- 安全转介：与提交当天看到的是同一套指引，不展示报告正文（结论已切换为转介处置） -->
      <template v-if="isReferred">
        <UAlert color="error" variant="soft" icon="i-lucide-shield-alert" title="本次评估已启动安全转介">
          <template #description>
            <p>
              本次评估命中了安全处置规则，流程已切换为安全转介，因此不再提供常规结论与行动方案。
              请先按下方指引完成转介处置。
            </p>
            <p class="mt-2">
              如需继续这个主题的工作，可以重新完成一次评估，系统会基于新的结果生成新的方案。
            </p>
          </template>
        </UAlert>

        <CrisisReferralCard
          v-if="record.fuse"
          :guide="record.fuse.guide"
          :help-phone="record.fuse.helpPhone"
          :ack-minutes="record.fuse.ackMinutes"
          :escalation-minutes="record.fuse.escalationMinutes"
          :psychologist-assigned="record.fuse.psychologistAssigned"
          :event-id="record.fuse.eventId"
        />
        <!-- 历史数据可能没有安全事件记录：只展示停止说明，不展示无依据的处置指引 -->
        <p v-else class="rounded-xl bg-slate-50 p-4 text-xs text-slate-500">
          本次转介的处置指引未记录在案，如需确认处理进度，请联系学校心理专员或管理员。
        </p>

        <div class="flex flex-wrap items-center gap-2 print:hidden">
          <UButton :to="restartLink" icon="i-lucide-rotate-ccw">重新完成一次评估</UButton>
          <UButton to="/assessments" color="neutral" variant="soft">返回评估记录</UButton>
        </div>
      </template>

      <template v-else>
        <!-- 评估报告 -->
        <section v-if="record.report">
          <AssessmentReportView :report="record.report" :tools="record.tools" />
        </section>
        <p v-else class="panel p-5 text-sm text-slate-500">
          这次评估尚未生成报告（可能是进行中的评估，或当时未生成结论）。
        </p>

        <!-- 组内量表：同一问题下连续完成的量表按提交顺序列出 -->
        <section class="panel p-6">
          <h2 class="text-lg font-semibold text-slate-800">本次评估包含的量表</h2>
          <ul class="mt-4 divide-y divide-slate-100">
            <li v-for="(attempt, index) in record.attempts" :key="attempt.id" class="flex flex-wrap items-center justify-between gap-2 py-3">
              <div class="min-w-0">
                <p class="text-sm text-slate-700">{{ index + 1 }}. {{ attempt.instrumentName }}</p>
                <p class="mt-0.5 text-xs text-slate-400">{{ formatDateTime(attempt.submittedAt) }}</p>
              </div>
              <UBadge v-if="attempt.blocked" color="error" variant="soft" size="sm">安全转介</UBadge>
              <UBadge
                v-else-if="attempt.levelName || attempt.level"
                :color="SEVERITY_COLOR[attempt.severity || ''] || 'neutral'"
                variant="soft"
                size="sm"
              >
                {{ attempt.levelName || attempt.level }}
              </UBadge>
            </li>
          </ul>
        </section>

        <!-- 关联方案：冻结方案在方案列表不可见，这里是教师能找到它的入口 -->
        <section v-if="record.plans.length" class="panel p-6">
          <h2 class="text-lg font-semibold text-slate-800">关联方案</h2>
          <ul class="mt-4 space-y-3">
            <li v-for="plan in record.plans" :key="plan.id">
              <NuxtLink :to="`/plans/${plan.id}`" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-4 transition hover:border-emerald-200 hover:bg-emerald-50/40">
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium text-emerald-700">{{ plan.title }}</span>
                  <span class="mt-0.5 block text-xs text-slate-400">查看方案详情与执行记录</span>
                </span>
                <UBadge v-if="plan.frozenBeforeAcceptance" color="error" variant="soft" size="sm">已停止</UBadge>
                <UIcon v-else name="i-lucide-chevron-right" class="size-4 text-slate-400" />
              </NuxtLink>
            </li>
          </ul>
        </section>

        <div class="flex flex-wrap items-center gap-2 print:hidden">
          <UButton v-if="record.canContinue" :to="continueLink" icon="i-lucide-arrow-right" trailing>继续完成这次评估</UButton>
          <UButton :to="restartLink" :color="record.canContinue ? 'neutral' : 'primary'" :variant="record.canContinue ? 'soft' : 'solid'" icon="i-lucide-rotate-ccw">再做一次评估</UButton>
          <span v-if="record.status === 'active' && record.plans.length === 0" class="text-xs text-slate-400">
            这次评估还没结束：继续完成剩余量表后会生成方案。
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
@media print {
  :global(header),
  .print\:hidden {
    display: none !important;
  }
}
</style>

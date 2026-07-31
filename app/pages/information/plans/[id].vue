<script setup lang="ts">
import { moduleMeta } from '#shared/assessments'

type PlanAction = {
  id: string; sequence: number; title: string; detail: string;
  status: string; dueAt: string | null; completedAt: string | null;
  executedAt: string | null; executionNote: string | null;
  startedAt?: string | null; blockedAt?: string | null; blockReason?: string | null;
  blockNote?: string | null; evidenceType?: string | null; evidenceSummary?: string | null;
  teacherConfidence?: number | null;
}

const route = useRoute()
const id = String(route.params.id)
const { data, error: loadError, refresh } = await useFetch<any>(`/api/v1/plans/${id}`)
const pending = ref(false)
const actionPendingId = ref<string | null>(null)
const sourceExpanded = ref(false)
const expandedActionId = ref<string | null>(null)
const acceptancePending = ref(false)

const acceptanceForm = reactive({
  reason: ''
})

// 执行反馈表单状态
const execForm = reactive({
  executedAt: '',
  executionNote: '',
  blockReason: '',
  blockNote: '',
  evidenceType: 'none',
  evidenceSummary: '',
  teacherConfidence: 3,
})

const reviewForm = reactive({
  effectScore: 3,
  progressNote: '',
  nextAction: '',
  decision: 'continue_plan',
  completedActionIds: [] as string[],
})
const feedbackForm = reactive({
  attributionAccuracy: 4,
  toolUsability: 4,
  scriptNaturalness: 4,
  actionDifficulty: 3,
  reviewUsefulness: 4,
  tags: [] as string[],
  note: '',
})
const feedbackPending = ref(false)
const feedbackTags = ['归因准确', '工具可用', '话术自然', '行动过难', '需要人工协同', '场景不匹配', '复盘有效']
const blockReasonOptions = [
  { label: '时间不足', value: 'time_limited' },
  { label: '学生暂不可用', value: 'student_unavailable' },
  { label: '家长不配合', value: 'guardian_uncooperative' },
  { label: '工具不适用', value: 'tool_not_applicable' },
  { label: '行动过难', value: 'action_too_hard' },
  { label: '风险升级', value: 'risk_escalated' },
  { label: '需要协同', value: 'need_collaboration' },
  { label: '其他', value: 'other' }
]
const reviewDecisionOptions = [
  { label: '继续原方案', value: 'continue_plan' },
  { label: '调整动作', value: 'adjust_actions' },
  { label: '需要协同', value: 'need_collaboration' },
  { label: '目标达成并关闭', value: 'close_success' },
  { label: '场景变化关闭', value: 'close_no_longer_needed' }
]

function moduleTitle(module: string) {
  return (moduleMeta as Record<string, { title: string }>)[module]?.title || module
}

/**
 * 按严重度取色，不能按等级码取色：等级码是业务在 ⑤e 自定义的
 * （green / L1 / LP2 / norming…），映射表里一个都对不上，徽章会恒为灰。
 * severity 是 low/medium/high/crisis 固定枚举，才是稳定的取色依据。
 */
function riskVariant(severity?: string): 'error' | 'warning' | 'success' | 'neutral' {
  const map: Record<string, 'error' | 'warning' | 'success' | 'neutral'> = {
    crisis: 'error', high: 'error', medium: 'warning', low: 'success',
  }
  return map[severity || ''] || 'neutral'
}

function statusText(status: string) {
  const map: Record<string, string> = {
    pending_acceptance: '待确认',
    accepted: '已接受',
    in_progress: '进行中',
    review_due: '待复盘',
    adjustment_needed: '需调整',
    escalated: '需协同',
    completed: '已完成',
    closed: '已关闭',
    archived: '已归档'
  }
  return map[status] || status
}

function statusVariant(status: string): 'info' | 'success' | 'neutral' | 'warning' | 'error' {
  const map: Record<string, 'info' | 'success' | 'neutral' | 'warning' | 'error'> = {
    pending_acceptance: 'warning',
    accepted: 'info',
    in_progress: 'info',
    review_due: 'warning',
    adjustment_needed: 'warning',
    escalated: 'error',
    completed: 'success',
    closed: 'neutral',
    archived: 'neutral',
  }
  return map[status] || 'neutral'
}

function actionStatusText(status: string) {
  const map: Record<string, string> = {
    pending: '未开始',
    in_progress: '进行中',
    completed: '已完成',
    blocked: '受阻',
    skipped: '已跳过',
    cancelled: '已取消'
  }
  return map[status] || status
}

const activeActions = computed<PlanAction[]>(() => {
  return data.value?.actions || []
})

const completedActionCount = computed(() =>
  activeActions.value.filter(a => a.status === 'completed').length
)
const report = computed(() => data.value?.report || {})
const planStructure = computed(() => report.value?.planStructure || {})
/** 归因构成。优先取报告里的，旧方案快照没有时回退到 planStructure.attribution.items。 */
const attributions = computed<Array<{ name: string, strength: 'primary' | 'secondary' | 'reference' }>>(() =>
  report.value?.attributions?.length ? report.value.attributions : (planStructure.value?.attribution?.items || [])
)
/** 只呈现强弱分组，不呈现占比小数——占比是规则匹配强度，不是测量精度。 */
function attributionStrengthLabel(strength: 'primary' | 'secondary' | 'reference') {
  return { primary: '主要', secondary: '次要', reference: '参考' }[strength] || '参考'
}
const supportGoal = computed(() => report.value?.supportGoal || {
  weeklyGoal: planStructure.value?.summary || data.value?.summary || '围绕当前问题先完成一个可观察、可复盘的小目标。',
  observableChange: report.value?.sevenDayFollowUp?.observationPoints?.[0] || '一周内能观察到行为、沟通或状态上的具体变化。',
  avoidGoal: '不要把目标设成一次性解决所有问题。'
})
const firstAction = computed(() => report.value?.firstAction || activeActions.value[0] || null)
// 用 length 判断而不是直接 ||：空数组也是 truthy，回退分支会永远进不去，
// 老方案（报告里没有 toolPrescriptions）的工具处方就整块消失了。
const toolPrescriptions = computed(() => report.value?.toolPrescriptions?.length
  ? report.value.toolPrescriptions
  : (data.value?.tools || []).map((tool: any) => {
  // V2: 优先使用 structuredSteps，fallback 到 content 文本拆分
  const hasStructuredSteps = tool.structuredSteps && tool.structuredSteps.length > 0
  return {
  title: tool.title,
  applicableWhen: planStructure.value?.attribution?.primary ? `适用于“${planStructure.value.attribution.primary}”相关场景。` : '适用于当前方案对应场景。',
  steps: hasStructuredSteps ? [] : String(tool.content || '').split(/\n|[;；。]/).map((item: string) => item.trim()).filter(Boolean).slice(0, 6),
  script: tool.scriptTemplate || tool.script || '',
  prohibitions: tool.prohibitions || [],
  outputArtifact: tool.outputArtifact || '执行记录或沟通/观察纪要',
  estimatedTime: tool.estimatedTime || tool.timePerSession || '本周内完成一次并记录结果',
  // V2: 结构化步骤详情
  _hasStructuredSteps: hasStructuredSteps,
  _structuredSteps: hasStructuredSteps ? tool.structuredSteps.map((s: any) => {
    return {
      seq: s.seq,
      title: s.title,
      description: s.description,
      estimatedTime: s.estimatedTime || '',
      materials: s.materials || '',
      keyTip: s.keyTip || '',
      scriptTemplate: s.scriptTemplate || '',
      successCriteria: s.successCriteria || '',
      commonIssues: s.commonIssues || ''
    }
  }) : null
}
}))
const escalationConditions = computed(() => report.value?.escalationConditions || report.value?.sevenDayFollowUp?.escalationSignals || [])
const successCriteria = computed(() => report.value?.successCriteria || report.value?.sevenDayFollowUp?.observationPoints || [])

// 展开/折叠某个动作的反馈区域
function toggleExpand(actionId: string) {
  const action = activeActions.value.find(a => a.id === actionId)
  if (!action || action.status === 'completed') {
    expandedActionId.value = expandedActionId.value === actionId ? null : actionId
    return
  }
  // 展开未完成的动作时，初始化反馈表单
  if (expandedActionId.value !== actionId) {
    expandedActionId.value = actionId
    execForm.executedAt = new Date().toISOString().slice(0, 16) // YYYY-MM-DDTHH:mm
    execForm.executionNote = ''
    execForm.blockReason = ''
    execForm.blockNote = ''
    execForm.evidenceType = 'none'
    execForm.evidenceSummary = ''
    execForm.teacherConfidence = 3
  } else {
    expandedActionId.value = null
  }
}

async function updateAcceptance(decision: 'accepted' | 'deferred' | 'not_applicable') {
  if (!data.value) return
  acceptancePending.value = true
  try {
    await $fetch(`/api/v1/plans/${data.value.id}/acceptance`, {
      method: 'PATCH',
      body: {
        decision,
        reason: decision === 'accepted' ? undefined : acceptanceForm.reason.trim()
      }
    })
    acceptanceForm.reason = ''
    await refresh()
  } finally {
    acceptancePending.value = false
  }
}

async function updateActionStatus(actionId: string, status: string, extra: Record<string, unknown> = {}) {
  actionPendingId.value = actionId
  try {
    await $fetch(`/api/v1/plans/${data.value!.id}/actions`, {
      method: 'PATCH',
      body: { actionId, status, ...extra },
    })
    expandedActionId.value = null
    await refresh()
  } finally {
    actionPendingId.value = null
  }
}

// 提交执行反馈并标记完成
async function submitExecution(actionId: string) {
  await updateActionStatus(actionId, 'completed', {
    executedAt: execForm.executedAt ? new Date(execForm.executedAt).toISOString() : undefined,
    executionNote: execForm.executionNote.trim() || undefined,
    evidenceType: execForm.evidenceType,
    evidenceSummary: execForm.evidenceSummary.trim() || undefined,
    teacherConfidence: Number(execForm.teacherConfidence)
  })
}

async function submitBlocked(actionId: string) {
  await updateActionStatus(actionId, 'blocked', {
    blockReason: execForm.blockReason,
    blockNote: execForm.blockNote.trim() || undefined,
    evidenceType: execForm.evidenceType,
    evidenceSummary: execForm.evidenceSummary.trim() || undefined,
    teacherConfidence: Number(execForm.teacherConfidence)
  })
}

// 简单 toggle（撤销完成或标记未完成时直接切换）
async function toggleAction(actionId: string, currentStatus: string) {
  const next = currentStatus === 'completed' ? 'pending' : 'completed'

  // 标记完成 → 展开反馈表单，由 submitExecution 完成提交
  if (next === 'completed') {
    toggleExpand(actionId)
    return
  }

  await updateActionStatus(actionId, next)
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatInputDate(dateStr: string) {
  if (!dateStr) return ''
  return dateStr.slice(0, 16) // YYYY-MM-DDTHH:mm
}

async function createReview() {
  if (!data.value) return
  pending.value = true
  try {
    await $fetch(`/api/v1/plans/${data.value.id}/reviews`, {
      method: 'POST',
      body: {
        effectScore: Number(reviewForm.effectScore),
        progressNote: reviewForm.progressNote,
        nextAction: reviewForm.nextAction,
        decision: reviewForm.decision,
        completedActionIds:
          reviewForm.completedActionIds.length ? reviewForm.completedActionIds : undefined,
      },
    })
    Object.assign(reviewForm, {
      effectScore: 3, progressNote: '', nextAction: '', decision: 'continue_plan', completedActionIds: [],
    })
    await refresh()
  } finally {
    pending.value = false
  }
}

async function submitFeedback() {
  if (!data.value) return
  feedbackPending.value = true
  try {
    await $fetch(`/api/v1/plans/${data.value.id}/feedback`, {
      method: 'POST',
      body: {
        attributionAccuracy: Number(feedbackForm.attributionAccuracy),
        toolUsability: Number(feedbackForm.toolUsability),
        scriptNaturalness: Number(feedbackForm.scriptNaturalness),
        actionDifficulty: Number(feedbackForm.actionDifficulty),
        reviewUsefulness: Number(feedbackForm.reviewUsefulness),
        tags: feedbackForm.tags,
        note: feedbackForm.note.trim() || undefined,
      },
    })
    Object.assign(feedbackForm, {
      attributionAccuracy: 4,
      toolUsability: 4,
      scriptNaturalness: 4,
      actionDifficulty: 3,
      reviewUsefulness: 4,
      tags: [],
      note: '',
    })
    await refresh()
  } finally {
    feedbackPending.value = false
  }
}

function toggleFeedbackTag(tag: string, checked: boolean | string) {
  if (checked) {
    if (!feedbackForm.tags.includes(tag)) feedbackForm.tags.push(tag)
  } else {
    feedbackForm.tags = feedbackForm.tags.filter(item => item !== tag)
  }
}

useHead({ title: () => data.value?.title || '方案详情' })
</script>

<template>
  <div class="mx-auto max-w-4xl px-5 py-10">
    <!-- 返回 -->
    <div class="mb-6">
      <UButton to="/information/plans" color="neutral" variant="ghost" icon="i-lucide-arrow-left" size="sm">
        返回方案列表
      </UButton>
    </div>

    <!-- 失败态。之前这里没有分支，拉取失败时 data 恒为 null，页面会永远转圈。 -->
    <UAlert
      v-if="loadError"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="方案加载失败"
      :description="(loadError as any)?.data?.message || '请检查网络后重试；若方案已被删除，请返回方案列表。'"
    >
      <template #actions>
        <UButton size="xs" color="error" variant="soft" @click="() => refresh()">重试</UButton>
        <UButton size="xs" color="neutral" variant="ghost" to="/information/plans">返回列表</UButton>
      </template>
    </UAlert>

    <!-- 加载态 -->
    <div
      v-else-if="!data"
      class="grid min-h-64 place-items-center text-sm text-slate-400"
    >
      <div class="text-center">
        <UIcon name="i-lucide-loader" class="mx-auto mb-3 size-8 animate-spin" />
        <p>加载中...</p>
      </div>
    </div>

    <div v-else class="space-y-6">
      <!-- ══════════ 1. 头部 ══════════ -->
      <section class="rounded-2xl border border-slate-200 bg-white p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <h1 class="text-xl font-semibold text-slate-900">{{ data.title }}</h1>
            <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
              <span v-if="data.student">
                <span class="text-slate-400">学生</span>
                {{ data.student.name }}
                <span v-if="data.student.gender" class="text-slate-400">({{ data.student.gender }})</span>
              </span>
              <span v-if="data.class">
                <span class="text-slate-400">班级</span>
                {{ data.class.name }}
                <template v-if="data.class.grade">({{ data.class.grade }}年级)</template>
              </span>
              <span class="text-slate-400">{{ moduleTitle(data.module) }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <UBadge
              :color="riskVariant(data.report?.risk?.severity)"
              variant="soft"
              size="md"
            >
              {{ data.report?.risk?.label || data.report?.risk?.level || '未知' }}
            </UBadge>
            <UBadge :color="statusVariant(data.status)" variant="soft" size="md">
              {{ statusText(data.status) }}
            </UBadge>
          </div>
        </div>
      </section>

      <section
        v-if="['pending_acceptance', 'adjustment_needed'].includes(data.status)"
        class="rounded-2xl border border-amber-200 bg-amber-50 p-5"
      >
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-sm font-semibold text-amber-900">方案确认</p>
            <p class="mt-1 text-sm leading-6 text-amber-800">
              请先确认这份方案是否适合当前场景。不适用或暂不执行会进入学校后台运营清单，便于后续协同和三库优化。
            </p>
          </div>
          <UButton color="success" icon="i-lucide-check" :loading="acceptancePending" @click="updateAcceptance('accepted')">
            接受执行
          </UButton>
        </div>
        <UFormField class="mt-4" label="暂不执行或不适用原因">
          <UTextarea v-model="acceptanceForm.reason" :rows="2" class="w-full" placeholder="例如：当前对象不适合、需要先与年级组确认、方案动作暂时过难" />
        </UFormField>
        <div class="mt-3 flex flex-wrap gap-2">
          <UButton color="neutral" variant="soft" :disabled="acceptanceForm.reason.trim().length < 4" :loading="acceptancePending" @click="updateAcceptance('deferred')">暂不执行</UButton>
          <UButton color="warning" variant="soft" :disabled="acceptanceForm.reason.trim().length < 4" :loading="acceptancePending" @click="updateAcceptance('not_applicable')">标记不适用</UButton>
        </div>
      </section>

      <!-- ══════════ 2. 来源评估卡片 ══════════ -->
      <section
        v-if="data.sourceAssessment"
        class="rounded-2xl border border-slate-200 bg-white"
      >
        <button
          class="flex w-full items-center justify-between p-5 text-left font-semibold text-slate-800"
          @click="sourceExpanded = !sourceExpanded"
        >
          <span class="flex items-center gap-2">
            <UIcon name="i-lucide-clipboard-check" class="size-4 text-emerald-600" />
            来源评估
          </span>
          <UIcon
            :name="sourceExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            class="size-4 text-slate-400"
          />
        </button>
        <div v-if="sourceExpanded" class="border-t border-slate-100 px-5 pb-5 pt-4">
          <div class="grid gap-3 text-sm md:grid-cols-3">
            <div>
              <span class="text-slate-400">评估模块</span>
              <p class="mt-1 font-medium">{{ moduleTitle(data.sourceAssessment.module) }}</p>
            </div>
            <div>
              <span class="text-slate-400">结果</span>
              <p class="mt-1 font-medium">
                {{ data.sourceAssessment.result?.risk?.label || data.sourceAssessment.result?.profile?.title || '-' }}
              </p>
            </div>
            <div>
              <span class="text-slate-400">提交时间</span>
              <p class="mt-1 font-medium">
                {{ data.sourceAssessment.submittedAt
                  ? new Date(data.sourceAssessment.submittedAt).toLocaleString('zh-CN')
                  : '-' }}
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- ══════════ 3. 方案执行表单（跟踪动作 + 反馈） ══════════ -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5">
        <div class="flex items-center justify-between">
          <h3 class="flex items-center gap-2 font-semibold text-slate-800">
            <UIcon name="i-lucide-list-checks" class="size-4 text-indigo-600" />
            方案执行
          </h3>
          <span class="text-xs text-slate-400">
            {{ completedActionCount }}/{{ activeActions.length }} 项完成
          </span>
        </div>

        <div v-if="!activeActions.length" class="mt-4 rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-400">
          暂无跟踪动作
        </div>

        <div class="mt-4 space-y-2">
          <div
            v-for="action in activeActions"
            :key="action.id"
          >
            <!-- 动作主行 -->
            <div
              class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition"
              :class="[
                action.status === 'completed'
                  ? 'border-emerald-100 bg-emerald-50/50'
                  : 'border-slate-100 bg-white hover:border-slate-200',
                actionPendingId === action.id ? 'pointer-events-none opacity-60' : '',
              ]"
              @click="toggleExpand(action.id)"
            >
              <UCheckbox
                :model-value="action.status === 'completed'"
                :disabled="actionPendingId === action.id"
                @click.stop
                @update:model-value="toggleAction(action.id, action.status)"
              />
              <div class="min-w-0 flex-1">
                <p
                  class="text-sm font-medium"
                  :class="action.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-800'"
                >
                  {{ action.title }}
                </p>
                <p class="mt-1 text-xs leading-5 text-slate-500">{{ action.detail }}</p>
                <!-- 截止日期 -->
                <p v-if="action.dueAt" class="mt-1 text-xs text-amber-600">
                  截止：{{ formatDate(action.dueAt) }}
                </p>
                <p v-if="action.blockReason" class="mt-1 text-xs text-red-600">
                  受阻原因：{{ blockReasonOptions.find(item => item.value === action.blockReason)?.label || action.blockReason }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <UBadge
                  :color="action.status === 'completed' ? 'success' : action.status === 'blocked' ? 'error' : action.status === 'in_progress' ? 'info' : action.status === 'skipped' ? 'neutral' : 'warning'"
                  variant="soft"
                  size="xs"
                >
                  {{ actionStatusText(action.status) }}
                </UBadge>
                <!-- 已完成且有反馈: 显示反馈摘要 -->
                <span
                  v-if="action.status === 'completed' && action.executionNote"
                  class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700"
                >
                  已反馈
                </span>
                <!-- 已完成但无反馈: 提示可补充 -->
                <span
                  v-else-if="action.status === 'completed'"
                  class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
                >
                  未反馈
                </span>
                <UIcon
                  v-if="actionPendingId === action.id"
                  name="i-lucide-loader"
                  class="size-4 animate-spin text-slate-400"
                />
                <UIcon
                  v-else
                  :name="expandedActionId === action.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                  class="size-4 text-slate-400"
                />
              </div>
            </div>

            <!-- 展开区域：执行反馈表单 或 已记录反馈 -->
            <div
              v-if="expandedActionId === action.id"
              class="-mt-px rounded-b-xl border border-t-0 border-slate-100 bg-slate-50 p-4"
            >
              <!-- 已完成/受阻/跳过动作 → 展示已记录的反馈 -->
              <template v-if="['completed', 'blocked', 'skipped'].includes(action.status)">
                <div class="grid gap-3 text-sm">
                  <div>
                    <span class="text-xs text-slate-400">状态</span>
                    <p class="mt-0.5 font-medium text-slate-700">{{ actionStatusText(action.status) }}</p>
                  </div>
                  <div v-if="action.executedAt">
                    <span class="text-xs text-slate-400">执行时间</span>
                    <p class="mt-0.5 font-medium text-slate-700">{{ formatDate(action.executedAt) }}</p>
                  </div>
                  <div v-if="action.blockReason">
                    <span class="text-xs text-slate-400">受阻原因</span>
                    <p class="mt-0.5 text-red-700">{{ blockReasonOptions.find(item => item.value === action.blockReason)?.label || action.blockReason }}</p>
                  </div>
                  <div v-if="action.blockNote">
                    <span class="text-xs text-slate-400">受阻说明</span>
                    <p class="mt-0.5 leading-6 text-slate-700">{{ action.blockNote }}</p>
                  </div>
                  <div v-if="action.executionNote">
                    <span class="text-xs text-slate-400">执行结果</span>
                    <p class="mt-0.5 leading-6 text-slate-700">{{ action.executionNote }}</p>
                  </div>
                  <div v-if="action.evidenceSummary">
                    <span class="text-xs text-slate-400">证据摘要</span>
                    <p class="mt-0.5 leading-6 text-slate-700">{{ action.evidenceSummary }}</p>
                  </div>
                  <div v-if="action.status === 'completed' && !action.executionNote">
                    <p class="text-xs text-amber-600">
                      <UIcon name="i-lucide-info" class="mr-1 inline size-3" />
                      尚未记录执行反馈，可点击勾选框撤销后重新标记完成。
                    </p>
                  </div>
                </div>
              </template>

              <!-- 未完成动作 → 反馈表单 -->
              <template v-else>
                <div class="grid gap-4 md:grid-cols-2">
                  <UFormField label="执行日期">
                    <UInput
                      v-model="execForm.executedAt"
                      type="datetime-local"
                      class="w-full"
                    />
                  </UFormField>
                  <div />
                </div>
                <UFormField class="mt-3" label="执行结果">
                  <UTextarea
                    v-model="execForm.executionNote"
                    :rows="2"
                    class="w-full"
                    placeholder="这次行动的具体执行情况和结果（如观察到的变化、遇到的困难等）"
                  />
                </UFormField>
                <div class="mt-3 grid gap-3 md:grid-cols-3">
                  <UFormField label="证据类型">
                    <USelect
                      v-model="execForm.evidenceType"
                      :items="[
                        { label: '无', value: 'none' },
                        { label: '观察记录', value: 'observation' },
                        { label: '沟通纪要', value: 'communication' },
                        { label: '执行产物', value: 'artifact' }
                      ]"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="把握度">
                    <USelect v-model="execForm.teacherConfidence" :items="[1, 2, 3, 4, 5].map(v => ({ label: `${v} / 5`, value: v }))" class="w-full" />
                  </UFormField>
                  <div class="flex items-end">
                    <UButton color="primary" variant="soft" block :loading="actionPendingId === action.id" @click="updateActionStatus(action.id, 'in_progress')">
                      标记进行中
                    </UButton>
                  </div>
                </div>
                <UFormField class="mt-3" label="证据摘要">
                  <UInput v-model="execForm.evidenceSummary" class="w-full" placeholder="例如：已完成一次观察记录；不要填写完整敏感正文" />
                </UFormField>
                <div class="mt-4 rounded-xl border border-red-100 bg-white p-3">
                  <div class="grid gap-3 md:grid-cols-[12rem_1fr]">
                    <UFormField label="受阻原因">
                      <USelect v-model="execForm.blockReason" :items="blockReasonOptions" class="w-full" />
                    </UFormField>
                    <UFormField label="受阻说明">
                      <UInput v-model="execForm.blockNote" class="w-full" placeholder="说明卡点，便于学校后台协同" />
                    </UFormField>
                  </div>
                  <div class="mt-3 flex justify-end">
                    <UButton
                      color="error"
                      variant="soft"
                      size="sm"
                      :disabled="!execForm.blockReason || (execForm.blockReason === 'other' && execForm.blockNote.trim().length < 2)"
                      :loading="actionPendingId === action.id"
                      @click="submitBlocked(action.id)"
                    >
                      标记受阻
                    </UButton>
                  </div>
                </div>
                <div class="mt-3 flex justify-end gap-2">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="() => { expandedActionId = null }"
                  >
                    取消
                  </UButton>
                  <UButton color="neutral" variant="soft" size="sm" :loading="actionPendingId === action.id" @click="updateActionStatus(action.id, 'skipped')">
                    跳过
                  </UButton>
                  <UButton
                    color="success"
                    size="sm"
                    :loading="actionPendingId === action.id"
                    @click="submitExecution(action.id)"
                  >
                    保存并标记完成
                  </UButton>
                </div>
              </template>
            </div>
          </div>
        </div>
      </section>

      <!-- ══════════ 4. 专业方案工作单 ══════════ -->
      <section v-if="data.report?.profile" class="rounded-2xl bg-slate-50 p-6">
        <p class="text-xs font-semibold text-emerald-700">专业方案工作单</p>
        <h3 class="mt-1 text-lg font-semibold">{{ data.report.profile.title }}</h3>
        <p class="mt-3 text-sm leading-7 text-slate-600">{{ data.report.profile.summary }}</p>

        <div class="mt-5 grid gap-3 md:grid-cols-3">
          <div class="rounded-xl border border-emerald-100 bg-white p-4">
            <p class="text-xs font-semibold text-emerald-700">归因构成</p>
            <!-- 有完整归因构成时按强弱分组呈现，否则回退到旧的主/次归因文本 -->
            <template v-if="attributions.length">
              <div v-for="attribution in attributions" :key="attribution.name" class="mt-2 flex items-start gap-2">
                <UBadge
                  size="xs"
                  :color="attribution.strength === 'primary' ? 'primary' : 'neutral'"
                  :variant="attribution.strength === 'primary' ? 'solid' : 'soft'"
                >
                  {{ attributionStrengthLabel(attribution.strength) }}
                </UBadge>
                <p class="text-sm leading-5" :class="attribution.strength === 'primary' ? 'font-semibold text-slate-800' : 'text-slate-600'">
                  {{ attribution.name }}
                </p>
              </div>
            </template>
            <template v-else>
              <p class="mt-2 text-sm font-semibold text-slate-800">{{ planStructure?.attribution?.primary || data.report.profile.primaryConcern }}</p>
              <p v-if="planStructure?.attribution?.secondary?.length" class="mt-2 text-xs leading-5 text-slate-500">
                次归因：{{ planStructure.attribution.secondary.join('、') }}
              </p>
            </template>
          </div>
          <div class="rounded-xl border border-sky-100 bg-white p-4">
            <p class="text-xs font-semibold text-sky-700">本周支持目标</p>
            <p class="mt-2 text-sm leading-6 text-slate-700">{{ supportGoal.weeklyGoal }}</p>
          </div>
          <div class="rounded-xl border border-amber-100 bg-white p-4">
            <p class="text-xs font-semibold text-amber-700">今天第一步</p>
            <p class="mt-2 text-sm font-semibold text-slate-800">{{ firstAction?.title || '完成一个最小行动' }}</p>
            <p class="mt-1 text-xs leading-5 text-slate-500">{{ firstAction?.detail || '先记录当前事实和一个可执行动作。' }}</p>
          </div>
        </div>

        <div class="mt-5 grid gap-3 md:grid-cols-2">
          <div class="rounded-xl bg-white p-4">
            <p class="text-sm font-semibold text-slate-700">可观察变化</p>
            <p class="mt-2 text-xs leading-6 text-slate-600">{{ supportGoal.observableChange }}</p>
          </div>
          <div class="rounded-xl bg-white p-4">
            <p class="text-sm font-semibold text-slate-700">暂不追求</p>
            <p class="mt-2 text-xs leading-6 text-slate-600">{{ supportGoal.avoidGoal }}</p>
          </div>
        </div>

        <div v-if="data.report.evidence?.length" class="mt-5">
          <h4 class="text-sm font-semibold text-slate-700">归因依据</h4>
          <div class="mt-3 grid gap-3 md:grid-cols-2">
            <div
              v-for="item in data.report.evidence"
              :key="item.title + item.detail"
              class="rounded-xl bg-white p-3"
            >
              <p class="text-sm font-semibold">{{ item.title }}</p>
              <p class="mt-1 text-xs leading-5 text-slate-500">{{ item.detail }}</p>
            </div>
          </div>
        </div>

        <div v-if="data.report.threeDayPlan?.length" class="mt-5">
          <h4 class="text-sm font-semibold text-slate-700">3 天行动方案</h4>
          <div class="mt-3 grid gap-3 md:grid-cols-3">
            <div
              v-for="day in data.report.threeDayPlan"
              :key="day.day"
              class="rounded-xl border border-emerald-100 bg-white p-4"
            >
              <p class="text-sm font-semibold">第 {{ day.day }} 天 · {{ day.title }}</p>
              <p
                v-for="action in day.actions"
                :key="action.title"
                class="mt-2 text-xs leading-5 text-slate-600"
              >
                {{ action.title }}：{{ action.detail }}
              </p>
            </div>
          </div>
        </div>

        <div v-if="toolPrescriptions.length" class="mt-5">
          <h4 class="text-sm font-semibold text-slate-700">工具处方</h4>
          <div class="mt-3 grid gap-3 md:grid-cols-2">
            <div v-for="tool in toolPrescriptions" :key="tool.title" class="rounded-xl border border-amber-100 bg-white p-4">
              <p class="text-sm font-semibold text-slate-800">{{ tool.title }}</p>
              <p class="mt-2 text-xs leading-5 text-amber-700">{{ tool.applicableWhen }}</p>

              <!-- V2: 结构化步骤 (优先) -->
              <div v-if="tool._hasStructuredSteps && tool._structuredSteps" class="mt-3 space-y-3">
                <p class="text-xs font-medium text-slate-500">操作步骤</p>
                <div v-for="step in tool._structuredSteps" :key="step.seq" class="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div class="flex items-center gap-2">
                    <span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">{{ step.seq }}</span>
                    <strong class="text-xs text-slate-800">{{ step.title }}</strong>
                    <span v-if="step.estimatedTime" class="text-xs text-slate-400">{{ step.estimatedTime }}</span>
                  </div>
                  <p class="mt-1.5 text-xs leading-5 text-slate-600">{{ step.description }}</p>
                  <div v-if="step.keyTip" class="mt-2 rounded bg-amber-50 p-2 text-xs leading-5 text-amber-800">
                    <span class="font-medium">关键提示：</span>{{ step.keyTip }}
                  </div>
                  <p v-if="step.successCriteria" class="mt-1.5 text-xs text-emerald-700">
                    <span class="font-medium">成功标准：</span>{{ step.successCriteria }}
                  </p>
                  <div v-if="step.materials" class="mt-1.5 text-xs text-slate-400">材料：{{ step.materials }}</div>
                </div>
              </div>

              <!-- V1: 传统步骤列表 (fallback) -->
              <ol v-else-if="tool.steps.length" class="mt-3 space-y-1 text-xs leading-5 text-slate-600">
                <li v-for="(step, index) in tool.steps" :key="index">{{ Number(index) + 1 }}. {{ step }}</li>
              </ol>

              <p v-if="tool.script" class="mt-3 rounded-lg bg-emerald-50 p-2 text-xs leading-5 text-emerald-900">话术：{{ tool.script }}</p>
              <p v-if="tool.outputArtifact" class="mt-2 text-xs text-slate-500">输出物：{{ tool.outputArtifact }}</p>
              <p v-if="tool.estimatedTime" class="mt-1 text-xs text-slate-500">建议耗时：{{ tool.estimatedTime }}</p>
              <div v-if="tool.prohibitions?.length" class="mt-3 rounded-lg bg-red-50 p-2 text-xs leading-5 text-red-800">
                禁忌：{{ Array.isArray(tool.prohibitions) ? tool.prohibitions.join('；') : tool.prohibitions }}
              </div>
            </div>
          </div>
        </div>

        <div class="mt-5 grid gap-3 md:grid-cols-2">
          <div v-if="successCriteria.length" class="rounded-xl bg-white p-4">
            <p class="text-sm font-semibold text-slate-700">成功标准</p>
            <ul class="mt-2 space-y-1 text-xs leading-5 text-slate-600">
              <li v-for="item in successCriteria" :key="item">· {{ item }}</li>
            </ul>
          </div>
          <div v-if="escalationConditions.length" class="rounded-xl border border-red-100 bg-red-50/60 p-4">
            <p class="text-sm font-semibold text-red-800">升级条件</p>
            <ul class="mt-2 space-y-1 text-xs leading-5 text-red-800">
              <li v-for="item in escalationConditions" :key="item">· {{ item }}</li>
            </ul>
          </div>
        </div>
      </section>

      <!-- ══════════ 5. 复盘时间线 ══════════ -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 class="flex items-center gap-2 font-semibold text-slate-800">
          <UIcon name="i-lucide-clock" class="size-4 text-slate-600" />
          复盘时间线
        </h3>

        <div class="mt-4 space-y-3">
          <div
            v-for="review in data.reviews"
            :key="review.id"
            class="rounded-xl border border-slate-100 p-4"
          >
            <div class="flex justify-between gap-3">
              <strong class="text-sm">效果 {{ review.effectScore }}/5</strong>
              <span class="text-xs text-slate-400">
                {{ new Date(review.reviewAt).toLocaleString('zh-CN') }}
              </span>
            </div>
            <p class="mt-2 text-sm leading-6 text-slate-600">{{ review.progressNote }}</p>
            <p class="mt-2 text-xs text-emerald-700">下一步：{{ review.nextAction }}</p>
          </div>
          <p
            v-if="!data.reviews?.length"
            class="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-400"
          >
            还没有复盘记录，在下方新增。
          </p>
        </div>
      </section>

      <!-- ══════════ 6. 新增复盘 ══════════ -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 class="flex items-center gap-2 font-semibold text-slate-800">
          <UIcon name="i-lucide-plus-circle" class="size-4 text-emerald-600" />
          新增复盘
        </h3>

        <div class="mt-4 grid gap-4 md:grid-cols-[8rem_1fr_12rem]">
          <UFormField label="效果评分">
            <USelect
              v-model="reviewForm.effectScore"
              :items="[1, 2, 3, 4, 5].map(v => ({ label: `${v} / 5`, value: v }))"
              class="w-full"
            />
          </UFormField>
          <UFormField label="下一步动作">
            <UInput v-model="reviewForm.nextAction" class="w-full" placeholder="后续跟进计划" />
          </UFormField>
          <UFormField label="复盘决策">
            <USelect v-model="reviewForm.decision" :items="reviewDecisionOptions" class="w-full" />
          </UFormField>
        </div>

        <UFormField class="mt-4" label="进展说明">
          <UTextarea
            v-model="reviewForm.progressNote"
            :rows="3"
            class="w-full"
            placeholder="描述本阶段的进展、观察和反思"
          />
        </UFormField>

        <!-- 本次完成动作多选 -->
        <div v-if="activeActions.filter(a => a.status !== 'completed').length" class="mt-4">
          <p class="mb-2 text-xs font-medium text-slate-500">本次完成了哪些动作？（勾选后自动标记为已完成）</p>
          <div class="space-y-1 rounded-xl border border-slate-100 p-3">
            <label
              v-for="action in activeActions.filter(a => a.status !== 'completed')"
              :key="action.id"
              class="flex cursor-pointer items-center gap-2.5 py-1 text-sm"
            >
              <UCheckbox
                :model-value="reviewForm.completedActionIds.includes(action.id)"
                @update:model-value="(checked: boolean | string) => {
                  if (checked) {
                    reviewForm.completedActionIds.push(action.id)
                  } else {
                    reviewForm.completedActionIds = reviewForm.completedActionIds.filter(id => id !== action.id)
                  }
                }"
              />
              <span class="text-slate-700">{{ action.title }}</span>
            </label>
          </div>
        </div>

        <div class="mt-4 flex justify-end">
          <UButton
            :loading="pending"
            :disabled="
              reviewForm.progressNote.trim().length < 4 ||
              reviewForm.nextAction.trim().length < 2
            "
            @click="createReview"
          >
            保存复盘
          </UButton>
        </div>
      </section>

      <!-- ══════════ 7. 方案质量反馈 ══════════ -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h3 class="flex items-center gap-2 font-semibold text-slate-800">
            <UIcon name="i-lucide-message-square-check" class="size-4 text-sky-600" />
            方案质量反馈
          </h3>
          <UBadge color="neutral" variant="soft">{{ data.feedback?.length || 0 }} 次反馈</UBadge>
        </div>

        <div v-if="data.feedback?.length" class="mt-4 rounded-xl bg-sky-50 p-3 text-xs leading-5 text-sky-900">
          最近反馈：归因 {{ data.feedback[0].attributionAccuracy }}/5 · 工具 {{ data.feedback[0].toolUsability }}/5 · 复盘 {{ data.feedback[0].reviewUsefulness }}/5
        </div>

        <div class="mt-4 grid gap-3 md:grid-cols-5">
          <UFormField label="归因准确">
            <USelect v-model="feedbackForm.attributionAccuracy" :items="[1, 2, 3, 4, 5].map(v => ({ label: `${v}`, value: v }))" class="w-full" />
          </UFormField>
          <UFormField label="工具可用">
            <USelect v-model="feedbackForm.toolUsability" :items="[1, 2, 3, 4, 5].map(v => ({ label: `${v}`, value: v }))" class="w-full" />
          </UFormField>
          <UFormField label="话术自然">
            <USelect v-model="feedbackForm.scriptNaturalness" :items="[1, 2, 3, 4, 5].map(v => ({ label: `${v}`, value: v }))" class="w-full" />
          </UFormField>
          <UFormField label="行动难度">
            <USelect v-model="feedbackForm.actionDifficulty" :items="[1, 2, 3, 4, 5].map(v => ({ label: `${v}`, value: v }))" class="w-full" />
          </UFormField>
          <UFormField label="复盘有效">
            <USelect v-model="feedbackForm.reviewUsefulness" :items="[1, 2, 3, 4, 5].map(v => ({ label: `${v}`, value: v }))" class="w-full" />
          </UFormField>
        </div>

        <div class="mt-4">
          <p class="mb-2 text-xs font-medium text-slate-500">反馈标签</p>
          <div class="flex flex-wrap gap-2">
            <label v-for="tag in feedbackTags" :key="tag" class="flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs">
              <UCheckbox
                :model-value="feedbackForm.tags.includes(tag)"
                @update:model-value="checked => toggleFeedbackTag(tag, checked)"
              />
              <span>{{ tag }}</span>
            </label>
          </div>
        </div>

        <UFormField class="mt-4" label="补充说明">
          <UTextarea v-model="feedbackForm.note" :rows="3" class="w-full" placeholder="可简单说明哪里有用、哪里不贴合；不要填写完整敏感正文。" />
        </UFormField>

        <div class="mt-4 flex justify-end">
          <UButton :loading="feedbackPending" @click="submitFeedback">提交质量反馈</UButton>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { moduleMeta } from '#shared/assessments'

type PlanAction = {
  id: string; sequence: number; title: string; detail: string;
  status: string; dueAt: string | null; completedAt: string | null;
  executedAt: string | null; executionNote: string | null;
}

const route = useRoute()
const id = String(route.params.id)
const { data, refresh } = await useFetch<any>(`/api/v1/plans/${id}`)
const pending = ref(false)
const actionPendingId = ref<string | null>(null)
const sourceExpanded = ref(false)
const expandedActionId = ref<string | null>(null)

// 执行反馈表单状态
const execForm = reactive({
  executedAt: '',
  executionNote: '',
})

const reviewForm = reactive({
  effectScore: 3,
  progressNote: '',
  nextAction: '',
  completedActionIds: [] as string[],
})

function moduleTitle(module: string) {
  return (moduleMeta as Record<string, { title: string }>)[module]?.title || module
}

function riskVariant(level: string): 'error' | 'warning' | 'success' | 'neutral' {
  const map: Record<string, 'error' | 'warning' | 'success' | 'neutral'> = {
    high: 'error', medium: 'warning', low: 'success',
  }
  return map[level] || 'neutral'
}

function statusText(status: string) {
  const map: Record<string, string> = { in_progress: '进行中', completed: '已完成', archived: '已归档' }
  return map[status] || status
}

function statusVariant(status: string): 'info' | 'success' | 'neutral' {
  const map: Record<string, 'info' | 'success' | 'neutral'> = {
    in_progress: 'info', completed: 'success', archived: 'neutral',
  }
  return map[status] || 'neutral'
}

const activeActions = computed<PlanAction[]>(() => {
  return data.value?.actions || []
})

const completedActionCount = computed(() =>
  activeActions.value.filter(a => a.status === 'completed').length
)

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
  } else {
    expandedActionId.value = null
  }
}

// 提交执行反馈并标记完成
async function submitExecution(actionId: string) {
  actionPendingId.value = actionId
  try {
    await $fetch(`/api/v1/plans/${data.value!.id}/actions`, {
      method: 'PATCH',
      body: {
        actionId,
        status: 'completed',
        executedAt: execForm.executedAt ? new Date(execForm.executedAt).toISOString() : undefined,
        executionNote: execForm.executionNote.trim() || undefined,
      },
    })
    expandedActionId.value = null
    await refresh()
  } finally {
    actionPendingId.value = null
  }
}

// 简单 toggle（撤销完成或标记未完成时直接切换）
async function toggleAction(actionId: string, currentStatus: string) {
  const next = currentStatus === 'completed' ? 'pending' : 'completed'

  // 标记完成 → 展开反馈表单，由 submitExecution 完成提交
  if (next === 'completed') {
    toggleExpand(actionId)
    return
  }

  // 撤销完成 → 直接切换
  actionPendingId.value = actionId
  try {
    await $fetch(`/api/v1/plans/${data.value!.id}/actions`, {
      method: 'PATCH',
      body: { actionId, status: next },
    })
    await refresh()
  } finally {
    actionPendingId.value = null
  }
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
        completedActionIds:
          reviewForm.completedActionIds.length ? reviewForm.completedActionIds : undefined,
      },
    })
    Object.assign(reviewForm, {
      effectScore: 3, progressNote: '', nextAction: '', completedActionIds: [],
    })
    await refresh()
  } finally {
    pending.value = false
  }
}

useHead({ title: () => data.value?.title || '方案详情' })
</script>

<template>
  <div class="mx-auto max-w-4xl px-5 py-10">
    <!-- 返回 -->
    <div class="mb-6">
      <UButton to="/information?tab=plans" color="neutral" variant="ghost" icon="i-lucide-arrow-left" size="sm">
        返回方案列表
      </UButton>
    </div>

    <!-- 加载态 -->
    <div
      v-if="!data"
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
              :color="riskVariant(data.report?.risk?.level)"
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
              </div>
              <div class="flex shrink-0 items-center gap-2">
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
              <!-- 已完成动作 → 展示已记录的反馈 -->
              <template v-if="action.status === 'completed'">
                <div class="grid gap-3 text-sm">
                  <div>
                    <span class="text-xs text-slate-400">执行时间</span>
                    <p class="mt-0.5 font-medium text-slate-700">{{ formatDate(action.executedAt) }}</p>
                  </div>
                  <div v-if="action.executionNote">
                    <span class="text-xs text-slate-400">执行结果</span>
                    <p class="mt-0.5 leading-6 text-slate-700">{{ action.executionNote }}</p>
                  </div>
                  <div v-else>
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
                <div class="mt-3 flex justify-end gap-2">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="() => { expandedActionId = null }"
                  >
                    取消
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

      <!-- ══════════ 4. 工具资源 ══════════ -->
      <section v-if="data.tools?.length" class="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 class="flex items-center gap-2 font-semibold text-slate-800">
          <UIcon name="i-lucide-wrench" class="size-4 text-amber-600" />
          工具资源
        </h3>
        <div class="mt-4 grid gap-3 md:grid-cols-2">
          <div
            v-for="(tool, i) in data.tools"
            :key="i"
            class="rounded-xl border border-amber-100 bg-amber-50/50 p-4"
          >
            <p class="text-sm font-semibold text-slate-800">{{ tool.title }}</p>
            <p class="mt-2 text-xs leading-6 text-slate-600">{{ tool.content }}</p>
          </div>
        </div>
      </section>

      <!-- ══════════ 5. AI 报告 ══════════ -->
      <section v-if="data.report?.profile" class="rounded-2xl bg-slate-50 p-6">
        <p class="text-xs font-semibold text-emerald-700">AI 评估报告</p>
        <h3 class="mt-1 text-lg font-semibold">{{ data.report.profile.title }}</h3>
        <p class="mt-3 text-sm leading-7 text-slate-600">{{ data.report.profile.summary }}</p>

        <!-- 证据项 -->
        <div v-if="data.report.evidence?.length" class="mt-4 grid gap-3 md:grid-cols-2">
          <div
            v-for="item in data.report.evidence"
            :key="item.title + item.detail"
            class="rounded-xl bg-white p-3"
          >
            <p class="text-sm font-semibold">{{ item.title }}</p>
            <p class="mt-1 text-xs leading-5 text-slate-500">{{ item.detail }}</p>
          </div>
        </div>

        <!-- 3 天方案 -->
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
      </section>

      <!-- ══════════ 6. 复盘时间线 ══════════ -->
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

      <!-- ══════════ 7. 新增复盘 ══════════ -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 class="flex items-center gap-2 font-semibold text-slate-800">
          <UIcon name="i-lucide-plus-circle" class="size-4 text-emerald-600" />
          新增复盘
        </h3>

        <div class="mt-4 grid gap-4 md:grid-cols-[8rem_1fr]">
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
    </div>
  </div>
</template>
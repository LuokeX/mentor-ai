<script setup lang="ts">
import { moduleIdSchema } from '#shared/contracts'
import { moduleMeta, type AssessmentDefinition } from '#shared/assessments'
import type { AssessmentReport } from '#shared/reports'

interface ContextOption {
  id: string
  type: 'student' | 'class' | 'guardian'
  label: string
  description?: string
}

interface PlanDetail {
  id: string
  nextReviewAt?: string | null
  actions: Array<{
    id: string
    title: string
    detail: string
    status: string
    dueAt?: string | null
  }>
}

const route = useRoute()
const moduleId = moduleIdSchema.parse(route.params.id)
const sourceChatSessionId = computed(() => typeof route.query.sourceChatSessionId === 'string' ? route.query.sourceChatSessionId : undefined)
const { data: definition } = await useFetch<AssessmentDefinition>(`/api/v1/assessments/${moduleId}`)
const { data: contextOptions } = await useFetch<any>('/api/v1/chat/context-options')
const toast = useToast()

const answers = reactive<Record<string, number>>({})
const current = ref(0)
const started = ref(false)
const draftLoaded = ref(false)
const draftUpdatedAt = ref<string>()
const attemptId = ref<string>()
const pending = ref(false)
const output = ref<any>(null)
const planDetail = ref<PlanDetail | null>(null)
const submitError = ref('')
const draftSaveError = ref('')
const allowUnlinked = ref(false)
const selectedContextKey = ref('none')
let saveTimer: ReturnType<typeof setTimeout> | undefined
let saveInFlight: Promise<void> | undefined

const contextRules: Record<string, Array<ContextOption['type']>> = {
  self_growth: [],
  class_system: ['class'],
  home_school: ['guardian', 'student'],
  student_case: ['student'],
  learning_problem: ['student']
}
const requiredContext = computed(() => moduleId === 'student_case' || moduleId === 'learning_problem')
const allowedContextTypes = computed(() => contextRules[moduleId] || [])
const allContextOptions = computed<ContextOption[]>(() => [
  ...((contextOptions.value?.students || []).map((item: any) => ({ ...item, type: 'student' as const }))),
  ...((contextOptions.value?.classes || []).map((item: any) => ({ ...item, type: 'class' as const }))),
  ...((contextOptions.value?.guardians || []).map((item: any) => ({ ...item, type: 'guardian' as const })))
])
const moduleContextOptions = computed(() => allContextOptions.value.filter(item => allowedContextTypes.value.includes(item.type)))
const contextSelectItems = computed(() => [
  { label: requiredContext.value ? '暂不关联（仅做匿名梳理）' : '暂不关联（通用评估）', value: 'none' },
  ...moduleContextOptions.value.map(item => ({
    label: `${item.type === 'student' ? '学生' : item.type === 'class' ? '班级' : '家长'} · ${item.label}`,
    value: `${item.type}:${item.id}`
  }))
])
const selectedContext = computed(() => {
  if (selectedContextKey.value === 'none') return null
  const [type, id] = selectedContextKey.value.split(':')
  return moduleContextOptions.value.find(item => item.type === type && item.id === id) || null
})
const dimensions = computed(() => [...new Set(definition.value?.questions.map(item => item.dimension) || [])])
const question = computed(() => definition.value?.questions[current.value])
const answeredCount = computed(() => Object.keys(answers).length)
const hasDraft = computed(() => Boolean(attemptId.value || answeredCount.value))
const progress = computed(() => definition.value ? Math.round(answeredCount.value / definition.value.questions.length * 100) : 0)
const report = computed<AssessmentReport | null>(() => output.value?.report || output.value?.result?.report || null)
const firstAction = computed(() => planDetail.value?.actions.find(item => item.status !== 'completed') || planDetail.value?.actions[0] || null)

function formatDate(value?: string | null) {
  if (!value) return '待安排'
  return new Date(value).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

function printReport() {
  window.print()
}

function firstUnansweredIndex() {
  if (!definition.value) return 0
  const index = definition.value.questions.findIndex(item => answers[item.id] === undefined)
  return index < 0 ? Math.max(definition.value.questions.length - 1, 0) : index
}

function canStart() {
  if (!requiredContext.value || selectedContext.value || allowUnlinked.value) return true
  toast.add({ title: '请先选择学生', description: '若当前只想匿名梳理，也可以勾选下方确认后继续。', color: 'warning' })
  return false
}

async function startAssessment(resume: boolean) {
  if (!canStart()) return
  if (!resume) {
    Object.keys(answers).forEach(key => delete answers[key])
    current.value = 0
    localStorage.removeItem(`assessment-draft:${moduleId}`)
    if (attemptId.value) {
      try {
        await saveDraft()
        draftUpdatedAt.value = new Date().toISOString()
      } catch (error: any) {
        toast.add({ title: '新评估初始化失败', description: error?.data?.message || '请稍后重试', color: 'error' })
        return
      }
    }
  } else {
    current.value = firstUnansweredIndex()
  }
  started.value = true
}

function choose(value: number) {
  if (!question.value || !definition.value) return
  answers[question.value.id] = value
  localStorage.setItem(`assessment-draft:${moduleId}`, JSON.stringify(answers))
  localStorage.setItem(`assessment-context:${moduleId}`, selectedContextKey.value)
  draftSaveError.value = ''
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveInFlight = saveDraft().catch((error: any) => {
      draftSaveError.value = error?.data?.message || '草稿暂未同步到服务器，请检查网络后继续。'
    })
  }, 450)
  if (current.value < definition.value.questions.length - 1) setTimeout(() => current.value++, 120)
}

async function saveDraft() {
  const result = await $fetch<{ attemptId: string, updatedAt?: string }>(`/api/v1/assessments/${moduleId}/draft`, {
    method: 'PATCH', body: { attemptId: attemptId.value, answers: { ...answers } }
  })
  attemptId.value = result.attemptId
  draftUpdatedAt.value = result.updatedAt
}

watch(selectedContextKey, (value) => {
  allowUnlinked.value = false
  if (import.meta.client) localStorage.setItem(`assessment-context:${moduleId}`, value)
})

onMounted(async () => {
  const queryType = typeof route.query.contextType === 'string' ? route.query.contextType : ''
  const queryId = typeof route.query.contextId === 'string' ? route.query.contextId : ''
  const storedContext = localStorage.getItem(`assessment-context:${moduleId}`)
  selectedContextKey.value = queryType && queryId ? `${queryType}:${queryId}` : storedContext || 'none'

  const localDraft = localStorage.getItem(`assessment-draft:${moduleId}`)
  if (localDraft) {
    try { Object.assign(answers, JSON.parse(localDraft)) } catch { localStorage.removeItem(`assessment-draft:${moduleId}`) }
  }
  try {
    const serverDraft = await $fetch<{ id: string, answers: Record<string, number>, updatedAt: string } | null>(`/api/v1/assessments/${moduleId}/draft`)
    if (serverDraft) {
      attemptId.value = serverDraft.id
      draftUpdatedAt.value = serverDraft.updatedAt
      Object.assign(answers, serverDraft.answers)
    }
  } catch (error: any) {
    toast.add({ title: '云端草稿加载失败', description: error?.data?.message || '仍可开始评估，答案会保存在当前设备。', color: 'warning' })
  } finally {
    draftLoaded.value = true
  }
})

async function submit() {
  if (!selectedContext.value && requiredContext.value && !allowUnlinked.value) {
    started.value = false
    canStart()
    return
  }
  pending.value = true
  submitError.value = ''
  try {
    if (saveTimer) clearTimeout(saveTimer)
    if (saveInFlight) await saveInFlight
    output.value = await $fetch(`/api/v1/assessments/${moduleId}/submit`, {
      method: 'POST',
      body: {
        attemptId: attemptId.value,
        answers,
        studentId: selectedContext.value?.type === 'student' ? selectedContext.value.id : undefined,
        classId: selectedContext.value?.type === 'class' ? selectedContext.value.id : undefined,
        guardianId: selectedContext.value?.type === 'guardian' ? selectedContext.value.id : undefined,
        sourceChatSessionId: sourceChatSessionId.value
      }
    })
    localStorage.removeItem(`assessment-draft:${moduleId}`)
    if (output.value?.planId) {
      planDetail.value = await $fetch<PlanDetail>(`/api/v1/plans/${output.value.planId}`).catch(() => null)
    }
  } catch (error: any) {
    submitError.value = error?.data?.message || error?.message || '提交失败，请检查网络后重试。'
  } finally {
    pending.value = false
  }
}

async function askAssistantAboutReport() {
  if (!report.value) return
  const actionText = firstAction.value ? `\n第一个行动：${firstAction.value.title}——${firstAction.value.detail}` : ''
  const prompt = `我刚完成「${report.value.printMeta.moduleTitle}」评估。报告提示“${report.value.risk.label}”，主要关注是“${report.value.profile.primaryConcern}”。${actionText}\n请帮我解释这意味着什么，并把第一个行动拆成今天能完成的具体步骤；如果信息不足，只问我一个关键问题。`
  sessionStorage.setItem('assistant-prefill', JSON.stringify({
    prompt,
    contextKey: selectedContext.value ? `${selectedContext.value.type}:${selectedContext.value.id}` : 'none'
  }))
  await navigateTo('/')
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-5 py-10">
    <UButton to="/" variant="ghost" color="neutral" icon="i-lucide-arrow-left">返回工作台</UButton>

    <section v-if="definition && !started && !output" class="mt-6 grid gap-6 lg:grid-cols-[.42fr_.58fr]">
      <aside class="panel h-fit p-6 sm:p-7">
        <div class="grid size-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><UIcon :name="moduleMeta[moduleId].icon" class="size-6" /></div>
        <p class="mt-5 text-sm font-semibold text-emerald-700">评估前说明</p>
        <h1 class="mt-2 text-2xl font-semibold">{{ definition.title }}</h1>
        <p class="mt-3 text-sm leading-6 text-slate-500">{{ definition.description }}</p>
        <div class="mt-6 grid grid-cols-2 gap-3 text-sm">
          <div class="rounded-xl bg-slate-50 p-3"><span class="block text-xs text-slate-400">预计用时</span><strong class="mt-1 block">约 {{ definition.estimatedMinutes }} 分钟</strong></div>
          <div class="rounded-xl bg-slate-50 p-3"><span class="block text-xs text-slate-400">题目数量</span><strong class="mt-1 block">{{ definition.questions.length }} 题</strong></div>
        </div>
        <p class="mt-5 text-xs leading-5 text-slate-400">本评估用于教育工作场景梳理，不构成医学或心理诊断。结果仅供您制定支持行动。</p>
      </aside>

      <div class="space-y-5">
        <section class="panel p-6 sm:p-7">
          <h2 class="text-lg font-semibold">它会帮你看什么</h2>
          <div class="mt-4 flex flex-wrap gap-2"><UBadge v-for="item in dimensions" :key="item" color="neutral" variant="soft">{{ item }}</UBadge></div>
          <div class="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
            完成后会生成确定性评估报告、3 天行动方案和 7 天复盘节点；到期动作会进入“今日待办”。
          </div>
        </section>

        <section v-if="allowedContextTypes.length" class="panel p-6 sm:p-7">
          <div class="flex items-start gap-3"><div class="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-700"><UIcon name="i-lucide-link" class="size-4" /></div><div><h2 class="font-semibold">先选择本次评估对象</h2><p class="mt-1 text-xs leading-5 text-slate-500">关联后，报告和行动方案会回到对应档案，后续复盘更连贯。</p></div></div>
          <USelect v-model="selectedContextKey" :items="contextSelectItems" class="mt-4 w-full" />
          <UAlert v-if="selectedContext" class="mt-3" color="info" variant="soft" title="已关联对象" :description="selectedContext.label" />
          <div v-else-if="requiredContext" class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <label class="flex cursor-pointer items-start gap-3 text-sm text-amber-950"><input v-model="allowUnlinked" type="checkbox" class="mt-1 size-4 accent-amber-600"><span>我确认本次只做匿名梳理，生成的方案不会关联到具体学生档案。</span></label>
          </div>
          <UAlert v-if="requiredContext && !moduleContextOptions.length" class="mt-3" color="warning" variant="soft" title="还没有可选学生" description="可先到信息管理中心录入或接收学生档案，再回来完成关联评估。" />
          <UButton v-if="requiredContext && !moduleContextOptions.length" to="/information?tab=students" class="mt-3" color="neutral" variant="soft" icon="i-lucide-user-plus">去录入学生</UButton>
        </section>

        <section class="panel p-6 sm:p-7">
          <div v-if="!draftLoaded" class="flex items-center gap-3 text-sm text-slate-500"><UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />正在检查未完成草稿……</div>
          <template v-else-if="hasDraft">
            <div class="flex items-start gap-3"><div class="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><UIcon name="i-lucide-file-clock" class="size-4" /></div><div><h2 class="font-semibold">发现未完成评估</h2><p class="mt-1 text-xs text-slate-500">已完成 {{ answeredCount }} / {{ definition.questions.length }} 题<template v-if="draftUpdatedAt"> · {{ new Date(draftUpdatedAt).toLocaleString('zh-CN') }} 保存</template></p></div></div>
            <div class="mt-5 flex flex-wrap gap-3"><UButton icon="i-lucide-play" @click="startAssessment(true)">继续未完成评估</UButton><UButton color="neutral" variant="soft" @click="startAssessment(false)">重新开始</UButton></div>
          </template>
          <template v-else>
            <h2 class="font-semibold">准备好后开始完整评估</h2>
            <p class="mt-2 text-sm text-slate-500">作答会自动保存，可以随时离开后继续。</p>
            <UButton class="mt-5" icon="i-lucide-arrow-right" trailing @click="startAssessment(false)">开始完整评估</UButton>
          </template>
        </section>
      </div>
    </section>

    <div v-if="definition && started && !output" class="mt-6 grid gap-6 lg:grid-cols-[.36fr_.64fr]">
      <aside class="panel h-fit p-6">
        <div class="grid size-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><UIcon :name="moduleMeta[moduleId].icon" class="size-6" /></div>
        <h1 class="mt-5 text-2xl font-semibold">{{ definition.title }}</h1>
        <p class="mt-3 text-sm leading-6 text-slate-500">{{ definition.description }}</p>
        <div v-if="selectedContext" class="mt-5 rounded-xl bg-sky-50 p-3 text-xs text-sky-900"><UIcon name="i-lucide-link" class="mr-1 inline size-3.5" />本次关联：{{ selectedContext.label }}</div>
        <div class="mt-6"><div class="mb-2 flex justify-between text-xs"><span>完成进度</span><span>{{ progress }}%</span></div><UProgress :model-value="progress" /></div>
        <p class="mt-4 text-xs text-slate-400">约 {{ definition.estimatedMinutes }} 分钟 · 自动保存草稿</p>
        <UButton class="mt-4" color="neutral" variant="ghost" size="sm" icon="i-lucide-settings-2" @click="() => { started = false }">返回调整评估对象</UButton>
      </aside>
      <section class="panel p-6 sm:p-9">
        <UAlert v-if="draftSaveError" class="mb-5" color="warning" variant="soft" title="草稿同步失败" :description="draftSaveError" />
        <UAlert v-if="submitError" class="mb-5" color="error" variant="soft" title="提交失败" :description="submitError" />
        <div class="flex items-center justify-between"><UBadge color="neutral" variant="soft">{{ question?.dimension }}</UBadge><span class="text-sm text-slate-400">{{ current + 1 }} / {{ definition.questions.length }}</span></div>
        <h2 class="mt-8 min-h-24 text-2xl font-medium leading-10">{{ question?.text }}</h2>
        <p v-if="question?.help" class="mt-2 text-sm leading-6 text-slate-500">{{ question.help }}</p>
        <div class="mt-7 space-y-3">
          <button v-for="option in question?.options" :key="option.value" type="button" class="flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-50" :class="answers[question!.id] === option.value ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white'" @click="choose(option.value)">
            <span class="grid size-8 shrink-0 place-items-center rounded-full border text-sm" :class="answers[question!.id] === option.value ? 'border-emerald-600 bg-emerald-700 text-white' : 'border-slate-200'">{{ option.value }}</span><span>{{ option.label }}</span>
          </button>
        </div>
        <div class="mt-8 flex justify-between">
          <UButton color="neutral" variant="soft" :disabled="current === 0" @click="() => { current-- }">上一题</UButton>
          <UButton v-if="current < definition.questions.length - 1" :disabled="!answers[question!.id]" @click="() => { current++ }">下一题</UButton>
          <UButton v-else :disabled="progress < 100" :loading="pending" @click="submit">提交并生成方案</UButton>
        </div>
      </section>
    </div>

    <section v-if="output" class="report-page mt-6 space-y-6">
      <div v-if="output.fuse" class="panel border-2 border-red-200 bg-red-50 p-7"><div class="flex gap-4"><UIcon name="i-lucide-siren" class="size-7 text-red-600" /><div><h1 class="text-xl font-semibold text-red-900">已启动安全转介</h1><p class="mt-2 text-sm text-red-800">{{ output.fuse.crisisGuide }}</p><p class="mt-3 text-xs text-red-600">事件编号：{{ output.fuse.eventId }}</p></div></div></div>
      <template v-else-if="report">
        <section v-if="output.planId" class="panel border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6 sm:p-7">
          <div class="flex flex-wrap items-start justify-between gap-4"><div><p class="text-sm font-semibold text-emerald-700">评估完成 · 行动方案已创建</p><h1 class="mt-2 text-2xl font-semibold">先完成一个最小行动</h1><p class="mt-2 text-sm text-slate-600">系统已安排 3 天行动，并在 {{ formatDate(planDetail?.nextReviewAt) }} 进入复盘提醒。</p></div><UIcon name="i-lucide-circle-check-big" class="size-9 text-emerald-600" /></div>
          <div v-if="firstAction" class="mt-5 rounded-2xl border border-emerald-100 bg-white p-4"><div class="flex flex-wrap items-center justify-between gap-2"><strong>{{ firstAction.title }}</strong><UBadge color="neutral" variant="soft">{{ formatDate(firstAction.dueAt) }} 前</UBadge></div><p class="mt-2 text-sm leading-6 text-slate-600">{{ firstAction.detail }}</p></div>
          <div class="mt-5 flex flex-wrap gap-3"><UButton :to="`/information/plans/${output.planId}`" icon="i-lucide-list-checks">开始执行第一个行动</UButton><UButton color="neutral" variant="soft" icon="i-lucide-message-circle-question" @click="askAssistantAboutReport">带着报告问助手</UButton></div>
        </section>
        <div class="print-actions flex flex-wrap justify-end gap-2"><UButton icon="i-lucide-printer" color="neutral" variant="soft" @click="printReport">打印/归档</UButton><UButton v-if="output.planId" :to="`/information/plans/${output.planId}`" icon="i-lucide-history">进入复盘记录</UButton></div>
        <div class="panel report-sheet p-7 sm:p-9">
          <div class="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-6">
            <div><p class="text-sm font-semibold text-emerald-700">正式评估报告</p><h1 class="mt-2 text-3xl font-semibold">{{ report.printMeta.moduleTitle }}</h1><p class="mt-2 text-xs text-slate-400">生成时间：{{ new Date(report.printMeta.generatedAt).toLocaleString('zh-CN') }} · 版本：{{ report.printMeta.assessmentVersion }}</p></div>
            <UBadge size="xl" color="primary" variant="soft">{{ report.risk.label }}</UBadge>
          </div>
          <div class="mt-7 grid gap-6 lg:grid-cols-[.95fr_1.05fr]">
            <section><h2 class="text-lg font-semibold">问题画像</h2><p class="mt-3 text-sm leading-7 text-slate-600">{{ report.profile.summary }}</p><p class="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">主要关注：{{ report.profile.primaryConcern }}</p></section>
            <section><h2 class="text-lg font-semibold">风险等级</h2><p class="mt-3 text-sm leading-7 text-slate-600">{{ report.risk.description }}</p><p class="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">{{ report.risk.nonDiagnosticNote }}</p></section>
          </div>
          <section class="mt-8"><h2 class="text-lg font-semibold">关键依据</h2><div class="mt-4 grid gap-3 md:grid-cols-2"><div v-for="item in report.evidence" :key="item.title + item.detail" class="rounded-xl border border-slate-100 p-4"><p class="text-sm font-semibold">{{ item.title }}</p><p class="mt-2 text-xs leading-5 text-slate-500">{{ item.detail }}</p></div></div></section>
          <section class="mt-8"><h2 class="text-lg font-semibold">3 天行动方案</h2><div class="mt-4 grid gap-4 md:grid-cols-3"><div v-for="day in report.threeDayPlan" :key="day.day" class="rounded-xl bg-emerald-50 p-4"><p class="text-sm font-semibold text-emerald-900">第 {{ day.day }} 天 · {{ day.title }}</p><div class="mt-3 space-y-3"><div v-for="action in day.actions" :key="action.title"><p class="text-sm font-medium">{{ action.title }}</p><p class="mt-1 text-xs leading-5 text-slate-600">{{ action.detail }}</p></div></div></div></div></section>
          <section class="mt-8 grid gap-6 lg:grid-cols-3"><div><h2 class="text-lg font-semibold">7 天观察点</h2><ul class="mt-3 space-y-2 text-sm text-slate-600"><li v-for="item in report.sevenDayFollowUp.observationPoints" :key="item">· {{ item }}</li></ul></div><div><h2 class="text-lg font-semibold">复盘问题</h2><ul class="mt-3 space-y-2 text-sm text-slate-600"><li v-for="item in report.sevenDayFollowUp.reviewQuestions" :key="item">· {{ item }}</li></ul></div><div><h2 class="text-lg font-semibold">升级信号</h2><ul class="mt-3 space-y-2 text-sm text-slate-600"><li v-for="item in report.sevenDayFollowUp.escalationSignals" :key="item">· {{ item }}</li></ul></div></section>
          <section class="mt-8"><h2 class="text-lg font-semibold">沟通话术</h2><div class="mt-4 grid gap-4 md:grid-cols-2"><div v-for="script in report.scripts" :key="script.scenario" class="rounded-xl border border-emerald-100 bg-white p-4"><p class="text-sm font-semibold text-emerald-900">{{ script.scenario }}</p><p class="mt-2 text-sm leading-6 text-slate-600">{{ script.text }}</p></div></div></section>
          <section class="mt-8"><h2 class="text-lg font-semibold">工具卡</h2><div class="mt-4 grid gap-4 md:grid-cols-2"><div v-for="tool in output.result.tools" :key="tool.title" class="rounded-xl bg-slate-50 p-4"><p class="text-sm font-semibold">{{ tool.title }}</p><p class="mt-2 text-xs leading-5 text-slate-500">{{ tool.content }}</p></div></div></section>
          <p class="mt-8 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-400">{{ report.printMeta.disclaimer }}</p>
        </div>
      </template>
      <div class="print-actions flex gap-3"><UButton to="/">返回工作台</UButton><UButton to="/information?tab=plans" color="neutral" variant="soft">查看方案记录</UButton></div>
    </section>
  </div>
</template>

<style scoped>
@media print {
  :global(header),
  .print-actions {
    display: none !important;
  }
  .report-page {
    margin: 0 !important;
  }
  .report-sheet {
    border: 0 !important;
    box-shadow: none !important;
    padding: 0 !important;
  }
}
</style>

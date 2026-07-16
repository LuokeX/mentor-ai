<script setup lang="ts">
import { moduleIdSchema } from '#shared/contracts'
import { moduleMeta, type AssessmentDefinition } from '#shared/assessments'
import type { AssessmentReport } from '#shared/reports'

const route = useRoute()
const moduleId = moduleIdSchema.parse(route.params.id)
const contextType = computed(() => typeof route.query.contextType === 'string' ? route.query.contextType : undefined)
const contextId = computed(() => typeof route.query.contextId === 'string' ? route.query.contextId : undefined)
const sourceChatSessionId = computed(() => typeof route.query.sourceChatSessionId === 'string' ? route.query.sourceChatSessionId : undefined)
const { data: definition } = await useFetch<AssessmentDefinition>(`/api/v1/assessments/${moduleId}`)
const answers = reactive<Record<string, number>>({})
const current = ref(0)
const pending = ref(false)
const output = ref<any>(null)
const attemptId = ref<string>()
let saveTimer: ReturnType<typeof setTimeout> | undefined
let saveInFlight: Promise<void> | undefined

const question = computed(() => definition.value?.questions[current.value])
const progress = computed(() => definition.value ? Math.round(Object.keys(answers).length / definition.value.questions.length * 100) : 0)
const report = computed<AssessmentReport | null>(() => output.value?.report || output.value?.result?.report || null)

function printReport() {
  window.print()
}

function choose(value: number) {
  if (!question.value || !definition.value) return
  answers[question.value.id] = value
  localStorage.setItem(`assessment-draft:${moduleId}`, JSON.stringify(answers))
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveInFlight = saveDraft().catch(() => undefined)
  }, 450)
  if (current.value < definition.value.questions.length - 1) setTimeout(() => current.value++, 120)
}

async function saveDraft() {
  const result = await $fetch<{ attemptId: string }>(`/api/v1/assessments/${moduleId}/draft`, {
    method: 'PATCH', body: { attemptId: attemptId.value, answers: { ...answers } }
  })
  attemptId.value = result.attemptId
}

onMounted(async () => {
  const draft = localStorage.getItem(`assessment-draft:${moduleId}`)
  if (draft) {
    try { Object.assign(answers, JSON.parse(draft)) } catch { localStorage.removeItem(`assessment-draft:${moduleId}`) }
  }
  const serverDraft = await $fetch<{ id: string, answers: Record<string, number> } | null>(`/api/v1/assessments/${moduleId}/draft`).catch(() => null)
  if (serverDraft) {
    attemptId.value = serverDraft.id
    Object.assign(answers, serverDraft.answers)
  }
})

async function submit() {
  pending.value = true
  try {
    if (saveTimer) clearTimeout(saveTimer)
    if (saveInFlight) await saveInFlight
    output.value = await $fetch(`/api/v1/assessments/${moduleId}/submit`, {
      method: 'POST',
      body: {
        attemptId: attemptId.value,
        answers,
        studentId: contextType.value === 'student' ? contextId.value : undefined,
        classId: contextType.value === 'class' ? contextId.value : undefined,
        guardianId: contextType.value === 'guardian' ? contextId.value : undefined,
        sourceChatSessionId: sourceChatSessionId.value
      }
    })
    localStorage.removeItem(`assessment-draft:${moduleId}`)
  } finally { pending.value = false }
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-5 py-10">
    <UButton to="/" variant="ghost" color="neutral" icon="i-lucide-arrow-left">返回工作台</UButton>
    <UAlert v-if="contextType && contextId && !output" class="mt-4" color="primary" variant="soft" title="本次评估已绑定咨询对象" description="提交后生成的方案会自动关联到对应学生、班级或家长档案。" />
    <div v-if="definition && !output" class="mt-6 grid gap-6 lg:grid-cols-[.36fr_.64fr]">
      <aside class="panel h-fit p-6">
        <div class="grid size-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><UIcon :name="moduleMeta[moduleId].icon" class="size-6" /></div>
        <h1 class="mt-5 text-2xl font-semibold">{{ definition.title }}</h1>
        <p class="mt-3 text-sm leading-6 text-slate-500">{{ definition.description }}</p>
        <div class="mt-6"><div class="mb-2 flex justify-between text-xs"><span>完成进度</span><span>{{ progress }}%</span></div><UProgress :model-value="progress" /></div>
        <p class="mt-4 text-xs text-slate-400">约 {{ definition.estimatedMinutes }} 分钟 · 已自动保存草稿</p>
      </aside>
      <section class="panel p-6 sm:p-9">
        <div class="flex items-center justify-between"><UBadge color="neutral" variant="soft">{{ question?.dimension }}</UBadge><span class="text-sm text-slate-400">{{ current + 1 }} / {{ definition.questions.length }}</span></div>
        <h2 class="mt-8 min-h-24 text-2xl font-medium leading-10">{{ question?.text }}</h2>
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
        <div class="print-actions flex flex-wrap justify-end gap-2"><UButton icon="i-lucide-printer" color="neutral" variant="soft" @click="printReport">打印/归档</UButton><UButton v-if="output.planId" :to="`/information?tab=plans&plan=${output.planId}`" icon="i-lucide-history">进入复盘记录</UButton></div>
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

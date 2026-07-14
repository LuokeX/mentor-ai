<script setup lang="ts">
import { moduleIdSchema } from '#shared/contracts'
import { moduleMeta, type AssessmentDefinition } from '#shared/assessments'

const route = useRoute()
const moduleId = moduleIdSchema.parse(route.params.id)
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
    output.value = await $fetch(`/api/v1/assessments/${moduleId}/submit`, { method: 'POST', body: { attemptId: attemptId.value, answers } })
    localStorage.removeItem(`assessment-draft:${moduleId}`)
  } finally { pending.value = false }
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-5 py-10">
    <UButton to="/" variant="ghost" color="neutral" icon="i-lucide-arrow-left">返回工作台</UButton>
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

    <section v-if="output" class="mt-6 space-y-6">
      <div v-if="output.fuse" class="panel border-2 border-red-200 bg-red-50 p-7"><div class="flex gap-4"><UIcon name="i-lucide-siren" class="size-7 text-red-600" /><div><h1 class="text-xl font-semibold text-red-900">已启动安全转介</h1><p class="mt-2 text-sm text-red-800">{{ output.fuse.crisisGuide }}</p><p class="mt-3 text-xs text-red-600">事件编号：{{ output.fuse.eventId }}</p></div></div></div>
      <template v-else>
        <div class="panel p-7"><div class="flex flex-wrap items-start justify-between gap-4"><div><p class="text-sm font-semibold text-emerald-700">评估结果</p><h1 class="mt-2 text-3xl font-semibold">{{ moduleMeta[moduleId].title }}</h1></div><UBadge size="xl" color="primary" variant="soft">{{ output.result.level }}</UBadge></div><p v-if="output.result.narrative" class="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm leading-7 text-emerald-950">{{ output.result.narrative }}</p><div class="mt-6 space-y-2"><p v-for="reason in output.result.reasons" :key="reason" class="flex gap-2 text-sm"><UIcon name="i-lucide-check-circle-2" class="mt-0.5 text-emerald-600" />{{ reason }}</p></div></div>
        <div class="grid gap-6 lg:grid-cols-2">
          <div class="panel p-7"><h2 class="font-semibold">维度结果</h2><div class="mt-5 space-y-4"><div v-for="(value, dimension) in output.result.dimensions" :key="dimension"><div class="mb-1 flex justify-between text-sm"><span>{{ dimension }}</span><span>{{ value }}/5</span></div><UProgress :model-value="Number(value) * 20" /></div></div></div>
          <div class="panel p-7"><h2 class="font-semibold">行动建议</h2><div class="mt-4 space-y-3"><div v-for="action in output.result.actions" :key="action.title" class="rounded-2xl bg-slate-50 p-4"><p class="text-sm font-semibold">{{ action.title }}</p><p class="mt-2 text-xs leading-5 text-slate-500">{{ action.detail }}</p></div></div></div>
        </div>
        <div class="panel p-7"><h2 class="font-semibold">配套工具</h2><div class="mt-4 grid gap-4 md:grid-cols-2"><div v-for="tool in output.result.tools" :key="tool.title" class="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-5"><p class="font-semibold text-emerald-900">{{ tool.title }}</p><p class="mt-2 text-sm leading-6 text-emerald-900/70">{{ tool.content }}</p></div></div></div>
      </template>
      <div class="flex gap-3"><UButton to="/">返回工作台</UButton><UButton to="/information" color="neutral" variant="soft">查看方案记录</UButton></div>
    </section>
  </div>
</template>

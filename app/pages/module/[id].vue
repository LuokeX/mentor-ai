<script setup lang="ts">
import { moduleIdSchema } from '#shared/contracts'
import { INSTRUMENT_ROLE_LABELS, type InstrumentRole, type LibraryType } from '#shared/contracts'
import { moduleMeta, type AssessmentDefinition } from '#shared/assessments'

interface ContextOption {
  id: string
  type: 'student' | 'class' | 'guardian'
  label: string
  description?: string
}

interface ModuleResourceOverview {
  assessment: {
    title: string
    code: string
    version: string
    questionCount: number
    sourceVersions: string[]
  }
  tools: {
    tools: Array<{
      title?: string
      scenario?: string
      steps?: string[]
      doNot?: string[]
      sourceRefs?: string[]
      version?: string
    }>
    sourceVersions: string[]
  }
  libraries: Array<{
    id: string
    libraryType: LibraryType
    name: string
    description?: string | null
    scope: 'global' | 'school'
    versionId: string
    version: string
    publishedAt?: string | null
  }>
}

interface InstrumentOption {
  code: string
  title: string
  shortName: string | null
  description: string
  questionCount: number
  estimatedMinutes: number
  role: InstrumentRole | null
  isRequired: boolean
  usageTiming: string | null
  status: 'available' | 'suggested' | 'not_needed' | 'locked' | 'completed'
  triggerCondition: string | null
  triggerConditionNote: string | null
  missingPrerequisites: Array<{ code: string, title: string }>
  blockingExclusives: Array<{ code: string, title: string }>
  lastSubmittedAt: string | null
  lastLevel: string | null
  lastLevelName: string | null
}
interface InstrumentRecommendation {
  instrumentCode: string | null
  instrumentTitle: string | null
  rationale: string
  source: 'ai' | 'ai_override' | 'redirected' | 'fallback'
  originalCode: string | null
  overriddenSuggestion: { code: string, title: string } | null
  pickedNotNeeded: boolean
  options: InstrumentOption[]
}

const route = useRoute()
const moduleId = moduleIdSchema.parse(route.params.id)
const sourceChatSessionId = computed(() => typeof route.query.sourceChatSessionId === 'string' ? route.query.sourceChatSessionId : undefined)
// 从对话分诊进来时会带上关联量表编码和教师原话，用于 AI 推荐
const routedInstrumentCode = computed(() => typeof route.query.instrumentCode === 'string' ? route.query.instrumentCode : undefined)
const routedText = computed(() => typeof route.query.q === 'string' ? route.query.q : undefined)

const {
  data: recommendation,
  error: recommendationError,
  refresh: refreshRecommendation
} = await useFetch<InstrumentRecommendation>(
  `/api/v1/assessments/${moduleId}/recommend`,
  { method: 'POST', body: { text: routedText.value, sourceChatSessionId: sourceChatSessionId.value } }
)

// 优先用 URL 指定的量表；否则用推荐结果；再否则由后端取默认
const selectedCode = ref<string | undefined>(
  routedInstrumentCode.value || recommendation.value?.instrumentCode || undefined
)
const instrumentOptions = computed(() => recommendation.value?.options || [])
const hasMultipleInstruments = computed(() => instrumentOptions.value.length > 1)
const selectedOption = computed(() => instrumentOptions.value.find(item => item.code === selectedCode.value) || null)

/**
 * 按 ③b 的角色把量表分区：入口筛查 → 深度诊断 → 专项/情境 → 未标角色。
 * 任何一张量表都没标角色时保持平铺（存量库），不凭空造分区。
 * 红线检查量表已被服务端按「未命中高危阈值不展示」过滤，不会出现在这里。
 */
const instrumentSections = computed(() => {
  const options = instrumentOptions.value
  if (!options.some(option => option.role)) return [{ key: 'all', label: '', options }]
  const order: Array<InstrumentRole | null> = ['screening', 'deep_dive', 'situational', null]
  return order
    .map(role => ({
      key: role || 'unassigned',
      label: role ? INSTRUMENT_ROLE_LABELS[role] : '其他量表',
      options: options.filter(option => option.role === role)
    }))
    .filter(section => section.options.length)
})

const { data: definition, error: definitionError, refresh: refreshDefinition } = await useFetch<AssessmentDefinition>(
  () => `/api/v1/assessments/${moduleId}`,
  { query: computed(() => selectedCode.value ? { instrumentCode: selectedCode.value } : {}) }
)

/** 切换量表：清空当前作答与草稿状态，重新拉题目 */
async function selectInstrument(code: string) {
  const target = instrumentOptions.value.find(item => item.code === code)
  if (!target || target.status === 'locked') return
  if (code === selectedCode.value) return
  selectedCode.value = code
  for (const key of Object.keys(answers)) delete answers[key]
  current.value = 0
  started.value = false
  attemptId.value = undefined
  draftUpdatedAt.value = undefined
  output.value = null
  await refreshDefinition()
}

const recommendationTitle = computed(() => ({
  ai: 'AI 推荐',
  ai_override: 'AI 推荐（与量表库的建议不同）',
  redirected: '需要先完成前置量表',
  fallback: '按量表库推荐'
}[recommendation.value?.source || 'fallback']))

/** AI 绕过业务触发条件时要说清楚，否则教师看不出这条推荐是否越过了业务判断。 */
const recommendationDescription = computed(() => {
  const rec = recommendation.value
  if (!rec) return ''
  if (rec.source === 'ai_override' && rec.overriddenSuggestion) {
    return `${rec.rationale}（量表库按你此前的作答建议先做「${rec.overriddenSuggestion.title}」，你也可以改选它）`
  }
  if (rec.source === 'ai_override' && rec.pickedNotNeeded) {
    return `${rec.rationale}（量表库按你此前的作答认为这张当前还不需要做，你可以再确认一下）`
  }
  return rec.rationale
})

/** 触发条件未满足时的说明。业务填了「触发条件说明」就用它，否则给一句通用文案。 */
function notNeededReason(option: InstrumentOption) {
  return option.triggerConditionNote
    ? `${option.triggerConditionNote}。当前未达到，可以先不做。`
    : '按量表库的触发条件，当前还不需要做这张。'
}

function instrumentLockReason(option: InstrumentOption) {
  if (option.missingPrerequisites.length) {
    return `请先完成「${option.missingPrerequisites.map(item => item.title).join('」「')}」`
  }
  if (option.blockingExclusives.length) {
    return `与「${option.blockingExclusives.map(item => item.title).join('」「')}」互斥，本次不需要做`
  }
  return ''
}
const { data: resourceOverview, error: resourceError } = await useFetch<ModuleResourceOverview>(`/api/v1/module-resources/${moduleId}`)

/** 重试整页数据。definition 拉不到时页面没有任何可操作内容，必须给一个出口。 */
const retrying = ref(false)
async function retryLoad() {
  retrying.value = true
  try { await Promise.all([refreshDefinition(), refreshRecommendation()]) }
  finally { retrying.value = false }
}
const { data: contextOptions } = await useFetch<any>('/api/v1/chat/context-options')
const toast = useToast()

const answers = reactive<Record<string, number>>({})
const current = ref(0)
const started = ref(false)
// 本地草稿键必须带量表编码，否则同模块两张量表会共用一份本地答案
const draftStorageKey = computed(() => `assessment-draft:${moduleId}:${selectedCode.value || 'default'}`)
const draftLoaded = ref(false)
const draftUpdatedAt = ref<string>()
const attemptId = ref<string>()
const pending = ref(false)
const output = ref<any>(null)
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
const visibleTools = computed(() => resourceOverview.value?.tools.tools.slice(0, 3) || [])
const resourceLibraries = computed(() => resourceOverview.value?.libraries || [])

const libraryTypeLabels: Record<LibraryType, string> = {
  assessment: '评估库',
  attribution: '归因库',
  tool: '工具库',
  output_template: '输出模板库',
  keyword_route: '关键词路由库'
}

function libraryTypeLabel(type: LibraryType) {
  return libraryTypeLabels[type] || type
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
    localStorage.removeItem(draftStorageKey.value)
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
  localStorage.setItem(draftStorageKey.value, JSON.stringify(answers))
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
    // 必须带 instrumentCode：不带的话服务端会按模块默认量表校验并落库，
    // 题号重合时这次作答会被记成另一张量表。
    method: 'PATCH', body: { attemptId: attemptId.value, answers: { ...answers }, instrumentCode: selectedCode.value }
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

  const localDraft = localStorage.getItem(draftStorageKey.value)
  if (localDraft) {
    try { Object.assign(answers, JSON.parse(localDraft)) } catch { localStorage.removeItem(draftStorageKey.value) }
  }
  try {
    const serverDraft = await $fetch<{ id: string, answers: Record<string, number>, updatedAt: string } | null>(`/api/v1/assessments/${moduleId}/draft`, {
      query: selectedCode.value ? { instrumentCode: selectedCode.value } : {}
    })
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
        sourceChatSessionId: sourceChatSessionId.value,
        instrumentCode: selectedCode.value
      }
    })
    localStorage.removeItem(draftStorageKey.value)
    attemptId.value = undefined
    // 提交后量表状态会变（这张变 completed，被它的触发条件解锁的那张变 suggested）。
    // 不刷新的话教师返回选择器看到的还是提交前的状态，得手动刷页面才对。
    await refreshRecommendation().catch(() => undefined)
    // 报告与方案统一在方案详情页查看：提交成功后直接跳转，不再停留完成页。
    if (output.value?.planId) {
      await navigateTo(`/plans/${output.value.planId}`)
      return
    }
    if (!output.value?.planId && !output.value?.fuse) {
      submitError.value = '评估已保存，但方案生成失败。请稍后在方案列表中查看，或联系管理员。'
    }
  } catch (error: any) {
    submitError.value = error?.data?.message || error?.message || '提交失败，请检查网络后重试。'
  } finally {
    pending.value = false
  }
}

</script>

<template>
  <div class="mx-auto max-w-5xl px-5 py-10">
    <UButton to="/" variant="ghost" color="neutral" icon="i-lucide-arrow-left">返回工作台</UButton>

    <!-- definition 拉不到时下面三个主 section 全部不渲染，页面会只剩一个返回按钮。
         必须显式给出错误和重试入口，否则教师只会觉得「页面坏了」。 -->
    <UAlert
      v-if="definitionError"
      class="mt-6"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="量表加载失败"
      :description="(definitionError as any)?.data?.message || '请检查网络后重试；若持续失败请联系平台管理员确认量表库已发布。'"
    >
      <template #actions>
        <UButton size="xs" color="error" variant="soft" :loading="retrying" @click="retryLoad">重试</UButton>
      </template>
    </UAlert>

    <!-- 推荐失败时选择器会整块消失、静默用默认量表。必须说明这一点。 -->
    <UAlert
      v-else-if="recommendationError"
      class="mt-6"
      color="warning"
      variant="soft"
      icon="i-lucide-info"
      title="AI 量表推荐暂不可用"
      description="已按量表库的默认量表继续；如需换一张，请重试后再选。"
    >
      <template #actions>
        <UButton size="xs" color="warning" variant="soft" :loading="retrying" @click="retryLoad">重试</UButton>
      </template>
    </UAlert>

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

        <section class="panel p-6 sm:p-7">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold">模块资源中心</h2>
              <p class="mt-1 text-xs leading-5 text-slate-500">当前量表、归因和工具都会优先使用校本发布版本；没有校本版本时自动回到平台基线。</p>
            </div>
            <UBadge v-if="resourceOverview?.assessment" color="primary" variant="soft">评估 {{ resourceOverview.assessment.version }}</UBadge>
          </div>
          <div v-if="resourceLibraries.length" class="mt-4 flex flex-wrap gap-2">
            <UBadge v-for="library in resourceLibraries" :key="library.versionId" color="neutral" variant="soft">
              {{ libraryTypeLabel(library.libraryType) }} · {{ library.scope === 'school' ? '校本' : '平台' }} v{{ library.version }}
            </UBadge>
          </div>
          <div v-if="visibleTools.length" class="mt-5 grid gap-3 md:grid-cols-3">
            <article v-for="tool in visibleTools" :key="tool.title || tool.scenario" class="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <p class="text-sm font-semibold">{{ tool.title || '工具卡' }}</p>
              <p class="mt-2 line-clamp-3 text-xs leading-5 text-slate-500">{{ tool.scenario || tool.steps?.[0] || '已发布工具可在本模块场景中调用。' }}</p>
            </article>
          </div>
          <UAlert v-else-if="resourceLibraries.length" class="mt-4" color="info" variant="soft" title="资源已发布" description="本模块已有量表或归因资源；工具卡发布后会在这里直接展示。" />
          <!-- 拉取失败和「确实没发布」是两回事，不能都说成「暂未发布模块资源」 -->
          <UAlert v-else-if="resourceError" class="mt-4" color="warning" variant="soft" title="模块资源加载失败" description="这不代表资源未发布，只是这次没取到。评估仍可正常进行。" />
          <UAlert v-else class="mt-4" color="warning" variant="soft" title="暂未发布模块资源" description="系统会暂时使用内置评估基线；归因和工具匹配不会让 AI 自由编造。" />
        </section>

        <!--
          量表选择器。模块下只有一张量表时不显示，保持原来的单量表体验。
          推荐来自 AI（LLM 从可做量表里挑）或规则兜底，教师始终可以改选。
        -->
        <section v-if="hasMultipleInstruments" class="panel p-6 sm:p-7">
          <div class="flex items-start gap-3">
            <div class="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
              <UIcon name="i-lucide-list-checks" class="size-4" />
            </div>
            <div>
              <h2 class="font-semibold">本次做哪张量表</h2>
              <p class="mt-1 text-xs leading-5 text-slate-500">
                这个模块有 {{ instrumentOptions.length }} 张量表。系统已按你的描述推荐了一张，你也可以自己改选。
              </p>
            </div>
          </div>

          <UAlert
            v-if="recommendation?.rationale"
            class="mt-4"
            :color="recommendation.source === 'redirected' || recommendation.source === 'ai_override' ? 'warning' : 'primary'"
            variant="soft"
            :title="recommendationTitle"
            :description="recommendationDescription"
          />

          <div class="mt-4 space-y-5">
            <div v-for="section in instrumentSections" :key="section.key">
              <p v-if="section.label" class="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-400">
                <span class="inline-block h-px w-4 bg-slate-200" />{{ section.label }}
              </p>
              <div class="space-y-3">
                <button
                  v-for="option in section.options"
                  :key="option.code"
                  type="button"
                  :disabled="option.status === 'locked'"
                  class="w-full rounded-xl border p-4 text-left transition"
                  :class="option.status === 'locked'
                    ? 'cursor-not-allowed border-slate-100 bg-slate-50 opacity-60'
                    : option.code === selectedCode
                      ? 'border-emerald-300 bg-emerald-50'
                      : option.status === 'not_needed'
                        ? 'border-slate-200 bg-white opacity-70 hover:border-emerald-200'
                        : 'border-slate-200 bg-white hover:border-emerald-200'"
                  @click="selectInstrument(option.code)"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-semibold text-slate-800">{{ option.title }}</span>
                    <UBadge v-if="option.isRequired" size="xs" color="primary" variant="soft">必做</UBadge>
                    <UBadge v-if="option.code === recommendation?.instrumentCode" size="xs" color="primary">推荐</UBadge>
                    <UBadge v-if="option.status === 'completed'" size="xs" color="neutral" variant="soft">
                      已完成{{ option.lastLevelName ? ` · ${option.lastLevelName}` : '' }}
                    </UBadge>
                    <UBadge v-if="option.status === 'suggested'" size="xs" color="warning" variant="soft">建议做</UBadge>
                    <UBadge v-if="option.status === 'not_needed'" size="xs" color="neutral" variant="soft">当前不需要</UBadge>
                    <UBadge v-if="option.status === 'locked'" size="xs" color="neutral" variant="soft">未解锁</UBadge>
                  </div>
                  <p class="mt-1.5 text-xs leading-5 text-slate-500">{{ option.description }}</p>
                  <p class="mt-1.5 text-xs text-slate-400">
                    {{ option.questionCount }} 题 · 约 {{ option.estimatedMinutes }} 分钟
                    <span v-if="option.usageTiming"> · {{ option.usageTiming }}</span>
                  </p>
                  <p v-if="option.status === 'locked'" class="mt-2 text-xs font-medium text-amber-700">
                    {{ instrumentLockReason(option) }}
                  </p>
                  <p v-else-if="option.status === 'not_needed'" class="mt-2 text-xs text-slate-500">
                    {{ notNeededReason(option) }}仍可手动选择。
                  </p>
                  <p v-else-if="option.status === 'suggested' && option.triggerConditionNote" class="mt-2 text-xs font-medium text-amber-700">
                    {{ option.triggerConditionNote }} —— 已达到，建议做。
                  </p>
                </button>
              </div>
            </div>
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
          <UButton v-if="requiredContext && !moduleContextOptions.length" to="/information/students" class="mt-3" color="neutral" variant="soft" icon="i-lucide-user-plus">去录入学生</UButton>
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
          <!-- 用 === undefined 判断，不能用真值：0 是合法分值（0/1 二值选项组），会被当成未作答 -->
          <UButton v-if="current < definition.questions.length - 1" :disabled="answers[question!.id] === undefined" @click="() => { current++ }">下一题</UButton>
          <UButton v-else :disabled="progress < 100" :loading="pending" @click="submit">提交并生成方案</UButton>
        </div>
      </section>
    </div>

    <section v-if="output" class="report-page mt-6 space-y-6">
      <!-- 安全熔断：必须停留在当前页展示转介指引，不跳方案页 -->
      <div v-if="output.fuse" class="panel border-2 border-red-200 bg-red-50 p-7"><div class="flex gap-4"><UIcon name="i-lucide-siren" class="size-7 text-red-600" /><div><h1 class="text-xl font-semibold text-red-900">已启动安全转介</h1><p class="mt-2 text-sm text-red-800">{{ output.fuse.crisisGuide }}</p><p class="mt-3 text-xs text-red-600">事件编号：{{ output.fuse.eventId }}</p></div></div></div>
      <!-- 非熔断：提交成功后自动跳转方案详情页，此提示仅作跳转前的过渡 -->
      <div v-else class="panel p-7 text-center text-sm text-slate-500">
        <p>评估完成，正在进入方案详情…</p>
      </div>
      <div class="print-actions flex gap-3"><UButton to="/">返回工作台</UButton><UButton to="/plans" color="neutral" variant="soft">查看方案记录</UButton></div>
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

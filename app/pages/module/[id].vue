<script setup lang="ts">
import { moduleIdSchema } from '#shared/contracts'
import { INSTRUMENT_ROLE_LABELS, type InstrumentRole } from '#shared/contracts'
import { moduleMeta, type AssessmentDefinition } from '#shared/assessments'

/** 模块主题色图标底色；写成完整 class 字面量以便 Tailwind 扫描生成 */
const moduleIconTone: Record<string, string> = {
  emerald: 'bg-emerald-100 text-emerald-700',
  sky: 'bg-sky-100 text-sky-700',
  amber: 'bg-amber-100 text-amber-700',
  violet: 'bg-violet-100 text-violet-700',
  rose: 'bg-rose-100 text-rose-700'
}

interface ContextOption {
  id: string
  type: 'student' | 'class' | 'guardian'
  label: string
  description?: string
}

interface InstrumentOption {  code: string
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
const meta = moduleMeta[moduleId]
/** 是否从 AI 对话分诊跳转进来（带会话 id 或教师原话）。两种入口的引导语完全不同。 */
const fromChat = computed(() => Boolean(sourceChatSessionId.value || routedText.value))

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

/**
 * 评估前分两步：先选量表（pick），选定后进评估准备（prepare，选对象 / 续草稿 / 开始作答）。
 * 模块只有一张量表时没有可选项，直接进第二步，保持原来的单量表体验。
 */
const stage = ref<'pick' | 'prepare'>(hasMultipleInstruments.value ? 'pick' : 'prepare')
const hasRoleSections = computed(() => instrumentSections.value.some(section => section.label))
const completedCount = computed(() => instrumentOptions.value.filter(option => option.status === 'completed').length)

/**
 * 量表列表上方的一句引导语。
 * 从 AI 对话进来时已经有一张按教师描述推荐的量表，教师只需确认或改选；
 * 直接进模块时没有任何上下文，按「入口筛查 → 深度诊断」的编排顺序引导。
 */
const pickerHint = computed(() => {
  const total = instrumentOptions.value.length
  if (fromChat.value) return `模块有 ${total} 张量表，系统已按你的描述推荐了一张，你也可以自己改选。`
  if (completedCount.value) return `模块有 ${total} 张量表，已完成 ${completedCount.value} 张；可以继续做建议的量表，也可以重做已完成的量表。`
  if (hasRoleSections.value) return '首次评估，建议优先选用入口筛查量表，逐个解锁深度诊断量表。'
  return `模块有 ${total} 张量表，选一张开始评估。`
})

/** 推荐说明只在 AI 参与或被前置量表改推时才有信息量，规则兜底时不占版面。 */
const showRecommendationNote = computed(
  () => Boolean(recommendation.value?.rationale) && recommendation.value?.source !== 'fallback'
)

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
  submitted.value = false
  pendingChoice.value = null
  for (const key of Object.keys(answers)) delete answers[key]
  current.value = 0
  started.value = false
  attemptId.value = undefined
  draftUpdatedAt.value = undefined
  output.value = null
  await refreshDefinition()
  // 草稿按「模块 + 量表」分别存，换量表后必须重新读，否则这张的未完成作答不会出现在续做入口
  await loadDraft()
}

/** 卡片上的「去评估」：选中该量表并进入评估准备。 */
async function pickInstrument(option: InstrumentOption) {
  if (option.status === 'locked') return
  await selectInstrument(option.code)
  stage.value = 'prepare'
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
/** 已点击提交：答案锁定，不能再改选项、不能上下翻题（finalize 失败时也只能重试生成方案） */
const submitted = ref(false)
/** 提交后检测到可继续的深度诊断量表时置位，让教师选择「立即接着做 / 先查看方案」 */
const pendingChoice = ref<InstrumentOption | null>(null)
/** 连续量表流程：全部建议量表完成后进入 finalize 生成方案 */
const flowState = ref<'idle' | 'finalizing'>('idle')
const finalizeError = ref('')
/** 连续量表流程：评估组 id（首次提交后由服务端返回；本地持久化以支持刷新后续做） */
const assessmentSessionId = ref<string>()
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
const question = computed(() => definition.value?.questions[current.value])
const answeredCount = computed(() => Object.keys(answers).length)
const hasDraft = computed(() => Boolean(attemptId.value || answeredCount.value))
const progress = computed(() => definition.value ? Math.round(answeredCount.value / definition.value.questions.length * 100) : 0)

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
  submitted.value = false
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
  if (submitted.value) return // 已提交的评估答案锁定，不可再修改
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
  // 连续量表流程：恢复上次评估组，刷新后继续做同一组的下一张量表。
  // 服务端会对续接的组做新鲜度校验（24 小时未提交视为过期），过期后自动开新组，
  // 因此这里即使带着旧 id 也不会把跨天的新问题误并入旧流程。
  const storedSession = localStorage.getItem(`assessment-session:${moduleId}`)
  if (storedSession) assessmentSessionId.value = storedSession

  await loadDraft()
})

/** 读取当前量表的草稿：本地先回填，服务端草稿为准。进页面和换量表时都要走一遍。 */
async function loadDraft() {
  draftLoaded.value = false
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
}

/** 绿色兜底结果页（submit/finalize 共用）：仍处于「建议做」状态、可继续完成的量表。 */
const suggestedInstrument = computed(() => instrumentOptions.value.find(item => item.status === 'suggested') || null)

/** 从「状态良好，无需方案」结果页直接进入下一张建议量表作答（沿用同一评估组续链）。 */
async function continueSuggestedInstrument() {
  const next = suggestedInstrument.value
  if (!next) return
  output.value = null
  await selectInstrument(next.code)
  started.value = true
}

/** 提交后的选择：立即接着做第二张（沿用同一评估组），答案锁定解除进入新量表作答。 */
async function continueChosenInstrument() {
  const next = pendingChoice.value
  if (!next) return
  pendingChoice.value = null
  await selectInstrument(next.code)
  started.value = true
}

/** 提交后的选择：先查看方案——基于组内已有结果生成方案，深度诊断以方案待办形式呈现。 */
async function skipChosenInstrument() {
  pendingChoice.value = null
  await finalizeAndGo()
}

/** 全部建议量表完成后，聚合评估组内结果统一生成方案并跳转方案详情页。失败时停留当前页可重试。 */
async function finalizeAndGo() {
  if (!assessmentSessionId.value) return
  flowState.value = 'finalizing'
  finalizeError.value = ''
  try {
    const result = await $fetch<{ planId: string, noPlanNeeded?: boolean, levelName?: string }>(`/api/v1/assessments/${moduleId}/finalize`, {
      method: 'POST',
      body: { sessionId: assessmentSessionId.value }
    })
    // 绿色兜底：状态良好无需方案，停留当前页展示结论。
    if (result?.noPlanNeeded) {
      output.value = result
      flowState.value = 'idle'
      return
    }
    await navigateTo(`/plans/${result.planId}`)
  } catch (error: any) {
    finalizeError.value = error?.data?.message || error?.message || '方案生成失败，请稍后重试。'
  }
}

async function submit() {
  if (!selectedContext.value && requiredContext.value && !allowUnlinked.value) {
    started.value = false
    canStart()
    return
  }
  pending.value = true
  submitError.value = ''
  finalizeError.value = ''
  try {
    if (saveTimer) clearTimeout(saveTimer)
    if (saveInFlight) await saveInFlight
    const res = await $fetch<{
      attemptId: string
      planId?: string | null
      fuse?: { eventId: string, referralId: string, crisisGuide: string } | null
      noPlanNeeded?: boolean
      levelName?: string
      deferred?: boolean
      assessmentSessionId?: string | null
    }>(`/api/v1/assessments/${moduleId}/submit`, {
      method: 'POST',
      body: {
        attemptId: attemptId.value,
        answers,
        studentId: selectedContext.value?.type === 'student' ? selectedContext.value.id : undefined,
        classId: selectedContext.value?.type === 'class' ? selectedContext.value.id : undefined,
        guardianId: selectedContext.value?.type === 'guardian' ? selectedContext.value.id : undefined,
        sourceChatSessionId: sourceChatSessionId.value,
        instrumentCode: selectedCode.value,
        // 连续量表流程：本次提交只落结果不生成方案，全部量表做完后由 finalize 统一生成。
        // 后端仅在非熔断且有评估组可聚合时生效；无组时仍按单张直接出方案。
        sessionId: assessmentSessionId.value,
        deferPlan: true
      }
    })
    // 安全熔断：保留 output 停留当前页展示转介指引，不进入连续流程。
    if (res?.fuse) {
      output.value = res
      return
    }
    // 绿色兜底：状态良好无需方案，停留当前页展示结论。
    if (res?.noPlanNeeded) {
      // submit 无条件建组：持久化评估组，供「继续完成建议量表」续接同一组
      if (res.assessmentSessionId) {
        assessmentSessionId.value = res.assessmentSessionId
        if (import.meta.client) localStorage.setItem(`assessment-session:${moduleId}`, res.assessmentSessionId)
      }
      output.value = res
      return
    }
    output.value = null
    localStorage.removeItem(draftStorageKey.value)
    attemptId.value = undefined
    // 提交后量表状态会变（这张变 completed，被它的触发条件解锁的那张变 suggested）。
    // 刷新后拿最新的建议清单，决定继续做下一张还是统一生成方案。
    await refreshRecommendation().catch(() => undefined)

    if (res?.deferred && res?.assessmentSessionId) {
      assessmentSessionId.value = res.assessmentSessionId
      if (import.meta.client) localStorage.setItem(`assessment-session:${moduleId}`, res.assessmentSessionId)
      // 已提交：答案锁定，不可再改选项或翻题；若方案生成失败只能重试，不能修改作答。
      submitted.value = true
      // 非强制延续：若有满足触发条件的深度诊断量表，交给教师选择「立即接着做 / 先查看方案」；
      // 没有则直接基于组内已有结果生成方案（后续仍可在方案里以待办形式建议）。
      await refreshRecommendation().catch(() => undefined)
      const next = instrumentOptions.value.find(item => item.status === 'suggested')
      if (next) {
        pendingChoice.value = next
        return
      }
      await finalizeAndGo()
      return
    }
    if (res?.planId) {
      await navigateTo(`/plans/${res.planId}`)
      return
    }
    submitError.value = '评估已保存，但方案生成失败。请稍后在方案列表中查看，或联系管理员。'
  } catch (error: any) {
    submitError.value = error?.data?.message || error?.message || '提交失败，请检查网络后重试。'
  } finally {
    pending.value = false
  }
}

</script>

<template>
  <div class="mx-auto max-w-6xl px-5 py-10">
    <UButton to="/" variant="ghost" color="neutral" icon="i-lucide-arrow-left">返回我的助手</UButton>

    <!-- 模块头：只展示当前模块的介绍，开始作答后收起给题目让位 -->
    <header v-if="!started && !output" class="mt-4">
      <div class="flex items-center gap-4">
        <span class="grid size-12 shrink-0 place-items-center rounded-2xl" :class="moduleIconTone[meta.color]">
          <UIcon :name="meta.icon" class="size-6" />
        </span>
        <h1 class="text-2xl font-semibold text-slate-800">{{ meta.title }} 评估</h1>
      </div>
      <p class="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-500">{{ meta.intro }}</p>
    </header>

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

    <!-- 第一步：选量表。按角色分区（入口筛查 → 深度诊断 → 专项/情境），卡片本身即「去评估」按钮。
         模块只有一张量表时 stage 初始就是 prepare，这一步整块不渲染。 -->
    <section v-if="definition && stage === 'pick' && !started && !output" class="mt-5">
      <p class="text-sm leading-6 text-slate-500">{{ pickerHint }}</p>

      <!-- AI 推荐 / 前置改推的理由。规则兜底时不展示，免得占版面说一句废话。 -->
      <UAlert
        v-if="showRecommendationNote"
        class="mt-4"
        :color="recommendation?.source === 'redirected' || recommendation?.source === 'ai_override' ? 'warning' : 'primary'"
        variant="soft"
        :title="recommendationTitle"
        :description="recommendationDescription"
      />

      <div class="mt-6 grid gap-x-8 gap-y-8" :class="instrumentSections.length > 1 ? 'md:grid-cols-2' : ''">
        <div
          v-for="(section, index) in instrumentSections"
          :key="section.key"
          :class="index % 2 === 1 ? 'md:border-l md:border-slate-100 md:pl-8' : ''"
        >
          <p v-if="section.label" class="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-400">
            <span class="inline-block h-px w-4 bg-slate-200" />{{ section.label }}
          </p>
          <div class="space-y-4">
            <button
              v-for="option in section.options"
              :key="option.code"
              type="button"
              :disabled="option.status === 'locked'"
              class="w-full rounded-2xl border p-5 text-left transition"
              :class="option.status === 'locked'
                ? 'cursor-not-allowed border-slate-100 bg-slate-50 opacity-60'
                : option.code === selectedCode
                  ? 'border-emerald-300 bg-emerald-50/70 ring-1 ring-emerald-200'
                  : option.status === 'not_needed'
                    ? 'border-slate-200 bg-white opacity-70 hover:border-emerald-200'
                    : 'border-slate-200 bg-white hover:border-emerald-200 hover:shadow-sm'"
              @click="pickInstrument(option)"
            >
              <div class="flex items-start gap-4">
                <div class="min-w-0 flex-1">
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
                </div>
                <!-- 卡片整体可点，这里只是行动召唤的样式，不能再嵌一个真按钮 -->
                <span
                  class="inline-flex shrink-0 items-center gap-1 self-center rounded-lg px-3.5 py-2 text-xs font-medium"
                  :class="option.status === 'locked' ? 'bg-slate-200 text-slate-400' : 'bg-emerald-600 text-white'"
                >
                  {{ option.status === 'locked' ? '未解锁' : '去评估' }}
                  <UIcon v-if="option.status !== 'locked'" name="i-lucide-arrow-right" class="size-3.5" />
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 第二步：评估准备。选定量表后确认对象、续做草稿并开始作答。 -->
    <section v-if="definition && stage === 'prepare' && !started && !output" class="mt-5 grid gap-6 md:grid-cols-[.4fr_.6fr]">
      <aside class="panel h-fit p-6 sm:p-7">
        <div class="grid size-12 place-items-center rounded-2xl" :class="moduleIconTone[meta.color]"><UIcon :name="meta.icon" class="size-6" /></div>
        <p class="mt-5 text-sm font-semibold text-emerald-700">评估前说明</p>
        <h2 class="mt-2 text-2xl font-semibold">{{ definition.title }}</h2>
        <p class="mt-3 text-sm leading-6 text-slate-500">{{ definition.description }}</p>
        <div class="mt-6 grid grid-cols-2 gap-3 text-sm">
          <div class="rounded-xl bg-slate-50 p-3"><span class="block text-xs text-slate-400">预计用时</span><strong class="mt-1 block">约 {{ definition.estimatedMinutes }} 分钟</strong></div>
          <div class="rounded-xl bg-slate-50 p-3"><span class="block text-xs text-slate-400">题目数量</span><strong class="mt-1 block">{{ definition.questions.length }} 题</strong></div>
        </div>
        <UButton
          v-if="hasMultipleInstruments"
          class="mt-5"
          color="neutral"
          variant="soft"
          size="sm"
          icon="i-lucide-list-checks"
          @click="() => { stage = 'pick' }"
        >换一张量表</UButton>
        <p class="mt-5 text-xs leading-5 text-slate-400">本评估用于教育工作场景梳理，不构成医学或心理诊断。结果仅供您制定支持行动。</p>
      </aside>

      <div class="space-y-5">
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

    <div v-if="definition && started && !output && flowState !== 'finalizing' && !pendingChoice" class="mt-6 grid gap-6 md:grid-cols-[.36fr_.64fr]">
      <aside class="panel h-fit p-6">
        <div class="grid size-12 place-items-center rounded-2xl" :class="moduleIconTone[meta.color]"><UIcon :name="meta.icon" class="size-6" /></div>
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
          <button v-for="option in question?.options" :key="option.value" type="button" :disabled="submitted" class="flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60" :class="answers[question!.id] === option.value ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white'" @click="choose(option.value)">
            <span class="grid size-8 shrink-0 place-items-center rounded-full border text-sm" :class="answers[question!.id] === option.value ? 'border-emerald-600 bg-emerald-700 text-white' : 'border-slate-200'">{{ option.value }}</span><span>{{ option.label }}</span>
          </button>
        </div>
        <div class="mt-8 flex items-center justify-between gap-3">
          <p v-if="submitted" class="text-xs text-slate-400">评估已提交，答案已锁定</p>
          <p v-else class="text-xs text-slate-400">可返回上一题修改，提交后答案锁定</p>
          <div class="flex gap-2">
            <UButton color="neutral" variant="soft" :disabled="current === 0 || submitted" @click="() => { current-- }">上一题</UButton>
            <!-- 用 === undefined 判断，不能用真值：0 是合法分值（0/1 二值选项组），会被当成未作答 -->
            <UButton v-if="current < definition.questions.length - 1" :disabled="answers[question!.id] === undefined || submitted" @click="() => { current++ }">下一题</UButton>
            <!-- 最后一题答完后才可提交；已提交后不可重复提交 -->
            <UButton v-else :disabled="progress < 100 || submitted" :loading="pending" @click="submit">提交并生成方案</UButton>
          </div>
        </div>
      </section>
    </div>

    <!-- 提交后的选择：满足触发条件的深度诊断量表，由教师决定是否立即接着做 -->
    <section v-if="pendingChoice && !output" class="panel mt-6 p-7 text-center">
      <UIcon name="i-lucide-microscope" class="mx-auto size-8 text-violet-600" />
      <h2 class="mt-3 text-lg font-semibold">检测到深度诊断量表</h2>
      <p class="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
        基于本次测量结果，建议进一步完成「{{ pendingChoice.title }}」以获得更精确的归因判断。
        <template v-if="pendingChoice.triggerConditionNote">（{{ pendingChoice.triggerConditionNote }}）</template>
      </p>
      <div class="mt-5 flex flex-wrap justify-center gap-3">
        <UButton icon="i-lucide-arrow-right" trailing @click="continueChosenInstrument">立即接着做</UButton>
        <UButton color="neutral" variant="soft" @click="skipChosenInstrument">先查看方案</UButton>
      </div>
    </section>

    <!-- 连续量表流程收尾：全部量表完成后统一生成方案，失败时可重试 -->
    <section v-if="flowState === 'finalizing' && !output" class="panel mt-6 p-7 text-center">
      <UIcon v-if="!finalizeError" name="i-lucide-loader-circle" class="mx-auto size-8 animate-spin text-emerald-600" />
      <p v-if="!finalizeError" class="mt-3 text-sm text-slate-600">全部量表已完成，正在生成方案…</p>
      <template v-else>
        <UIcon name="i-lucide-triangle-alert" class="mx-auto size-8 text-red-500" />
        <p class="mt-3 text-sm text-red-600">{{ finalizeError }}</p>
        <div class="mt-5 flex flex-wrap justify-center gap-3">
          <UButton icon="i-lucide-refresh-cw" @click="finalizeAndGo">重试生成方案</UButton>
          <UButton to="/" color="neutral" variant="soft">返回工作台</UButton>
        </div>
      </template>
    </section>

    <section v-if="output" class="report-page mt-6 space-y-6">
      <!-- 安全熔断：必须停留在当前页展示转介指引，不跳方案页 -->
      <div v-if="output.fuse" class="panel border-2 border-red-200 bg-red-50 p-7"><div class="flex gap-4"><UIcon name="i-lucide-siren" class="size-7 text-red-600" /><div><h1 class="text-xl font-semibold text-red-900">已启动安全转介</h1><p class="mt-2 text-sm text-red-800">{{ output.fuse.crisisGuide }}</p><p class="mt-3 text-xs text-red-600">事件编号：{{ output.fuse.eventId }}</p></div></div></div>
      <!-- 绿色兜底：状态良好，无需生成方案 -->
      <div v-else-if="output.noPlanNeeded" class="panel border-2 border-emerald-200 bg-emerald-50 p-7">
        <div class="flex gap-4">
          <UIcon name="i-lucide-circle-check" class="size-7 text-emerald-600" />
          <div>
            <h1 class="text-xl font-semibold text-emerald-900">状态良好，无需方案</h1>
            <p class="mt-2 text-sm leading-6 text-emerald-800">
              {{ output.levelName || '状态良好' }}：本次评估未发现需要重点干预的信号，暂时不需要生成行动方案。保持现有节奏即可，后续可随时重新评估。
            </p>
            <!-- 无方案但有建议量表（如筛查量表状态良好、深度诊断仍待做）：提供续链入口 -->
            <UButton
              v-if="suggestedInstrument"
              class="mt-4"
              icon="i-lucide-arrow-right"
              trailing
              @click="continueSuggestedInstrument"
            >
              继续完成建议量表「{{ suggestedInstrument.title }}」
            </UButton>
          </div>
        </div>
      </div>
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

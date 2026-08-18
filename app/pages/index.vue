<script setup lang="ts">
import { assessmentBadge, moduleMeta } from '#shared/assessments'
import type { ModuleId, RouteDecision } from '#shared/contracts'
import { useModuleScores } from '~/composables/useModuleScores'

interface ClarificationRoundData {
  type: 'clarification'
  round: number
  question: string
  options: string[]
  moduleScores: Record<string, number>
}

interface ClarificationSummaryData {
  type: 'summary'
  answer: string
  rationale: string
  primaryModule: ModuleId
  moduleProportions: Record<string, number>
  suggestedActions: Array<{ label: string; type: string; module?: ModuleId; instrumentCode?: string; sourceText?: string }>
}

interface SourceItem {
  chunkId: string
  documentTitle: string
  heading?: string | null
  resourceTitle?: string
  excerpt?: string
  module?: ModuleId
  libraryType?: string
  resourceVersionId?: string
}

interface TimelineItem {
  messageId?: string
  role: 'user' | 'assistant'
  text: string
  sources?: SourceItem[]
  mode?: 'deepseek' | 'local_fallback'
  planUpdateSuggestions?: Array<any>
  feedback?: 'helpful' | 'not_helpful'
  clarification?: ClarificationRoundData
  summary?: ClarificationSummaryData
}

const { user } = useAuth()
const { updateScores, moduleScores } = useModuleScores()
const { data: sessions, refresh: refreshSessions } = await useFetch<any[]>('/api/v1/chat/sessions')
const { data: assistantStatus } = await useFetch<any>('/api/v1/chat/status')
const { data: governance, refresh: refreshGovernance } = await useFetch<any>('/api/v1/chat/data-governance')
const { data: today, refresh: refreshToday } = await useFetch<any>('/api/v1/workbench/today')
const { data: activePlans } = await useFetch<any>('/api/v1/plans/active')
const { data: contextOptions } = await useFetch<any>('/api/v1/chat/context-options')
const input = ref('')
const pending = ref(false)
const loadingSession = ref(false)
const sessionId = ref<string>()
const route = ref<(RouteDecision & { id: string }) | null>(null)
const fuse = ref<{ message: string, guide: string } | null>(null)
const timeline = ref<TimelineItem[]>([])
const assistantMode = ref<'deepseek' | 'local_fallback'>(assistantStatus.value?.mode || 'local_fallback')
const messageViewport = ref<HTMLElement | null>(null)
const copiedMessage = ref<number | null>(null)
const confirmingModule = ref<ModuleId | null>(null)
/** 最后一条教师发言。进入模块时带给量表推荐用，让 AI 知道教师在说什么。 */
const lastUserMessage = computed(() => {
  for (let i = timeline.value.length - 1; i >= 0; i--) {
    const item = timeline.value[i]
    if (item?.role === 'user' && item.text?.trim()) return item.text.trim()
  }
  return ''
})
const routeConfirmError = ref('')
const selectedOptions = ref<Record<number, string>>({})
const pendingPlanSuggestion = ref<{ item: TimelineItem, index: number } | null>(null)
const planExecForm = reactive({ executedAt: '', executionNote: '' })
const selectedContextKey = ref('none')
const suppressContextWatch = ref(false)
const contextPreview = ref<any>(null)
const previewLoading = ref(false)
const withoutRecord = ref(false)
const deleteCandidate = ref<string>()
const currentSnapPage = ref(0) // 0: 聊天面板, 1: 使用闭环
const snapLocked = ref(false)
let snapUnlockTimer: number | undefined
const toast = useToast()
const { moduleLabel, libraryTypeLabel, actionStatusLabel } = useDisplayLabels()
const quickPrompts = [
  '小明上课经常走神，作业拖拉到半夜，数学计算经常看错符号，考前紧张到手抖，说自己就是学不好。我该如何处理？',
  '我们班最近死气沉沉的，学生不愿意来学校，班委也形同虚设，制定了班级公约没人执行，我每天都在救火。我该如何处理？',
  '有个家长经常越级投诉到校长，说我没管好，还联合其他家长在群里攻击我，沟通渠道基本断了。我该如何处理？',
  '我真的快扛不住了，每天都像打仗一样，回家就瘫在沙发上什么都不想干，学生犯错我现在连气都懒得生了。我该如何处理？'
]
const greetingName = computed(() => {
  const name = user.value?.name?.trim()
  if (!name) return '老师'
  return name.endsWith('老师') ? name : `${name}老师`
})
const contextSelectItems = computed(() => [
  { label: '不指定对象', value: 'none' },
  ...((contextOptions.value?.students || []).map((item: any) => ({ label: `学生 · ${item.label}`, value: `student:${item.id}` }))),
  ...((contextOptions.value?.classes || []).map((item: any) => ({ label: `班级 · ${item.label}`, value: `class:${item.id}` }))),
  ...((contextOptions.value?.guardians || []).map((item: any) => ({ label: `家长 · ${item.label}`, value: `guardian:${item.id}` })))
])
const mobileSessionItems = computed(() => (sessions.value || []).map((item: any) => ({
  label: item.title,
  value: item.id
})))
const allContextOptions = computed(() => [
  ...((contextOptions.value?.students || []).map((item: any) => ({ ...item, type: 'student' }))),
  ...((contextOptions.value?.classes || []).map((item: any) => ({ ...item, type: 'class' }))),
  ...((contextOptions.value?.guardians || []).map((item: any) => ({ ...item, type: 'guardian' })))
])
const selectedContext = computed(() => {
  if (selectedContextKey.value === 'none') return null
  const [type, id] = selectedContextKey.value.split(':')
  return allContextOptions.value.find((item: any) => item.type === type && item.id === id) || null
})
const contextPayload = computed(() => selectedContext.value ? { contextType: selectedContext.value.type, contextId: selectedContext.value.id } : {})
const todayTodoMetrics = computed(() => {
  const actions = today.value?.actions || []
  const reviews = today.value?.reviews || []
  const drafts = today.value?.drafts || []
  const assignments = today.value?.recentAssignments || []
  const unread = today.value?.unreadCount || 0
  return {
    unread,
    actions: actions.length,
    overdueActions: actions.filter((item: any) => item.overdue).length,
    reviews: reviews.length,
    drafts: drafts.length,
    assignments: assignments.length,
    total: unread + actions.length + reviews.length + drafts.length + assignments.length
  }
})

function getModuleState(id: string) {
  return today.value?.moduleStates?.[id] || null
}

function getModuleBadge(id: string) {
  return assessmentBadge(getModuleState(id)?.lastLevel)
}

function getModuleBadgeColor(id: string): any {
  return getModuleBadge(id)?.color || 'neutral'
}

function relativeDate(value?: string) {
  if (!value) return ''
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

async function scrollToLatest(behavior: ScrollBehavior = 'smooth') {
  await nextTick()
  messageViewport.value?.scrollTo({ top: messageViewport.value.scrollHeight, behavior })
}

function usePrompt(prompt: string) {
  input.value = prompt
}

function sendClarificationSelection(option: string) {
  // 找到当前活跃的追问轮次，记录选中项
  const lastClarification = [...timeline.value].reverse().find(item => item.clarification)
  if (lastClarification?.clarification) {
    selectedOptions.value = { ...selectedOptions.value, [lastClarification.clarification.round]: option }
  }
  input.value = option
  nextTick(() => ask())
}

function sendClarificationDone() {
  input.value = '[DONE]'
  nextTick(() => ask())
}

async function copyMessage(text: string, index: number) {
  await navigator.clipboard.writeText(text)
  copiedMessage.value = index
  window.setTimeout(() => { if (copiedMessage.value === index) copiedMessage.value = null }, 1600)
}

function newConversation() {
  sessionId.value = undefined
  timeline.value = []
  route.value = null
  fuse.value = null
  routeConfirmError.value = ''
  selectedOptions.value = {}
  nextTick(() => scrollToLatest('auto'))
}

function handleMobileSessionSelect(value: string | undefined) {
  if (!value || value === sessionId.value) return
  void loadSession(value)
}

watch(selectedContextKey, () => {
  if (suppressContextWatch.value) return
  if (!sessionId.value || !timeline.value.length) return
  newConversation()
})

async function loadSession(id: string) {
  if (pending.value) return
  loadingSession.value = true
  try {
    const result = await $fetch<any>(`/api/v1/chat/sessions/${id}`)
    sessionId.value = id
    suppressContextWatch.value = true
    selectedContextKey.value = result.session.contextType && result.session.contextType !== 'none' && result.session.contextId
      ? `${result.session.contextType}:${result.session.contextId}`
      : 'none'
    await nextTick()
    suppressContextWatch.value = false
    route.value = null
    fuse.value = null
    routeConfirmError.value = ''
    timeline.value = result.messages.map((item: any) => {
      const base: TimelineItem = {
        messageId: item.id,
        role: item.role,
        text: item.text,
        mode: item.metadata?.mode,
        sources: item.metadata?.sources || [],
        planUpdateSuggestions: item.metadata?.planUpdateSuggestions || []
      }
      // 恢复追问轮次数据
      if (item.metadata?.type === 'clarification_round') {
        base.clarification = {
          type: 'clarification',
          round: item.metadata.round,
          question: item.metadata.question,
          options: item.metadata.options,
          moduleScores: item.metadata.moduleScores
        }
        if (item.metadata.moduleScores) updateScores(item.metadata.moduleScores)
      }
      // 恢复总结数据
      if (item.metadata?.type === 'clarification_summary') {
        base.summary = {
          type: 'summary',
          answer: item.metadata.answer,
          rationale: item.metadata.rationale,
          primaryModule: item.metadata.primaryModule,
          moduleProportions: item.metadata.moduleProportions,
          suggestedActions: item.metadata.suggestedActions
        }
        if (item.metadata.moduleProportions) updateScores(item.metadata.moduleProportions)
      }
      return base
    })

    // 重建 selectedOptions：每个追问轮次后的第一条用户消息即为所选选项
    selectedOptions.value = {}
    let pendingClarificationRound: number | null = null
    for (const item of timeline.value) {
      if (item.clarification) {
        pendingClarificationRound = item.clarification.round
      } else if (item.role === 'user' && pendingClarificationRound !== null) {
        selectedOptions.value[pendingClarificationRound] = item.text
        pendingClarificationRound = null
      }
    }
    const lastAssistant = [...result.messages].reverse().find((item: any) => item.role === 'assistant')
    if (lastAssistant?.metadata?.mode) assistantMode.value = lastAssistant.metadata.mode
    if (lastAssistant?.metadata?.route) route.value = { id: lastAssistant.metadata.route.decisionId || '', ...lastAssistant.metadata.route }
    await scrollToLatest('auto')
  } finally { loadingSession.value = false }
}

async function deleteSession(id: string) {
  if (deleteCandidate.value !== id) { deleteCandidate.value = id; return }
  await $fetch(`/api/v1/chat/sessions/${id}`, { method: 'DELETE' })
  deleteCandidate.value = undefined
  if (sessionId.value === id) newConversation()
  await refreshSessions()
}

async function ask() {
  if (!input.value.trim() || pending.value) return
  const text = input.value.trim()
  input.value = ''
  pending.value = true
  route.value = null
  fuse.value = null
  routeConfirmError.value = ''
  timeline.value.push({ role: 'user', text })
  await scrollToLatest()
  let assistantIndex = -1
  try {
    const response = await fetch('/api/v1/chat/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId.value, message: text, withoutRecord: withoutRecord.value, ...contextPayload.value })
    })
    if (!response.ok || !response.body) throw new Error('助手暂时不可用')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''
      for (const part of parts) {
        const event = part.match(/event: (.+)/)?.[1]
        const raw = part.match(/data: (.+)/)?.[1]
        if (!event || !raw) continue
        const data = JSON.parse(raw)
        if (event === 'ack') {
          sessionId.value = data.sessionId
          if (data.context) {
            suppressContextWatch.value = true
            selectedContextKey.value = `${data.context.type}:${data.context.id}`
            await nextTick()
            suppressContextWatch.value = false
          }
        }
        if (event === 'answer_start') {
          pending.value = false
          assistantMode.value = data.mode
          timeline.value.push({ role: 'assistant', text: '', mode: data.mode, sources: [] })
          assistantIndex = timeline.value.length - 1
          await scrollToLatest()
        }
        if (event === 'answer_delta') {
          if (assistantIndex < 0) {
            pending.value = false
            timeline.value.push({ role: 'assistant', text: '', sources: [] })
            assistantIndex = timeline.value.length - 1
          }
          timeline.value[assistantIndex]!.text += data.text
          await scrollToLatest('auto')
          // 让出控制权给浏览器渲染管线，使流式输出可见
          await new Promise(r => requestAnimationFrame(r))
        }
        if (event === 'answer') {
          assistantMode.value = data.mode
          if (assistantIndex >= 0) {
            timeline.value[assistantIndex]!.messageId = data.messageId
            timeline.value[assistantIndex]!.text = data.text
            timeline.value[assistantIndex]!.mode = data.mode
          } else {
            timeline.value.push({ messageId: data.messageId, role: 'assistant', text: data.text, mode: data.mode, sources: [] })
            assistantIndex = timeline.value.length - 1
          }
          await scrollToLatest()
        }
        if (event === 'plan_update_suggestions' && assistantIndex >= 0) {
          timeline.value[assistantIndex]!.messageId = data.messageId
          timeline.value[assistantIndex]!.planUpdateSuggestions = data.suggestions
        }
        if (event === 'sources' && assistantIndex >= 0) timeline.value[assistantIndex]!.sources = data
        if (event === 'route') route.value = data
        if (event === 'clarification_round') {
          if (assistantIndex >= 0) {
            timeline.value[assistantIndex]!.clarification = data
          }
          updateScores(data.moduleScores)
        }
        if (event === 'clarification_summary') {
          if (assistantIndex >= 0) {
            timeline.value[assistantIndex]!.summary = data
          }
          updateScores(data.moduleProportions)
        }
        if (event === 'fuse') fuse.value = data
        if (event === 'error') throw new Error(data.message)
      }
    }
    await refreshSessions()
    await refreshToday()
  } catch (error: any) {
    timeline.value.push({ role: 'assistant', text: error?.message || '处理失败，请稍后重试。' })
  } finally {
    pending.value = false
    await scrollToLatest()
  }
}

async function loadContextPreview() {
  if (!selectedContext.value) { contextPreview.value = null; return }
  previewLoading.value = true
  try {
    contextPreview.value = await $fetch('/api/v1/chat/context-preview', { query: { type: selectedContext.value.type, id: selectedContext.value.id } })
  } catch (error: any) {
    toast.add({ title: '上下文预览加载失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  } finally { previewLoading.value = false }
}

watch(selectedContextKey, loadContextPreview, { flush: 'post' })

async function acceptPrivacyNotice() {
  try {
    await $fetch('/api/v1/chat/consent', { method: 'POST', body: { noticeVersion: governance.value.noticeVersion, accepted: true } })
    await refreshGovernance()
    await loadContextPreview()
    toast.add({ title: '隐私告知已确认', color: 'success' })
  } catch (error: any) { toast.add({ title: '确认失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
}

async function submitFeedback(item: TimelineItem, rating: 'helpful' | 'not_helpful') {
  if (!item.messageId) return
  try {
    await $fetch(`/api/v1/chat/messages/${item.messageId}/feedback`, { method: 'POST', body: { rating, reasons: [] } })
    item.feedback = rating
    toast.add({ title: '感谢您的反馈', color: 'success' })
  } catch (error: any) { toast.add({ title: '反馈提交失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
}

async function confirmPlanSuggestion(item: TimelineItem, index: number) {
  if (!item.messageId) return
  pendingPlanSuggestion.value = { item, index }
  planExecForm.executedAt = ''
  planExecForm.executionNote = ''
}

async function submitPlanExecution() {
  const pending = pendingPlanSuggestion.value
  if (!pending) return
  const { item, index } = pending
  if (!item.messageId) return
  try {
    await $fetch(`/api/v1/chat/messages/${item.messageId}/plan-suggestions/${index}/confirm`, {
      method: 'POST',
      body: {
        executedAt: planExecForm.executedAt ? new Date(planExecForm.executedAt).toISOString() : undefined,
        executionNote: planExecForm.executionNote.trim() || undefined,
      }
    })
    item.planUpdateSuggestions![index].appliedAt = new Date().toISOString()
    pendingPlanSuggestion.value = null
    toast.add({ title: '方案已更新', color: 'success' })
    await refreshToday()
  } catch (error: any) { toast.add({ title: '方案更新失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
}

async function confirmModule(module: ModuleId) {
  if (!route.value || confirmingModule.value) return
  confirmingModule.value = module
  routeConfirmError.value = ''
  try {
    await $fetch(`/api/v1/chat/routes/${route.value.id}/confirm`, { method: 'POST', body: { module } })
  } catch (error: any) {
    routeConfirmError.value = error?.data?.message || error?.message || '处理方向确认记录保存失败，已继续进入模块。'
  } finally {
    confirmingModule.value = null
  }
  // 带上分诊建议的量表编码和教师原话：模块页据此推荐并直接定位到该量表
  await navigateTo({
    path: `/module/${module}`,
    query: {
      ...(selectedContext.value
        ? { contextType: selectedContext.value.type, contextId: selectedContext.value.id, sourceChatSessionId: sessionId.value }
        : { sourceChatSessionId: sessionId.value }),
      ...(route.value?.suggestedInstrumentCode ? { instrumentCode: route.value.suggestedInstrumentCode } : {}),
      ...(lastUserMessage.value ? { q: lastUserMessage.value.slice(0, 500) } : {})
    }
  })
}

onMounted(async () => {
  const query = useRoute().query
  // 会话深链：?sessionId=<uuid> 打开指定会话；归属由 /api/v1/chat/sessions/[id] 服务端校验，跨教师返回 404
  const deepLinkSessionId = typeof query.sessionId === 'string' && query.sessionId ? query.sessionId : ''
  const type = typeof query.contextType === 'string' ? query.contextType : ''
  const id = typeof query.contextId === 'string' ? query.contextId : ''
  let prefill: { prompt?: string, contextKey?: string } | null = null
  const storedPrefill = sessionStorage.getItem('assistant-prefill')
  if (storedPrefill) {
    try { prefill = JSON.parse(storedPrefill) } catch { /* 忽略损坏的本地预填数据 */ }
    sessionStorage.removeItem('assistant-prefill')
  }
  if (deepLinkSessionId) {
    await loadSession(deepLinkSessionId)
  } else if (type && id) selectedContextKey.value = `${type}:${id}`
  else if (prefill?.contextKey) selectedContextKey.value = prefill.contextKey
  else loadContextPreview()
  if (prefill?.prompt) input.value = prefill.prompt
})

function getSnapSections() {
  return [
    document.getElementById('chat-section'),
    document.getElementById('dashboard-section')
  ].filter((section): section is HTMLElement => Boolean(section))
}

function getStickyHeaderOffset() {
  return (document.querySelector('header') as HTMLElement | null)?.offsetHeight || 0
}

function getSnapPoint(section: HTMLElement, index: number) {
  if (index === 0) return 0
  const top = section.getBoundingClientRect().top + window.scrollY
  return Math.max(0, top - getStickyHeaderOffset() - 16)
}

function getNearestSnapPage(sections = getSnapSections()) {
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  sections.forEach((section, index) => {
    const distance = Math.abs(getSnapPoint(section, index) - window.scrollY)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })
  return nearestIndex
}

function scrollToSnapSection(section: HTMLElement, index: number) {
  window.scrollTo({ top: getSnapPoint(section, index), behavior: 'smooth' })
}

function canScrollInside(target: EventTarget | null, dir: number) {
  let el = target instanceof Element ? target : null
  while (el && el !== document.body) {
    if (el.matches('input, textarea, select, [contenteditable="true"], [role="listbox"]')) return true
    const style = window.getComputedStyle(el)
    const canScroll = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 2
    if (canScroll) {
      const atTop = el.scrollTop <= 2
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
      if ((dir > 0 && !atBottom) || (dir < 0 && !atTop)) return true
    }
    el = el.parentElement
  }
  return false
}

function syncSnapPage() {
  currentSnapPage.value = getNearestSnapPage()
}

// 全页 snap 滚动：聊天面板 → 使用闭环
function handleWheel(event: WheelEvent) {
  if (Math.abs(event.deltaY) < 8) return
  const dir = event.deltaY > 0 ? 1 : -1
  if (canScrollInside(event.target, dir)) return

  if (snapLocked.value) {
    event.preventDefault()
    return
  }

  const sections = getSnapSections()
  const activePage = getNearestSnapPage(sections)
  const nextPage = activePage + dir
  if (nextPage < 0 || nextPage >= sections.length) return

  event.preventDefault()
  currentSnapPage.value = nextPage
  snapLocked.value = true
  scrollToSnapSection(sections[nextPage]!, nextPage)

  if (snapUnlockTimer) window.clearTimeout(snapUnlockTimer)
  snapUnlockTimer = window.setTimeout(() => {
    snapLocked.value = false
    syncSnapPage()
  }, 700)
}

onMounted(() => {
  syncSnapPage()
  window.addEventListener('wheel', handleWheel, { passive: false })
  window.addEventListener('scroll', syncSnapPage, { passive: true })
  window.addEventListener('resize', syncSnapPage, { passive: true })
})

onUnmounted(() => {
  if (snapUnlockTimer) window.clearTimeout(snapUnlockTimer)
  window.removeEventListener('wheel', handleWheel)
  window.removeEventListener('scroll', syncSnapPage)
  window.removeEventListener('resize', syncSnapPage)
})
</script>

<template>
  <div class="mx-auto max-w-7xl px-5 pb-8 pt-4 sm:pb-12 sm:pt-6">
    <section id="chat-section" class="grid items-stretch gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside class="panel hidden h-[18rem] flex-col overflow-hidden lg:flex lg:h-[calc(100dvh-7rem)] lg:min-h-[34rem]">
        <div class="border-b border-slate-100 p-4">
          <button type="button" class="w-full flex items-center justify-center gap-2 rounded-lg bg-[var(--ui-primary)] px-4 py-3 text-base font-medium text-white" @click="newConversation"><UIcon name="i-lucide-message-square-plus" class="size-5" />新对话</button>
        </div>
        <div class="flex items-center justify-between px-4 pb-2 pt-4">
          <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">最近对话</p>
          <span class="text-xs text-slate-400">{{ sessions?.length || 0 }}</span>
        </div>
        <div class="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          <div v-for="item in sessions" :key="item.id" class="group relative rounded-xl text-left text-sm transition" :class="sessionId===item.id?'bg-emerald-50 text-emerald-950 ring-1 ring-inset ring-emerald-100':'text-slate-600 hover:bg-slate-50'">
            <button class="w-full px-3 py-3 text-left" @click="loadSession(item.id)">
              <span class="flex items-start gap-2"><UIcon name="i-lucide-message-circle" class="mt-0.5 size-4 shrink-0" :class="sessionId===item.id?'text-emerald-600':'text-slate-300 group-hover:text-slate-500'" /><span class="line-clamp-2 block leading-5">{{ item.title }}</span></span>
              <span class="mt-1.5 block pl-6 text-[11px] text-slate-400">{{ new Date(item.updatedAt).toLocaleString('zh-CN') }}</span>
            </button>
            <button class="absolute right-1.5 top-2 grid size-6 place-items-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-500" :class="deleteCandidate===item.id?'bg-red-50 text-red-600':'opacity-0 group-hover:opacity-100'" :title="deleteCandidate===item.id?'再次点击确认删除':'删除对话'" @click.stop="deleteSession(item.id)">
              <UIcon name="i-lucide-x" class="size-3.5" />
            </button>
          </div>
          <div v-if="!sessions?.length" class="grid place-items-center px-3 py-16 text-center"><UIcon name="i-lucide-messages-square" class="size-7 text-slate-300" /><p class="mt-2 text-xs text-slate-400">暂无历史对话</p></div>
        </div>
        <div class="border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-400"><UIcon name="i-lucide-lock-keyhole" class="mr-1 inline size-3.5" />对话仅您本人可见</div>
        <div class="border-t border-slate-100 p-3">
          <ModuleProportionPanel />
        </div>
      </aside>

      <div class="panel flex h-[calc(100dvh-10rem)] min-h-[26rem] min-w-0 flex-col overflow-hidden lg:h-[calc(100dvh-7rem)] lg:min-h-[34rem]">
        <div class="border-b border-slate-100 bg-white/95 px-4 py-3 lg:hidden">
          <div class="flex items-center gap-2">
            <UButton icon="i-lucide-message-square-plus" size="sm" @click="newConversation">新对话</UButton>
            <USelect
              :model-value="sessionId || ''"
              :items="mobileSessionItems"
              :disabled="!mobileSessionItems.length || pending"
              placeholder="最近对话"
              class="min-w-0 flex-1"
              @update:model-value="handleMobileSessionSelect"
            />
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white/90 px-5 py-3.5 sm:px-6">
          <div class="flex min-w-0 items-center gap-3">
            <div class="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><UIcon name="i-lucide-sparkles" class="size-4.5" /></div>
            <div class="min-w-0"><div class="flex items-center gap-2"><strong class="text-sm">AI 分诊助手</strong><span class="size-1.5 rounded-full bg-emerald-500" /></div><p class="truncate text-xs text-slate-400">只做问题澄清与模块推荐 · 不跳过量表和规则归因</p></div>
          </div>
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <USelect v-model="selectedContextKey" :items="contextSelectItems" class="w-64 max-w-full" />
            <UBadge :color="assistantMode==='deepseek'?'success':'warning'" variant="soft"><span class="mr-1.5 size-1.5 rounded-full" :class="assistantMode==='deepseek'?'bg-emerald-500':'bg-amber-500'" />{{ assistantMode==='deepseek'?'DeepSeek 已接入':'本地降级模式' }}</UBadge>
          </div>
        </div>
        <div v-if="selectedContext" class="border-b border-emerald-100 bg-emerald-50/70 px-5 py-3 text-sm sm:px-6">
          <div class="flex flex-wrap items-center justify-between gap-2"><div class="flex items-center gap-2"><UIcon name="i-lucide-link" class="text-emerald-700" /><strong>{{ selectedContext.type === 'student' ? '咨询学生' : selectedContext.type === 'class' ? '咨询班级' : '咨询家长' }}：{{ selectedContext.label }}</strong></div><div class="flex items-center gap-3"><label class="flex items-center gap-2 text-xs text-slate-600"><USwitch v-model="withoutRecord" size="sm" />不带档案咨询</label><details class="relative"><summary class="cursor-pointer list-none text-xs font-medium text-emerald-700">本次将发送的信息</summary><div class="absolute right-0 top-7 z-30 max-h-80 w-[min(32rem,85vw)] overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"><p class="text-xs leading-5 text-slate-500">数据模式：{{ contextPreview?.mode || governance?.effectiveMode }}；始终排除 {{ contextPreview?.excludedFields?.join('、') }}</p><pre class="mt-3 whitespace-pre-wrap text-xs leading-5 text-slate-600">{{ withoutRecord ? '本次不发送档案信息。' : JSON.stringify(contextPreview?.context?.snapshot || {}, null, 2) }}</pre></div></details></div></div>
        </div>
        <div v-if="governance?.needsConsent" class="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900"><span>学校申请使用完整业务上下文。确认前将自动回退到严格脱敏模式；电话、邮箱、账号和系统标识永不发送。</span><UButton size="xs" color="warning" @click="acceptPrivacyNotice">阅读并确认 {{ governance.noticeVersion }}</UButton></div>

        <NuxtLink v-if="activePlans?.count" to="/plans" class="mx-4 mt-2 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm transition hover:bg-emerald-100 sm:mx-6"><UIcon name="i-lucide-clipboard-list" class="size-5 text-emerald-600" /><div class="flex-1"><strong class="text-emerald-800">您有 {{ activePlans.count }} 个进行中的方案</strong><p class="text-xs text-emerald-600">点击查看之前的方案及执行情况，避免重复规划</p></div><UIcon name="i-lucide-arrow-right" class="size-4 text-emerald-400" /></NuxtLink>

        <div ref="messageViewport" class="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-slate-50/70 to-white px-4 py-6 sm:px-6" :class="{'opacity-60':loadingSession}">
          <div v-if="timeline.length" class="mx-auto max-w-3xl space-y-7">
            <div v-for="(item, index) in timeline" :key="index" class="flex items-start gap-3" :class="item.role === 'user' ? 'flex-row-reverse' : ''">
              <div class="grid size-8 shrink-0 place-items-center rounded-xl text-xs font-semibold" :class="item.role === 'user' ? 'bg-emerald-800 text-white' : 'border border-emerald-100 bg-white text-emerald-700 shadow-sm'">
                <UIcon v-if="item.role === 'assistant'" name="i-lucide-sparkles" class="size-4" /><span v-else>{{ user?.name?.slice(0, 1) }}</span>
              </div>
              <div class="min-w-0 max-w-[88%] sm:max-w-[82%]">
                <div class="mb-1.5 flex items-center gap-2 text-[11px] text-slate-400" :class="item.role === 'user' ? 'justify-end' : ''"><span>{{ item.role === 'user' ? '我' : '赋能助手' }}</span><span v-if="item.role === 'assistant' && item.mode === 'local_fallback'" class="text-amber-600">降级回答</span></div>
                <div class="group relative rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm" :class="item.role === 'user' ? 'rounded-tr-md bg-emerald-800 text-white' : 'rounded-tl-md border border-slate-100 bg-white text-slate-700'">
                  <div v-if="item.role === 'user'" class="whitespace-pre-wrap" v-text="item.text" />
                  <div v-else class="markdown-body" v-html="useMarkdown(item.text)" />
                  <button v-if="item.role === 'assistant'" type="button" class="absolute -bottom-7 left-0 flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100 focus:opacity-100" :aria-label="copiedMessage === index ? '已复制回答' : '复制回答'" @click="copyMessage(item.text, index)"><UIcon :name="copiedMessage === index ? 'i-lucide-check' : 'i-lucide-copy'" class="size-3" />{{ copiedMessage === index ? '已复制' : '复制' }}</button>
                </div>
                <ClarificationOptions
                  v-if="item.clarification"
                  :question="item.clarification.question"
                  :options="item.clarification.options"
                  :round="item.clarification.round"
                  :selected-option="selectedOptions[item.clarification.round]"
                  @select="sendClarificationSelection"
                  @done="sendClarificationDone"
                />
                <div v-if="item.summary" class="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
                  <div class="flex items-center gap-2 text-xs font-semibold text-emerald-700">
                    <UIcon name="i-lucide-bar-chart-3" class="size-4" />分析结果
                  </div>
                  <div class="markdown-body mt-2 text-sm leading-7 text-slate-700" v-html="useMarkdown(item.summary.rationale)" />
                  <div class="mt-4 flex flex-wrap items-center gap-2">
                    <UButton
                      v-for="action in item.summary.suggestedActions"
                      :key="action.label"
                      color="primary"
                      size="sm"
                      @click="() => { if (action.module) navigateTo({ path: `/module/${action.module}`, query: {
                        ...(action.instrumentCode ? { instrumentCode: action.instrumentCode } : {}),
                        ...(action.sourceText ? { q: action.sourceText.slice(0, 500) } : {}),
                        sourceChatSessionId: sessionId
                      } }) }"
                    >{{ action.label }}</UButton>
                  </div>
                </div>
                <details v-if="item.sources?.length" class="group mt-7 overflow-hidden rounded-xl border border-emerald-100 bg-emerald-50/50 text-xs text-slate-600">
                  <summary class="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 font-medium text-emerald-800"><span class="flex items-center gap-2"><UIcon name="i-lucide-book-open-check" class="size-4" />参考了 {{ item.sources.length }} 条知识内容</span><UIcon name="i-lucide-chevron-down" class="size-3.5 transition group-open:rotate-180" /></summary>
                  <div class="space-y-2 border-t border-emerald-100 px-3 py-3">
                    <div v-for="(source, sourceIndex) in item.sources" :key="source.chunkId" class="rounded-lg bg-white/80 p-3">
                      <p class="font-medium text-slate-700"><span class="mr-1 text-emerald-600">{{ sourceIndex + 1 }}.</span>{{ source.documentTitle }}<span v-if="source.heading" class="font-normal text-slate-400"> · {{ source.heading }}</span></p>
                      <p class="mt-1 text-[11px] text-emerald-700/70">{{ source.resourceTitle || '模块资源' }}<template v-if="source.module || source.libraryType"> · {{ source.module ? moduleLabel(source.module) : '通用' }} / {{ source.libraryType ? libraryTypeLabel(source.libraryType) : '资源' }}</template></p><p v-if="source.excerpt" class="mt-1.5 line-clamp-3 leading-5 text-slate-500">{{ source.excerpt }}</p>
                    </div>
                  </div>
                </details>
                <div v-if="item.role === 'assistant' && item.planUpdateSuggestions?.length" class="mt-7 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs"><p class="font-semibold text-amber-900">AI 建议更新方案（尚未写入）</p><div v-for="(suggestion, suggestionIndex) in item.planUpdateSuggestions" :key="suggestionIndex" class="flex items-center justify-between gap-3 rounded-lg bg-white p-3"><span class="text-slate-600">{{ suggestion.actionTitle || '新增复盘' }}<template v-if="suggestion.newStatus"> → {{ actionStatusLabel(suggestion.newStatus) }}</template><span v-if="suggestion.progressNote" class="mt-1 block text-slate-400">{{ suggestion.progressNote }}</span></span><UButton size="xs" :disabled="Boolean(suggestion.appliedAt)" @click="confirmPlanSuggestion(item, suggestionIndex)">{{ suggestion.appliedAt ? '已确认' : '确认应用' }}</UButton></div></div>
                <div v-if="item.role === 'assistant' && item.messageId" class="mt-7 flex items-center gap-2 text-xs text-slate-400"><span>这条回答有帮助吗？</span><UButton size="xs" color="neutral" :variant="item.feedback==='helpful'?'soft':'ghost'" icon="i-lucide-thumbs-up" @click="submitFeedback(item, 'helpful')">有帮助</UButton><UButton size="xs" color="neutral" :variant="item.feedback==='not_helpful'?'soft':'ghost'" icon="i-lucide-thumbs-down" @click="submitFeedback(item, 'not_helpful')">没帮助</UButton></div>
              </div>
            </div>

            <div v-if="pending" class="flex items-start gap-3"><div class="grid size-8 shrink-0 place-items-center rounded-xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><UIcon name="i-lucide-sparkles" class="size-4" /></div><div><p class="mb-1.5 text-[11px] text-slate-400">赋能助手</p><div class="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-slate-100 bg-white px-4 py-4 shadow-sm"><span class="size-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-.3s]" /><span class="size-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-.15s]" /><span class="size-1.5 animate-bounce rounded-full bg-emerald-400" /><span class="ml-2 text-xs text-slate-400">正在澄清问题并判断推荐模块</span></div></div></div>

            <div v-if="fuse" class="flex items-start gap-3"><div class="grid size-8 shrink-0 place-items-center rounded-xl border border-red-200 bg-red-50 text-red-600 shadow-sm"><UIcon name="i-lucide-siren" class="size-4" /></div><div class="min-w-0 max-w-[88%] sm:max-w-[82%]"><p class="mb-1.5 text-[11px] text-slate-400">赋能助手</p><div class="rounded-2xl rounded-tl-md border-2 border-red-200 bg-red-50 p-5"><div class="flex gap-3"><UIcon name="i-lucide-siren" class="mt-1 size-6 shrink-0 text-red-600" /><div><h3 class="font-semibold text-red-900">常规建议已暂停</h3><p class="mt-2 text-sm text-red-800">{{ fuse.message }}</p><p class="mt-3 rounded-xl bg-white/70 p-3 text-sm text-red-900">{{ fuse.guide }}</p></div></div></div></div></div>
            <div v-if="route && !fuse" class="flex items-start gap-3"><div class="grid size-8 shrink-0 place-items-center rounded-xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><UIcon name="i-lucide-sparkles" class="size-4" /></div><div class="min-w-0 max-w-[88%] sm:max-w-[82%]"><p class="mb-1.5 text-[11px] text-slate-400">赋能助手</p><div class="rounded-2xl rounded-tl-md border border-emerald-100 bg-emerald-50/70 p-5"><div class="flex items-center gap-2 text-xs font-semibold text-emerald-700"><UIcon name="i-lucide-route" class="size-4" />建议处理方向</div><p class="mt-2 text-sm leading-6 text-slate-600">{{ route.rationale }}</p><UAlert v-if="routeConfirmError" class="mt-3" color="warning" variant="soft" :description="routeConfirmError" /><div class="mt-4 flex flex-wrap items-center gap-2"><UButton color="primary" :loading="confirmingModule === route.primaryModule" :disabled="Boolean(confirmingModule)" @click="confirmModule(route.primaryModule)">{{ moduleMeta[route.primaryModule].title }} · {{ Math.round(route.confidence * 100) }}%</UButton><UButton v-for="item in route.secondaryModules" :key="item.module" color="neutral" variant="soft" :loading="confirmingModule === item.module" :disabled="Boolean(confirmingModule)" @click="confirmModule(item.module)">{{ moduleMeta[item.module].title }} · {{ Math.round(item.confidence * 100) }}%</UButton></div><p class="mt-3 text-xs text-slate-500">由您确认处理方向；进入模块后再由规则引擎完成评估与分级。</p></div></div></div>
          </div>

          <div v-else class="mx-auto flex h-full max-w-2xl flex-col items-center justify-center py-8 text-center">
            <div class="grid size-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><UIcon name="i-lucide-sparkles" class="size-6" /></div><h2 class="mt-4 text-lg font-semibold">{{ greetingName }}，今天遇到了什么？</h2><p class="mt-2 text-sm leading-6 text-slate-500">自然描述真实情况即可，助手会帮您判断先进入哪个模块评估。</p>
            <div class="mt-6 grid w-full gap-2 sm:grid-cols-2"><button v-for="prompt in quickPrompts" :key="prompt" type="button" class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm leading-5 text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800" @click="usePrompt(prompt)">{{ prompt }}<UIcon name="i-lucide-arrow-up-right" class="ml-1 inline size-3.5 text-slate-300" /></button></div>
          </div>
        </div>

        <form class="sticky bottom-0 border-t border-slate-100 bg-white px-4 py-3.5 sm:px-6" @submit.prevent="ask">
          <div class="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition focus-within:border-emerald-400 focus-within:ring-3 focus-within:ring-emerald-100">
            <UTextarea v-model="input" :rows="4" :maxrows="8" :maxlength="4000" autoresize class="min-w-0 flex-1" variant="none" placeholder="请详细描述您的问题，包括：问题表现、涉及对象、发生频率、您的感受。系统将自动匹配关键词进行智能识别。" aria-label="向 AI 赋能助手提问" @keydown.enter.exact.prevent="ask" />
            <UButton type="submit" icon="i-lucide-arrow-up" size="lg" square :loading="pending" :disabled="!input.trim()" aria-label="发送消息" />
          </div>
          <div class="mt-2 flex items-center justify-between px-1 text-[11px] text-slate-400"><span>Enter 发送 · Shift + Enter 换行</span><span>{{ input.length }}/4000</span></div>
          <p class="mt-1 text-center text-[11px] text-slate-300">AI 辅助建议，需人工专业判断</p>
        </form>
      </div>
    </section>

    <section id="dashboard-section" v-if="today" class="mt-12">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-emerald-700">持续使用闭环</p>
          <h2 class="mt-1 text-2xl font-semibold">今日待办</h2>
        </div>
        <NuxtLink to="/notifications" class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 hover:shadow-md">
          <UIcon name="i-lucide-bell-ring" class="size-4" />
          进入工作日志
          <UIcon name="i-lucide-arrow-right" class="size-4" />
        </NuxtLink>
      </div>

      <!-- 指标卡片 -->
      <div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="panel flex flex-col items-center p-5 text-center transition hover:shadow-md">
          <div class="grid size-10 place-items-center rounded-xl bg-blue-100">
            <UIcon name="i-lucide-bell" class="size-5 text-blue-600" />
          </div>
          <strong class="mt-3 text-2xl font-bold text-slate-900">{{ todayTodoMetrics.unread }}</strong>
          <p class="mt-0.5 text-xs text-slate-500">未读通知</p>
        </div>
        <div class="panel flex flex-col items-center p-5 text-center transition hover:shadow-md">
          <div class="grid size-10 place-items-center rounded-xl" :class="todayTodoMetrics.overdueActions ? 'bg-red-100' : 'bg-emerald-100'">
            <UIcon name="i-lucide-clipboard-check" class="size-5" :class="todayTodoMetrics.overdueActions ? 'text-red-600' : 'text-emerald-600'" />
          </div>
          <strong class="mt-3 text-2xl font-bold" :class="todayTodoMetrics.overdueActions ? 'text-red-700' : 'text-slate-900'">{{ todayTodoMetrics.actions }}</strong>
          <p class="mt-0.5 text-xs text-slate-500">
            今日动作
            <span v-if="todayTodoMetrics.overdueActions" class="ml-0.5 text-red-500">({{ todayTodoMetrics.overdueActions }} 逾期)</span>
          </p>
        </div>
        <div class="panel flex flex-col items-center p-5 text-center transition hover:shadow-md">
          <div class="grid size-10 place-items-center rounded-xl bg-amber-100">
            <UIcon name="i-lucide-rotate-ccw" class="size-5 text-amber-600" />
          </div>
          <strong class="mt-3 text-2xl font-bold text-slate-900">{{ todayTodoMetrics.reviews }}</strong>
          <p class="mt-0.5 text-xs text-slate-500">待复盘</p>
        </div>
        <div class="panel flex flex-col items-center p-5 text-center transition hover:shadow-md">
          <div class="grid size-10 place-items-center rounded-xl bg-purple-100">
            <UIcon name="i-lucide-file-text" class="size-5 text-purple-600" />
          </div>
          <strong class="mt-3 text-2xl font-bold text-slate-900">{{ todayTodoMetrics.drafts + todayTodoMetrics.assignments }}</strong>
          <p class="mt-0.5 text-xs text-slate-500">草稿/移交</p>
        </div>
      </div>

      <!-- 待办列表：今日动作 + 待复盘 -->
      <div class="mt-5 grid gap-4 lg:grid-cols-2">
        <div class="panel flex flex-col p-5">
          <div class="flex items-center justify-between">
            <h3 class="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <UIcon name="i-lucide-clipboard-check" class="size-4 text-emerald-600" />今日动作
            </h3>
            <NuxtLink to="/notifications?tab=action" class="text-xs font-medium text-emerald-600 transition hover:text-emerald-800">查看全部</NuxtLink>
          </div>
          <div class="mt-4 flex-1 space-y-2">
            <NuxtLink v-for="action in today.actions.slice(0, 4)" :key="action.id" :to="`/plans/${action.planId}`" class="flex flex-col gap-1.5 rounded-lg border border-slate-100 bg-white px-3 py-2.5 text-sm transition hover:border-emerald-200 hover:bg-emerald-50/50">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-medium text-slate-500">{{ (moduleMeta as Record<string, { title: string }>)[action.planModule]?.title || '' }}</span>
                <UBadge :color="action.overdue ? 'error' : 'neutral'" variant="soft" size="xs">{{ action.overdue ? '已逾期' : '今日' }}</UBadge>
              </div>
              <p class="line-clamp-2 text-sm leading-5 text-slate-700">{{ action.detail }}</p>
            </NuxtLink>
            <p v-if="!today.actions.length" class="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-400">暂无到期动作</p>
          </div>
        </div>

        <div class="panel flex flex-col p-5">
          <div class="flex items-center justify-between">
            <h3 class="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <UIcon name="i-lucide-rotate-ccw" class="size-4 text-amber-600" />待复盘
            </h3>
            <span v-if="todayTodoMetrics.drafts" class="flex items-center gap-1 text-xs text-slate-400">
              <UIcon name="i-lucide-file-clock" class="size-3" />{{ todayTodoMetrics.drafts }} 份草稿
            </span>
          </div>
          <div class="mt-4 flex-1 space-y-2">
            <NuxtLink v-for="review in today.reviews.slice(0, 4)" :key="review.id" :to="`/plans/${review.id}`" class="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2.5 text-sm transition hover:border-amber-200 hover:bg-amber-50/50">
              <span class="min-w-0 truncate"><strong>{{ review.title }}</strong><small class="ml-1.5 text-slate-400">{{ (moduleMeta as Record<string, { title: string }>)[review.module]?.title || review.module }}</small></span>
              <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-slate-300" />
            </NuxtLink>
            <p v-if="!today.reviews.length" class="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-400">暂无待复盘方案</p>
          </div>
        </div>
      </div>
    </section>

    <section id="modules" class="mt-12">
      <div class="flex items-end justify-between"><div><p class="text-sm font-semibold text-emerald-700">快捷入口</p><h2 class="mt-1 text-2xl font-semibold">我知道要处理什么</h2></div><UButton to="/information" variant="ghost" color="neutral" trailing-icon="i-lucide-arrow-right">信息管理中心</UButton></div>
      <div class="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <NuxtLink v-for="(item, id) in moduleMeta" :key="id" :to="`/module/${id}`" class="panel group flex min-h-64 flex-col p-5 transition hover:-translate-y-1 hover:shadow-xl">
          <div class="flex items-start justify-between gap-3"><div class="grid size-11 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><UIcon :name="item.icon" class="size-5" /></div><UBadge v-if="getModuleBadge(id)" :color="getModuleBadgeColor(id)" variant="soft">{{ getModuleBadge(id)?.label }}</UBadge></div>
          <h3 class="mt-5 font-semibold">{{ item.title }}</h3><p class="mt-2 text-sm text-slate-500">{{ item.short }}</p>
          <div class="mt-auto border-t border-slate-100 pt-4 text-xs">
            <div v-if="getModuleState(id)?.draftId" class="flex items-center justify-between gap-2 text-amber-700"><span class="flex items-center gap-1.5"><UIcon name="i-lucide-file-clock" class="size-3.5" />继续未完成评估</span><span>{{ getModuleState(id).draftAnswerCount }} 题</span></div>
            <div v-else-if="getModuleState(id)?.lastSubmittedAt" class="flex items-center justify-between gap-2 text-slate-500"><span>最近评估</span><span>{{ relativeDate(getModuleState(id).lastSubmittedAt) }}</span></div>
            <div v-else class="flex items-center gap-1.5 text-emerald-700"><UIcon name="i-lucide-play" class="size-3.5" />开始首次评估</div>
            <div v-if="getModuleState(id)?.pendingActions || getModuleState(id)?.reviewDue" class="mt-2 flex flex-wrap gap-1.5"><UBadge v-if="getModuleState(id)?.pendingActions" color="neutral" variant="soft">{{ getModuleState(id).pendingActions }} 个待执行</UBadge><UBadge v-if="getModuleState(id)?.reviewDue" color="warning" variant="soft">{{ getModuleState(id).reviewDue }} 个待复盘</UBadge></div>
          </div>
        </NuxtLink>
      </div>
    </section>

  </div>

  <UModal :open="!!pendingPlanSuggestion" @update:open="(val) => { if (!val) pendingPlanSuggestion = null }" title="执行反馈" description="请填写本次方案执行的具体情况。">
    <template #body>
      <form class="space-y-4" @submit.prevent="submitPlanExecution">
        <UFormField label="执行日期">
          <UInput v-model="planExecForm.executedAt" type="datetime-local" class="w-full" />
        </UFormField>
        <UFormField label="执行结果">
          <UTextarea v-model="planExecForm.executionNote" :rows="4" class="w-full" placeholder="这次行动的具体执行情况和取得的效果" />
        </UFormField>
        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="ghost" @click="() => { pendingPlanSuggestion = null }">取消</UButton>
          <UButton type="submit" :loading="pending" :disabled="!planExecForm.executionNote.trim()">确认并保存</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>

<style>
.markdown-body h1 { font-size: 1.25rem; font-weight: 700; margin: 1rem 0 0.5rem; }
.markdown-body h2 { font-size: 1.1rem; font-weight: 700; margin: 0.75rem 0 0.5rem; }
.markdown-body h3 { font-size: 1rem; font-weight: 600; margin: 0.75rem 0 0.25rem; }
.markdown-body p { margin: 0.25rem 0; }
.markdown-body ul, .markdown-body ol { padding-left: 1.25rem; margin: 0.25rem 0; }
.markdown-body li { margin: 0.125rem 0; }
.markdown-body strong { font-weight: 600; }
.markdown-body em { font-style: italic; }
.markdown-body code {
  font-size: 0.8rem;
  background: #f1f5f9;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-family: ui-monospace, monospace;
}
.markdown-body pre {
  background: #1e293b;
  color: #e2e8f0;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  overflow-x: auto;
  margin: 0.5rem 0;
  font-size: 0.8rem;
  line-height: 1.5;
}
.markdown-body pre code {
  background: none;
  padding: 0;
  color: inherit;
}
.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.5rem 0;
  font-size: 0.8rem;
}
.markdown-body th, .markdown-body td {
  border: 1px solid #e2e8f0;
  padding: 0.375rem 0.75rem;
  text-align: left;
}
.markdown-body th {
  background: #f8fafc;
  font-weight: 600;
}
.markdown-body blockquote {
  border-left: 3px solid #10b981;
  padding-left: 0.75rem;
  margin: 0.5rem 0;
  color: #475569;
}
.markdown-body hr {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 0.75rem 0;
}
.markdown-body a {
  color: #059669;
  text-decoration: underline;
}
</style>

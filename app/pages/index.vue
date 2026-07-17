<script setup lang="ts">
import { assessmentBadge, moduleMeta } from '#shared/assessments'
import type { ModuleId, RouteDecision } from '#shared/contracts'

interface SourceItem {
  chunkId: string
  documentTitle: string
  heading?: string | null
  knowledgeBase: string
  excerpt?: string
}

interface TimelineItem {
  messageId?: string
  role: 'user' | 'assistant'
  text: string
  sources?: SourceItem[]
  mode?: 'deepseek' | 'local_fallback'
  planUpdateSuggestions?: Array<any>
  feedback?: 'helpful' | 'not_helpful'
}

const { user } = useAuth()
const { data: sessions, refresh: refreshSessions } = await useFetch<any[]>('/api/v1/chat/sessions')
const { data: assistantStatus } = await useFetch<any>('/api/v1/chat/status')
const { data: governance, refresh: refreshGovernance } = await useFetch<any>('/api/v1/chat/data-governance')
const { data: today, refresh: refreshToday } = await useFetch<any>('/api/v1/workbench/today')
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
const routeConfirmError = ref('')
const selectedContextKey = ref('none')
const suppressContextWatch = ref(false)
const contextPreview = ref<any>(null)
const previewLoading = ref(false)
const withoutRecord = ref(false)
const deleteCandidate = ref<string>()
const toast = useToast()
const quickPrompts = [
  '最近工作压力很大，总觉得精力不够用',
  '班级纪律反复，想梳理一下问题出在哪里',
  '家长在群里公开质疑我，我该怎么沟通？',
  '有位学生最近明显沉默，我应该先做什么？',
  '有个学生怎么教都不会，我该怎么帮他？'
]
const contextSelectItems = computed(() => [
  { label: '不指定对象', value: 'none' },
  ...((contextOptions.value?.students || []).map((item: any) => ({ label: `学生 · ${item.label}`, value: `student:${item.id}` }))),
  ...((contextOptions.value?.classes || []).map((item: any) => ({ label: `班级 · ${item.label}`, value: `class:${item.id}` }))),
  ...((contextOptions.value?.guardians || []).map((item: any) => ({ label: `家长 · ${item.label}`, value: `guardian:${item.id}` })))
])
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
  nextTick(() => scrollToLatest('auto'))
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
    timeline.value = result.messages.map((item: any) => ({
      messageId: item.id,
      role: item.role,
      text: item.text,
      mode: item.metadata?.mode,
      sources: item.metadata?.sources || [],
      planUpdateSuggestions: item.metadata?.planUpdateSuggestions || []
    }))
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
  try {
    await $fetch(`/api/v1/chat/messages/${item.messageId}/plan-suggestions/${index}/confirm`, { method: 'POST' })
    item.planUpdateSuggestions![index].appliedAt = new Date().toISOString()
    toast.add({ title: '方案已按您的确认更新', color: 'success' })
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
  await navigateTo({ path: `/module/${module}`, query: selectedContext.value ? { contextType: selectedContext.value.type, contextId: selectedContext.value.id, sourceChatSessionId: sessionId.value } : undefined })
}

onMounted(() => {
  const query = useRoute().query
  const type = typeof query.contextType === 'string' ? query.contextType : ''
  const id = typeof query.contextId === 'string' ? query.contextId : ''
  let prefill: { prompt?: string, contextKey?: string } | null = null
  const storedPrefill = sessionStorage.getItem('assistant-prefill')
  if (storedPrefill) {
    try { prefill = JSON.parse(storedPrefill) } catch { /* 忽略损坏的本地预填数据 */ }
    sessionStorage.removeItem('assistant-prefill')
  }
  if (type && id) selectedContextKey.value = `${type}:${id}`
  else if (prefill?.contextKey) selectedContextKey.value = prefill.contextKey
  else loadContextPreview()
  if (prefill?.prompt) input.value = prefill.prompt
})
</script>

<template>
  <div class="mx-auto max-w-7xl px-5 py-8 sm:py-12">
    <section class="grid gap-8 lg:grid-cols-[1.25fr_.75fr]">
      <div>
        <p class="text-sm font-semibold text-emerald-700">{{ new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) }}</p>
        <h1 class="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{{ user?.name }}，今天遇到了什么？</h1>
        <p class="mt-4 max-w-2xl text-base leading-7 text-slate-600">把情况像对同事一样说出来。助手会结合已审核业务知识进行多轮分析，给出来源和可执行建议，再由您确认处理方向。</p>
      </div>
      <div class="panel flex items-center gap-4 p-5">
        <div class="grid size-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><UIcon name="i-lucide-shield-check" class="size-7" /></div>
        <div><p class="text-sm font-semibold">安全规则正在运行</p><p class="mt-1 text-xs leading-5 text-slate-500">危机与等级由确定性规则执行；AI 只负责理解、检索和表达，不进行心理诊断。</p></div>
      </div>
    </section>

    <section class="mt-10 grid items-stretch gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside class="panel flex h-[18rem] flex-col overflow-hidden lg:h-[46rem] lg:min-h-[42rem]">
        <div class="border-b border-slate-100 p-4">
          <UButton block icon="i-lucide-message-square-plus" size="lg" @click="newConversation">新对话</UButton>
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
      </aside>

      <div class="panel flex h-[calc(100dvh-7.5rem)] min-h-[36rem] min-w-0 flex-col overflow-hidden lg:h-[46rem] lg:min-h-[42rem]">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white/90 px-5 py-3.5 sm:px-6">
          <div class="flex min-w-0 items-center gap-3">
            <div class="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><UIcon name="i-lucide-sparkles" class="size-4.5" /></div>
            <div class="min-w-0"><div class="flex items-center gap-2"><strong class="text-sm">AI 赋能助手</strong><span class="size-1.5 rounded-full bg-emerald-500" /></div><p class="truncate text-xs text-slate-400">基于 {{ assistantStatus?.publishedKnowledgeBases || 0 }} 个已发布知识库 · 支持连续追问</p></div>
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
                <details v-if="item.sources?.length" class="group mt-7 overflow-hidden rounded-xl border border-emerald-100 bg-emerald-50/50 text-xs text-slate-600">
                  <summary class="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 font-medium text-emerald-800"><span class="flex items-center gap-2"><UIcon name="i-lucide-book-open-check" class="size-4" />参考了 {{ item.sources.length }} 条知识内容</span><UIcon name="i-lucide-chevron-down" class="size-3.5 transition group-open:rotate-180" /></summary>
                  <div class="space-y-2 border-t border-emerald-100 px-3 py-3">
                    <div v-for="(source, sourceIndex) in item.sources" :key="source.chunkId" class="rounded-lg bg-white/80 p-3">
                      <p class="font-medium text-slate-700"><span class="mr-1 text-emerald-600">{{ sourceIndex + 1 }}.</span>{{ source.documentTitle }}<span v-if="source.heading" class="font-normal text-slate-400"> · {{ source.heading }}</span></p>
                      <p class="mt-1 text-[11px] text-emerald-700/70">{{ source.knowledgeBase }}</p><p v-if="source.excerpt" class="mt-1.5 line-clamp-3 leading-5 text-slate-500">{{ source.excerpt }}</p>
                    </div>
                  </div>
                </details>
                <div v-if="item.role === 'assistant' && item.planUpdateSuggestions?.length" class="mt-7 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs"><p class="font-semibold text-amber-900">AI 建议更新方案（尚未写入）</p><div v-for="(suggestion, suggestionIndex) in item.planUpdateSuggestions" :key="suggestionIndex" class="flex items-center justify-between gap-3 rounded-lg bg-white p-3"><span class="text-slate-600">{{ suggestion.actionTitle || '新增复盘' }}<template v-if="suggestion.newStatus"> → {{ suggestion.newStatus }}</template><span v-if="suggestion.progressNote" class="mt-1 block text-slate-400">{{ suggestion.progressNote }}</span></span><UButton size="xs" :disabled="Boolean(suggestion.appliedAt)" @click="confirmPlanSuggestion(item, suggestionIndex)">{{ suggestion.appliedAt ? '已确认' : '确认应用' }}</UButton></div></div>
                <div v-if="item.role === 'assistant' && item.messageId" class="mt-7 flex items-center gap-2 text-xs text-slate-400"><span>这条回答有帮助吗？</span><UButton size="xs" color="neutral" :variant="item.feedback==='helpful'?'soft':'ghost'" icon="i-lucide-thumbs-up" @click="submitFeedback(item, 'helpful')">有帮助</UButton><UButton size="xs" color="neutral" :variant="item.feedback==='not_helpful'?'soft':'ghost'" icon="i-lucide-thumbs-down" @click="submitFeedback(item, 'not_helpful')">没帮助</UButton></div>
              </div>
            </div>

            <div v-if="pending" class="flex items-start gap-3"><div class="grid size-8 shrink-0 place-items-center rounded-xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><UIcon name="i-lucide-sparkles" class="size-4" /></div><div><p class="mb-1.5 text-[11px] text-slate-400">赋能助手</p><div class="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-slate-100 bg-white px-4 py-4 shadow-sm"><span class="size-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-.3s]" /><span class="size-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-.15s]" /><span class="size-1.5 animate-bounce rounded-full bg-emerald-400" /><span class="ml-2 text-xs text-slate-400">正在检索并整理建议</span></div></div></div>

            <div v-if="fuse" class="flex items-start gap-3"><div class="grid size-8 shrink-0 place-items-center rounded-xl border border-red-200 bg-red-50 text-red-600 shadow-sm"><UIcon name="i-lucide-siren" class="size-4" /></div><div class="min-w-0 max-w-[88%] sm:max-w-[82%]"><p class="mb-1.5 text-[11px] text-slate-400">赋能助手</p><div class="rounded-2xl rounded-tl-md border-2 border-red-200 bg-red-50 p-5"><div class="flex gap-3"><UIcon name="i-lucide-siren" class="mt-1 size-6 shrink-0 text-red-600" /><div><h3 class="font-semibold text-red-900">常规建议已暂停</h3><p class="mt-2 text-sm text-red-800">{{ fuse.message }}</p><p class="mt-3 rounded-xl bg-white/70 p-3 text-sm text-red-900">{{ fuse.guide }}</p></div></div></div></div></div>
            <div v-if="route && !fuse" class="flex items-start gap-3"><div class="grid size-8 shrink-0 place-items-center rounded-xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><UIcon name="i-lucide-sparkles" class="size-4" /></div><div class="min-w-0 max-w-[88%] sm:max-w-[82%]"><p class="mb-1.5 text-[11px] text-slate-400">赋能助手</p><div class="rounded-2xl rounded-tl-md border border-emerald-100 bg-emerald-50/70 p-5"><div class="flex items-center gap-2 text-xs font-semibold text-emerald-700"><UIcon name="i-lucide-route" class="size-4" />建议处理方向</div><p class="mt-2 text-sm leading-6 text-slate-600">{{ route.rationale }}</p><UAlert v-if="routeConfirmError" class="mt-3" color="warning" variant="soft" :description="routeConfirmError" /><div class="mt-4 flex flex-wrap items-center gap-2"><UButton color="primary" :loading="confirmingModule === route.primaryModule" :disabled="Boolean(confirmingModule)" @click="confirmModule(route.primaryModule)">{{ moduleMeta[route.primaryModule].title }} · {{ Math.round(route.confidence * 100) }}%</UButton><UButton v-for="item in route.secondaryModules" :key="item.module" color="neutral" variant="soft" :loading="confirmingModule === item.module" :disabled="Boolean(confirmingModule)" @click="confirmModule(item.module)">{{ moduleMeta[item.module].title }} · {{ Math.round(item.confidence * 100) }}%</UButton></div><p class="mt-3 text-xs text-slate-500">由您确认处理方向；进入模块后再由规则引擎完成评估与分级。</p></div></div></div>
          </div>

          <div v-else class="mx-auto flex h-full max-w-2xl flex-col items-center justify-center py-8 text-center">
            <div class="grid size-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><UIcon name="i-lucide-sparkles" class="size-6" /></div><h2 class="mt-4 text-lg font-semibold">今天想先聊聊什么？</h2><p class="mt-2 text-sm leading-6 text-slate-500">自然描述真实情况即可，助手会结合已审核知识梳理问题并给出可执行建议。</p>
            <div class="mt-6 grid w-full gap-2 sm:grid-cols-2"><button v-for="prompt in quickPrompts" :key="prompt" type="button" class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm leading-5 text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800" @click="usePrompt(prompt)">{{ prompt }}<UIcon name="i-lucide-arrow-up-right" class="ml-1 inline size-3.5 text-slate-300" /></button></div>
          </div>
        </div>

        <form class="sticky bottom-0 border-t border-slate-100 bg-white px-4 py-3.5 sm:px-6" @submit.prevent="ask">
          <div class="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition focus-within:border-emerald-400 focus-within:ring-3 focus-within:ring-emerald-100">
            <UTextarea v-model="input" :rows="1" :maxrows="5" :maxlength="4000" autoresize class="min-w-0 flex-1" variant="none" placeholder="描述您遇到的情况，Shift + Enter 换行……" aria-label="向 AI 赋能助手提问" @keydown.enter.exact.prevent="ask" />
            <UButton type="submit" icon="i-lucide-arrow-up" size="lg" square :loading="pending" :disabled="!input.trim()" aria-label="发送消息" />
          </div>
          <div class="mt-2 flex items-center justify-between px-1 text-[11px] text-slate-400"><span>Enter 发送 · Shift + Enter 换行</span><span>{{ input.length }}/4000</span></div>
        </form>
      </div>
    </section>

    <section v-if="today" class="mt-12">
      <div class="flex items-end justify-between"><div><p class="text-sm font-semibold text-emerald-700">持续使用闭环</p><h2 class="mt-1 text-2xl font-semibold">今日待办</h2></div><UButton to="/notifications" variant="ghost" color="neutral" trailing-icon="i-lucide-bell">{{ today.unreadCount }} 条未读</UButton></div>
      <div class="mt-5 grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
        <div class="panel p-5"><h3 class="font-semibold">首次使用清单</h3><div class="mt-4 space-y-3"><div v-for="item in today.onboarding" :key="item.key" class="flex items-center gap-3 text-sm"><span class="grid size-6 place-items-center rounded-full" :class="item.completed?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-400'"><UIcon :name="item.completed?'i-lucide-check':'i-lucide-circle'" class="size-3.5" /></span><span :class="item.completed?'text-slate-400 line-through':'text-slate-700'">{{ item.label }}</span></div></div></div>
        <div class="panel p-5"><div class="grid gap-4 sm:grid-cols-3"><div><p class="text-xs text-slate-400">问卷草稿</p><strong class="mt-1 block text-2xl">{{ today.drafts.length }}</strong></div><div><p class="text-xs text-slate-400">今日/逾期动作</p><strong class="mt-1 block text-2xl">{{ today.actions.length }}</strong></div><div><p class="text-xs text-slate-400">待复盘方案</p><strong class="mt-1 block text-2xl">{{ today.reviews.length }}</strong></div></div><div class="mt-5 space-y-2"><NuxtLink v-for="action in today.actions.slice(0, 4)" :key="action.id" :to="`/information/plans/${action.planId}`" class="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm"><span><strong>{{ action.title }}</strong><small class="ml-2 text-slate-400">{{ action.planTitle }}</small></span><UBadge :color="action.overdue?'error':'neutral'" variant="soft">{{ action.overdue ? '已逾期' : '今日' }}</UBadge></NuxtLink><p v-if="!today.actions.length" class="py-4 text-center text-sm text-slate-400">今天没有到期动作</p></div></div>
      </div>
    </section>

    <section class="mt-12">
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

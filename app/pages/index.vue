<script setup lang="ts">
import { moduleMeta } from '#shared/assessments'
import type { ModuleId, RouteDecision } from '#shared/contracts'

interface SourceItem {
  chunkId: string
  documentTitle: string
  heading?: string | null
  knowledgeBase: string
  excerpt?: string
}

interface TimelineItem {
  role: 'user' | 'assistant'
  text: string
  sources?: SourceItem[]
  mode?: 'deepseek' | 'local_fallback'
}

const { user } = useAuth()
const { data: sessions, refresh: refreshSessions } = await useFetch<any[]>('/api/v1/chat/sessions')
const { data: assistantStatus } = await useFetch<any>('/api/v1/chat/status')
const input = ref('')
const pending = ref(false)
const loadingSession = ref(false)
const sessionId = ref<string>()
const route = ref<(RouteDecision & { id: string }) | null>(null)
const fuse = ref<{ message: string, guide: string } | null>(null)
const timeline = ref<TimelineItem[]>([])
const assistantMode = ref<'deepseek' | 'local_fallback'>(assistantStatus.value?.mode || 'local_fallback')

function newConversation() {
  sessionId.value = undefined
  timeline.value = []
  route.value = null
  fuse.value = null
}

async function loadSession(id: string) {
  if (pending.value) return
  loadingSession.value = true
  try {
    const result = await $fetch<any>(`/api/v1/chat/sessions/${id}`)
    sessionId.value = id
    route.value = null
    fuse.value = null
    timeline.value = result.messages.map((item: any) => ({
      role: item.role,
      text: item.text,
      mode: item.metadata?.mode,
      sources: item.metadata?.sources || []
    }))
    const lastAssistant = [...result.messages].reverse().find((item: any) => item.role === 'assistant')
    if (lastAssistant?.metadata?.mode) assistantMode.value = lastAssistant.metadata.mode
  } finally { loadingSession.value = false }
}

async function ask() {
  if (!input.value.trim() || pending.value) return
  const text = input.value.trim()
  input.value = ''
  pending.value = true
  route.value = null
  fuse.value = null
  timeline.value.push({ role: 'user', text })
  let assistantIndex = -1
  try {
    const response = await fetch('/api/v1/chat/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId.value, message: text })
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
        if (event === 'ack') sessionId.value = data.sessionId
        if (event === 'answer') {
          assistantMode.value = data.mode
          timeline.value.push({ role: 'assistant', text: data.text, mode: data.mode, sources: [] })
          assistantIndex = timeline.value.length - 1
        }
        if (event === 'sources' && assistantIndex >= 0) timeline.value[assistantIndex]!.sources = data
        if (event === 'route') route.value = data
        if (event === 'fuse') fuse.value = data
        if (event === 'error') throw new Error(data.message)
      }
    }
    await refreshSessions()
  } catch (error: any) {
    timeline.value.push({ role: 'assistant', text: error?.message || '处理失败，请稍后重试。' })
  } finally { pending.value = false }
}

async function confirmModule(module: ModuleId) {
  if (!route.value) return
  await $fetch(`/api/v1/chat/routes/${route.value.id}/confirm`, { method: 'POST', body: { module } })
  await navigateTo(`/module/${module}`)
}
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

    <section class="mt-10 grid gap-5 lg:grid-cols-[15rem_1fr]">
      <aside class="panel h-fit overflow-hidden">
        <div class="border-b border-slate-100 p-4"><UButton block icon="i-lucide-message-square-plus" @click="newConversation">新对话</UButton></div>
        <div class="max-h-[34rem] space-y-1 overflow-y-auto p-2">
          <button v-for="item in sessions" :key="item.id" class="w-full rounded-xl px-3 py-3 text-left text-sm transition" :class="sessionId===item.id?'bg-emerald-50 text-emerald-900':'text-slate-600 hover:bg-slate-50'" @click="loadSession(item.id)"><span class="line-clamp-2 block">{{ item.title }}</span><span class="mt-1 block text-[11px] text-slate-400">{{ new Date(item.updatedAt).toLocaleString('zh-CN') }}</span></button>
          <p v-if="!sessions?.length" class="px-3 py-8 text-center text-xs text-slate-400">暂无历史对话</p>
        </div>
      </aside>

      <div class="panel min-w-0 overflow-hidden">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-7"><div class="flex items-center gap-2"><span class="size-2 rounded-full bg-emerald-500" /><strong>AI 赋能助手</strong><span class="text-xs text-slate-400">知识增强 · 多轮对话 · {{ assistantStatus?.publishedKnowledgeBases || 0 }} 个已发布知识库</span></div><UBadge :color="assistantMode==='deepseek'?'success':'warning'" variant="soft">{{ assistantMode==='deepseek'?'DeepSeek 已接入':'本地降级模式' }}</UBadge></div>
        <div v-if="timeline.length" class="max-h-[32rem] space-y-5 overflow-y-auto px-5 py-6 sm:px-7" :class="{'opacity-60':loadingSession}">
          <div v-for="(item, index) in timeline" :key="index" class="flex" :class="item.role === 'user' ? 'justify-end' : 'justify-start'">
            <div class="max-w-[88%]">
              <div class="whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7" :class="item.role === 'user' ? 'bg-emerald-800 text-white' : 'bg-slate-100 text-slate-700'">{{ item.text }}</div>
              <div v-if="item.sources?.length" class="mt-2 space-y-2">
                <div v-for="(source, sourceIndex) in item.sources" :key="source.chunkId" class="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-950"><p class="font-medium">[{{ sourceIndex + 1 }}] {{ source.documentTitle }}<span v-if="source.heading"> · {{ source.heading }}</span></p><p class="mt-1 text-emerald-700/70">知识库：{{ source.knowledgeBase }}</p><p v-if="source.excerpt" class="mt-1 line-clamp-3 leading-5 text-slate-600">{{ source.excerpt }}</p></div>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="grid min-h-64 place-items-center px-6 text-center"><div><UIcon name="i-lucide-sparkles" class="mx-auto size-9 text-emerald-600" /><p class="mt-3 font-medium">从一个真实问题开始</p><p class="mt-2 text-sm text-slate-400">助手会检索已发布手册，并标出回答依据。</p></div></div>
        <div v-if="fuse" class="m-5 rounded-2xl border-2 border-red-200 bg-red-50 p-5 sm:m-7"><div class="flex gap-3"><UIcon name="i-lucide-siren" class="mt-1 size-6 shrink-0 text-red-600" /><div><h3 class="font-semibold text-red-900">常规建议已暂停</h3><p class="mt-2 text-sm text-red-800">{{ fuse.message }}</p><p class="mt-3 rounded-xl bg-white/70 p-3 text-sm text-red-900">{{ fuse.guide }}</p></div></div></div>
        <div v-if="route && !fuse" class="m-5 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5 sm:m-7"><p class="text-xs font-semibold uppercase tracking-wider text-emerald-700">建议处理方向</p><p class="mt-2 text-sm text-slate-600">{{ route.rationale }}</p><div class="mt-3 flex flex-wrap items-center gap-3"><UButton color="primary" @click="confirmModule(route.primaryModule)">{{ moduleMeta[route.primaryModule].title }} · {{ Math.round(route.confidence * 100) }}%</UButton><UButton v-for="item in route.secondaryModules" :key="item.module" color="neutral" variant="soft" @click="confirmModule(item.module)">{{ moduleMeta[item.module].title }} · {{ Math.round(item.confidence * 100) }}%</UButton></div><p class="mt-3 text-xs text-slate-500">AI 只提出方向，最终由您确认；进入模块后由规则引擎完成评估和分级。</p></div>
        <form class="flex gap-3 border-t border-slate-100 p-4 sm:p-6" @submit.prevent="ask"><UTextarea v-model="input" :rows="2" autoresize class="flex-1" placeholder="例如：最近有位家长总在群里质疑我，沟通完我也很难受……" @keydown.enter.exact.prevent="ask" /><UButton type="submit" icon="i-lucide-send" size="xl" :loading="pending">发送</UButton></form>
      </div>
    </section>

    <section class="mt-12">
      <div class="flex items-end justify-between"><div><p class="text-sm font-semibold text-emerald-700">快捷入口</p><h2 class="mt-1 text-2xl font-semibold">我知道要处理什么</h2></div><UButton to="/information" variant="ghost" color="neutral" trailing-icon="i-lucide-arrow-right">信息管理中心</UButton></div>
      <div class="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4"><NuxtLink v-for="(item, id) in moduleMeta" :key="id" :to="`/module/${id}`" class="panel group p-5 transition hover:-translate-y-1 hover:shadow-xl"><div class="grid size-11 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><UIcon :name="item.icon" class="size-5" /></div><h3 class="mt-5 font-semibold">{{ item.title }}</h3><p class="mt-2 text-sm text-slate-500">{{ item.short }}</p><UIcon name="i-lucide-arrow-up-right" class="mt-5 size-4 text-slate-400 transition group-hover:text-emerald-700" /></NuxtLink></div>
    </section>
  </div>
</template>

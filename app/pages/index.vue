<script setup lang="ts">
import { moduleMeta } from '#shared/assessments'
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

interface AgentActionCard {
  kind: 'recommend_assessment' | 'info'
  module?: ModuleId
  assessmentCode?: string
  title: string
  reason?: string
  content?: string
  ctaLabel?: string
}

interface TimelineItem {
  messageId?: string
  role: 'user' | 'assistant'
  text: string
  sources?: SourceItem[]
  mode?: 'deepseek' | 'local_fallback' | 'agent'
  planUpdateSuggestions?: Array<any>
  feedback?: 'helpful' | 'not_helpful'
  clarification?: ClarificationRoundData
  summary?: ClarificationSummaryData
  /** Agent 进程标记（工具调用记录：纯文本或结构化 {name,title,args}） */
  toolCalls?: Array<string | { name: string; title?: string; args?: string }>
  /** Agent 输出的动作卡（P0：量表推荐卡） */
  actionCards?: AgentActionCard[]
  /** 回答是否已完成（answer 事件到达）：完成前不展示工具/引用/量表过程块，避免抢在流式答案前出现 */
  answerCompleted?: boolean
}

const { user } = useAuth()
const { updateScores } = useModuleScores()
const { data: sessions, refresh: refreshSessions } = await useFetch<any[]>('/api/v1/chat/sessions')
// 侧栏「进行中的方案」：沿用方案列表接口，status=active 即待确认/进行中/待复盘/需调整/需协同，
// 只取总数展示，点击计数箭头进入完整方案列表。
const { data: pendingPlanResult } = await useFetch<{ total: number }>('/api/v1/plans', {
  query: { status: 'active', pageSize: 1, sort: 'nextReviewAt', order: 'asc' }
})
const pendingPlanTotal = computed(() => pendingPlanResult.value?.total || 0)
const { data: governance, refresh: refreshGovernance } = await useFetch<any>('/api/v1/chat/data-governance')
const { data: contextOptions } = await useFetch<any>('/api/v1/chat/context-options')
const input = ref('')
const pending = ref(false)
const loadingSession = ref(false)
const sessionId = ref<string>()
const route = ref<(RouteDecision & { id: string }) | null>(null)
const fuse = ref<{ message: string, guide: string } | null>(null)
const timeline = ref<TimelineItem[]>([])
/** 等待中状态条文案（Agent 灰度下由 thinking 事件更新为「Agent 思考中…」） */
const pendingLabel = ref('正在澄清问题并判断推荐模块')
/** 是否存在「待填充」的空气泡（answer_start 已建立但文本未流入）：动画应并入该气泡，独立状态条不再显示 */
const pendingAssistantBubble = computed(() => {
  const last = timeline.value[timeline.value.length - 1]
  return Boolean(last && last.role === 'assistant' && last.text === '' && pending.value)
})
const messageViewport = ref<HTMLElement | null>(null)
const copiedMessage = ref<number | null>(null)
/** 最后一条教师发言。进入模块时带给量表推荐用，让 AI 知道教师在说什么。 */
const lastUserMessage = computed(() => {
  for (let i = timeline.value.length - 1; i >= 0; i--) {
    const item = timeline.value[i]
    if (item?.role === 'user' && item.text?.trim()) return item.text.trim()
  }
  return ''
})
const selectedOptions = ref<Record<number, string>>({})
const selectedContextKey = ref('none')
const suppressContextWatch = ref(false)
const contextPreview = ref<any>(null)
const previewLoading = ref(false)
const withoutRecord = ref(false)
const deleteCandidate = ref<string>()
const toast = useToast()
const { moduleLabel, libraryTypeLabel, actionStatusLabel } = useDisplayLabels()
// 对话页把消息区滚动上报给导航浮层：滚动即收起顶栏与底部菜单（小屏生效）
// 小屏顶栏浮层滑出时会盖住面板标题行、露出被裁半截的图标：此时把标题行一并淡出；顶栏收起或桌面端恒显示
const { hidden: headerHidden, enabled: headerAutoHide, reportScroll: reportHeaderScroll } = useAutoHideHeader()
const panelHeaderFaded = computed(() => headerAutoHide.value && !headerHidden.value)
// 键盘遮挡高度：键盘以浮层覆盖，面板主动缩短，输入框才不会被盖住
const { inset: keyboardInset, covered: keyboardCovered } = useKeyboardInset()
// 手机端浏览器有时会为了露出输入框平移可视视口，键盘收起后必须归零，否则整窗看起来上移了
watch([keyboardCovered, keyboardInset], () => { if (typeof window !== 'undefined' && window.scrollY !== 0) window.scrollTo(0, 0) })
/** 是否手机窄屏（<640px，与 Tailwind 的 sm 断点一致）：手机上面板四周只留 2px。 */
const phoneLayout = ref(false)
let phoneMedia: MediaQueryList | null = null
function syncPhoneLayout(event?: MediaQueryListEvent) {
  phoneLayout.value = event ? event.matches : Boolean(phoneMedia?.matches)
}
/** 是否有底部菜单（<768px，与 Tailwind 的 md 断点一致）：它默认收起，只有滑出时才需要抬高输入框。 */
const bottomNavLayout = ref(false)
let bottomNavMedia: MediaQueryList | null = null
function syncBottomNavLayout(event?: MediaQueryListEvent) {
  bottomNavLayout.value = event ? event.matches : Boolean(bottomNavMedia?.matches)
}
/** 对话面板高度：默认用 class 里的高度；键盘弹出时用内联高度补偿，其余情况高度恒定（导航显隐不挤压内容）。 */
const panelHeightStyle = computed(() => {
  if (!keyboardCovered.value) return undefined
  // 键盘弹出时底部菜单已经藏到键盘后面，面板底部直接贴到键盘上沿。
  // 手机窄屏面板只留 2px 顶边距；≥sm 沿用原有基准。
  const base = phoneLayout.value ? '2px' : '1.9rem'
  const inset = keyboardInset.value > 0 ? ` - ${keyboardInset.value}px` : ''
  return { height: `calc(100dvh - ${base}${inset})` }
})

/** 底部菜单浮层滑出时输入框上移：菜单悬浮在聊天窗口之上，但不盖住输入框（≥md 没有底部菜单，不需要抬高）。 */
const inputLifted = computed(() => bottomNavLayout.value && !headerHidden.value && !keyboardCovered.value)

// 对话页按视口高度布局、滚动只发生在消息区内：锁掉窗口滚动，手机端手势不会把整个窗口拖走
useHead({ htmlAttrs: { class: 'overflow-hidden' }, bodyAttrs: { class: 'overflow-hidden' } })
const greetingName = computed(() => {
  const name = user.value?.name?.trim()
  if (!name) return '老师'
  return name.endsWith('老师') ? name : `${name}老师`
})

/** 空态问候语的打字效果（模仿 SSE 流式输出：逐字出现，输出完收起光标）。 */
const typedGreeting = ref('')
const greetingTyping = ref(false)
let greetingTimer: ReturnType<typeof setInterval> | null = null

function stopGreetingTyping() {
  if (greetingTimer) {
    clearInterval(greetingTimer)
    greetingTimer = null
  }
  greetingTyping.value = false
}

function playGreetingTyping() {
  stopGreetingTyping()
  const full = `${greetingName.value}，今天遇到了什么？`
  // 用户系统设置了「减少动态效果」时直接整段显示，不做逐字动画
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    typedGreeting.value = full
    return
  }
  typedGreeting.value = ''
  greetingTyping.value = true
  let index = 0
  greetingTimer = setInterval(() => {
    index += 1
    typedGreeting.value = full.slice(0, index)
    if (index >= full.length) stopGreetingTyping()
  }, 70)
}
/** 手机/平板端会话抽屉开关（≥lg 时左侧栏常驻，不使用此状态）。 */
const sidebarOpen = ref(false)
/** 是否处于「左侧栏常驻」的宽屏（与 Tailwind 的 lg 断点一致）。 */
const isDesktopSidebar = ref(false)
let sidebarMedia: MediaQueryList | null = null
function syncDesktopSidebar(event?: MediaQueryListEvent) {
  isDesktopSidebar.value = event ? event.matches : Boolean(sidebarMedia?.matches)
}
/** 当前会话标题；无会话时显示「新对话」。 */
const activeSessionTitle = computed(() => {
  const current = (sessions.value || []).find((item: { id: string, title?: string }) => item.id === sessionId.value)
  return current?.title?.trim() || '新对话'
})

function startNewConversation() {
  sidebarOpen.value = false
  newConversation()
}

function selectSession(id: string) {
  sidebarOpen.value = false
  void loadSession(id)
}

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

async function scrollToLatest(behavior: ScrollBehavior = 'smooth') {
  await nextTick()
  messageViewport.value?.scrollTo({ top: messageViewport.value.scrollHeight, behavior })
}

/** 消息区滚动 → 顶栏自动收起/滑出（小屏生效）。 */
function onMessageViewportScroll(event: Event) {
  const el = event.target as HTMLElement
  reportHeaderScroll(el.scrollTop, el.scrollHeight - el.clientHeight)
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
  selectedOptions.value = {}
  selectedContextKey.value = 'none'
  mentionOpen.value = false
  mentionQuery.value = ''
  playGreetingTyping()
  nextTick(() => scrollToLatest('auto'))
}

// 会话内允许随时 @ 切换咨询对象：切换后保留当前对话，后续消息由后端更新会话绑定（跟随最新对象）

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
    timeline.value = result.messages.map((item: any) => {
      const base: TimelineItem = {
        messageId: item.id,
        role: item.role,
        text: item.text,
        mode: item.metadata?.mode,
        sources: item.metadata?.sources || [],
        planUpdateSuggestions: item.metadata?.planUpdateSuggestions || [],
        // 历史消息都是已完成的回答：工具/引用/量表块可以直接展示
        answerCompleted: item.role === 'assistant'
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
      // 恢复 Agent 回答的动作卡与工具/引用过程（含旧消息兼容：无 toolCalls/sources 字段时置空数组）
      if (item.metadata?.type === 'agent_answer') {
        base.actionCards = item.metadata?.actionCards || []
        base.toolCalls = Array.isArray(item.metadata?.toolCalls) ? item.metadata.toolCalls : []
        base.sources = Array.isArray(item.metadata?.sources) ? item.metadata.sources : []
        if (item.metadata?.moduleProportions) updateScores(item.metadata.moduleProportions)
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
  pendingLabel.value = 'Agent 正在分析问题…'
  route.value = null
  fuse.value = null
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
          // Agent 模式：保持 pending 状态条（文案随 thinking 变化），气泡先建立供工具/引用/卡片挂载
          timeline.value.push({ role: 'assistant', text: '', mode: data.mode, sources: [] })
          assistantIndex = timeline.value.length - 1
          if (data.mode === 'agent') {
            pending.value = true
            pendingLabel.value = 'Agent 正在分析问题…'
          } else {
            pending.value = false
          }
          await scrollToLatest()
        }
        if (event === 'answer_delta') {
          // 文字开始流入：撤下状态条（只在首次 delta 生效）
          if (assistantIndex >= 0 && timeline.value[assistantIndex]?.text === '') pending.value = false
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
          if (assistantIndex >= 0) {
            timeline.value[assistantIndex]!.messageId = data.messageId
            timeline.value[assistantIndex]!.text = data.text
            timeline.value[assistantIndex]!.mode = data.mode
            timeline.value[assistantIndex]!.answerCompleted = true
          } else {
            timeline.value.push({ messageId: data.messageId, role: 'assistant', text: data.text, mode: data.mode, sources: [], answerCompleted: true })
            assistantIndex = timeline.value.length - 1
          }
          await scrollToLatest()
        }
        if (event === 'module_proportions') {
          // Agent 回答先行模式：模块分诊路由结果回传，驱动「模块评估占比」面板
          updateScores(data.moduleProportions)
        }
        if (event === 'thinking') {
          // Agent 思考中：复用现有 pending 状态条，仅更新文案（不新增气泡）
          const phase = data && typeof data === 'object' ? (data as any)?.phase : undefined
          pendingLabel.value = phase === 'tool' ? '正在调用工具…' : 'Agent 正在分析问题…'
        }
        if (event === 'tool_call') {
          // 记入当前 assistant 气泡的工具调用过程（结构化：name/title/args）
          if (assistantIndex >= 0 && timeline.value[assistantIndex]) {
            const payload = data && typeof data === 'object' ? (data as any) : undefined
            const toolName = typeof payload?.name === 'string' ? payload.name
              : typeof payload?.tool === 'string' ? payload.tool
                : typeof payload?.toolName === 'string' ? payload.toolName
                  : typeof payload?.input?.tool === 'string' ? payload.input.tool : ''
            const item = timeline.value[assistantIndex]!
            if (!item.toolCalls) item.toolCalls = []
            if (typeof payload?.title === 'string') {
              item.toolCalls.push({
                name: toolName || 'tool',
                title: payload.title,
                args: typeof payload?.args === 'string' ? payload.args.slice(0, 80) : undefined
              })
            } else {
              item.toolCalls.push(`[工具] ${toolName || '工具'}`)
            }
            await scrollToLatest('auto')
          }
        }
        if (event === 'sources') {
          // 知识库引用来源标签：合并到当前 assistant 气泡（按 chunkId 去重）
          if (assistantIndex >= 0 && timeline.value[assistantIndex]) {
            const items = Array.isArray((data as any)?.items) ? (data as any).items : []
            const item = timeline.value[assistantIndex]!
            const existing = Array.isArray(item.sources) ? item.sources : (item.sources = [])
            for (const src of items as any[]) {
              if (src?.chunkId && !existing.some(s => s.chunkId === src.chunkId)) {
                existing.push({
                  chunkId: src.chunkId,
                  documentTitle: src.documentTitle || '知识库片段',
                  heading: src.heading || null,
                  excerpt: src.excerpt,
                  module: src.module || undefined,
                  libraryType: src.libraryType || undefined
                })
              }
            }
            await scrollToLatest('auto')
          }
        }
        if (event === 'action_card') {
          // 兼容两种载荷：原始 ActionCard 或 { card: ActionCard } 包装
          const wrapped = data && typeof data === 'object' && (data as any)?.card && typeof (data as any).card === 'object' ? (data as any).card : data
          const card = wrapped && typeof wrapped === 'object' && typeof wrapped?.kind === 'string' ? wrapped as AgentActionCard : undefined
          if (card) {
            if (assistantIndex < 0) {
              pending.value = false
              timeline.value.push({ role: 'assistant', text: '', sources: [], actionCards: [] })
              assistantIndex = timeline.value.length - 1
            }
            const item = timeline.value[assistantIndex]!
            if (!item.actionCards) item.actionCards = []
            item.actionCards.push(card)
            await scrollToLatest()
          }
        }
        if (event === 'fuse') fuse.value = data
        if (event === 'error') throw new Error(data.message)
      }
    }
    await refreshSessions()
  } catch (error: any) {
    timeline.value.push({ role: 'assistant', text: error?.message || '处理失败，请稍后重试。' })
  } finally {
    pending.value = false
    await scrollToLatest()
  }
}

// ---- 输入框 @ 关联咨询对象 ----
const mentionOpen = ref(false)
const mentionQuery = ref('')
/** @ 触发匹配：返回输入文本中最后一个以 @ 开头的词的起点与检索词 */
function mentionAt(value: string): { index: number; query: string } | null {
  const lastAt = value.lastIndexOf('@')
  if (lastAt < 0) return null
  const after = value.slice(lastAt + 1)
  // @ 之后出现空格视为普通符号，不触发关联
  if (after.includes(' ')) return null
  return { index: lastAt, query: after }
}
function handleMentionInput(event: Event) {
  const value = (event.target as HTMLTextAreaElement).value
  const at = mentionAt(value)
  if (at) {
    mentionOpen.value = true
    mentionQuery.value = at.query
  } else {
    mentionOpen.value = false
  }
}
function applyMention(type: string, id: string) {
  const at = mentionAt(input.value)
  if (at) {
    input.value = input.value.slice(0, at.index) + input.value.slice(at.index + 1 + at.query.length)
  }
  const key = `${type}:${id}`
  mentionOpen.value = false
  mentionQuery.value = ''
  // 在已有会话中切换到另一个咨询对象：自动新建会话并绑定新对象，避免上下文混搭
  if (key !== selectedContextKey.value && sessionId.value) {
    sessionId.value = undefined
    timeline.value = []
    route.value = null
    fuse.value = null
    selectedOptions.value = {}
    nextTick(() => scrollToLatest('auto'))
  }
  selectedContextKey.value = key
}
function closeMention() {
  mentionOpen.value = false
  mentionQuery.value = ''
}
const mentionOptions = computed(() => {
  const q = mentionQuery.value.trim().toLowerCase()
  const all = allContextOptions.value
  if (!q) return all
  return all.filter((item: any) =>
    (item.label || '').toLowerCase().includes(q) ||
    (item.className || '').toLowerCase().includes(q) ||
    (item.description || '').toLowerCase().includes(q)
  )
})
const mentionTypeLabel = (type: string) => type === 'student' ? '学生' : type === 'class' ? '班级' : '家长'

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

/** 历史分诊卡跳转：只做导航，不再写入处理方向确认记录 */
async function goToModule(module: ModuleId) {
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

/** Agent 动作卡正文（recommend_assessment 用 reason，info 用 content） */
function cardBodyText(card: AgentActionCard): string {
  if (card.kind === 'recommend_assessment') return card.reason || ''
  return card.content || ''
}

/** 量表推荐卡 CTA：跳转对应模块评估页（与 suggestedActions/route 确认跳转同模式） */
function openAgentActionCard(card: AgentActionCard) {
  if (card.kind !== 'recommend_assessment' || !card.module) return
  void navigateTo({
    path: `/module/${card.module}`,
    query: {
      ...(card.assessmentCode ? { instrumentCode: card.assessmentCode } : {}),
      ...(selectedContext.value
        ? { contextType: selectedContext.value.type, contextId: selectedContext.value.id, sourceChatSessionId: sessionId.value }
        : { sourceChatSessionId: sessionId.value }),
      ...(lastUserMessage.value ? { q: lastUserMessage.value.slice(0, 500) } : {})
    }
  })
}

/** 是否已尝试过自动恢复最近会话（防止与 watch 兜底重复触发） */
const autoRestored = ref(false)

async function autoRestoreLatestSession() {
  if (autoRestored.value) return
  autoRestored.value = true
  const latest = sessions.value?.[0]
  if (!latest?.id) return
  try {
    await loadSession(latest.id)
  } catch {
    // 会话不可恢复（如已被归档）时保持欢迎页，不影响其他初始化
  }
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
    autoRestored.value = true
    await loadSession(deepLinkSessionId)
  } else if (type && id) {
    autoRestored.value = true
    selectedContextKey.value = `${type}:${id}`
  } else if (prefill?.contextKey) {
    autoRestored.value = true
    selectedContextKey.value = prefill.contextKey
  } else {
    // 无深链/上下文/预填时自动恢复最近一次对话：刷新或隔一段时间回来仍能看到历史记录
    await autoRestoreLatestSession()
    if (!timeline.value.length) loadContextPreview()
  }
  if (prefill?.prompt) input.value = prefill.prompt
  if (!timeline.value.length) playGreetingTyping()
  // 左侧栏在 ≥lg 常驻，小屏收起时用 inert 把它移出键盘 Tab 顺序
  sidebarMedia = window.matchMedia('(min-width: 1024px)')
  syncDesktopSidebar()
  sidebarMedia.addEventListener('change', syncDesktopSidebar)
  phoneMedia = window.matchMedia('(max-width: 639px)')
  syncPhoneLayout()
  phoneMedia.addEventListener('change', syncPhoneLayout)
  bottomNavMedia = window.matchMedia('(max-width: 767px)')
  syncBottomNavLayout()
  bottomNavMedia.addEventListener('change', syncBottomNavLayout)
})

// 教师姓名晚于首屏到达时重新播放一次，避免标题停留在默认称呼
watch(greetingName, () => {
  if (!timeline.value.length) playGreetingTyping()
})

onBeforeUnmount(() => {
  stopGreetingTyping()
  sidebarMedia?.removeEventListener('change', syncDesktopSidebar)
  phoneMedia?.removeEventListener('change', syncPhoneLayout)
  bottomNavMedia?.removeEventListener('change', syncBottomNavLayout)
})

// 客户端 useFetch 可能晚于 onMounted 完成，列表就绪后再兜底恢复一次
watch(sessions, autoRestoreLatestSession, { once: true })
</script>

<template>
  <div class="mx-auto max-w-7xl px-0.5 pb-0 pt-0.5 sm:px-6 sm:pb-6 sm:pt-6 lg:px-8">
    <section id="chat-section" class="grid items-stretch gap-5 sm:gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div v-if="sidebarOpen" class="fixed inset-0 z-[55] bg-slate-900/30 backdrop-blur-sm lg:hidden" @click="sidebarOpen = false" />
      <aside
        class="panel fixed inset-y-2 left-2 z-[60] flex w-72 max-w-[85vw] flex-col overflow-hidden shadow-2xl transition-transform duration-200 lg:static lg:inset-auto lg:h-[calc(100dvh-7.5rem)] lg:w-auto lg:max-w-none lg:shadow-none"
        :class="sidebarOpen ? 'translate-x-0' : '-translate-x-[120%] lg:translate-x-0'"
        :inert="!sidebarOpen && !isDesktopSidebar"
      >
        <div class="border-b border-slate-100 p-3">
          <button type="button" class="w-full flex items-center justify-center gap-1.5 rounded-lg bg-[var(--ui-primary)] px-3 py-2 text-sm font-medium text-white" @click="startNewConversation"><UIcon name="i-lucide-message-square-plus" class="size-4" />新对话</button>
        </div>
        <div class="border-b border-slate-100 px-3 py-3">
          <NuxtLink
            to="/plans"
            class="group flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 transition hover:border-emerald-200 hover:bg-emerald-50"
          >
            <span class="flex items-center gap-1.5 text-sm font-medium text-emerald-900">
              <UIcon name="i-lucide-list-checks" class="size-4 text-emerald-600" />
              进行中的方案
            </span>
            <span class="flex items-center gap-1.5">
              <span class="min-w-5 rounded-full bg-emerald-600 px-1.5 py-0.5 text-center text-[11px] font-semibold text-white">{{ pendingPlanTotal }}</span>
              <UIcon name="i-lucide-arrow-right" class="size-4 text-emerald-600 transition group-hover:translate-x-0.5" />
            </span>
          </NuxtLink>
        </div>
        <div class="flex items-center justify-between px-4 pb-2 pt-4">
          <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">最近对话</p>
          <span class="text-xs text-slate-400">{{ sessions?.length || 0 }}</span>
        </div>
        <div class="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          <div v-for="item in sessions" :key="item.id" class="group relative rounded-xl text-left text-sm transition" :class="sessionId===item.id?'bg-emerald-50 text-emerald-950 ring-1 ring-inset ring-emerald-100':'text-slate-600 hover:bg-slate-50'">
            <button class="w-full px-3 py-2 text-left" @click="selectSession(item.id)">
              <span class="flex items-start gap-2"><UIcon name="i-lucide-message-circle" class="mt-0.5 size-4 shrink-0" :class="sessionId===item.id?'text-emerald-600':'text-slate-300 group-hover:text-slate-500'" /><span class="line-clamp-2 block leading-5">{{ item.title }}</span></span>
              <span class="mt-1 block pl-6 text-[11px] text-slate-400">{{ formatDateTime(item.updatedAt) }}</span>
            </button>
            <button class="absolute right-1.5 top-2 grid size-6 place-items-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-500" :class="deleteCandidate===item.id?'bg-red-50 text-red-600':'opacity-0 group-hover:opacity-100'" :title="deleteCandidate===item.id?'再次点击确认删除':'删除对话'" @click.stop="deleteSession(item.id)">
              <UIcon name="i-lucide-x" class="size-3.5" />
            </button>
          </div>
          <div v-if="!sessions?.length" class="grid place-items-center px-3 py-16 text-center"><UIcon name="i-lucide-messages-square" class="size-7 text-slate-300" /><p class="mt-2 text-xs text-slate-400">暂无历史对话</p></div>
        </div>
      </aside>

      <div
        class="panel relative flex h-[calc(100dvh-env(safe-area-inset-bottom)-4px)] min-w-0 flex-col overflow-hidden transition-[height] duration-200 sm:h-[calc(100dvh-3rem)] lg:h-[calc(100dvh-7.5rem)]"
        :style="panelHeightStyle"
      >
        <div class="flex items-center gap-2 border-b border-slate-100 bg-white/95 px-3 py-1.5 lg:hidden">
          <UButton icon="i-lucide-panel-left" color="neutral" variant="ghost" size="sm" aria-label="打开对话列表" @click="sidebarOpen = true" />
          <p class="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{{ activeSessionTitle }}</p>
          <UButton icon="i-lucide-message-square-plus" color="primary" variant="soft" size="sm" aria-label="新对话" @click="newConversation" />
        </div>
        <div class="flex items-center justify-between gap-3 border-b border-slate-100 bg-white/90 px-3 py-1.5 transition-opacity duration-200 sm:px-6 sm:py-3" :class="panelHeaderFaded ? 'opacity-0' : ''" :aria-hidden="panelHeaderFaded">
          <div class="flex min-w-0 items-center gap-3">
            <div class="grid size-7 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700 sm:size-9 sm:rounded-xl"><UIcon name="i-lucide-sparkles" class="size-4.5" /></div>
            <div class="min-w-0"><div class="flex items-center gap-2"><strong class="text-sm">AI 助手</strong><span class="size-1.5 rounded-full bg-emerald-500" /></div></div>
          </div>
          <div class="flex min-w-0 flex-1 items-center justify-end gap-2">
            <div v-if="selectedContext" class="flex min-w-0 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 sm:py-1.5"><UIcon :name="selectedContext.type === 'student' ? 'i-lucide-user-round' : selectedContext.type === 'class' ? 'i-lucide-users' : 'i-lucide-user-round-check'" class="size-3.5 shrink-0" /><span class="truncate">{{ mentionTypeLabel(selectedContext.type) }} · {{ selectedContext.label }}</span></div>
            <span v-else class="min-w-0 truncate text-xs text-slate-500 sm:text-sm"><span class="sm:hidden"><span class="font-semibold text-emerald-700">@</span> 可关联学生、班级、家长</span><span class="hidden sm:inline">未指定对象 · 输入框输入 <span class="font-semibold text-emerald-700">@</span> 可关联学生、班级、家长</span></span>
          </div>
        </div>
        <div v-if="selectedContext" class="border-b border-emerald-100 bg-emerald-50/70 px-5 py-3 text-sm sm:px-6">
          <div class="flex flex-wrap items-center justify-between gap-2"><div class="flex items-center gap-2"><UIcon name="i-lucide-link" class="text-emerald-700" /><strong>{{ selectedContext.type === 'student' ? '咨询学生' : selectedContext.type === 'class' ? '咨询班级' : '咨询家长' }}：{{ selectedContext.label }}</strong></div><div class="flex items-center gap-3"><label class="flex items-center gap-2 text-xs text-slate-600"><USwitch v-model="withoutRecord" size="sm" />不带档案咨询</label><details class="relative"><summary class="cursor-pointer list-none text-xs font-medium text-emerald-700">本次将发送的信息</summary><div class="absolute right-0 top-7 z-30 max-h-80 w-[min(32rem,85vw)] overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"><p class="text-xs leading-5 text-slate-500">数据模式：{{ contextPreview?.mode || governance?.effectiveMode }}；始终排除 {{ contextPreview?.excludedFields?.join('、') }}</p><pre class="mt-3 whitespace-pre-wrap text-xs leading-5 text-slate-600">{{ withoutRecord ? '本次不发送档案信息。' : JSON.stringify(contextPreview?.context?.snapshot || {}, null, 2) }}</pre></div></details></div></div>
        </div>
        <div v-if="governance?.needsConsent" class="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900"><span>学校申请使用完整业务上下文。确认前将自动回退到严格脱敏模式；电话、邮箱、账号和系统标识永不发送。</span><UButton size="xs" color="warning" @click="acceptPrivacyNotice">阅读并确认 {{ governance.noticeVersion }}</UButton></div>

        <div ref="messageViewport" class="hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain bg-gradient-to-b from-slate-50/70 to-white px-3 pt-4 sm:px-6 sm:pt-6" :class="[inputLifted ? 'pb-40 sm:pb-44' : 'pb-40 sm:pb-36', {'opacity-60':loadingSession}]" @scroll="onMessageViewportScroll">
          <div v-if="timeline.length" class="mx-auto max-w-3xl space-y-5 sm:space-y-7">
            <div v-for="(item, index) in timeline" :key="index" class="flex items-start gap-3" :class="item.role === 'user' ? 'flex-row-reverse' : 'max-sm:flex-col max-sm:gap-2'">
              <!-- 手机端：头像与「赋能助手」标签单独占一行，回答气泡在下方通栏，不再被头像列和 88% 宽度挤压 -->
              <div class="flex items-center gap-2 sm:block sm:shrink-0">
                <div class="grid size-8 shrink-0 place-items-center rounded-xl text-xs font-semibold" :class="item.role === 'user' ? 'bg-emerald-800 text-white' : 'border border-emerald-100 bg-white text-emerald-700 shadow-sm'">
                  <UIcon v-if="item.role === 'assistant'" name="i-lucide-sparkles" class="size-4" /><span v-else>{{ user?.name?.slice(0, 1) }}</span>
                </div>
                <div v-if="item.role === 'assistant'" class="flex items-center gap-2 text-[11px] text-slate-400 sm:hidden"><span>赋能助手</span><span v-if="item.mode === 'local_fallback'" class="text-amber-600">降级回答</span></div>
              </div>
              <div class="min-w-0" :class="item.role === 'user' ? 'max-w-[88%] sm:max-w-[82%]' : 'max-w-full sm:max-w-[82%]'">
                <div class="mb-1.5 items-center gap-2 text-[11px] text-slate-400" :class="item.role === 'user' ? 'flex justify-end' : 'hidden sm:flex'"><span>{{ item.role === 'user' ? '我' : '赋能助手' }}</span><span v-if="item.role === 'assistant' && item.mode === 'local_fallback'" class="text-amber-600">降级回答</span></div>
                <div class="group relative rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm" :class="item.role === 'user' ? 'rounded-tr-md bg-emerald-800 text-white' : 'rounded-tl-md border border-slate-100 bg-white text-slate-700'">
                  <div v-if="item.role === 'user'" class="whitespace-pre-wrap" v-text="item.text" />
                  <!-- 空气泡内部动画：answer_start 已建立气泡但文本未流入时，动画显示在气泡内，避免与底部独立状态条重复 -->
                  <div v-else-if="item.text === '' && index === timeline.length - 1 && pending" class="flex items-center gap-1.5 py-1.5">
                    <span class="size-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-.3s]" />
                    <span class="size-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-.15s]" />
                    <span class="size-1.5 animate-bounce rounded-full bg-emerald-400" />
                    <span class="ml-2 text-xs text-slate-400">{{ pendingLabel }}</span>
                  </div>
                  <div v-else class="markdown-body" v-html="useMarkdown(item.text)" />
                  <button v-if="item.role === 'assistant'" type="button" class="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-white/95 px-1.5 py-1 text-[11px] text-slate-400 opacity-0 shadow-sm transition hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100 focus:opacity-100" :aria-label="copiedMessage === index ? '已复制回答' : '复制回答'" @click="copyMessage(item.text, index)"><UIcon :name="copiedMessage === index ? 'i-lucide-check' : 'i-lucide-copy'" class="size-3" />{{ copiedMessage === index ? '已复制' : '复制' }}</button>
                </div>
                <!-- 工具调用过程（「调用过 N 个工具」）：暂时隐藏，保留代码待确认后再决定去留 -->
                <details v-if="item.role === 'assistant' && item.answerCompleted && item.toolCalls?.length" hidden class="group mt-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 text-xs text-slate-600">
                  <summary class="flex cursor-pointer list-none items-center justify-between px-3.5 py-2 font-medium text-slate-500">
                    <span class="flex items-center gap-2"><UIcon name="i-lucide-wrench" class="size-4" />调用过 {{ item.toolCalls.length }} 个工具</span>
                    <UIcon name="i-lucide-chevron-down" class="size-3.5 transition group-open:rotate-180" />
                  </summary>
                  <div class="space-y-1.5 border-t border-slate-200 px-3 py-2.5">
                    <div v-for="(call, callIndex) in item.toolCalls" :key="`tool-${callIndex}`" class="rounded-lg bg-white/80 p-2.5">
                      <p class="flex items-center gap-1.5 font-medium text-slate-700"><UIcon name="i-lucide-wrench" class="size-3 shrink-0 text-slate-400" /><span>{{ typeof call === 'string' ? call.replace(/^\[工具\]\s*/, '') : (call.title || call.name) }}</span></p>
                      <p v-if="typeof call === 'object' && call.args" class="mt-1 break-all text-[11px] leading-4 text-slate-400">{{ call.args }}</p>
                    </div>
                  </div>
                </details>
                <div v-if="item.role === 'assistant' && item.answerCompleted && item.actionCards?.length" class="mt-3 space-y-2">
                  <div v-for="(card, cardIndex) in item.actionCards" :key="`action-card-${cardIndex}`" class="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                    <p class="text-sm font-semibold text-emerald-800">{{ card.title }}</p>
                    <p class="mt-1 text-sm leading-6 text-slate-600">{{ cardBodyText(card) }}</p>
                    <div v-if="card.kind === 'recommend_assessment' && card.module" class="mt-3">
                      <UButton color="primary" size="sm" @click="openAgentActionCard(card)">{{ card.ctaLabel || '进入模块完成评估' }}</UButton>
                    </div>
                  </div>
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
                <details v-if="item.role === 'assistant' && item.answerCompleted && item.sources?.length" class="group mt-2 overflow-hidden rounded-xl border border-emerald-100 bg-emerald-50/50 text-xs text-slate-600">
                  <summary class="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 font-medium text-emerald-800"><span class="flex items-center gap-2"><UIcon name="i-lucide-book-open-check" class="size-4" />参考了 {{ item.sources.length }} 条知识内容</span><UIcon name="i-lucide-chevron-down" class="size-3.5 transition group-open:rotate-180" /></summary>
                  <div class="space-y-2 border-t border-emerald-100 px-3 py-3">
                    <div v-for="(source, sourceIndex) in item.sources" :key="source.chunkId" class="rounded-lg bg-white/80 p-3">
                      <p class="font-medium text-slate-700"><span class="mr-1 text-emerald-600">{{ sourceIndex + 1 }}.</span>{{ source.documentTitle }}<span v-if="source.heading" class="font-normal text-slate-400"> · {{ source.heading }}</span></p>
                      <p class="mt-1 text-[11px] text-emerald-700/70">{{ source.resourceTitle || '模块资源' }}<template v-if="source.module || source.libraryType"> · {{ source.module ? moduleLabel(source.module) : '通用' }} / {{ source.libraryType ? libraryTypeLabel(source.libraryType) : '资源' }}</template></p><p v-if="source.excerpt" class="mt-1.5 line-clamp-3 leading-5 text-slate-500">{{ source.excerpt }}</p>
                    </div>
                  </div>
                </details>
                <div v-if="item.role === 'assistant' && item.planUpdateSuggestions?.length" class="mt-7 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs"><p class="font-semibold text-amber-900">AI 曾建议更新方案（历史记录）</p><div v-for="(suggestion, suggestionIndex) in item.planUpdateSuggestions" :key="suggestionIndex" class="flex items-center justify-between gap-3 rounded-lg bg-white p-3"><span class="text-slate-600">{{ suggestion.actionTitle || '新增复盘' }}<template v-if="suggestion.newStatus"> → {{ actionStatusLabel(suggestion.newStatus) }}</template><span v-if="suggestion.progressNote" class="mt-1 block text-slate-400">{{ suggestion.progressNote }}</span></span><span class="text-[11px] text-slate-400">{{ suggestion.appliedAt ? '已应用' : '未应用' }}</span></div></div>
                <div v-if="item.role === 'assistant' && item.messageId" class="mt-3 flex items-center gap-2 text-xs text-slate-400"><span>这条回答有帮助吗？</span><UButton size="xs" color="neutral" :variant="item.feedback==='helpful'?'soft':'ghost'" icon="i-lucide-thumbs-up" @click="submitFeedback(item, 'helpful')">有帮助</UButton><UButton size="xs" color="neutral" :variant="item.feedback==='not_helpful'?'soft':'ghost'" icon="i-lucide-thumbs-down" @click="submitFeedback(item, 'not_helpful')">没帮助</UButton></div>
              </div>
            </div>

            <div v-if="pending && !pendingAssistantBubble" class="flex items-start gap-3 max-sm:flex-col max-sm:gap-2">
              <div class="flex items-center gap-2 sm:block sm:shrink-0">
                <div class="grid size-8 shrink-0 place-items-center rounded-xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><UIcon name="i-lucide-sparkles" class="size-4" /></div>
                <span class="text-[11px] text-slate-400 sm:hidden">赋能助手</span>
              </div>
              <div class="min-w-0 max-w-full sm:max-w-[82%]">
                <p class="mb-1.5 hidden text-[11px] text-slate-400 sm:block">赋能助手</p>
                <div class="flex w-fit items-center gap-1.5 rounded-2xl rounded-tl-md border border-slate-100 bg-white px-4 py-4 shadow-sm"><span class="size-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-.3s]" /><span class="size-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-.15s]" /><span class="size-1.5 animate-bounce rounded-full bg-emerald-400" /><span class="ml-2 text-xs text-slate-400">{{ pendingLabel }}</span></div></div></div>

            <div v-if="fuse" class="flex items-start gap-3 max-sm:flex-col max-sm:gap-2">
              <div class="flex items-center gap-2 sm:block sm:shrink-0">
                <div class="grid size-8 shrink-0 place-items-center rounded-xl border border-red-200 bg-red-50 text-red-600 shadow-sm"><UIcon name="i-lucide-siren" class="size-4" /></div>
                <span class="text-[11px] text-slate-400 sm:hidden">赋能助手</span>
              </div>
              <div class="min-w-0 max-w-full sm:max-w-[82%]">
                <p class="mb-1.5 hidden text-[11px] text-slate-400 sm:block">赋能助手</p>
                <div class="rounded-2xl rounded-tl-md border-2 border-red-200 bg-red-50 p-5"><div class="flex gap-3"><UIcon name="i-lucide-siren" class="mt-1 size-6 shrink-0 text-red-600" /><div><h3 class="font-semibold text-red-900">常规建议已暂停</h3><p class="mt-2 text-sm text-red-800">{{ fuse.message }}</p><p class="mt-3 rounded-xl bg-white/70 p-3 text-sm text-red-900">{{ fuse.guide }}</p></div></div></div></div></div>
            <div v-if="route && !fuse" class="flex items-start gap-3 max-sm:flex-col max-sm:gap-2">
              <div class="flex items-center gap-2 sm:block sm:shrink-0">
                <div class="grid size-8 shrink-0 place-items-center rounded-xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><UIcon name="i-lucide-sparkles" class="size-4" /></div>
                <span class="text-[11px] text-slate-400 sm:hidden">赋能助手</span>
              </div>
              <div class="min-w-0 max-w-full sm:max-w-[82%]">
                <p class="mb-1.5 hidden text-[11px] text-slate-400 sm:block">赋能助手</p>
                <div class="rounded-2xl rounded-tl-md border border-emerald-100 bg-emerald-50/70 p-5"><div class="flex items-center gap-2 text-xs font-semibold text-emerald-700"><UIcon name="i-lucide-route" class="size-4" />历史分诊方向</div><p class="mt-2 text-sm leading-6 text-slate-600">{{ route.rationale }}</p><div class="mt-4 flex flex-wrap items-center gap-2"><UButton color="primary" @click="goToModule(route.primaryModule)">{{ moduleMeta[route.primaryModule].title }} · {{ Math.round(route.confidence * 100) }}%</UButton><UButton v-for="item in route.secondaryModules" :key="item.module" color="neutral" variant="soft" @click="goToModule(item.module)">{{ moduleMeta[item.module].title }} · {{ Math.round(item.confidence * 100) }}%</UButton></div><p class="mt-3 text-xs text-slate-500">历史分诊记录，仅作回看；当前版本由 AI 助手直接给出分析与建议。</p></div></div></div>
          </div>

          <div v-else class="mx-auto flex h-full max-w-2xl flex-col items-center justify-center py-8 text-center">
            <div class="grid size-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><UIcon name="i-lucide-sparkles" class="size-6" /></div><h2 class="mt-4 text-xl font-semibold sm:text-2xl" :aria-label="`${greetingName}，今天遇到了什么？`"><span>{{ typedGreeting }}</span><span v-if="greetingTyping" class="ml-0.5 inline-block h-5 w-[2px] animate-pulse rounded-full bg-emerald-500 align-[-3px] sm:h-6" aria-hidden="true" /></h2>
          </div>
        </div>

        <form class="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pt-4 transition-[padding] duration-200 sm:px-6 lg:pb-6" :class="inputLifted ? 'pb-[4.5rem]' : 'pb-5'" @submit.prevent="ask">
          <div class="pointer-events-auto relative">
            <div v-if="mentionOpen" class="fixed inset-0 z-20" @click="closeMention" />
            <div v-if="mentionOpen" class="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
              <div class="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs text-slate-400">
                <UIcon name="i-lucide-search" class="size-3.5" />
                <span v-if="mentionQuery" class="truncate">检索“{{ mentionQuery }}”</span>
                <span v-else>输入关键词检索 · 选择对象后自动关联</span>
              </div>
              <div class="max-h-60 overflow-y-auto p-1.5">
                <button v-if="!mentionOptions.length" type="button" class="w-full px-3 py-3 text-center text-xs text-slate-400" @click="closeMention">无可供关联的对象</button>
                <button v-for="item in mentionOptions" :key="`${item.type}:${item.id}`" type="button" class="flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-emerald-50" @mousedown.prevent="applyMention(item.type, item.id)">
                  <span class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700"><UIcon :name="item.type === 'student' ? 'i-lucide-user-round' : item.type === 'class' ? 'i-lucide-users' : 'i-lucide-user-round-check'" class="size-3.5" /></span>
                  <span class="min-w-0">
                    <span class="block truncate text-sm text-slate-700">{{ item.label }}</span>
                    <span class="block truncate text-xs text-slate-400">{{ mentionTypeLabel(item.type) }} · {{ item.description }}</span>
                  </span>
                </button>
              </div>
            </div>
            <div class="rounded-2xl border border-slate-300 bg-white/30 p-1.5 shadow-lg shadow-slate-900/5 backdrop-blur-xl [-webkit-backdrop-filter:blur(24px)] transition focus-within:border-emerald-400 focus-within:ring-3 focus-within:ring-emerald-100 sm:p-2">
              <div class="flex items-center gap-2">
                <UTextarea v-model="input" :rows="2" :maxrows="8" :maxlength="4000" autoresize class="min-w-0 flex-1" variant="none" aria-label="向 AI 赋能助手提问" @input="handleMentionInput" @keydown.enter.exact.prevent="ask" @keydown.esc="closeMention" />
                <UButton type="submit" icon="i-lucide-arrow-up" size="lg" square :loading="pending" :disabled="!input.trim()" aria-label="发送消息" />
              </div>
              <div class="mt-1 hidden items-center justify-between gap-2 px-1 text-[11px] sm:flex"><span class="text-slate-500">AI 辅助建议，需人工专业判断 · 输入 @ 关联对象</span><span class="shrink-0 text-slate-500">Enter 发送 · Shift + Enter 换行 {{ input.length }}/4000</span></div>
            </div>
          </div>
        </form>
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

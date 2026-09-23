<script setup lang="ts">
import { assistantNavigationSchema, assistantFeedbackReasons, type AssistantFeedbackReason } from '#shared/assistant'
import { moduleMeta } from '#shared/assessments'
import type { ModuleId, RouteDecision } from '#shared/contracts'
import { useModuleScores } from '~/composables/useModuleScores'
import { useSpeechPlayback } from '~/composables/useSpeechPlayback'
import {
  blobToBase64,
  blobToWav16k,
  createAudioContext,
  createLevelMeter,
  MAX_RECORDING_MS,
  MAX_RECORDING_SECONDS,
  type LevelMeter
} from '~/utils/audio'

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
  kind: 'recommend_assessment' | 'info' | 'navigate'
  to?: string
  module?: ModuleId
  assessmentCode?: string
  title: string
  reason?: string
  content?: string
  ctaLabel?: string
}

interface TimelineItem {
  messageId?: string
  role: 'user' | 'assistant' | 'system'
  text: string
  sources?: SourceItem[]
  mode?: 'deepseek' | 'local_fallback' | 'agent'
  planUpdateSuggestions?: Array<any>
  feedback?: 'helpful' | 'not_helpful'
  feedbackOpen?: boolean
  feedbackReasons?: AssistantFeedbackReason[]
  feedbackComment?: string
  clarification?: ClarificationRoundData
  summary?: ClarificationSummaryData
  /** Agent 进程标记（工具调用记录：纯文本或结构化 {name,title,args}） */
  toolCalls?: Array<string | { name: string; title?: string; args?: string }>
  /** Agent 输出的动作卡（P0：量表推荐卡） */
  actionCards?: AgentActionCard[]
  /** 回答是否已完成（answer 事件到达）：完成前不展示工具/引用/量表过程块，避免抢在流式答案前出现 */
  answerCompleted?: boolean
  /** 教师中途停止生成：保留已流入的部分文本并显示「已停止」标记 */
  stopped?: boolean
  /** 会话内换绑咨询对象的分隔条（role=system）：标记这条之后谈的是另一个对象 */
  contextSwitch?: { type: string, label: string }
}

/** 空态「今日建议」条目（服务端确定性生成，不经过模型）。 */
interface AssistantBriefItem {
  kind: 'plan_review_due' | 'action_overdue' | 'draft_assessment' | 'notifications' | 'risk_communication'
  title: string
  detail: string
  prompt: string
  targetPath?: string
}

interface AssistantBrief {
  items: AssistantBriefItem[]
  generatedAt: string
}

/** 工具过程面板的展示项：同名工具合并计数（模型常对多个模块重复调用同一工具）。 */
interface ToolCallDisplay {
  key: string
  title: string
  count: number
}

/** 回答后的追问建议：确定性生成，只做「填入并发送」。 */
interface FollowUpChip {
  label: string
  prompt: string
}

const { user } = useAuth()
const { updateScores } = useModuleScores()
const { data: sessions, refresh: refreshSessions } = await useFetch<any[]>('/api/v1/chat/sessions')
/**
 * 今日建议卡开关：暂时隐藏（2026-09-14 按产品反馈下线展示）。
 * 服务端接口（GET /api/v1/chat/assistant-brief）与数据结构保留；改回 true 即恢复展示与请求。
 */
const SHOW_ASSISTANT_BRIEF = false
// 空态「今日建议」：服务端按教师自己的数据确定性生成，不调用模型（local 数据模式同样可用）
const { data: briefData } = await useFetch<AssistantBrief>('/api/v1/chat/assistant-brief', {
  immediate: SHOW_ASSISTANT_BRIEF
})
const briefItems = computed<AssistantBriefItem[]>(() => (briefData.value?.items || []).slice(0, 3))
/** 生成中请求的中断控制器：停止生成按钮据此中断本轮 SSE */
const abortController = ref<AbortController | null>(null)
// 侧栏「进行中的方案」：沿用方案列表接口，status=active 即待确认/进行中/待复盘/需调整/需协同，
// 只取总数展示，点击计数箭头进入完整方案列表。
const { data: pendingPlanResult } = await useFetch<{ total: number }>('/api/v1/plans', {
  query: { status: 'active', pageSize: 1, sort: 'nextReviewAt', order: 'asc' }
})
const pendingPlanTotal = computed(() => pendingPlanResult.value?.total || 0)
/**
 * 语音能力（录音识别 / 回答朗读）：服务端按配置返回 speech.asr 与 speech.tts，
 * 未配置时两者都是 false，前端据此不渲染麦克风与朗读按钮（不留不可用的死按钮）。
 */
const { data: speechCapability } = await useFetch<{ speech?: { asr?: boolean, tts?: boolean } }>('/api/v1/chat/status')
const asrEnabled = computed(() => Boolean(speechCapability.value?.speech?.asr))
const ttsEnabled = computed(() => Boolean(speechCapability.value?.speech?.tts))
const { data: governance, refresh: refreshGovernance } = await useFetch<any>('/api/v1/chat/data-governance')
const { data: contextOptions } = await useFetch<any>('/api/v1/chat/context-options')
const input = ref('')
const pending = ref(false)
/** 有个别句子被扣住（等整轮校验）：静默超过短暂时间后在状态条里提示，别让文字停住看起来像卡死 */
const reviewPending = ref(false)
/** 扣住提示的防抖定时器：扣住后很快又有文字流出时不显示提示，避免状态条一闪一闪 */
let reviewHintTimer: ReturnType<typeof setTimeout> | undefined
function clearReviewHint() {
  if (!reviewHintTimer) return
  clearTimeout(reviewHintTimer)
  reviewHintTimer = undefined
}
const loadingSession = ref(false)
const sessionId = ref<string>()
const route = ref<(RouteDecision & { id: string }) | null>(null)
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
/**
 * 本轮对象：会话未绑定对象时，服务端从本轮消息里识别出的学生/班级（未改变会话绑定）。
 * 用于消除「教师直接写学生姓名，助手却不查档案」的割裂；教师认可后可一键固定为会话对象。
 */
const turnObject = ref<{ type: string, id: string, label: string } | null>(null)
const turnObjectCandidates = ref<Array<{ type: string, id: string, label: string }>>([])
/** 会话已绑定对象、本轮又提到另一个唯一对象：只提示是否切换，不自动切换 */
const suggestedContext = ref<{ type: string, id: string, label: string } | null>(null)
const bindingTurnObject = ref(false)

/** 把本轮对象固定为会话绑定对象（后续轮次的记忆、方案与评估都按它收口）。 */
async function bindTurnObject(object: { type: string, id: string, label: string }, options: { switched?: boolean } = {}) {
  if (!sessionId.value || bindingTurnObject.value) return
  bindingTurnObject.value = true
  try {
    await $fetch(`/api/v1/chat/sessions/${sessionId.value}/context`, {
      method: 'POST',
      body: { contextType: object.type, contextId: object.id }
    })
    selectedContextKey.value = `${object.type}:${object.id}`
    turnObject.value = null
    turnObjectCandidates.value = []
    suggestedContext.value = null
    toast.add({
      title: options.switched
        ? `已切换到${mentionTypeLabel(object.type)}「${object.label}」`
        : `已固定为${mentionTypeLabel(object.type)}「${object.label}」`,
      description: '之后的提问都会读取该对象的记录；本轮回答如需按它重来，可点回答下方的「重新生成」。',
      color: 'success'
    })
  } catch {
    toast.add({ title: '固定失败，请稍后重试', color: 'error' })
  } finally {
    bindingTurnObject.value = false
  }
}
const deleteCandidate = ref<string>()
const toast = useToast()
const { moduleLabel, libraryTypeLabel, actionStatusLabel } = useDisplayLabels()

// ---- 语音输入与朗读：录音 → 16kHz WAV → 识别 → 自动发送；回答定稿后按「语音对话」喇叭开关自动朗读 ----
const { speakingId, loadingId: speechLoadingId, toggle: toggleSpeech, play: playSpeech, stop: stopSpeech } = useSpeechPlayback()
/**
 * 「语音对话」总开关（页头「AI 助手」标题后的喇叭图标，亮=开）：打开后每轮回答生成完自动朗读。
 * 只存在于页面状态里：不落库、不写 localStorage，每次进入页面都从关闭开始，避免教师换个设备突然出声。
 * 录音识别结果不受这个开关影响：说完即发送，见 finishRecording。
 */
const voiceMode = ref(false)
/** 学校数据模式为 local 时两个语音接口都逐请求返回 403，开关置灰并说明原因 */
const voiceModeBlocked = computed(() => governance.value?.effectiveMode === 'local')
/** 切换开关：关闭时立刻停掉正在播放的朗读 */
function toggleVoiceMode(value: boolean) {
  voiceMode.value = value
  if (!value) stopSpeech()
}
/**
 * 手机端输入方式：true=按住说话（默认），false=键盘打字。桌面端不使用（输入框恒显示）。
 * 只在 ASR 可用时渲染「按住说话」；切到键盘打字后仍可从输入框旁的麦克风按钮切回来。
 */
const mobileVoiceInput = ref(true)
/** 输入区上方的语音提示（麦克风权限、识别失败等），不用 alert */
const speechError = ref('')
const recording = ref(false)
/** 已录制秒数（仅用于界面提示，上限 MAX_RECORDING_SECONDS） */
const recordingSeconds = ref(0)
/** 录音瞬时音量（0~1），驱动音量条 */
const recordingLevel = ref(0)
/** 录音已停止、正在转写与请求识别 */
const transcribing = ref(false)
/** 输入框容器：识别完成后把焦点还给输入框 */
const composerRef = ref<HTMLElement | null>(null)
let mediaStream: MediaStream | null = null
let mediaRecorder: MediaRecorder | null = null
let audioContext: AudioContext | null = null
let levelMeter: LevelMeter | null = null
let recordedChunks: Blob[] = []
let levelFrame: number | null = null
let recordTicker: ReturnType<typeof setInterval> | null = null
/** 本次录音的开始时刻：秒数显示与 60s 上限都按真实耗时算，避免后台节流导致显示停滞/超录 */
let recordingStartedAt = 0
/** 录音代次：卸载/丢弃时自增，使已在途的 MediaRecorder stop 回调不再触发转写上传 */
let recordingGeneration = 0

function focusInput() {
  void nextTick(() => composerRef.value?.querySelector('textarea')?.focus())
}

/** 清掉录音计时与音量采样，但不动媒体与 AudioContext（释放由 releaseRecording 负责）。 */
function clearRecordingTimers() {
  if (recordTicker) {
    clearInterval(recordTicker)
    recordTicker = null
  }
  if (levelFrame !== null) {
    cancelAnimationFrame(levelFrame)
    levelFrame = null
  }
  recordingLevel.value = 0
}

/** 释放麦克风轨道与 AudioContext：停止录音、组件卸载、页面离开时都要调用。 */
function releaseRecording() {
  clearRecordingTimers()
  levelMeter?.close()
  levelMeter = null
  if (audioContext) {
    void audioContext.close().catch(() => undefined)
    audioContext = null
  }
  mediaStream?.getTracks().forEach(track => track.stop())
  mediaStream = null
  mediaRecorder = null
}

/** 组件卸载/页面离开：丢弃当前录音（不再上传识别），并释放麦克风与 AudioContext。 */
function discardRecording() {
  recordingGeneration += 1
  recording.value = false
  releaseRecording()
}

async function startRecording() {
  if (recording.value || transcribing.value || pending.value) return
  speechError.value = ''
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      speechError.value = '当前浏览器不支持录音，请更换浏览器。'
      return
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaStream = stream
    const context = createAudioContext()
    audioContext = context
    // 音量分析需要 AudioContext 处于 running：用户点击后 resume 通常即时生效
    await context.resume().catch(() => undefined)
    levelMeter = createLevelMeter(context, stream)
    const recorder = new MediaRecorder(stream)
    mediaRecorder = recorder
    recordedChunks = []
    const generation = ++recordingGeneration
    recorder.addEventListener('dataavailable', (event) => {
      // 代次不符说明该录音已被丢弃/被新的录音替代，避免把旧音频混进新的一段
      if (generation !== recordingGeneration) return
      if (event.data.size > 0) recordedChunks.push(event.data)
    })
    // 卸载时已丢弃的录音（代次变化）不再触发转写上传
    recorder.addEventListener('stop', () => {
      if (generation === recordingGeneration) void finishRecording()
    }, { once: true })
    recorder.start()
    recording.value = true
    recordingSeconds.value = 0
    recordingStartedAt = Date.now()
    sampleRecordingLevel()
    // 秒数显示与 60s 上限都用真实耗时判定（后台标签页定时器会被节流，按计数会漏停）
    recordTicker = setInterval(() => {
      const elapsed = Date.now() - recordingStartedAt
      recordingSeconds.value = Math.min(MAX_RECORDING_SECONDS, Math.floor(elapsed / 1000))
      if (elapsed >= MAX_RECORDING_MS) stopRecording()
    }, 250)
  } catch {
    speechError.value = '无法访问麦克风，请检查浏览器权限。'
    recording.value = false
    releaseRecording()
  }
}

/** 用分析节点的时域峰值驱动音量条（每帧一次，不做额外平滑）。 */
function sampleRecordingLevel() {
  if (!recording.value || !levelMeter) return
  recordingLevel.value = levelMeter.level()
  levelFrame = requestAnimationFrame(sampleRecordingLevel)
}

/** 手动（或到 60s 上限自动）停止录音；真正的转写由 MediaRecorder 的 stop 事件触发。 */
function stopRecording() {
  if (!recording.value) return
  recording.value = false
  clearRecordingTimers()
  try {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop()
    else releaseRecording()
  } catch {
    releaseRecording()
  }
}

function toggleRecording() {
  if (transcribing.value) return
  if (recording.value) stopRecording()
  else void startRecording()
}

/**
 * 按住说话（手机端大按钮）：按下开始录音，松开结束并自动发送。
 * `holdActive` 兜住「getUserMedia 还在等授权/初始化时教师就已松手」的情况，避免一路录下去。
 * 键盘按住（Space / Enter）走同一套逻辑；keydown 会连发，只认第一次。
 */
let holdActive = false
function startHoldRecording(event: Event) {
  if (event instanceof KeyboardEvent && event.repeat) return
  holdActive = true
  void beginHoldRecording()
}
async function beginHoldRecording() {
  await startRecording()
  if (!holdActive && recording.value) stopRecording()
}
function endHoldRecording() {
  holdActive = false
  if (recording.value) stopRecording()
}

/** 录音结束：本地转成 16kHz 单声道 WAV → base64 → 识别接口 → 识别文本追加到输入框并直接发送。 */
async function finishRecording() {
  const mimeType = mediaRecorder?.mimeType || 'audio/webm'
  const blob = new Blob(recordedChunks, { type: mimeType })
  recordedChunks = []
  releaseRecording()
  if (!blob.size) {
    speechError.value = '没有录到声音，请重试。'
    return
  }
  transcribing.value = true
  try {
    const wav = await blobToWav16k(blob)
    const audioBase64 = await blobToBase64(wav)
    const result = await $fetch<{ text?: string }>('/api/v1/chat/transcriptions', {
      method: 'POST',
      body: { audioBase64, mimeType: 'audio/wav' }
    })
    const text = (result?.text || '').trim()
    if (!text) {
      speechError.value = '没有识别到语音内容，请重试。'
      return
    }
    // 追加到已有内容之后（不覆盖教师已经打了一半的文字）
    input.value = input.value.trim() ? `${input.value.trim()} ${text}` : text
    // ask() 在转写中会直接返回，自动发送前必须先复位转写状态
    transcribing.value = false
    // 说完即发送：识别结果直接发出，不再要求教师再点一次发送。
    // 仍走 ask() 这一唯一提问入口，安全规则、会话绑定与危机识别都不变。
    // 上一轮还在生成时只回填输入框，不插队发送。
    if (!pending.value) {
      await nextTick()
      void ask()
      return
    }
    focusInput()
  } catch (error) {
    speechError.value = apiErrorMessage(error, '语音识别暂时不可用，请稍后重试。')
  } finally {
    transcribing.value = false
  }
}

/** 业务错误一律用服务端返回的中文 message；拿不到时用兜底文案，不暴露内部堆栈。 */
function apiErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const data = (error as { data?: { message?: unknown } }).data
    if (data && typeof data.message === 'string' && data.message.trim()) return data.message.trim()
  }
  return fallback
}

/** 模板入口：朗读/停止同一条回答（返回 Promise，交给点击事件即可）。 */
function toggleSpeechFor(item: TimelineItem) {
  if (item.messageId) void toggleSpeech(item.messageId)
}

/**
 * 「语音对话」自动朗读：回答定稿（answer 事件）后播放这条回答。
 * 静默失败：浏览器拦截自动播放、服务端 409「没有可朗读的内容」、local 模式 403 都不打扰教师——
 * 每轮回答都弹一次错误会盖住回答本身；教师仍可手动点「朗读」拿到具体原因。
 */
function maybeAutoRead(item: TimelineItem) {
  if (!voiceMode.value || !ttsEnabled.value || !item.messageId || item.stopped) return
  void playSpeech(item.messageId, { silent: true })
}

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
  // 换会话前停掉朗读
  stopSpeech()
  timeline.value = []
  route.value = null
  turnObject.value = null
  turnObjectCandidates.value = []
  suggestedContext.value = null
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
  // 切会话：停掉上一条会话的朗读
  stopSpeech()
  loadingSession.value = true
  try {
    const result = await $fetch<any>(`/api/v1/chat/sessions/${id}`)
    sessionId.value = id
    turnObject.value = null
    turnObjectCandidates.value = []
    suggestedContext.value = null
    suppressContextWatch.value = true
    selectedContextKey.value = result.session.contextType && result.session.contextType !== 'none' && result.session.contextId
      ? `${result.session.contextType}:${result.session.contextId}`
      : 'none'
    await nextTick()
    suppressContextWatch.value = false
    route.value = null
    const mapped: TimelineItem[] = result.messages.map((item: any) => {
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

    // 会话内的咨询对象换绑：把分隔条插到换绑后第一条消息之前（换绑后还没发消息时追加到末尾）
    const switches: any[] = Array.isArray(result.session?.metadata?.contextSwitches) ? result.session.metadata.contextSwitches : []
    const validSwitches = switches.filter((entry: any) => entry && typeof entry.at === 'string' && entry.to?.type)
    const withDividers: TimelineItem[] = []
    let switchIndex = 0
    result.messages.forEach((raw: any, index: number) => {
      const createdAt = Date.parse(raw?.createdAt)
      while (switchIndex < validSwitches.length && Date.parse(validSwitches[switchIndex].at) <= createdAt) {
        withDividers.push(contextSwitchItem(validSwitches[switchIndex].to.type, validSwitches[switchIndex].to.label))
        switchIndex += 1
      }
      withDividers.push(mapped[index]!)
    })
    while (switchIndex < validSwitches.length) {
      withDividers.push(contextSwitchItem(validSwitches[switchIndex].to.type, validSwitches[switchIndex].to.label))
      switchIndex += 1
    }
    timeline.value = withDividers

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

/** 判断异常是否来自「停止生成」（AbortController）。 */
function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError')
}

/**
 * 消费一轮回答的 SSE 流（普通提问与重新生成共用）。
 * reuseIndex：重新生成时复用已有的助手气泡；默认 -1 表示等 answer_start 新建气泡。
 * 返回最终写入的助手气泡下标（-1 表示本轮没有产生气泡）。
 */
async function readAssistantStream(response: Response, reuseIndex = -1): Promise<number> {
  let assistantIndex = reuseIndex
  const reader = response.body!.getReader()
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
          turnObject.value = data.turnObject ? { type: data.turnObject.type, id: data.turnObject.id, label: data.turnObject.label } : null
          turnObjectCandidates.value = Array.isArray(data.turnObjectCandidates)
            ? data.turnObjectCandidates.map((item: any) => ({ type: item.type, id: item.id, label: item.label }))
            : []
          suggestedContext.value = data.suggestedContext
            ? { type: data.suggestedContext.type, id: data.suggestedContext.id, label: data.suggestedContext.label }
            : null
          if (data.context) {
            suppressContextWatch.value = true
            selectedContextKey.value = `${data.context.type}:${data.context.id}`
            await nextTick()
            suppressContextWatch.value = false
          }
        }
        if (event === 'answer_start') {
          // Agent 模式：保持 pending 状态条（文案随 thinking 变化），气泡先建立供工具/引用/卡片挂载。
          // 重新生成时复用已有气泡（reuseIndex），不再新建。
          if (assistantIndex < 0) {
            timeline.value.push({ role: 'assistant', text: '', mode: data.mode, sources: [] })
            assistantIndex = timeline.value.length - 1
          }
          if (data.mode === 'agent') {
            pending.value = true
            pendingLabel.value = 'Agent 正在分析问题…'
          } else {
            pending.value = false
          }
          await scrollToLatest()
        }
        if (event === 'answer_delta') {
          // 文字继续流入：撤下「正在核对回答依据…」（被扣住的只是个别句子，其余照常流出）
          clearReviewHint()
          reviewPending.value = false
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
            const item = timeline.value[assistantIndex]!
            item.messageId = data.messageId
            // 与流式已渲染文本一致时不赋值：避免整段 Markdown 无谓重解析。
            // 不一致说明服务端做了清理或证据复核重写，此时才需要整段替换。
            if (typeof data.text === 'string' && item.text !== data.text) item.text = data.text
            item.mode = data.mode
            item.answerCompleted = true
          } else {
            timeline.value.push({ messageId: data.messageId, role: 'assistant', text: data.text, mode: data.mode, sources: [], answerCompleted: true })
            assistantIndex = timeline.value.length - 1
          }
          // 回答已定稿：撤下「正在核对回答依据…」状态条（本轮若无任何 delta，此前一直是挂起状态）
          reviewPending.value = false
          clearReviewHint()
          pending.value = false
          // 「语音对话」打开时自动朗读这条回答（重新生成同样走这里，读的是新回答）
          if (assistantIndex >= 0) maybeAutoRead(timeline.value[assistantIndex]!)
          await scrollToLatest()
        }
        if (event === 'module_proportions') {
          // Agent 回答先行模式：模块分诊路由结果回传，驱动「模块评估占比」面板
          updateScores(data.moduleProportions)
        }
        if (event === 'thinking') {
          // Agent 思考中：复用现有 pending 状态条，仅更新文案（不新增气泡）
          const phase = data && typeof data === 'object' ? (data as any)?.phase : undefined
          if (phase === 'review') {
            // 有个别句子被扣住、等整轮校验：先不打扰，静默超过 0.8 秒才挂起状态条
            // （扣住一句后马上又有文字流出时不显示，避免状态条一闪一闪）
            reviewPending.value = true
            clearReviewHint()
            reviewHintTimer = setTimeout(() => {
              reviewHintTimer = undefined
              const item = assistantIndex >= 0 ? timeline.value[assistantIndex] : undefined
              if (!reviewPending.value || !item || item.answerCompleted) return
              pending.value = true
              pendingLabel.value = '正在核对回答依据…'
            }, 800)
          } else if (!reviewPending.value) {
            pendingLabel.value = phase === 'tool' ? '正在调用工具…' : 'Agent 正在分析问题…'
          }
        }
        if (event === 'tool_call') {
          // 记入当前 assistant 气泡的工具调用过程（只保留工具名与中文标题，参数不进入界面）
          if (assistantIndex >= 0 && timeline.value[assistantIndex]) {
            const payload = data && typeof data === 'object' ? (data as any) : undefined
            const toolName = typeof payload?.name === 'string' ? payload.name
              : typeof payload?.tool === 'string' ? payload.tool
                : typeof payload?.toolName === 'string' ? payload.toolName
                  : typeof payload?.input?.tool === 'string' ? payload.input.tool : ''
            const item = timeline.value[assistantIndex]!
            if (!item.toolCalls) item.toolCalls = []
            if (typeof payload?.title === 'string') {
              // 只保留工具名与中文标题：参数属于内部结构（含模块 ID 等标识），不进入前端状态与界面
              item.toolCalls.push({ name: toolName || 'tool', title: payload.title })
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
        if (event === 'error') throw new Error(data.message)
      }
    }
  return assistantIndex
}

/** 停止生成：中断本轮 SSE；服务端检测到客户端断开后不落库、不发 answer 事件。 */
function stopGeneration() {
  abortController.value?.abort()
}

/** 标记气泡为「已停止」：保留已流入的部分文本；空气泡直接移除。 */
function markStopped(index: number) {
  if (index < 0 || !timeline.value[index]) {
    const last = timeline.value[timeline.value.length - 1]
    if (last && last.role === 'assistant' && !last.text) timeline.value.pop()
    return
  }
  const item = timeline.value[index]!
  item.stopped = true
  item.answerCompleted = Boolean(item.text)
}

async function ask() {
  // 录音/识别期间不允许发送：避免把没识别完的语音和文字混在一轮里
  if (!input.value.trim() || pending.value || recording.value || transcribing.value) return
  // 「语音对话」打开时先停掉上一条回答的自动朗读：新问题发出后，读的应该是新回答
  if (voiceMode.value) stopSpeech()
  const text = input.value.trim()
  input.value = ''
  pending.value = true
  pendingLabel.value = 'Agent 正在分析问题…'
  route.value = null
  turnObject.value = null
  turnObjectCandidates.value = []
  suggestedContext.value = null
  timeline.value.push({ role: 'user', text })
  await scrollToLatest()
  const controller = new AbortController()
  abortController.value = controller
  let assistantIndex = -1
  try {
    const response = await fetch('/api/v1/chat/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId.value, message: text, ...contextPayload.value }),
      signal: controller.signal
    })
    if (!response.ok || !response.body) throw new Error('助手暂时不可用')
    assistantIndex = await readAssistantStream(response)
    await refreshSessions()
  } catch (error: any) {
    if (isAbortError(error)) markStopped(assistantIndex)
    else timeline.value.push({ role: 'assistant', text: error?.message || '处理失败，请稍后重试。' })
  } finally {
    pending.value = false
    reviewPending.value = false
    clearReviewHint()
    abortController.value = null
    await scrollToLatest()
  }
}

/** 重新生成：服务端软删旧回答并以同一条教师提问重跑，前端复用原气泡接收新内容。 */
async function regenerateAnswer(item: TimelineItem, index: number) {
  const messageId = item.messageId
  if (!messageId || pending.value) return
  // 这条回答正在朗读时先停播：下面的正文会被清空重写
  stopSpeech()
  pending.value = true
  pendingLabel.value = 'Agent 正在重新生成…'
  item.text = ''
  item.messageId = undefined
  item.actionCards = []
  item.sources = []
  item.toolCalls = []
  item.answerCompleted = false
  item.stopped = false
  await scrollToLatest()
  const controller = new AbortController()
  abortController.value = controller
  try {
    const response = await fetch(`/api/v1/chat/messages/${messageId}/regenerate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal
    })
    if (!response.ok || !response.body) throw new Error('助手暂时不可用')
    await readAssistantStream(response, index)
    await refreshSessions()
  } catch (error: any) {
    if (isAbortError(error)) markStopped(index)
    else {
      item.text = error?.message || '重新生成失败，请稍后重试。'
      item.answerCompleted = true
    }
  } finally {
    pending.value = false
    reviewPending.value = false
    clearReviewHint()
    abortController.value = null
    await scrollToLatest()
  }
}

/** 工具过程面板的展示项：同名工具合并计数（模型常对多个模块重复调用同一工具）。 */
function toolCallDisplay(item: TimelineItem): ToolCallDisplay[] {
  const calls = item.toolCalls || []
  const grouped = new Map<string, ToolCallDisplay>()
  for (const call of calls) {
    const title = typeof call === 'string'
      ? call.replace(/^\[工具\]\s*/, '')
      : (call.title || call.name)
    const key = typeof call === 'string' ? title : (call.name || title)
    const existing = grouped.get(key)
    if (existing) existing.count += 1
    else grouped.set(key, { key, title, count: 1 })
  }
  return [...grouped.values()]
}

/** 当前这条回答涉及的模块：只取本条回答的动作卡与知识来源，不用会话级旧占比（否则每条回答都会重复同一个建议）。 */
function answerModules(item: TimelineItem): ModuleId[] {
  const modules: ModuleId[] = []
  const push = (module?: ModuleId | null) => {
    if (module && module in moduleMeta && !modules.includes(module)) modules.push(module)
  }
  for (const card of item.actionCards || []) push(card.module)
  const sourceCounts = new Map<ModuleId, number>()
  for (const source of item.sources || []) {
    const module = source.module
    if (!module || !(module in moduleMeta)) continue
    sourceCounts.set(module, (sourceCounts.get(module) || 0) + 1)
  }
  const topSource = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topSource) push(topSource[0])
  return modules
}

/**
 * 追问建议开关：暂时隐藏（2026-09-14 按产品反馈下线展示）。
 * 生成逻辑与数据结构保留；改回 true 即恢复展示。
 */
const SHOW_FOLLOW_UP_CHIPS = false
/** 回答后的追问建议：全部确定性生成（动作卡 / 引用来源 / 本条回答的模块 / 兜底），不调用模型。 */
function followUpChips(item: TimelineItem): FollowUpChip[] {
  if (item.role !== 'assistant' || !item.answerCompleted || item.stopped) return []
  const chips: FollowUpChip[] = []
  for (const card of item.actionCards || []) {
    if (!card.title) continue
    chips.push({
      label: card.kind === 'recommend_assessment' ? `开始做《${card.title}》` : card.title,
      prompt: card.kind === 'recommend_assessment'
        ? `我想做「${card.title}」这张量表，做之前先提醒我需要注意什么。`
        : `关于「${card.title}」，再展开说说具体怎么做。`
    })
  }
  if (item.sources?.length) {
    chips.push({ label: '这条建议怎么在我们班落地', prompt: '把上面的建议结合我们班的实际情况，拆成这周可以做的步骤。' })
  }
  const related = answerModules(item)[0]
  if (related) {
    chips.push({ label: `继续聊${moduleMeta[related].title}`, prompt: `我想继续聊${moduleMeta[related].title}方面的问题。` })
  }
  if (!chips.length) chips.push({ label: '拆成这周的三步', prompt: '把上面的分析拆成我这周可以先做的三步。' })
  return chips.slice(0, 3)
}

/** 点击建议：填入输入框并直接发送。 */
function sendPrompt(prompt: string) {
  if (pending.value) return
  input.value = prompt
  void ask()
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
  if (key === selectedContextKey.value) return
  const option = allContextOptions.value.find((item: any) => item.type === type && item.id === id)
  selectedContextKey.value = key
  // 会话内换对象：保留当前对话（历史由服务端保留、下一条消息换绑），只插入分隔条说明从这条起谈的是新对象
  if (!sessionId.value || !timeline.value.length) return
  // 还没发消息就连着切换时，只保留最后一条分隔条
  if (timeline.value[timeline.value.length - 1]?.contextSwitch) timeline.value.pop()
  timeline.value.push(contextSwitchItem(type, option?.label))
  nextTick(() => scrollToLatest())
}

/** 换绑咨询对象的时间线分隔条（role=system，仅用于展示，不落库）。 */
function contextSwitchItem(type: string, label?: string | null): TimelineItem {
  return {
    role: 'system',
    text: '',
    contextSwitch: { type, label: label || '该对象' }
  }
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

/** 会话列表里显示每条对话当前绑定的咨询对象（列表接口已返回 contextType/contextId）。 */
function sessionContextLabel(item: any) {
  if (!item?.contextId || !item?.contextType || item.contextType === 'none') return ''
  const matched = allContextOptions.value.find((option: any) => option.type === item.contextType && option.id === item.contextId)
  return (item.contextType === 'student' ? '学生' : item.contextType === 'class' ? '班级' : '家长') + ' · ' + (matched?.label || '已关联对象')
}

async function acceptPrivacyNotice() {
  try {
    await $fetch('/api/v1/chat/consent', { method: 'POST', body: { noticeVersion: governance.value.noticeVersion, accepted: true } })
    await refreshGovernance()
    toast.add({ title: '隐私告知已确认', color: 'success' })
  } catch (error: any) { toast.add({ title: '确认失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
}

async function submitFeedback(item: TimelineItem, rating: 'helpful' | 'not_helpful', details = false) {
  if (rating === 'not_helpful' && !details) { item.feedbackOpen = true; item.feedbackReasons ??= []; return }
  if (!item.messageId) return
  try {
    await $fetch(`/api/v1/chat/messages/${item.messageId}/feedback`, { method: 'POST', body: { rating, reasons: rating === 'not_helpful' ? item.feedbackReasons ?? [] : [], comment: rating === 'not_helpful' ? item.feedbackComment : undefined } })
    item.feedback = rating
    item.feedbackOpen = false
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
  if (card.kind === 'navigate') {
    const parsed = assistantNavigationSchema.safeParse(card)
    if (parsed.success) return navigateTo(parsed.data.to)
    return
  }
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
  // 释放麦克风与 AudioContext（丢弃未完成录音、不再上传识别）
  discardRecording()
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
        <!-- 没有进行中的方案时整块隐藏，避免出现「进行中的方案 0」的空入口 -->
        <div v-if="pendingPlanTotal > 0" class="border-b border-slate-100 px-3 py-3">
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
              <span class="mt-1 flex items-center gap-1.5 pl-6 text-[11px] text-slate-400"><span>{{ formatDateTime(item.updatedAt) }}</span><span v-if="sessionContextLabel(item)" class="truncate rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-500">{{ sessionContextLabel(item) }}</span></span>
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
            <!-- 语音对话总开关：喇叭亮=打开（每轮回答自动朗读），灭=关闭；未开启 TTS 能力时不渲染（不留死按钮） -->
            <UButton
              v-if="ttsEnabled"
              type="button"
              size="sm"
              square
              icon="i-lucide-volume-2"
              :color="voiceMode ? 'primary' : 'neutral'"
              :variant="voiceMode ? 'soft' : 'ghost'"
              :disabled="voiceModeBlocked"
              :aria-pressed="voiceMode"
              :aria-label="voiceMode ? '关闭语音对话朗读' : '打开语音对话朗读'"
              :title="voiceModeBlocked
                ? '本校数据模式为本地，语音能力不向外部服务发送数据'
                : voiceMode ? '语音对话已打开：每轮回答自动朗读' : '打开后每轮回答自动朗读'"
              @click="toggleVoiceMode(!voiceMode)"
            />
          </div>
          <div class="flex min-w-0 flex-1 items-center justify-end gap-2">
            <div v-if="selectedContext" class="flex min-w-0 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 sm:py-1.5"><UIcon :name="selectedContext.type === 'student' ? 'i-lucide-user-round' : selectedContext.type === 'class' ? 'i-lucide-users' : 'i-lucide-user-round-check'" class="size-3.5 shrink-0" /><span class="truncate">{{ mentionTypeLabel(selectedContext.type) }} · {{ selectedContext.label }}</span></div>
            <span v-else class="min-w-0 truncate text-xs text-slate-500 sm:text-sm"><span class="sm:hidden"><span class="font-semibold text-emerald-700">@</span> 可关联学生、班级、家长</span><span class="hidden sm:inline">未指定对象 · 输入框输入 <span class="font-semibold text-emerald-700">@</span> 可关联学生、班级、家长</span></span>
          </div>
        </div>
        <!-- 本轮对象：服务端按本轮消息识别，不改变会话绑定；命中多个时由教师点选，不替教师猜 -->
        <div
          v-if="!selectedContext && (turnObject || turnObjectCandidates.length)"
          class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 bg-emerald-50/60 px-3 py-2 text-xs sm:px-6"
        >
          <template v-if="turnObject">
            <span class="flex min-w-0 items-center gap-1.5 text-emerald-900">
              <UIcon name="i-lucide-link" class="size-3.5 shrink-0" />
              <span class="truncate">本次按{{ mentionTypeLabel(turnObject.type) }}「{{ turnObject.label }}」回答</span>
            </span>
            <UButton size="xs" color="primary" variant="soft" :loading="bindingTurnObject" @click="bindTurnObject(turnObject)">固定为本会话对象</UButton>
          </template>
          <template v-else>
            <span class="flex min-w-0 items-center gap-1.5 text-amber-900">
              <UIcon name="i-lucide-circle-help" class="size-3.5 shrink-0" />
              <span class="truncate">本轮提到的对象可能是以下之一，点选后按它回答：</span>
            </span>
            <UButton
              v-for="candidate in turnObjectCandidates"
              :key="`${candidate.type}:${candidate.id}`"
              size="xs" color="neutral" variant="soft" :loading="bindingTurnObject"
              @click="bindTurnObject(candidate)"
            >{{ candidate.label }}</UButton>
          </template>
        </div>
        <!-- 会话已绑定对象、本轮又提到另一个唯一对象：只提示是否切换，避免静默混用两个学生的信息 -->
        <div
          v-if="suggestedContext"
          class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-100 bg-amber-50/70 px-3 py-2 text-xs sm:px-6"
        >
          <span class="flex min-w-0 items-center gap-1.5 text-amber-900">
            <UIcon name="i-lucide-replace" class="size-3.5 shrink-0" />
            <span class="truncate">本轮提到的{{ mentionTypeLabel(suggestedContext.type) }}「{{ suggestedContext.label }}」与当前对象不同，是否切换？</span>
          </span>
          <UButton size="xs" color="warning" variant="soft" :loading="bindingTurnObject" @click="bindTurnObject(suggestedContext, { switched: true })">
            切到「{{ suggestedContext.label }}」
          </UButton>
          <UButton size="xs" color="neutral" variant="ghost" @click="suggestedContext = null">保持当前对象</UButton>
        </div>
        <div v-if="governance?.needsConsent" class="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900"><span>学校申请使用完整业务上下文。确认前将自动回退到严格脱敏模式；电话、邮箱、账号和系统标识永不发送。</span><UButton size="xs" color="warning" @click="acceptPrivacyNotice">阅读并确认 {{ governance.noticeVersion }}</UButton></div>

        <div ref="messageViewport" class="hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain bg-gradient-to-b from-slate-50/70 to-white px-3 pt-4 sm:px-6 sm:pt-6" :class="[inputLifted ? 'pb-40 sm:pb-44' : 'pb-40 sm:pb-36', {'opacity-60':loadingSession}]" @scroll="onMessageViewportScroll">
          <div v-if="timeline.length" class="mx-auto max-w-3xl space-y-5 sm:space-y-7">
            <template v-for="(item, index) in timeline" :key="index">
            <!-- 会话内换绑咨询对象：分隔条标明从这条起谈的是另一个对象（历史消息保留） -->
            <div v-if="item.contextSwitch" class="flex items-center gap-3 py-1 text-[11px] text-slate-400">
              <span class="h-px flex-1 bg-slate-200" />
              <span class="flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1 font-medium text-emerald-700"><UIcon name="i-lucide-link" class="size-3" />以下开始谈：{{ mentionTypeLabel(item.contextSwitch.type) }} · {{ item.contextSwitch.label }}</span>
              <span class="h-px flex-1 bg-slate-200" />
            </div>
            <div v-else class="flex items-start gap-3" :class="item.role === 'user' ? 'flex-row-reverse' : 'max-sm:flex-col max-sm:gap-2'">
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
                  <!-- 流式期间按纯文本追加：delta 只改动文本节点，不对半截 Markdown 反复全量重解析；
                       answer 事件到达（answerCompleted）后再一次性渲染 Markdown -->
                  <div v-else-if="!item.answerCompleted" class="whitespace-pre-wrap" v-text="item.text" />
                  <div v-else class="markdown-body" v-html="useMarkdown(item.text)" />
                  <p v-if="item.role === 'assistant' && item.stopped" class="mt-2 flex items-center gap-1 text-[11px] text-slate-400"><UIcon name="i-lucide-circle-stop" class="size-3" />已停止生成</p>
                  <button v-if="item.role === 'assistant'" type="button" class="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-white/95 px-1.5 py-1 text-[11px] text-slate-400 opacity-0 shadow-sm transition hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100 focus:opacity-100" :aria-label="copiedMessage === index ? '已复制回答' : '复制回答'" @click="copyMessage(item.text, index)"><UIcon :name="copiedMessage === index ? 'i-lucide-check' : 'i-lucide-copy'" class="size-3" />{{ copiedMessage === index ? '已复制' : '复制' }}</button>
                </div>
                <!-- 量表推荐卡与工具过程、引用来源同一行排布：宽度够时三块同行，不够时卡片整行独占、折叠条另起一行（手机/平板/桌面自适应）。
                     折叠条展开时必须同时给 details 加 open:self-start、给 summary 加 group-open:h-auto：本行用 items-stretch 做等高，
                     被拉伸的 details 高度是确定值，summary 的 h-full 会解析成整个盒高，把展开内容挤到 overflow-hidden 之外而看不见 -->
                <div
                  v-if="item.role === 'assistant' && (item.toolCalls?.length || (item.answerCompleted && (item.actionCards?.length || item.sources?.length)))"
                  class="mt-3 flex flex-wrap items-stretch gap-2"
                >
                  <!-- 量表推荐卡：默认收起，展开后给理由与入口。md 起给 13rem 基准宽（空间不足即整行独占），此时卡片与折叠条同行，量表名放不下就截断（悬停看全名）；md 以下卡片独占整行，量表名换行完整显示 -->
                  <div v-if="item.answerCompleted && item.actionCards?.length" class="min-w-0 basis-full space-y-2 has-[details[open]]:basis-full md:basis-52 md:grow">
                    <details v-for="(card, cardIndex) in item.actionCards" :key="`action-card-${cardIndex}`" class="group overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/70 open:self-start">
                      <summary class="flex h-full cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-1.5 group-open:h-auto">
                        <span class="flex min-w-0 items-center gap-2">
                          <UIcon name="i-lucide-clipboard-list" class="size-4 shrink-0 text-emerald-700" />
                          <span class="min-w-0 text-xs text-emerald-800 md:truncate" :title="card.title"><span v-if="card.kind === 'recommend_assessment'" class="mr-1 text-emerald-700">推荐量表</span><span class="font-semibold">{{ card.title }}</span></span>
                        </span>
                        <span class="flex shrink-0 items-center gap-1.5 text-xs text-emerald-700">
                          <span class="sm:hidden">查看详情</span>
                          <UIcon name="i-lucide-chevron-down" class="size-3.5 transition group-open:rotate-180" />
                        </span>
                      </summary>
                      <div class="border-t border-emerald-200/70 px-4 py-3">
                        <p class="text-sm leading-6 text-slate-600">{{ cardBodyText(card) }}</p>
                        <div v-if="(card.kind === 'recommend_assessment' && card.module) || card.kind === 'navigate'" class="mt-3">
                          <UButton color="primary" size="sm" @click="openAgentActionCard(card)">{{ card.ctaLabel || '进入模块完成评估' }}</UButton>
                        </div>
                      </div>
                    </details>
                  </div>
                  <!-- 工具过程与引用来源：合成一组参与换行，避免出现「卡片 + 一个条」的参差排布；任一条展开时整组独占一行 -->
                  <div class="flex min-w-0 flex-wrap items-stretch gap-2 has-[details[open]]:basis-full">
                    <!-- 工具调用过程：同名工具合并计数；不展示内部参数（含模块 ID 等标识） -->
                    <details v-if="item.toolCalls?.length" class="group shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 text-xs text-slate-600 open:basis-full open:self-start">
                      <summary class="flex h-full cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-1.5 font-medium text-slate-500 group-open:h-auto">
                        <span class="flex items-center gap-2">
                          <UIcon :name="item.answerCompleted ? 'i-lucide-wrench' : 'i-lucide-loader-circle'" class="size-4" :class="!item.answerCompleted ? 'animate-spin text-emerald-600' : ''" />
                          {{ item.answerCompleted ? `调用工具${item.toolCalls.length}次` : `正在调用工具${item.toolCalls.length}次` }}
                        </span>
                        <UIcon name="i-lucide-chevron-down" class="size-3.5 transition group-open:rotate-180" />
                      </summary>
                      <div class="space-y-1.5 border-t border-slate-200 px-3 py-2.5">
                        <div v-for="entry in toolCallDisplay(item)" :key="`tool-${entry.key}`" class="flex items-center justify-between gap-3 rounded-lg bg-white/80 p-2.5">
                          <p class="flex items-center gap-1.5 font-medium text-slate-700"><UIcon name="i-lucide-wrench" class="size-3 shrink-0 text-slate-400" /><span>{{ entry.title }}</span></p>
                          <span v-if="entry.count > 1" class="shrink-0 text-[11px] text-slate-400">×{{ entry.count }}</span>
                        </div>
                      </div>
                    </details>
                    <!-- 引用来源：展开后不展示内部字段（chunkId 等） -->
                    <details v-if="item.answerCompleted && item.sources?.length" class="group shrink-0 overflow-hidden rounded-xl border border-emerald-100 bg-emerald-50/50 text-xs text-slate-600 open:basis-full open:self-start">
                      <summary class="flex h-full cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-1.5 font-medium text-emerald-800 group-open:h-auto">
                        <span class="flex items-center gap-2"><UIcon name="i-lucide-book-open-check" class="size-4" />参考知识库{{ item.sources.length }}条</span>
                        <UIcon name="i-lucide-chevron-down" class="size-3.5 transition group-open:rotate-180" />
                      </summary>
                      <div class="space-y-2 border-t border-emerald-100 px-3 py-3">
                        <div v-for="(source, sourceIndex) in item.sources" :key="source.chunkId" class="rounded-lg bg-white/80 p-3">
                          <p class="font-medium text-slate-700"><span class="mr-1 text-emerald-600">{{ sourceIndex + 1 }}.</span>{{ source.documentTitle }}<span v-if="source.heading" class="font-normal text-slate-400"> · {{ source.heading }}</span></p>
                          <p class="mt-1 text-[11px] text-emerald-700/70">{{ source.resourceTitle || '模块资源' }}<template v-if="source.module || source.libraryType"> · {{ source.module ? moduleLabel(source.module) : '通用' }} / {{ source.libraryType ? libraryTypeLabel(source.libraryType) : '资源' }}</template></p><p v-if="source.excerpt" class="mt-1.5 line-clamp-3 leading-5 text-slate-500">{{ source.excerpt }}</p>
                        </div>
                      </div>
                    </details>
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
                <div v-if="item.role === 'assistant' && item.planUpdateSuggestions?.length" class="mt-7 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs"><p class="font-semibold text-amber-900">AI 曾建议更新方案（历史记录）</p><div v-for="(suggestion, suggestionIndex) in item.planUpdateSuggestions" :key="suggestionIndex" class="flex items-center justify-between gap-3 rounded-lg bg-white p-3"><span class="text-slate-600">{{ suggestion.actionTitle || '新增复盘' }}<template v-if="suggestion.newStatus"> → {{ actionStatusLabel(suggestion.newStatus) }}</template><span v-if="suggestion.progressNote" class="mt-1 block text-slate-400">{{ suggestion.progressNote }}</span></span><span class="text-[11px] text-slate-400">{{ suggestion.appliedAt ? '已应用' : '未应用' }}</span></div></div>
                <div v-if="item.role === 'assistant' && item.messageId" class="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400"><span>这条回答有帮助吗？</span><UButton size="xs" color="neutral" :variant="item.feedback==='helpful'?'soft':'ghost'" icon="i-lucide-thumbs-up" @click="submitFeedback(item, 'helpful')">有帮助</UButton><UButton size="xs" color="neutral" :variant="item.feedback==='not_helpful'?'soft':'ghost'" icon="i-lucide-thumbs-down" @click="submitFeedback(item, 'not_helpful')">没帮助</UButton><UButton v-if="ttsEnabled && item.messageId" size="xs" color="neutral" :variant="speakingId === item.messageId ? 'soft' : 'ghost'" :icon="speakingId === item.messageId ? 'i-lucide-square' : 'i-lucide-volume-2'" :loading="speechLoadingId === item.messageId" :aria-label="speakingId === item.messageId ? '停止朗读' : '朗读回答'" @click="toggleSpeechFor(item)">{{ speakingId === item.messageId ? '停止' : '朗读' }}</UButton><UButton v-if="item.answerCompleted && !pending && index === timeline.length - 1" size="xs" color="neutral" variant="ghost" icon="i-lucide-refresh-cw" @click="regenerateAnswer(item, index)">重新生成</UButton></div>
                <!-- 追问建议：暂时隐藏（SHOW_FOLLOW_UP_CHIPS=false）；生成逻辑保留，改回开关即恢复 -->
                <div v-if="item.feedbackOpen" class="mt-3 space-y-3 rounded-xl border border-slate-200 p-3">
                  <p class="text-sm">哪里需要改进？（可选）</p>
                  <div class="flex flex-wrap gap-3">
                    <label v-for="reason in assistantFeedbackReasons" :key="reason.value" class="flex items-center gap-1 text-sm">
                      <input v-model="item.feedbackReasons" type="checkbox" :value="reason.value">{{ reason.label }}
                    </label>
                  </div>
                  <UTextarea v-model="item.feedbackComment" aria-label="反馈补充说明" placeholder="补充说明（可选）" :maxlength="500" class="w-full" />
                  <UButton size="sm" @click="submitFeedback(item, 'not_helpful', true)">提交反馈</UButton>
                  <UButton size="sm" variant="ghost" color="neutral" @click="item.feedbackOpen = false">取消</UButton>
                </div>
                <div v-if="SHOW_FOLLOW_UP_CHIPS && item.role === 'assistant' && item.answerCompleted" class="mt-3 flex flex-wrap gap-2">
                  <button
                    v-for="chip in followUpChips(item)"
                    :key="chip.label"
                    type="button"
                    class="rounded-full border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-xs text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
                    :disabled="pending"
                    @click="sendPrompt(chip.prompt)"
                  >{{ chip.label }}</button>
                </div>
              </div>
            </div>
            </template>

            <div v-if="pending && !pendingAssistantBubble" class="flex items-start gap-3 max-sm:flex-col max-sm:gap-2">
              <div class="flex items-center gap-2 sm:block sm:shrink-0">
                <div class="grid size-8 shrink-0 place-items-center rounded-xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><UIcon name="i-lucide-sparkles" class="size-4" /></div>
                <span class="text-[11px] text-slate-400 sm:hidden">赋能助手</span>
              </div>
              <div class="min-w-0 max-w-full sm:max-w-[82%]">
                <p class="mb-1.5 hidden text-[11px] text-slate-400 sm:block">赋能助手</p>
                <div class="flex w-fit items-center gap-1.5 rounded-2xl rounded-tl-md border border-slate-100 bg-white px-4 py-4 shadow-sm"><span class="size-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-.3s]" /><span class="size-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-.15s]" /><span class="size-1.5 animate-bounce rounded-full bg-emerald-400" /><span class="ml-2 text-xs text-slate-400">{{ pendingLabel }}</span></div></div></div>

            <div v-if="route" class="flex items-start gap-3 max-sm:flex-col max-sm:gap-2">
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
            <div class="mt-6 w-full space-y-3 text-left">
              <!-- 今日建议：暂时隐藏（SHOW_ASSISTANT_BRIEF=false）；接口与数据结构保留，改回开关即恢复 -->
              <div v-if="SHOW_ASSISTANT_BRIEF && briefItems.length" class="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                <p class="flex items-center gap-2 text-xs font-semibold text-amber-900"><UIcon name="i-lucide-calendar-check" class="size-4" />今日建议</p>
                <div class="mt-2 space-y-2">
                  <div v-for="entry in briefItems" :key="`${entry.kind}-${entry.title}`" class="flex items-start justify-between gap-3 rounded-xl bg-white/80 p-3">
                    <button type="button" class="min-w-0 flex-1 text-left disabled:opacity-50" :disabled="pending" @click="sendPrompt(entry.prompt)">
                      <span class="block truncate text-sm font-medium text-slate-700">{{ entry.title }}</span>
                      <span class="mt-0.5 block text-xs leading-5 text-slate-500">{{ entry.detail }}</span>
                    </button>
                    <NuxtLink v-if="entry.targetPath" :to="entry.targetPath" class="shrink-0 text-xs text-emerald-700 hover:underline">去看看</NuxtLink>
                  </div>
                </div>
              </div>
            </div>
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
            <div ref="composerRef" class="rounded-2xl border border-slate-300 bg-white/30 p-1.5 shadow-lg shadow-slate-900/5 backdrop-blur-xl [-webkit-backdrop-filter:blur(24px)] transition focus-within:border-emerald-400 focus-within:ring-3 focus-within:ring-emerald-100 sm:p-2">
              <!-- 录音/识别状态：录音中显示已录时长与音量条，识别中显示转写提示 -->
              <div v-if="recording || transcribing" class="mb-1 flex items-center gap-2 px-1 pt-0.5 text-[11px]">
                <template v-if="recording">
                  <span class="flex shrink-0 items-center gap-1.5 font-medium text-red-600"><span class="size-1.5 animate-pulse rounded-full bg-red-500" />正在录音 {{ recordingSeconds }}s / {{ MAX_RECORDING_SECONDS }}s</span>
                  <span class="flex h-1.5 min-w-0 flex-1 items-center overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                    <span class="h-full rounded-full bg-emerald-500 transition-[width] duration-75" :style="{ width: `${Math.round(recordingLevel * 100)}%` }" />
                  </span>
                  <span class="shrink-0 text-slate-400 sm:hidden">松开后自动发送</span>
                  <span class="hidden shrink-0 text-slate-400 sm:inline">点击麦克风结束，识别后自动发送</span>
                </template>
                <span v-else class="flex shrink-0 items-center gap-1.5 text-slate-500"><UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin text-emerald-600" />正在识别语音…</span>
              </div>
              <!-- 语音相关错误（权限、识别失败）：就地提示，不用 alert；下一次录音会清空 -->
              <p v-if="speechError" class="mb-1 flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-600">
                <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" />
                <span class="min-w-0 flex-1">{{ speechError }}</span>
                <button type="button" class="shrink-0 rounded p-0.5 transition hover:bg-red-100" aria-label="关闭提示" @click="speechError = ''"><UIcon name="i-lucide-x" class="size-3" /></button>
              </p>
              <!-- 手机端「按住说话」：ASR 可用时替换输入框；按下开始录音、松开自动发送，键盘图标切回打字 -->
              <div v-if="asrEnabled && mobileVoiceInput" class="flex items-center gap-2 sm:hidden">
                <UButton
                  type="button"
                  size="lg"
                  class="h-12 min-w-0 flex-1 select-none touch-none text-sm"
                  :icon="recording ? 'i-lucide-audio-waveform' : 'i-lucide-mic'"
                  :color="recording ? 'error' : 'neutral'"
                  :variant="recording ? 'solid' : 'soft'"
                  :loading="transcribing"
                  :disabled="pending || transcribing"
                  :aria-label="recording ? '松开发送' : '按住说话'"
                  @pointerdown.prevent="startHoldRecording"
                  @pointerup="endHoldRecording"
                  @pointercancel="endHoldRecording"
                  @pointerleave="endHoldRecording"
                  @keydown.space.prevent="startHoldRecording"
                  @keydown.enter.prevent="startHoldRecording"
                  @keyup.space="endHoldRecording"
                  @keyup.enter="endHoldRecording"
                  @contextmenu.prevent
                >{{ recording ? '松开 发送' : '按住说话' }}</UButton>
                <UButton v-if="pending" type="button" icon="i-lucide-square" size="lg" square class="size-12" color="neutral" variant="soft" aria-label="停止生成" @click="stopGeneration" />
                <UButton type="button" icon="i-lucide-keyboard" size="lg" square class="size-12" color="neutral" variant="ghost" aria-label="切换到键盘输入" title="切换到键盘输入" @click="mobileVoiceInput = false" />
              </div>
              <!-- 输入框：电脑端恒显示；手机端只在键盘输入模式下显示 -->
              <div class="items-center gap-2" :class="asrEnabled && mobileVoiceInput ? 'hidden sm:flex' : 'flex'">
                <UTextarea v-model="input" :rows="2" :maxrows="8" :maxlength="4000" autoresize class="min-w-0 flex-1" variant="none" aria-label="向 AI 赋能助手提问" @input="handleMentionInput" @keydown.enter.exact.prevent="ask" @keydown.esc="closeMention" />
                <!-- 手机端此按钮切回「按住说话」：只在键盘输入模式下出现；桌面端不渲染 -->
                <UButton
                  v-if="asrEnabled && !mobileVoiceInput"
                  type="button"
                  size="lg"
                  square
                  icon="i-lucide-mic"
                  color="neutral"
                  variant="soft"
                  class="sm:hidden"
                  aria-label="切换到按住说话"
                  title="切换到按住说话"
                  @click="mobileVoiceInput = true"
                />
                <!-- 语音输入（桌面端）：点击开始录音、再点结束，识别完成自动发送；录音/识别期间不可再点 -->
                <UButton
                  v-if="asrEnabled"
                  type="button"
                  :icon="recording ? 'i-lucide-square' : 'i-lucide-mic'"
                  size="lg"
                  square
                  :color="recording ? 'error' : 'neutral'"
                  :variant="recording ? 'solid' : 'soft'"
                  :loading="transcribing"
                  :disabled="pending || transcribing"
                  :aria-label="recording ? '结束录音' : '语音输入'"
                  class="hidden sm:inline-flex"
                  @click="toggleRecording"
                />
                <UButton v-if="pending" type="button" icon="i-lucide-square" size="lg" square color="neutral" variant="soft" aria-label="停止生成" @click="stopGeneration" />
                <UButton v-else type="submit" icon="i-lucide-arrow-up" size="lg" square :disabled="!input.trim() || recording || transcribing" aria-label="发送消息" />
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

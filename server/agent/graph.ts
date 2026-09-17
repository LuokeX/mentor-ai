import { assistantNavigationSchema } from '../../shared/assistant'
/**
 * LangGraph「回答先行 Agent」基座（P0）。
 *
 * 节点归属说明（P0 阶段逻辑并入本图，不拆独立节点文件）：
 *  - guard：上下文装载由入口（AGENT-C）负责，组装助手见 nodes/guard.ts 的 prepareRunInput；
 *  - preliminary / report / final / safety：P0 收敛在下方 runAgentGraph 的
 *    createReactAgent（模型回答）+ 工具调用循环中：模型直接给出“回答先行”的初步
 *    理解，推荐量表走 recommend_assessment 工具并产出 action_card；量表结果接入后
 *    再拆 final 节点。
 *
 * 事件流（onEvent 回调，事件名与契约 AGENT_SSE_EVENTS 一致，由入口转发 SSE）：
 *  tool_call          → { name, args }（args 截断到 300 字符）
 *  tool_result        → { name, result }（result 截断到 500 字符）
 *  action_card        → ActionCard（工具返回含 { actionCard } 时即时推送并收集）
 *  answer_delta       → { text }（模型流式文本逐段推送）
 *  module_proportions → { moduleProportions }（最终模块评估占比，驱动前端「模块评估占比」面板）
 */
import type { H3Event } from 'h3'
import { serializeToolOutput, toolOutcome } from './tool-output'
import { collectToolEvidence, type AnswerEvidence } from './evidence'
import { repairToolTrace, traceToLangChainMessages } from './tool-trace'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { ActionCard, AgentMessage, AgentState, AgentTool, AgentToolContext, AgentToolTraceStep, AgentUserContext } from './types'
import { AGENT_SSE_EVENTS } from './types'
import { sanitizeHistoryForSummary } from '../domain/chat-clarification'
import { createAgentLlm } from '../integrations/models'
import { buildAgentTools } from './tools/index'
import type { ModuleId } from '../../shared/contracts'

/** 模型/工具默认轮次上限：可由 AI_AGENT_MAX_TOOL_ROUNDS 覆盖（默认 8 轮，随只读工具集扩充上调）。 */
const DEFAULT_MAX_TOOL_ROUNDS = 8

/** 单次工具执行的默认超时（毫秒）：超时按「工具失败」回传给模型自愈，不中断整轮回答。 */
const DEFAULT_TOOL_TIMEOUT_MS = 10_000

/** 历史消息防御上限（真正的裁剪由入口的 token 预算负责，这里只防止异常输入）。 */
const MAX_HISTORY_MESSAGES = 400

/** 单次工具返回的字符上限（防止工具结果把 in-turn 前缀撑大，进而抬高成本与延迟）。 */
const TOOL_RESULT_CHAR_CAP = 16000

/** 无产出时的自动重试次数：总尝试次数 = 1 + AGENT_RETRY_TIMES。 */
const AGENT_RETRY_TIMES = 1

export interface RunAgentGraphInput {
  /** 对话消息（含本轮用户输入），入口组装。 */
  messages: AgentMessage[]
  signal?: AbortSignal
  /** 仅内部合成评测注入；REST 不接受该参数。 */
  toolsForEvaluation?: AgentTool[]
  /** 教师上下文（业务对象/记忆/画像），guard 装载后传入。 */
  userCtx: AgentUserContext
  /** system prompt（AGENT-C 提供 renderPrompt 结果），本图只追加行为附加说明。 */
  systemPrompt: string
  /** SSE 事件采集器：转发给入口（入口再转发给前端）。 */
  onEvent: (event: string, data: unknown) => void
}

export interface RunAgentGraphResult {
  answer: string
  evidence?: AnswerEvidence[]
  actionCards: ActionCard[]
  exitReason: AgentState['exitReason']
  /** 本轮工具调用过程（供入口持久化到消息 metadata，切换会话后仍可展示） */
  toolCalls?: Array<{ name: string; title: string; args: string; status?: 'success' | 'empty' | 'error' | 'timeout'; latencyMs?: number }>
  /**
   * 工具之间的判定冲突（如模块分诊结论与量表推荐模块不一致）。
   * 图内不做落库，由入口写产品事件留痕。
   */
  toolConflicts?: string[]
  /** 本轮知识库引用来源（供入口持久化到消息 metadata） */
  sources?: Array<{ chunkId: string; documentTitle: string; heading?: string | null; excerpt?: string; module?: string | null; libraryType?: string }>
  /** 模块评估占比（0~1）。由 module_route / recommend_assessment 工具最终路由结果推导，供前端「模块评估占比」面板展示。 */
  moduleProportions?: Record<ModuleId, number>
  /** 本轮每一次模型往返的用量元数据（供入口写入 ai_model_calls，只记元数据不记正文）。 */
  modelCalls?: AgentModelCallRecord[]
  /**
   * 本轮工具轨迹（P3）：模型发起的 tool_calls 与工具返回，供入口加密落库并在下一轮回放，
   * 以恢复「上一轮的请求序列是这一轮前缀」的缓存不变量。无工具调用时为空。
   */
  toolTrace?: AgentToolTraceStep[]
}

/** 单次模型往返的用量元数据（缓存字段缺失时为 undefined，不猜测）。 */
export interface AgentModelCallRecord {
  model: string
  status: 'success' | 'failed'
  latencyMs: number
  promptTokens?: number
  completionTokens?: number
  cacheHitTokens?: number
  cacheMissTokens?: number
  /**
   * 该次往返的结束原因（DeepSeek：stop / tool_calls / length / content_filter /
   * insufficient_system_resource 等）。上游中断导致空正文时靠它区分「正常结束的空回答」
   * 与「服务端资源不足被中断」，服务端未返回时缺省。
   */
  finishReason?: string
  errorCode?: string
}

/** 工具层由 AGENT-B 提供；加载失败时不抛错，本轮以“无工具”运行保证可降级。 */
async function loadAgentTools(userCtx: AgentUserContext, enabledTools?: string[] | null): Promise<AgentTool[]> {
  try {
    const built = await buildAgentTools(userCtx, enabledTools)
    return Array.isArray(built) ? built : []
  } catch (error) {
    console.error('[agent/graph] 工具层加载失败，本轮以无工具运行:', error instanceof Error ? error.message : error)
    return []
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 工具执行超时错误：与普通异常区分，便于把「超时」作为独立状态回传与记录。 */
class ToolTimeoutError extends Error {
  readonly toolName: string
  readonly timeoutMs: number
  constructor(toolName: string, timeoutMs: number) {
    super(`工具 ${toolName} 执行超时（>${timeoutMs}ms）`)
    this.name = 'ToolTimeoutError'
    this.toolName = toolName
    this.timeoutMs = timeoutMs
  }
}

/** 给工具执行套一个超时上限：超时按工具失败处理，不中断整轮回答。 */
async function withToolTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ToolTimeoutError(toolName, timeoutMs)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 契约只保证 schema 是 zod schema；DynamicStructuredTool 泛型约束随 @langchain/core 版本变化，经 unknown 透传。
 *
 * cache：同一次运行内「相同工具 + 相同参数」的结果缓存。模型偶尔会反复发起同一个查询，
 * 命中缓存可省掉一次数据库查询与一次工具往返的 token 开销（缓存按轮次重置，不跨轮）。
 */
function toLangChainTool(def: AgentTool, ctx: AgentToolContext, cache: Map<string, string>): DynamicStructuredTool {
  let emptySearches = 0
  const input = {
    name: def.name,
    description: def.description,
    schema: def.schema,
    func: async (args: unknown) => {
      const cacheKey = `${def.name}:${stringify(args)}`
      const cached = cache.get(cacheKey)
      if (cached !== undefined) return cached
      if (def.name === 'knowledge_search' && emptySearches >= 2) return JSON.stringify({ status: 'empty', items: [], message: '本轮已检索并改写查询一次，仍未获得依据。请区分通用建议与正式资源，不再重复查询。' })
      ctx.user.signal?.throwIfAborted()
      const timeoutMs = def.timeoutMs && def.timeoutMs > 0 ? def.timeoutMs : DEFAULT_TOOL_TIMEOUT_MS
      try {
        const result = await withToolTimeout(Promise.resolve(def.execute(args, ctx)), timeoutMs, def.name)
        if (def.name === 'knowledge_search' && toolOutcome(result) === 'empty') emptySearches += 1
        const capped = serializeToolOutput(result, TOOL_RESULT_CHAR_CAP)
        cache.set(cacheKey, capped)
        return capped
      } catch (error) {
        if (error instanceof ToolTimeoutError) {
          console.error(`[agent/graph] 工具 ${def.name} 执行超时（>${timeoutMs}ms），按失败回传模型自愈`)
          const payload = JSON.stringify({
            status: 'timeout', error: '工具执行超时',
            message: `该工具在 ${Math.round(timeoutMs / 1000)} 秒内没有返回结果，请缩小查询范围，或基于已有信息直接回答。`
          })
          cache.set(cacheKey, payload)
          return payload
        }
        // 工具执行失败回传模型自愈（文本描述错误），不中断整个 agent 运行
        console.error(`[agent/graph] 工具 ${def.name} 执行失败:`, error instanceof Error ? error.message : error)
        return JSON.stringify({ status: 'error', error: '工具执行失败', message: '查询暂时不可用，请缩小范围或说明信息缺口。' })
      }
    }
  }
  return new DynamicStructuredTool(
    input as unknown as ConstructorParameters<typeof DynamicStructuredTool>[0]
  ) as unknown as DynamicStructuredTool
}

/** 工具英文名 → 前端展示中文标题。 */
const TOOL_TITLES: Record<string, string> = {
  knowledge_search: '知识库检索',
  module_route: '问题分诊',
  recommend_assessment: '推荐量表',
  entity_memory: '实体记忆',
  record_snapshot: '读取咨询对象档案',
  student_search: '查找学生',
  student_snapshot: '读取学生档案',
  plan_lookup: '查询方案与复盘',
  assessment_history: '查询评估历史',
  communication_lookup: '查询沟通记录',
  class_overview: '班级学生概览',
  teacher_brief: '读取教师待办',
  resource_lookup: '查询三库资源'
}

/** 从 ToolMessage content 里提取知识库来源片段（knowledge_search 结果 → SourceItem[]）。 */
function extractKnowledgeSources(output: unknown): Array<{
  chunkId: string
  documentTitle: string
  heading?: string | null
  excerpt?: string
  module?: string | null
  libraryType?: string
}> {
  const text = renderToolMessageContent((output as { content?: unknown } | null)?.content ?? output)
  if (!text) return []
  try {
    const parsed = JSON.parse(text) as unknown
    // 当前 knowledge_search 返回 { items, catalog }；兼容历史上直接返回数组的形态
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : []
    if (!list.length) return []
    return list.slice(0, 5).map(item => {
      const src = item as Record<string, unknown>
      if (!src || typeof src !== 'object' || typeof src.chunkId !== 'string') return null
      return {
        chunkId: src.chunkId,
        documentTitle: String(src.documentTitle || '知识库片段'),
        heading: typeof src.heading === 'string' ? src.heading : null,
        excerpt: typeof src.excerpt === 'string' ? truncate(src.excerpt, 120) : undefined,
        module: typeof src.module === 'string' ? src.module : null,
        libraryType: typeof src.libraryType === 'string' ? src.libraryType : undefined
      }
    }).filter((item): item is NonNullable<typeof item> => item !== null)
  } catch {
    return []
  }
}

/** v2 streamEvents chunk 形状窄化（event/name/data 均为可选字段，运行时逐个校验）。 */
function isStreamChunk(value: unknown): value is { event: string; name?: string; run_id?: string; data: Record<string, unknown> } {
  if (!value || typeof value !== 'object') return false
  const chunk = value as { event?: unknown, name?: unknown, run_id?: unknown, data?: unknown }
  if (typeof chunk.event !== 'string') return false
  if (chunk.name !== undefined && typeof chunk.name !== 'string') return false
  if (chunk.run_id !== undefined && typeof chunk.run_id !== 'string') return false
  if (chunk.data === undefined || chunk.data === null || typeof chunk.data !== 'object') return false
  return true
}

/**
 * 从模型消息的 usage_metadata 读取 token 用量（含 DeepSeek 缓存命中字段）。
 * LangChain 把 OpenAI 风格的 prompt_tokens_details.cached_tokens 映射为
 * input_token_details.cache_read；未返回该字段时保持 undefined，不猜测。
 */
function readUsageMetadata(message: unknown): Pick<AgentModelCallRecord, 'promptTokens' | 'completionTokens' | 'cacheHitTokens' | 'cacheMissTokens'> | null {
  if (!message || typeof message !== 'object') return null
  const meta = (message as { usage_metadata?: unknown }).usage_metadata
  if (!meta || typeof meta !== 'object') return null
  const usage = meta as {
    input_tokens?: unknown
    output_tokens?: unknown
    input_token_details?: { cache_read?: unknown } | null
  }
  const record: Pick<AgentModelCallRecord, 'promptTokens' | 'completionTokens' | 'cacheHitTokens' | 'cacheMissTokens'> = {}
  if (typeof usage.input_tokens === 'number' && Number.isFinite(usage.input_tokens)) record.promptTokens = usage.input_tokens
  if (typeof usage.output_tokens === 'number' && Number.isFinite(usage.output_tokens)) record.completionTokens = usage.output_tokens
  const cacheRead = usage.input_token_details?.cache_read
  if (typeof cacheRead === 'number' && Number.isFinite(cacheRead) && cacheRead >= 0) {
    record.cacheHitTokens = cacheRead
    if (typeof record.promptTokens === 'number') record.cacheMissTokens = Math.max(0, record.promptTokens - cacheRead)
  }
  return Object.keys(record).length ? record : null
}

/** 从 on_chat_model_stream 的 AIMessageChunk 中提取纯文本（兼容 string 与 content block 数组两种形态）。 */
function extractStreamedText(chunk: { data: Record<string, unknown> }): string {  const modelChunk = chunk.data.chunk
  if (!modelChunk || typeof modelChunk !== 'object') return ''
  const content = (modelChunk as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const text = (block as { text?: unknown }).text
    if (typeof text === 'string') parts.push(text)
  }
  return parts.join('')
}

/** 运行时收窄为契约 ActionCard（不信任工具输出，逐字段校验）。 */
function isActionCard(value: unknown): value is ActionCard {
  if (!value || typeof value !== 'object') return false
  const card = value as Record<string, unknown>
  if (card.kind === 'navigate') return assistantNavigationSchema.safeParse(card).success
  if (card.kind === 'info') {
    return typeof card.title === 'string' && typeof card.content === 'string'
  }
  if (card.kind === 'recommend_assessment') {
    return (
      typeof card.module === 'string' &&
      typeof card.assessmentCode === 'string' &&
      typeof card.title === 'string' &&
      typeof card.reason === 'string' &&
      typeof card.ctaLabel === 'string'
    )
  }
  return false
}

/** 从 on_tool_end 输出中提取 actionCard：兼容 { actionCard } / { actionCards: [] } / 卡片本身 / ToolMessage(含 content) 各种形态。 */
function extractActionCard(output: unknown): ActionCard | null {
  // LangGraph 1.x：on_tool_end 的 output 是 ToolMessage 对象，需先取 content（string 或 content blocks 数组）
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const maybeMsg = output as { content?: unknown }
    if (maybeMsg.content !== undefined) {
      const rendered = renderToolMessageContent(maybeMsg.content)
      if (rendered !== null) return extractActionCard(rendered)
    }
  }
  let parsed: unknown = output
  if (typeof output === 'string') {
    try {
      parsed = JSON.parse(output)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null
  const container = parsed as Record<string, unknown>
  if (isActionCard(container)) return container
  if (isActionCard(container.actionCard)) return container.actionCard
  if (Array.isArray(container.actionCards)) {
    for (const card of container.actionCards) {
      if (isActionCard(card)) return card
    }
  }
  return null
}

/** ToolMessage.content 还原为字符串：string 原样；content blocks 数组拼接 text 段；其余返回 null。 */
function renderToolMessageContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (typeof block === 'string') parts.push(block)
      else if (block && typeof block === 'object') {
        const text = (block as { text?: unknown }).text
        if (typeof text === 'string') parts.push(text)
      }
    }
    return parts.join('')
  }
  return null
}

/** 从模型输出中提取工具调用（工具轨迹用，字段逐个校验）。 */
/**
 * 提取模型发起的工具调用。`reliable` 表示每个调用都带真实 id：
 * 只有可靠时才记录工具轨迹与待配对集合，否则回放会产生服务端拒绝的非法序列。
 */
function extractToolCalls(message: unknown): { calls: Array<{ id: string, name: string, args: string }>, reliable: boolean } | null {
  if (!message || typeof message !== 'object') return null
  const raw = (message as { tool_calls?: unknown }).tool_calls
  if (!Array.isArray(raw) || !raw.length) return null
  const calls: Array<{ id: string, name: string, args: string }> = []
  let reliable = true
  for (const item of raw) {
    if (!item || typeof item !== 'object') { reliable = false; continue }
    const call = item as { id?: unknown, name?: unknown, args?: unknown }
    const name = typeof call.name === 'string' ? call.name : ''
    if (!name) { reliable = false; continue }
    const hasId = typeof call.id === 'string' && call.id.length > 0
    if (!hasId) reliable = false
    const args = typeof call.args === 'string' ? call.args : JSON.stringify(call.args ?? {})
    calls.push({ id: hasId ? call.id as string : `call_${calls.length}`, name, args })
  }
  return calls.length ? { calls, reliable } : null
}

/** 五个业务模块 ID（模块占比兜底/归一化用）。 */
const MODULE_IDS: ModuleId[] = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']

/** 所有模块清零的占比映射。 */
function emptyModuleProportions(): Record<ModuleId, number> {
  return Object.fromEntries(MODULE_IDS.map(m => [m, 0])) as Record<ModuleId, number>
}

/** 从上一轮模块评分（可为空）播种占比：只保留合法模块并夹到 0~1。 */
function seedModuleProportions(last?: Record<ModuleId, number> | null): Record<ModuleId, number> {
  const out = emptyModuleProportions()
  if (last && typeof last === 'object') {
    for (const id of MODULE_IDS) {
      const v = last[id]
      if (typeof v === 'number' && Number.isFinite(v)) out[id] = Math.min(1, Math.max(0, Math.round(v * 100) / 100))
    }
  }
  return out
}

/** 从 module_route / recommend_assessment 的工具输出中读取路由到的模块与置信度。 */
function extractRoutedModule(output: unknown): { module: ModuleId; confidence?: number } | null {
  const text = renderToolMessageContent((output as { content?: unknown } | null)?.content ?? output)
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const rec = parsed as Record<string, unknown>
    if (typeof rec.module !== 'string' || !MODULE_IDS.includes(rec.module as ModuleId)) return null
    return {
      module: rec.module as ModuleId,
      confidence: typeof rec.confidence === 'number' && Number.isFinite(rec.confidence) ? rec.confidence : undefined
    }
  } catch {
    return null
  }
}

/** 运行期工具调用记录（供入口写 assistant_tool_called 事件与消息 metadata）。 */
function detectToolOutcome(output: unknown): 'success' | 'empty' | 'error' | 'timeout' {
  const text = renderToolMessageContent((output as { content?: unknown } | null)?.content ?? output)
  if (!text) return 'success'
  if (text.includes('工具执行超时')) return 'timeout'
  if (text.includes('工具执行失败')) return 'error'
  try { return toolOutcome(JSON.parse(text)) } catch { return 'success' }
}

/**
 * 运行「回答先行 Agent」图，返回最终答案、推荐卡与终止原因。
 *
 * 失败处理：本轮无任何产出时自动整轮重试（最多 AGENT_RETRY_TIMES 次）；重试仍无产出、
 * 或已向客户端发过内容后失败，一律返回 answer='' + exitReason='error'，由入口发 error 事件。
 * 不回退到其它提示词，也不生成兜底回答。
 * 特例：模型以空正文结束（或工具预算用尽）而本轮已经有工具结果时，先用已返回的事实补一次
 * 收尾回答（不绑定工具）——教师已经看到工具过程，直接报错等于白跑一轮；补答也空才报错。
 *
 * 终止语义：
 *  - done       正常结束且已有模型文本；
 *  - max_rounds 工具轮次达到上限（AI_AGENT_MAX_TOOL_ROUNDS，默认 8）或超过总时长，把已生成文本作为答案返回；
 *  - error      重试后仍无模型文本，或异常导致无产出。
 *
 * 运行期防护：
 *  - 同轮内相同 (工具, 参数) 的重复调用直接复用上次结果（省一次查询与一次模型往返）；
 *  - 单次工具执行有超时上限（AgentTool.timeoutMs，默认 10s），超时按工具失败回传模型自愈；
 *  - 重试时追加一条不落库的临时提示，要求模型直接产出回答（无反馈重试容易撞同一个坑）；
 *  - 模型往返记录结束原因（finish_reason）；以空正文结束的异常往返标记为 failed +
 *    empty_round:<finish_reason>，便于在 AI 中心区分上游中断（insufficient_system_resource）
 *    与正常结束的空回答；
 *  - 模块分诊与量表推荐结论冲突时以量表推荐为准，并把冲突号交给入口写产品事件。
 */
export async function runAgentGraph(event: H3Event, input: RunAgentGraphInput): Promise<RunAgentGraphResult> {
  const { messages, userCtx, systemPrompt, onEvent } = input
  const config = useRuntimeConfig(event)
  const totalTimeoutMs = Number(config.deepseekTimeoutMs) || 60_000
  const deadline = Date.now() + totalTimeoutMs
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(totalTimeoutMs)]) : AbortSignal.timeout(totalTimeoutMs)
  /** 轮次上限与工具启用清单：来自 AI_AGENT_MAX_TOOL_ROUNDS / AI_AGENT_ENABLED_TOOLS（AI 中心只读展示）。 */
  const maxToolRounds = Number(config.agentMaxToolRounds) || DEFAULT_MAX_TOOL_ROUNDS
  const enabledTools = typeof config.agentEnabledTools === 'string' && config.agentEnabledTools.trim()
    ? config.agentEnabledTools.split(',').map(name => name.trim()).filter(Boolean)
    : null
  let exitReason: AgentState['exitReason'] = null
  let answerText = ''
  let evidence: AnswerEvidence[] = []
  let attemptFailed = false
  let actionCards: ActionCard[] = []
  /** 工具/引用过程记录（用于展示：工具调用与知识库引用来源）。 */
  let contextEvents: Array<unknown> = []
  /** 工具调用记录（供持久化）：与 contextEvents 同步收集 */
  let toolCallRecords: Array<{ name: string; title: string; args: string; status?: 'success' | 'empty' | 'error' | 'timeout'; latencyMs?: number }> = []
  /** 本轮的模块分诊结论与量表推荐模块（用于一致性检查）。 */
  let routedModule: ModuleId | null = null
  let recommendedModule: ModuleId | null = null
  let toolConflicts: string[] = []
  /** 知识库引用来源（供持久化） */
  let sourceRecords: Array<{ chunkId: string; documentTitle: string; heading?: string | null; excerpt?: string; module?: string | null; libraryType?: string }> = []
  /** 模块评估占比：由 module_route / recommend_assessment 工具路由结果累加推导。 */
  let moduleProportions = seedModuleProportions(userCtx.lastModuleScores)
  /** 是否已向客户端发过内容类事件（回答增量/工具过程/卡片/引用）：发过即不再重试，避免重复展示 */
  let emittedContent = false
  /**
   * 每次模型往返的用量元数据。跨重试累计：重试同样产生计费调用，
   * 只记元数据不记正文，由入口写入 ai_model_calls。
   */
  const modelCallRecords: AgentModelCallRecord[] = []
  /** 本轮工具轨迹（P3）：每次尝试重置，只有产出回答的那次会被入口落库。 */
  let toolTraceRecords: AgentToolTraceStep[] = []

  // 未配置模型：不生成兜底回答，返回空答案由入口发 error 事件
  if (!config.deepseekApiKey) {
    console.error('[agent/graph] 未配置 DEEPSEEK_API_KEY，Agent 无法运行')
    return { answer: '', actionCards: [], exitReason: 'error', toolCalls: [], sources: [], modelCalls: [] }
  }

  /** 执行一轮 Agent：内部只抛异常、不做兜底；累计变量由外层按轮次重置。 */
  const runOnce = async (attempt: number): Promise<void> => {
    const llm = await createAgentLlm(event)
    const modelName = typeof llm.model === 'string' && llm.model ? llm.model : 'unknown'
    /** 本轮内每个模型调用的开始时间（run_id → 时间戳） */
    const modelCallStarts = new Map<string, number>()
    /** 本次尝试写入 modelCallRecords 的起始下标（记录跨尝试累计，收尾判断只看本次尝试） */
    const attemptRecordStart = modelCallRecords.length
    /** 最近一次模型往返是否发起了工具调用（用于识别「以空正文结束」的异常往返） */
    let lastRoundHadToolCalls = false
    /** 本轮内每个工具调用的开始时间与记录下标（run_id → …），用于回填耗时与状态 */
    const toolCallStarts = new Map<string, number>()
    const toolCallIndex = new Map<string, number>()
    /** 同轮重复调用缓存：相同 (工具, 参数) 直接复用上次结果 */
    const toolResultCache = new Map<string, string>()
    const agentTools = input.toolsForEvaluation ?? await loadAgentTools(userCtx, enabledTools)
    const tools = agentTools.map(def => toLangChainTool(def, { event, user: { ...userCtx, signal } }, toolResultCache))
    const agent = createReactAgent({ llm, tools })

    // system（代码基线 assistant_chat 模板 + 代码行为要点）
    // + 历史（只追加：由入口按 token 预算裁剪，这里不再做条数截断，只保留防御性上限）
    if (!systemPrompt.trim()) throw new Error('系统提示词未提供（assistant_chat 正文缺失）')
    const systemText = systemPrompt.trim()
    if (messages.length > MAX_HISTORY_MESSAGES) {
      console.warn(`[agent/graph] 历史消息 ${messages.length} 条超过防御上限 ${MAX_HISTORY_MESSAGES}，本轮截断（入口的 token 预算应已裁剪）`)
    }
    const historyMessages: BaseMessage[] = []
    for (const item of sanitizeHistoryForSummary(messages.slice(-MAX_HISTORY_MESSAGES))) {
      if (item.role === 'user') {
        historyMessages.push(new HumanMessage(item.content))
        // P3：把上一轮的工具轨迹按原顺序回放，使上一轮的请求序列成为本轮的前缀
        const trace = (item as AgentMessage).toolTrace
        if (trace?.length) historyMessages.push(...traceToLangChainMessages(trace))
        continue
      }
      historyMessages.push(new AIMessage(item.content))
    }
    const langMessages: BaseMessage[] = [new SystemMessage(systemText), ...historyMessages]
    // 带反馈重试：上一次尝试没有任何产出，追加一条只作用于本次尝试的提示（不落库、不进历史、不改变下一轮前缀）
    if (attempt > 0) {
      langMessages.push(new HumanMessage('（系统提示）上一轮没有产出任何回答内容。请直接给出本轮回答；需要资料时先调用工具，但不要重复发起相同的查询。'))
    }

    onEvent(AGENT_SSE_EVENTS.THINKING, { phase: 'planning' })
    /**
     * 收尾补答：模型没有产出正文时（工具预算用尽、或模型直接以空正文结束整轮），
     * 用本轮已返回的工具结果再要一次回答——不绑定工具，只让它依据既有事实作答。
     * 成败都记一条模型往返（含结束原因），失败不抛错：交给外层按既有重试/报错逻辑处理。
     */
    const finalizeFromGatheredFacts = async (
      instruction: string,
      source: 'budget_exhausted' | 'empty_answer'
    ): Promise<void> => {
      signal.throwIfAborted()
      const startedAt = Date.now()
      const final = await llm.invoke([
        ...langMessages, ...traceToLangChainMessages(toolTraceRecords),
        new HumanMessage(instruction)
      ], { signal })
      const finishReason = String(final.response_metadata?.finish_reason ?? '')
      if (finishReason === 'length' || finishReason === 'content_filter') throw new Error('模型回答未完整结束')
      const content = renderToolMessageContent(final.content)
      const text = content?.trim() ?? ''
      modelCallRecords.push({
        model: modelName,
        status: text ? 'success' : 'failed',
        latencyMs: Date.now() - startedAt,
        ...(finishReason ? { finishReason } : {}),
        ...(text ? {} : { errorCode: `${source}:${finishReason || 'unknown'}` }),
        ...(readUsageMetadata(final) ?? {})
      })
      if (!text) return
      answerText += content
      onEvent(AGENT_SSE_EVENTS.ANSWER_DELTA, { text: content })
      exitReason = 'done'
    }
    const stream = await agent.streamEvents(
      { messages: langMessages },
      { version: 'v2', recursionLimit: maxToolRounds * 2 + 6, signal }
    )
    let toolRounds = 0
    const activeTools = new Set<string>()
    const pendingToolCalls = new Set<string>()
    let finishWithoutTools = false
    for await (const rawChunk of stream) {
      if (!isStreamChunk(rawChunk)) continue
      signal.throwIfAborted()
      if (Date.now() >= deadline) throw new Error('Agent timeout')
      if (rawChunk.event === 'on_tool_start') {
        toolRounds += 1
        activeTools.add(rawChunk.run_id ?? rawChunk.name ?? 'tool')
        const toolName = rawChunk.name ?? 'tool'
        const toolCall = { name: toolName, title: TOOL_TITLES[toolName] || toolName, args: truncate(stringify(rawChunk.data.input), 300) }
        contextEvents.push(toolCall)
        toolCallRecords.push(toolCall)
        if (rawChunk.run_id) {
          toolCallStarts.set(rawChunk.run_id, Date.now())
          toolCallIndex.set(rawChunk.run_id, toolCallRecords.length - 1)
        }
        emittedContent = true
        onEvent(AGENT_SSE_EVENTS.THINKING, { phase: 'tool', name: toolName, title: TOOL_TITLES[toolName] || toolName })
        onEvent(AGENT_SSE_EVENTS.TOOL_CALL, contextEvents[contextEvents.length - 1])
        continue
      }
      if (rawChunk.event === 'on_tool_end') {
        const output = rawChunk.data.output
        activeTools.delete(rawChunk.run_id ?? rawChunk.name ?? 'tool')
        evidence.push(...collectToolEvidence(rawChunk.name ?? '', output))
        const card = extractActionCard(output)
        if (card && actionCards.length < 2 && !actionCards.some(existing => JSON.stringify(existing) === JSON.stringify(card))) {
          actionCards.push(card)
          onEvent(AGENT_SSE_EVENTS.ACTION_CARD, card)
        }
        const rawTool = renderToolMessageContent((output as { content?: unknown } | null)?.content ?? output)
        if (rawTool && actionCards.length < 2) {
          try {
            const extra = JSON.parse(rawTool).actionCards
            if (Array.isArray(extra)) for (const candidate of extra) {
              if (actionCards.length >= 2) break
              if (isActionCard(candidate) && !actionCards.some(existing => JSON.stringify(existing) === JSON.stringify(candidate))) {
                actionCards.push(candidate); onEvent(AGENT_SSE_EVENTS.ACTION_CARD, candidate)
              }
            }
          } catch { /* 非卡片结果 */ }
        }
        // 工具调用耗时与状态回填（供入口写 assistant_tool_called 产品事件）
        const toolRunId = rawChunk.run_id
        const recordIndex = toolRunId ? toolCallIndex.get(toolRunId) : undefined
        if (recordIndex !== undefined && toolCallRecords[recordIndex]) {
          const startedAt = toolRunId ? toolCallStarts.get(toolRunId) : undefined
          toolCallRecords[recordIndex]!.latencyMs = startedAt ? Math.max(0, Date.now() - startedAt) : 0
          toolCallRecords[recordIndex]!.status = detectToolOutcome(output)
        }
        // 模块分诊：从 module_route / recommend_assessment 输出中累加路由到的模块占比
        const toolName = rawChunk.name ?? ''
        if (toolName === 'module_route' || toolName === 'recommend_assessment') {
          const routed = extractRoutedModule(output)
          if (routed) {
            // 该工具推荐置信度（recommend_assessment 无置信度，默认按最高路由此判定）
            const score = routed.confidence != null ? Math.min(1, Math.max(0, routed.confidence)) : 0.75
            moduleProportions[routed.module] = Math.max(moduleProportions[routed.module], score)
            if (toolName === 'module_route') routedModule = routed.module
            else recommendedModule = routed.module
          }
        }
        // 知识库检索：把命中片段作为引用来源推送给前端（来源标签）
        const sourceItems = toolName === 'knowledge_search' ? extractKnowledgeSources(output) : []
        if (sourceItems.length) {
          contextEvents.push({ name: 'sources', title: '知识库引用', items: sourceItems })
          sourceRecords.push(...sourceItems)
          onEvent('sources', { items: sourceItems })
        }
        onEvent(AGENT_SSE_EVENTS.TOOL_RESULT, { name: toolName, result: truncate(stringify(output), 500) })
        // P3：工具返回进入轨迹（按模型当时看到的完整内容回放，展示用的截断不影响落库）
        const toolCallId = (output as { tool_call_id?: unknown } | null)?.tool_call_id
        if (typeof toolCallId === 'string' && toolCallId) {
          pendingToolCalls.delete(toolCallId)
          toolTraceRecords.push({
            type: 'tool',
            content: renderToolMessageContent((output as { content?: unknown } | null)?.content) ?? stringify(output),
            toolCallId
          })
        }
        emittedContent = true
        if (toolRounds >= maxToolRounds && activeTools.size === 0 && pendingToolCalls.size === 0) { finishWithoutTools = true; break }
        continue
      }
      if (rawChunk.event === 'on_chat_model_start') {
        if (rawChunk.run_id) modelCallStarts.set(rawChunk.run_id, Date.now())
        continue
      }
      if (rawChunk.event === 'on_chat_model_end') {
        const modelOutput = rawChunk.data.output
        const finishReason = (modelOutput as { response_metadata?: { finish_reason?: string } } | undefined)?.response_metadata?.finish_reason
        if (finishReason === 'length' || finishReason === 'content_filter') throw new Error('模型回答未完整结束')
        const usage = readUsageMetadata(modelOutput)
        const startedAt = rawChunk.run_id ? modelCallStarts.get(rawChunk.run_id) : undefined
        // P3：模型发起的工具调用进入轨迹（含 id，用于与工具返回配对）；
        // 调用没有真实 id 时不记录工具轨迹，避免回放出现无法配对的 tool_calls 序列
        const extracted = extractToolCalls(modelOutput)
        lastRoundHadToolCalls = Boolean(extracted)
        modelCallRecords.push({
          model: modelName,
          status: 'success',
          latencyMs: startedAt ? Math.max(0, Date.now() - startedAt) : 0,
          ...(finishReason ? { finishReason: String(finishReason) } : {}),
          ...(usage || {})
        })
        if (extracted) {
          const text = renderToolMessageContent((modelOutput as { content?: unknown } | null)?.content) ?? ''
          if (extracted.reliable) {
            for (const call of extracted.calls) pendingToolCalls.add(call.id)
            toolTraceRecords.push({ type: 'assistant', content: text, toolCalls: extracted.calls })
          } else if (text.trim()) {
            toolTraceRecords.push({ type: 'assistant', content: text })
          }
        }
        continue
      }
      if (rawChunk.event === 'on_chat_model_error') {
        const startedAt = rawChunk.run_id ? modelCallStarts.get(rawChunk.run_id) : undefined
        modelCallRecords.push({
          model: modelName,
          status: 'failed',
          latencyMs: startedAt ? Math.max(0, Date.now() - startedAt) : 0,
          errorCode: 'model_error'
        })
        continue
      }
      if (rawChunk.event === 'on_chat_model_stream') {
        const text = extractStreamedText(rawChunk)
        if (text) {
          answerText += text
          emittedContent = true
          onEvent(AGENT_SSE_EVENTS.ANSWER_DELTA, { text })
        }
      }
    }
    if (finishWithoutTools) {
      await finalizeFromGatheredFacts(
        '工具查询预算已用完。请依据已返回的事实完整回答，说明尚缺的信息；不要声称查询未获得的结论。',
        'budget_exhausted'
      )
      return
    }
    // 模型以空正文结束：没有任何文本产出，也没有再发起工具调用。
    // 先把这次异常往返标记进审计（教师已看到工具过程，重试会重复展示，所以不整轮重试），
    // 再用本轮已返回的工具结果补一次收尾回答；补答也空则由入口按既有逻辑发 error 事件。
    if (!answerText.trim()) {
      const lastRecord = modelCallRecords.length > attemptRecordStart ? modelCallRecords[modelCallRecords.length - 1] : undefined
      if (!lastRoundHadToolCalls && lastRecord && lastRecord.status === 'success') {
        lastRecord.status = 'failed'
        lastRecord.errorCode = `empty_round:${lastRecord.finishReason || 'unknown'}`
      }
      if (toolTraceRecords.some(step => step.type === 'tool')) {
        await finalizeFromGatheredFacts(
          '上一轮没有产出回答正文。请依据上面已返回的事实直接给出本轮回答，说明尚缺的信息；不要重复调用工具，也不要声称查询未获得的结论。',
          'empty_answer'
        )
      }
    }
  }

  for (let attempt = 0; attempt <= AGENT_RETRY_TIMES; attempt += 1) {
    // 每次尝试重置累计，避免重试导致卡片/工具过程/引用重复
    actionCards = []
    contextEvents = []
    toolCallRecords = []
    sourceRecords = []
    toolTraceRecords = []
    routedModule = null
    recommendedModule = null
    toolConflicts = []
    moduleProportions = seedModuleProportions(userCtx.lastModuleScores)
    answerText = ''
    evidence = []
    attemptFailed = false
    exitReason = null
    emittedContent = false
    try {
      await runOnce(attempt)
    } catch (error) {
      attemptFailed = true
      answerText = ''
      exitReason = 'error'
      console.error(`[agent/graph] runAgentGraph 第 ${attempt + 1} 次尝试失败:`, error instanceof Error ? error.message : error)
    }
    // 模块一致性检查：分诊结论与量表推荐模块不一致时以量表推荐为准，冲突交入口留痕
    if (routedModule && recommendedModule && routedModule !== recommendedModule) {
      toolConflicts.push(`module_route:${routedModule}->recommend_assessment:${recommendedModule}`)
      console.warn(`[agent/graph] 工具判定冲突：分诊=${routedModule}，量表推荐=${recommendedModule}，以量表推荐为准`)
    }
    // 已产出文本、已向客户端发过内容、或已到轮次/时长上限：不再重试
    if (answerText.trim() && !attemptFailed) break
    if (signal.aborted) break
    if (emittedContent) break

    if (attempt < AGENT_RETRY_TIMES) {
      console.warn(`[agent/graph] 本轮无回答产出，自动重试（第 ${attempt + 2} 次）`)
    }
  }

  // 重试后仍无产出：不回退到其它提示词，返回空答案由入口发 error 事件
  if (!answerText.trim()) {
    return { answer: '', actionCards: [], exitReason: 'error', toolCalls: toolCallRecords, sources: [], modelCalls: modelCallRecords, toolTrace: [], toolConflicts }
  }
  if (exitReason === null) exitReason = 'done'

  // 有路由判定时，把最终模块评估占比以共享事件推给前端（供「模块评估占比」面板展示）
  const hasProportion = Object.values(moduleProportions).some(v => v > 0)
  if (hasProportion) {
    onEvent(AGENT_SSE_EVENTS.MODULE_PROPORTIONS, { moduleProportions })
  }

  return {
    answer: answerText.trim(), evidence, actionCards, exitReason,
    toolCalls: toolCallRecords, sources: sourceRecords,
    moduleProportions: hasProportion ? moduleProportions : undefined,
    modelCalls: modelCallRecords,
    toolTrace: repairToolTrace(toolTraceRecords),
    toolConflicts: toolConflicts.length ? toolConflicts : undefined
  }
}
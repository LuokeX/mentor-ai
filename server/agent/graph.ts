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
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { ActionCard, AgentMessage, AgentState, AgentTool, AgentToolContext, AgentUserContext } from './types'
import { AGENT_SSE_EVENTS } from './types'
import { getAiRuntimeConfig } from '../domain/ai-config'
import { sanitizeHistoryForSummary } from '../domain/chat-clarification'
import { createAgentLlm } from '../integrations/models'
import { buildAgentTools } from './tools/index'
import type { ModuleId } from '../../shared/contracts'

/** 模型/工具默认轮次上限（P0 默认 6 轮）。 */
const MAX_TOOL_ROUNDS = 6

/** 模型结束后仍无可用文本时的兜底回答。 */
const FALLBACK_ANSWER = '抱歉，暂时没能生成合适的回答。您可以换个说法再描述一次，或先进入对应模块查看可用的评估量表。'

export interface RunAgentGraphInput {
  /** 对话消息（含本轮用户输入），入口组装。 */
  messages: AgentMessage[]
  /** 教师上下文（业务对象/记忆/画像），guard 装载后传入。 */
  userCtx: AgentUserContext
  /** system prompt（AGENT-C 提供 renderPrompt 结果），本图只追加行为附加说明。 */
  systemPrompt: string
  /** SSE 事件采集器：转发给入口（入口再转发给前端）。 */
  onEvent: (event: string, data: unknown) => void
}

export interface RunAgentGraphResult {
  answer: string
  actionCards: ActionCard[]
  exitReason: AgentState['exitReason']
  fallbackUsed: boolean
  /** 本轮工具调用过程（供入口持久化到消息 metadata，切换会话后仍可展示） */
  toolCalls?: Array<{ name: string; title: string; args: string }>
  /** 本轮知识库引用来源（供入口持久化到消息 metadata） */
  sources?: Array<{ chunkId: string; documentTitle: string; heading?: string | null; excerpt?: string; module?: string | null; libraryType?: string }>
  /** 模块评估占比（0~1）。由 module_route / recommend_assessment 工具最终路由结果推导，供前端「模块评估占比」面板展示。 */
  moduleProportions?: Record<ModuleId, number>
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

/** 契约只保证 schema 是 zod schema；DynamicStructuredTool 泛型约束随 @langchain/core 版本变化，经 unknown 透传。 */
function toLangChainTool(def: AgentTool, ctx: AgentToolContext): DynamicStructuredTool {
  const input = {
    name: def.name,
    description: def.description,
    schema: def.schema,
    func: async (args: unknown) => {
      try {
        const result = await def.execute(args, ctx)
        return typeof result === 'string' ? result : JSON.stringify(result)
      } catch (error) {
        // 工具执行失败回传模型自愈（文本描述错误），不中断整个 agent 运行
        console.error(`[agent/graph] 工具 ${def.name} 执行失败:`, error instanceof Error ? error.message : error)
        return JSON.stringify({ error: '工具执行失败', message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' })
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
  entity_memory: '实体记忆'
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
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, 5).map(item => {
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
function isStreamChunk(value: unknown): value is { event: string; name?: string; data: Record<string, unknown> } {
  if (!value || typeof value !== 'object') return false
  const chunk = value as { event?: unknown; name?: unknown; data?: unknown }
  if (typeof chunk.event !== 'string') return false
  if (chunk.name !== undefined && typeof chunk.name !== 'string') return false
  if (chunk.data === undefined || chunk.data === null || typeof chunk.data !== 'object') return false
  return true
}

/** 从 on_chat_model_stream 的 AIMessageChunk 中提取纯文本（兼容 string 与 content block 数组两种形态）。 */
function extractStreamedText(chunk: { data: Record<string, unknown> }): string {
  const modelChunk = chunk.data.chunk
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

/**
 * 运行「回答先行 Agent」图，返回最终答案、推荐卡与终止原因。
 *
 * 终止语义：
 *  - done       正常结束且已有模型文本；
 *  - max_rounds 工具轮次达到上限（默认 6）或超过总时长（DB 运行时配置或 60s），
 *               把已生成文本作为答案返回；
 *  - fallback   无模型文本（含未配置 DeepSeek），返回内置兜底文本；
 *  - error      任何异常，fallbackUsed=true、answer 为空，由 AGENT-C 决定回退或提示。
 */
export async function runAgentGraph(event: H3Event, input: RunAgentGraphInput): Promise<RunAgentGraphResult> {
  const { messages, userCtx, systemPrompt, onEvent } = input
  const config = useRuntimeConfig(event)
  const rt = await getAiRuntimeConfig(event)
  const totalTimeoutMs = rt.timeoutMs ?? 60_000
  // Agent 运行参数：后台 AI 中心运行时配置优先；行为要点不再有代码默认值，未配置即不追加
  const maxToolRounds = rt.agentMaxRounds ?? MAX_TOOL_ROUNDS
  const behaviorNotes = rt.agentBehaviorNotes?.trim() || ''
  const temperature = rt.agentTemperature ?? undefined
  const actionCards: ActionCard[] = []
  /** 工具/引用过程记录（用于展示：工具调用与知识库引用来源）。 */
  const contextEvents: Array<unknown> = []
  /** 工具调用记录（供持久化）：与 contextEvents 同步收集 */
  const toolCallRecords: Array<{ name: string; title: string; args: string }> = []
  /** 知识库引用来源（供持久化） */
  const sourceRecords: Array<{ chunkId: string; documentTitle: string; heading?: string | null; excerpt?: string; module?: string | null; libraryType?: string }> = []
  /** 模块评估占比：由 module_route / recommend_assessment 工具路由结果累加推导。 */
  const moduleProportions = seedModuleProportions(userCtx.lastModuleScores)

  // 未接入模型：直接返回本地兜底文本（由入口补发 answer_start 后整体推送）
  if (!config.deepseekApiKey) {
    onEvent(AGENT_SSE_EVENTS.ANSWER_DELTA, { text: FALLBACK_ANSWER })
    return { answer: FALLBACK_ANSWER, actionCards, exitReason: 'fallback', fallbackUsed: true }
  }

  let exitReason: AgentState['exitReason'] = null
  let answerText = ''
  let fallbackUsed = false
  const deadline = Date.now() + totalTimeoutMs
  try {
    const llm = await createAgentLlm(event, { temperature })
    const agentTools = await loadAgentTools(userCtx, rt.agentTools)
    const tools = agentTools.map(def => toLangChainTool(def, { event, user: userCtx }))
    const agent = createReactAgent({ llm, tools })

    // system（AI 中心 assistant_chat 模板 + 行为附加说明）+ 历史（sanitize 后截断，避免“选项：”列表被模型模仿）
    if (!systemPrompt.trim()) throw new Error('系统提示词未提供（assistant_chat 未配置或未发布）')
    const systemText = [systemPrompt.trim(), behaviorNotes].filter(Boolean).join('\n\n')
    const historyMessages: BaseMessage[] = sanitizeHistoryForSummary(messages)
      .slice(-12)
      .map(item => (item.role === 'user' ? new HumanMessage(item.content) : new AIMessage(item.content)))
    const langMessages: BaseMessage[] = [new SystemMessage(systemText), ...historyMessages]

    onEvent(AGENT_SSE_EVENTS.THINKING, { phase: 'planning' })
    const stream = await agent.streamEvents(
      { messages: langMessages },
      { version: 'v2', recursionLimit: maxToolRounds + 4 }
    )
    let toolRounds = 0
    for await (const rawChunk of stream) {
      if (!isStreamChunk(rawChunk)) continue
      // 轮次/总时长上限：把已生成文本作为答案返回
      if (toolRounds >= maxToolRounds || Date.now() >= deadline) {
        exitReason = 'max_rounds'
        break
      }
      if (rawChunk.event === 'on_tool_start') {
        toolRounds += 1
        const toolName = rawChunk.name ?? 'tool'
        const toolCall = { name: toolName, title: TOOL_TITLES[toolName] || toolName, args: truncate(stringify(rawChunk.data.input), 300) }
        contextEvents.push(toolCall)
        toolCallRecords.push(toolCall)
        onEvent(AGENT_SSE_EVENTS.THINKING, { phase: 'tool', name: toolName, title: TOOL_TITLES[toolName] || toolName })
        onEvent(AGENT_SSE_EVENTS.TOOL_CALL, contextEvents[contextEvents.length - 1])
        continue
      }
      if (rawChunk.event === 'on_tool_end') {
        const output = rawChunk.data.output
        const card = extractActionCard(output)
        if (card) {
          actionCards.push(card)
          onEvent(AGENT_SSE_EVENTS.ACTION_CARD, card)
        }
        // 模块分诊：从 module_route / recommend_assessment 输出中累加路由到的模块占比
        const toolName = rawChunk.name ?? ''
        if (toolName === 'module_route' || toolName === 'recommend_assessment') {
          const routed = extractRoutedModule(output)
          if (routed) {
            // 该工具推荐置信度（recommend_assessment 无置信度，默认按最高路由此判定）
            const score = routed.confidence != null ? Math.min(1, Math.max(0, routed.confidence)) : 0.75
            moduleProportions[routed.module] = Math.max(moduleProportions[routed.module], score)
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
        continue
      }
      if (rawChunk.event === 'on_chat_model_stream') {
        const text = extractStreamedText(rawChunk)
        if (text) {
          answerText += text
          onEvent(AGENT_SSE_EVENTS.ANSWER_DELTA, { text })
        }
      }
    }

    // 结束收尾：有文本 → done（max_rounds 保留已生成文本）；无文本 → 兜底文本
    if (!answerText.trim()) {
      fallbackUsed = true
      answerText = FALLBACK_ANSWER
      onEvent(AGENT_SSE_EVENTS.ANSWER_DELTA, { text: FALLBACK_ANSWER })
      if (exitReason !== 'max_rounds') exitReason = 'fallback'
    } else if (exitReason === null) {
      exitReason = 'done'
    }

    // 有路由判定时，把最终模块评估占比以共享事件推给前端（供「模块评估占比」面板展示）
    const hasProportion = Object.values(moduleProportions).some(v => v > 0)
    if (hasProportion) {
      onEvent(AGENT_SSE_EVENTS.MODULE_PROPORTIONS, { moduleProportions })
    }

    return {
      answer: answerText.trim(), actionCards, exitReason, fallbackUsed,
      toolCalls: toolCallRecords, sources: sourceRecords,
      moduleProportions: hasProportion ? moduleProportions : undefined
    }
  } catch (error) {
    console.error('[agent/graph] runAgentGraph 失败:', error instanceof Error ? error.message : error)
    return { answer: '', actionCards, exitReason: 'error', fallbackUsed: true }
  }
}
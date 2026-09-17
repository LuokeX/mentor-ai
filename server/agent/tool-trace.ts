/**
 * 工具轨迹序列化（P3）。
 *
 * 背景：模型在一轮里调用工具时，实际看到的序列是
 *   教师提问 → AI(tool_calls) → Tool(结果) → … → AI(最终回答)
 * 而回放历史时只存了「教师提问 + 最终回答」，于是下一轮的请求前缀在工具调用处与
 * 上一轮分叉，缓存只能命中分叉点之前的部分。把工具轨迹加密保存并在下一轮原样回放，
 * 可把分叉点推到最后一轮末尾，恢复「上一轮是这一轮前缀」的不变量。
 *
 * 安全与体积约束：
 *  - 轨迹正文含业务数据，必须加密落库（tool_trace_enc），且只回放最近一轮；
 *  - 不保存思维链（reasoning_content）：实测回放不带它也能被服务端接受；
 *  - 超过体积/步数上限的轨迹标记为不完整，直接丢弃，不回放；
 *  - 回放前必须修复配对（见 repairToolTrace）：assistant 的 tool_calls 必须有紧随其后、
 *    按 id 一一对应的工具结果，否则服务端直接拒绝整轮请求（INVALID_TOOL_RESULTS）。
 *    修复发生在落库前与回放前两处，历史数据无需迁移。
 */
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { AgentToolTraceStep } from '../agent/types'

/** 轨迹格式版本：结构变化时递增，旧版本解析失败会被静默忽略。 */
export const TOOL_TRACE_VERSION = 1

/** 轨迹上限：步数与总字符数（防止把长轨迹反复塞进每轮提示词）。 */
export const TOOL_TRACE_MAX_STEPS = 24
export const TOOL_TRACE_MAX_CHARS = 20000

export interface SerializedToolTrace {
  version: number
  steps: AgentToolTraceStep[]
}

/**
 * 序列化轨迹：超出上限、为空或没有任何可回放内容时返回 null（表示不落库、不回放）。
 * 落库前先修复配对，避免把非法序列存下来、下一轮回放时被服务端拒绝。
 * 结果用于 encryptSensitive 落库。
 */
export function serializeToolTrace(steps: AgentToolTraceStep[] | undefined | null): string | null {
  const replayable = repairToolTrace(steps)
  if (!replayable.length) return null
  if (replayable.length > TOOL_TRACE_MAX_STEPS) return null
  const chars = replayable.reduce((sum, step) => (
    sum + step.content.length + (step.toolCalls?.reduce((inner, call) => inner + call.args.length + call.name.length, 0) ?? 0)
  ), 0)
  if (chars > TOOL_TRACE_MAX_CHARS) return null
  const payload: SerializedToolTrace = { version: TOOL_TRACE_VERSION, steps: replayable }
  return JSON.stringify(payload)
}

/** 解析轨迹：版本不符或结构不合法时返回 null（调用点按「不回放」处理）。 */
export function parseToolTrace(text: string | null | undefined): AgentToolTraceStep[] | null {
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const payload = parsed as { version?: unknown, steps?: unknown }
  if (payload.version !== TOOL_TRACE_VERSION || !Array.isArray(payload.steps)) return null
  const steps: AgentToolTraceStep[] = []
  for (const raw of payload.steps) {
    if (!raw || typeof raw !== 'object') return null
    const step = raw as { type?: unknown, content?: unknown, toolCalls?: unknown, toolCallId?: unknown }
    if (step.type !== 'assistant' && step.type !== 'tool') return null
    if (typeof step.content !== 'string') return null
    if (step.type === 'assistant') {
      const calls: Array<{ id: string, name: string, args: string }> = []
      if (step.toolCalls !== undefined) {
        if (!Array.isArray(step.toolCalls)) return null
        for (const rawCall of step.toolCalls) {
          if (!rawCall || typeof rawCall !== 'object') return null
          const call = rawCall as { id?: unknown, name?: unknown, args?: unknown }
          if (typeof call.id !== 'string' || typeof call.name !== 'string' || typeof call.args !== 'string') return null
          calls.push({ id: call.id, name: call.name, args: call.args })
        }
      }
      steps.push(calls.length ? { type: 'assistant', content: step.content, toolCalls: calls } : { type: 'assistant', content: step.content })
    } else {
      if (typeof step.toolCallId !== 'string') return null
      steps.push({ type: 'tool', content: step.content, toolCallId: step.toolCallId })
    }
  }
  return steps.length ? steps : null
}

/**
 * 把轨迹挂到它所属的教师提问上（轨迹发生在该提问之后、最终回答之前）。
 * 传入的消息按时间正序；assistant 消息若带轨迹，则挂到它前面最近的一条 user 消息。
 * 返回新数组，不修改入参。
 */
export function attachToolTraces(
  messages: Array<{ role: 'user' | 'assistant', content: string, id?: string, createdAt?: string, toolTrace?: AgentToolTraceStep[] }>
): Array<{ role: 'user' | 'assistant', content: string, id?: string, createdAt?: string, toolTrace?: AgentToolTraceStep[] }> {
  const result = messages.map(message => ({ ...message }))
  for (let index = 0; index < result.length; index += 1) {
    const message = result[index]!
    if (message.role !== 'assistant' || !message.toolTrace?.length) continue
    for (let back = index - 1; back >= 0; back -= 1) {
      const candidate = result[back]!
      if (candidate.role === 'user') {
        candidate.toolTrace = message.toolTrace
        break
      }
    }
    delete message.toolTrace
  }
  return result
}

/** 参数 JSON 还原：模型给出的 arguments 必须是对象，非法 JSON 回退空对象。 */
function safeParseArgs(args: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(args)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/**
 * 修复轨迹配对：OpenAI 兼容接口要求每个 assistant 的 tool_calls 都有紧随其后、
 * 按 tool_call_id 一一对应的 tool 结果，否则整轮请求被服务端以 400 拒绝
 * （INVALID_TOOL_RESULTS，实测见 2026-09-16 真实模型评测）。
 *
 * 轨迹本身可能不完整：工具结果缺少 tool_call_id 时该步不会被记录，模型没给出调用 id
 * 时调用也无法配对。因此回放前统一：
 *  - 丢弃无法被完整回应的 assistant 工具调用步骤（连同其孤立工具结果）；
 *  - 丢弃没有对应 assistant 调用的孤立 tool 步骤。
 * 返回新数组，不修改入参；返回空数组表示这段轨迹没有任何可回放的内容。
 */
export function repairToolTrace(steps: AgentToolTraceStep[] | undefined | null): AgentToolTraceStep[] {
  const list = steps ?? []
  const repaired: AgentToolTraceStep[] = []
  for (let index = 0; index < list.length; index += 1) {
    const step = list[index]!
    // 孤立 tool 步骤：它的 assistant 调用已被丢弃（或从未记录），跳过
    if (step.type !== 'assistant') continue
    if (!step.toolCalls?.length) {
      repaired.push({ type: 'assistant', content: step.content })
      continue
    }
    const claimed = new Map<string, AgentToolTraceStep>()
    let cursor = index + 1
    while (cursor < list.length && list[cursor]!.type === 'tool') {
      const tool = list[cursor]!
      if (tool.toolCallId && !claimed.has(tool.toolCallId)) claimed.set(tool.toolCallId, tool)
      cursor += 1
    }
    const calls = step.toolCalls.filter(call => claimed.has(call.id))
    if (!calls.length) {
      index = cursor - 1
      continue
    }
    repaired.push({ type: 'assistant', content: step.content, toolCalls: calls })
    for (const call of calls) repaired.push(claimed.get(call.id)!)
    index = cursor - 1
  }
  return repaired
}

/**
 * 轨迹 → LangChain 消息（回放用）。先修复配对，保证序列对 OpenAI 兼容接口始终合法。
 */
export function traceToLangChainMessages(steps: AgentToolTraceStep[]): BaseMessage[] {
  const messages: BaseMessage[] = []
  for (const step of repairToolTrace(steps)) {
    if (step.type === 'assistant') {
      messages.push(new AIMessage({
        content: step.content,
        tool_calls: (step.toolCalls ?? []).map(call => ({
          name: call.name,
          id: call.id,
          type: 'tool_call' as const,
          args: safeParseArgs(call.args)
        }))
      }))
      continue
    }
    if (step.toolCallId) {
      messages.push(new ToolMessage({ content: step.content, tool_call_id: step.toolCallId }))
    }
  }
  return messages
}

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { streamEvents } = vi.hoisted(() => ({ streamEvents: vi.fn() }))

vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: () => ({ streamEvents })
}))
vi.mock('../server/integrations/models', () => ({
  createAgentLlm: vi.fn(async () => ({}))
}))
vi.mock('../server/agent/tools/index', () => ({
  buildAgentTools: vi.fn(async () => [])
}))

import { runAgentGraph } from '../server/agent/graph'
import { attachToolTraces, parseToolTrace, serializeToolTrace, TOOL_TRACE_MAX_CHARS, TOOL_TRACE_MAX_STEPS, TOOL_TRACE_VERSION } from '../server/agent/tool-trace'
import type { AgentMessage, AgentToolTraceStep } from '../server/agent/types'

async function* chunks(items: unknown[]): AsyncGenerator<unknown> {
  for (const item of items) yield item
}

function textChunk(text: string) {
  return { event: 'on_chat_model_stream', data: { chunk: { content: text } } }
}

const messages: AgentMessage[] = [{ role: 'user', content: '这个孩子最近怎么样？' }]

function invoke(history: AgentMessage[] = messages) {
  return runAgentGraph({} as never, {
    messages: history,
    userCtx: { schoolId: 'school-1', userId: 'user-1', sessionId: 'session-1' },
    systemPrompt: 'system prompt',
    onEvent: () => {}
  })
}

describe('工具轨迹序列化', () => {
  const steps: AgentToolTraceStep[] = [
    { type: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'record_snapshot', args: '{}' }] },
    { type: 'tool', content: '{"label":"合成档案"}', toolCallId: 'call_1' }
  ]

  it('序列化后能原样解析，且带版本号', () => {
    const serialized = serializeToolTrace(steps)!
    expect(serialized).toBeTruthy()
    const parsed = JSON.parse(serialized) as { version: number }
    expect(parsed.version).toBe(TOOL_TRACE_VERSION)
    expect(parseToolTrace(serialized)).toEqual(steps)
  })

  it('空轨迹与超限轨迹返回 null（不落库、不回放）', () => {
    expect(serializeToolTrace([])).toBeNull()
    expect(serializeToolTrace(undefined)).toBeNull()
    const manySteps: AgentToolTraceStep[] = Array.from({ length: TOOL_TRACE_MAX_STEPS + 1 }, (_, index) => ({
      type: 'tool' as const, content: 'x', toolCallId: `call_${index}`
    }))
    expect(serializeToolTrace(manySteps)).toBeNull()
    const hugeSteps: AgentToolTraceStep[] = [{ type: 'tool', content: 'x'.repeat(TOOL_TRACE_MAX_CHARS + 1), toolCallId: 'call_1' }]
    expect(serializeToolTrace(hugeSteps)).toBeNull()
  })

  it('版本不符或结构非法时解析返回 null（静默降级为不回放）', () => {
    expect(parseToolTrace(null)).toBeNull()
    expect(parseToolTrace('not json')).toBeNull()
    expect(parseToolTrace(JSON.stringify({ version: TOOL_TRACE_VERSION + 1, steps }))).toBeNull()
    expect(parseToolTrace(JSON.stringify({ version: TOOL_TRACE_VERSION, steps: [{ type: 'tool', content: 1 }] }))).toBeNull()
  })

  it('轨迹挂到所属教师提问上，且不修改原数组', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答', toolTrace: steps },
      { role: 'user', content: '第二问' },
      { role: 'assistant', content: '第二答' }
    ]
    const attached = attachToolTraces(history)
    expect(attached[0]!.toolTrace).toEqual(steps)
    expect(attached[1]!.toolTrace).toBeUndefined()
    // 原数组保持不变
    expect(history[0]!.toolTrace).toBeUndefined()
    expect(history[1]!.toolTrace).toEqual(steps)
  })
})

describe('runAgentGraph 工具轨迹采集与回放', () => {
  beforeEach(() => {
    streamEvents.mockReset()
    vi.stubGlobal('useRuntimeConfig', () => ({ deepseekApiKey: 'test-key', deepseekTimeoutMs: 5000 }))
  })

  it('采集模型发起的工具调用与工具返回，并在下一轮按原顺序回放', async () => {
    streamEvents.mockImplementationOnce(() => chunks([
      {
        event: 'on_chat_model_end',
        data: { output: { content: '', tool_calls: [{ id: 'call_1', name: 'record_snapshot', args: {} }] } }
      },
      {
        event: 'on_tool_end',
        name: 'record_snapshot',
        data: { output: { content: '{"label":"合成档案"}', tool_call_id: 'call_1' } }
      },
      textChunk('这是回答')
    ]))

    const result = await invoke()

    expect(result.toolTrace).toEqual([
      { type: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'record_snapshot', args: '{}' }] },
      { type: 'tool', content: '{"label":"合成档案"}', toolCallId: 'call_1' }
    ])

    // 下一轮：把轨迹挂到提问上，图应把它还原成 Human → AI(tool_calls) → Tool → AI 的顺序
    streamEvents.mockReset()
    streamEvents.mockImplementationOnce(() => chunks([textChunk('第二轮回答')]))
    await invoke([
      { role: 'user', content: '这个孩子最近怎么样？', toolTrace: result.toolTrace },
      { role: 'assistant', content: '这是回答' },
      { role: 'user', content: '那我该怎么做？' }
    ])

    const passed = streamEvents.mock.calls[0]?.[0] as { messages: Array<{ _getType?: () => string, getType?: () => string, tool_calls?: unknown[], tool_call_id?: string }> }
    const types = passed.messages.map(message => (message.getType ? message.getType() : 'unknown'))
    expect(passed.messages[0]!.getType?.()).toBe('system')
    expect(types).toEqual(['system', 'human', 'ai', 'tool', 'ai', 'human'])
    const aiWithTools = passed.messages[2] as { tool_calls?: Array<{ id: string, name: string }> }
    expect(aiWithTools.tool_calls?.[0]).toMatchObject({ id: 'call_1', name: 'record_snapshot' })
    expect((passed.messages[3] as { tool_call_id?: string }).tool_call_id).toBe('call_1')
  })

  it('无工具调用时轨迹为空', async () => {
    streamEvents.mockImplementationOnce(() => chunks([textChunk('直接回答')]))

    const result = await invoke()

    expect(result.toolTrace).toEqual([])
  })
})

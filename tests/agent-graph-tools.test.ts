import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const { streamEvents, captured, toolDef } = vi.hoisted(() => ({
  streamEvents: vi.fn(),
  captured: { tools: [] as unknown[] },
  toolDef: {} as Record<string, unknown>
}))

vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: (args: { tools: unknown[] }) => {
    captured.tools = args.tools
    return { streamEvents }
  }
}))
vi.mock('../server/integrations/models', () => ({
  createAgentLlm: vi.fn(async () => ({}))
}))
vi.mock('../server/agent/tools/index', () => ({
  buildAgentTools: vi.fn(async () => [toolDef])
}))

import { runAgentGraph } from '../server/agent/graph'
import type { AgentMessage } from '../server/agent/types'

/** 可断言调用次数的工具执行器。 */
const execute = vi.fn()

/** 产出若干流式块。 */
async function* chunks(items: unknown[]): AsyncGenerator<unknown> {
  for (const item of items) yield item
}

function textChunk(text: string) {
  return { event: 'on_chat_model_stream', data: { chunk: { content: text } } }
}

const messages: AgentMessage[] = [{ role: 'user', content: '我们班午休纪律反复' }]

function invoke(onEvent: (name: string, data: unknown) => void = () => {}) {
  return runAgentGraph({} as never, {
    messages,
    userCtx: { schoolId: 'school-1', userId: 'user-1', sessionId: 'session-1' },
    systemPrompt: 'system prompt',
    onEvent
  })
}

/** 取被 createReactAgent 收到的第一个工具（真实 DynamicStructuredTool 实例）。 */
function firstTool() {
  return captured.tools[0] as { invoke: (args: unknown) => Promise<string> }
}

describe('runAgentGraph 运行期防护', () => {
  beforeEach(() => {
    streamEvents.mockReset()
    execute.mockReset()
    captured.tools = []
    toolDef.name = 'plan_lookup'
    toolDef.description = '测试工具'
    toolDef.schema = z.object({ q: z.string().optional() })
    toolDef.timeoutMs = 50
    toolDef.execute = execute
    vi.stubGlobal('useRuntimeConfig', () => ({
      deepseekApiKey: 'test-key',
      deepseekTimeoutMs: 5000,
      agentMaxToolRounds: 8,
      agentEnabledTools: ''
    }))
  })

  it('同轮内相同参数的重复调用只执行一次，参数不同则重新执行', async () => {
    execute.mockResolvedValue({ plans: [] })
    streamEvents.mockImplementation(() => chunks([textChunk('回答')]))

    await invoke()
    const tool = firstTool()

    await tool.invoke({ q: 'same' })
    await tool.invoke({ q: 'same' })
    expect(execute).toHaveBeenCalledTimes(1)

    await tool.invoke({ q: 'other' })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('工具执行超时时按失败回传模型自愈，不中断整轮回答', async () => {
    execute.mockImplementationOnce(() => new Promise(() => { /* 永不结束，等待超时 */ }))
    streamEvents.mockImplementation(() => chunks([textChunk('回答')]))

    const result = await invoke()
    const payload = await firstTool().invoke({ q: 'slow' })

    expect(payload).toContain('工具执行超时')
    // 本轮回答仍正常产出，超时不会打断图运行
    expect(result.answer).toBe('回答')
  })

  it('模块分诊与量表推荐冲突时以量表推荐为准并记录冲突', async () => {
    streamEvents.mockImplementation(() => chunks([
      {
        event: 'on_tool_end',
        name: 'module_route',
        run_id: 'run-route',
        data: { output: { content: JSON.stringify({ module: 'home_school', confidence: 0.6 }) } }
      },
      {
        event: 'on_tool_end',
        name: 'recommend_assessment',
        run_id: 'run-recommend',
        data: { output: { content: JSON.stringify({ module: 'student_case' }) } }
      },
      textChunk('回答')
    ]))

    const result = await invoke()

    expect(result.toolConflicts).toHaveLength(1)
    expect(result.toolConflicts?.[0]).toContain('home_school')
    expect(result.toolConflicts?.[0]).toContain('student_case')
  })

  it('工具调用记录带状态与耗时（供入口写产品事件）', async () => {
    execute.mockResolvedValue({ plans: [] })
    streamEvents.mockImplementation(() => chunks([
      { event: 'on_tool_start', name: 'plan_lookup', run_id: 'run-1', data: { input: { q: 'a' } } },
      {
        event: 'on_tool_end',
        name: 'plan_lookup',
        run_id: 'run-1',
        data: { output: { content: JSON.stringify({ plans: [] }), tool_call_id: 'call-1' } }
      },
      textChunk('回答')
    ]))

    const result = await invoke()

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls?.[0]!.name).toBe('plan_lookup')
    expect(result.toolCalls?.[0]!.status).toBe('success')
    expect(typeof result.toolCalls?.[0]!.latencyMs).toBe('number')
  })

  it('工具返回失败时记录 error 状态', async () => {
    streamEvents.mockImplementation(() => chunks([
      { event: 'on_tool_start', name: 'plan_lookup', run_id: 'run-2', data: { input: {} } },
      {
        event: 'on_tool_end',
        name: 'plan_lookup',
        run_id: 'run-2',
        data: { output: { content: JSON.stringify({ error: '工具执行失败', message: 'x' }), tool_call_id: 'call-2' } }
      },
      textChunk('回答')
    ]))

    const result = await invoke()

    expect(result.toolCalls?.[0]!.status).toBe('error')
  })

  it('知识库检索结果里的来源片段被采集（兼容 { items } 结构）', async () => {
    streamEvents.mockImplementation(() => chunks([
      {
        event: 'on_tool_end',
        name: 'knowledge_search',
        run_id: 'run-3',
        data: {
          output: {
            content: JSON.stringify({
              items: [{ chunkId: 'chunk-1', documentTitle: '班级常规手册', excerpt: '片段' }]
            }),
            tool_call_id: 'call-3'
          }
        }
      },
      textChunk('回答')
    ]))

    const result = await invoke()

    expect(result.sources).toHaveLength(1)
    expect(result.sources?.[0]!.chunkId).toBe('chunk-1')
  })
})

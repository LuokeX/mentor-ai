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
import type { AgentMessage } from '../server/agent/types'

/** 一次尝试直接抛错（模拟网络/鉴权等失败）。 */
async function* boom(): AsyncGenerator<unknown> {
  throw new Error('模型调用失败')
}

/** 产出若干流式块。 */
async function* chunks(items: unknown[]): AsyncGenerator<unknown> {
  for (const item of items) yield item
}

/** 先产出文本再抛错（模拟流中断）。 */
async function* yieldThenThrow(text: string): AsyncGenerator<unknown> {
  yield { event: 'on_chat_model_stream', data: { chunk: { content: text } } }
  throw new Error('流中断')
}

function textChunk(text: string) {
  return { event: 'on_chat_model_stream', data: { chunk: { content: text } } }
}

const messages: AgentMessage[] = [{ role: 'user', content: '最近班上一到午休就乱' }]

function invoke(onEvent: (name: string, data: unknown) => void = () => {}) {
  return runAgentGraph({} as never, {
    messages,
    userCtx: { schoolId: 'school-1', userId: 'user-1', sessionId: 'session-1' },
    systemPrompt: 'system prompt',
    onEvent
  })
}

describe('runAgentGraph 自动重试', () => {
  beforeEach(() => {
    streamEvents.mockReset()
    vi.stubGlobal('useRuntimeConfig', () => ({ deepseekApiKey: 'test-key', deepseekTimeoutMs: 5000 }))
  })

  it('本轮无产出时自动重试一次，第二次产出文本即返回', async () => {
    streamEvents
      .mockImplementationOnce(() => boom())
      .mockImplementationOnce(() => chunks([textChunk('先说说最近一次的具体情况')]))

    const result = await invoke()

    expect(streamEvents).toHaveBeenCalledTimes(2)
    expect(result.answer).toBe('先说说最近一次的具体情况')
    expect(result.exitReason).toBe('done')
  })

  it('两次都没有产出时返回空答案与 error，交由入口发 error 事件', async () => {
    streamEvents.mockImplementation(() => chunks([]))

    const result = await invoke()

    expect(streamEvents).toHaveBeenCalledTimes(2)
    expect(result.answer).toBe('')
    expect(result.exitReason).toBe('error')
  })

  it('已向客户端发过内容后失败不重试，避免重复展示', async () => {
    streamEvents.mockImplementation(() => yieldThenThrow('已经流出的部分回答'))

    const result = await invoke()

    expect(streamEvents).toHaveBeenCalledTimes(1)
    expect(result.answer).toBe('已经流出的部分回答')
  })

  it('未配置模型时不重试、不产出兜底回答', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ deepseekApiKey: '' }))

    const result = await invoke()

    expect(streamEvents).not.toHaveBeenCalled()
    expect(result.answer).toBe('')
    expect(result.exitReason).toBe('error')
  })

  it('已推送过工具过程后失败不重试，避免重复展示工具卡片', async () => {
    const events: string[] = []
    streamEvents.mockImplementationOnce(() => chunks([
      { event: 'on_tool_start', name: 'knowledge_search', data: { input: { query: '午休' } } }
    ]))

    const result = await invoke(name => events.push(name))

    expect(streamEvents).toHaveBeenCalledTimes(1)
    expect(result.answer).toBe('')
    expect(result.exitReason).toBe('error')
    expect(events.filter(name => name === 'tool_call')).toHaveLength(1)
  })
})

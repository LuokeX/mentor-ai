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

/** 产出若干流式块。 */
async function* chunks(items: unknown[]): AsyncGenerator<unknown> {
  for (const item of items) yield item
}

function textChunk(text: string) {
  return { event: 'on_chat_model_stream', data: { chunk: { content: text } } }
}

function modelEnd(usageMetadata: Record<string, unknown>, runId = 'run-1') {
  return { event: 'on_chat_model_end', run_id: runId, data: { output: { usage_metadata: usageMetadata } } }
}

const messages: AgentMessage[] = [{ role: 'user', content: '最近班上一到午休就乱' }]

function invoke() {
  return runAgentGraph({} as never, {
    messages,
    userCtx: { schoolId: 'school-1', userId: 'user-1', sessionId: 'session-1' },
    systemPrompt: 'system prompt',
    onEvent: () => {}
  })
}

describe('runAgentGraph 模型调用用量采集', () => {
  beforeEach(() => {
    streamEvents.mockReset()
    vi.stubGlobal('useRuntimeConfig', () => ({ deepseekApiKey: 'test-key', deepseekTimeoutMs: 5000 }))
  })

  it('从 usage_metadata 读取输入/输出与缓存命中，并推导未命中差值', async () => {
    streamEvents.mockImplementationOnce(() => chunks([
      { event: 'on_chat_model_start', run_id: 'run-1', data: {} },
      modelEnd({ input_tokens: 1200, output_tokens: 200, input_token_details: { cache_read: 1024 } }),
      textChunk('先看这一周午休的具体表现')
    ]))

    const result = await invoke()

    expect(result.modelCalls).toHaveLength(1)
    expect(result.modelCalls?.[0]).toMatchObject({
      model: 'unknown',
      status: 'success',
      promptTokens: 1200,
      completionTokens: 200,
      cacheHitTokens: 1024,
      cacheMissTokens: 176
    })
    expect(typeof result.modelCalls?.[0]?.latencyMs).toBe('number')
  })

  it('服务端未返回缓存字段时保持缺省，不猜测命中数', async () => {
    streamEvents.mockImplementationOnce(() => chunks([
      modelEnd({ input_tokens: 800, output_tokens: 90 }),
      textChunk('回答')
    ]))

    const result = await invoke()

    const record = result.modelCalls?.[0]
    expect(record?.promptTokens).toBe(800)
    expect(record?.completionTokens).toBe(90)
    expect(record?.cacheHitTokens).toBeUndefined()
    expect(record?.cacheMissTokens).toBeUndefined()
  })

  it('模型调用失败记一条 failed，重试成功的调用同样累计（重试也计费）', async () => {
    streamEvents
      .mockImplementationOnce(() => chunks([
        { event: 'on_chat_model_start', run_id: 'run-1', data: {} },
        { event: 'on_chat_model_error', run_id: 'run-1', data: { error: new Error('boom') } }
      ]))
      .mockImplementationOnce(() => chunks([
        modelEnd({ input_tokens: 500, output_tokens: 60 }),
        textChunk('重试后的回答')
      ]))

    const result = await invoke()

    expect(streamEvents).toHaveBeenCalledTimes(2)
    expect(result.modelCalls?.map(item => item.status)).toEqual(['failed', 'success'])
    expect(result.modelCalls?.[0]?.errorCode).toBe('model_error')
  })

  it('重试后仍无产出时，仍返回已发生的调用记录供入口审计', async () => {
    streamEvents.mockImplementation(() => chunks([modelEnd({ input_tokens: 300, output_tokens: 0 })]))

    const result = await invoke()

    expect(result.answer).toBe('')
    expect(result.exitReason).toBe('error')
    expect(result.modelCalls).toHaveLength(2)
  })
})

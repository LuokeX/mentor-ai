import { beforeEach, describe, expect, it, vi } from 'vitest'

const { streamEvents, llmInvoke } = vi.hoisted(() => ({ streamEvents: vi.fn(), llmInvoke: vi.fn() }))

vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: () => ({ streamEvents })
}))
vi.mock('../server/integrations/models', () => ({
  createAgentLlm: vi.fn(async () => ({ model: 'test-model', invoke: llmInvoke }))
}))
vi.mock('../server/agent/tools/index', () => ({
  buildAgentTools: vi.fn(async () => [])
}))

import { runAgentGraph } from '../server/agent/graph'
import type { AgentMessage } from '../server/agent/types'

async function* chunks(items: unknown[]): AsyncGenerator<unknown> {
  for (const item of items) yield item
}

function textChunk(text: string) {
  return { event: 'on_chat_model_stream', data: { chunk: { content: text } } }
}

/** 第一轮：模型发起工具调用 → 工具返回（结果进入本轮轨迹）。 */
const toolRound = [
  {
    event: 'on_chat_model_end',
    data: {
      output: {
        content: '',
        response_metadata: { finish_reason: 'tool_calls' },
        tool_calls: [{ id: 'call_1', name: 'knowledge_search', args: { query: '注意力分散型' } }]
      }
    }
  },
  {
    event: 'on_tool_end',
    name: 'knowledge_search',
    run_id: 'call_1',
    data: { output: { content: '{"items":[]}', tool_call_id: 'call_1' } }
  }
]

/** 第二轮：模型返回空正文，也没有工具调用（线上 2026-09-17 11:20 的失败形态）。 */
const emptyFinalRound = {
  event: 'on_chat_model_end',
  data: { output: { content: '', response_metadata: { finish_reason: 'stop' } } }
}

const messages: AgentMessage[] = [{ role: 'user', content: '注意力分散型。知识库里有吗？' }]

function invoke(onEvent: (name: string, data: unknown) => void = () => {}) {
  return runAgentGraph({} as never, {
    messages,
    userCtx: { schoolId: 'school-1', userId: 'user-1', sessionId: 'session-1' },
    systemPrompt: 'system prompt',
    onEvent
  })
}

describe('runAgentGraph 空正文收尾补答', () => {
  beforeEach(() => {
    streamEvents.mockReset()
    llmInvoke.mockReset()
    vi.stubGlobal('useRuntimeConfig', () => ({ deepseekApiKey: 'test-key', deepseekTimeoutMs: 5000 }))
  })

  it('模型以空正文结束但已有工具结果时，用已返回的事实补一次收尾回答', async () => {
    streamEvents.mockImplementationOnce(() => chunks([...toolRound, emptyFinalRound]))
    llmInvoke.mockResolvedValueOnce({
      content: '归因库里确实有「注意力分散型」这一条。',
      response_metadata: { finish_reason: 'stop' }
    })

    const result = await invoke()

    expect(result.answer).toBe('归因库里确实有「注意力分散型」这一条。')
    expect(result.exitReason).toBe('done')
    // 空正文的那次往返标记进审计：便于在 AI 中心区分上游中断与正常空回答
    expect(result.modelCalls?.map(call => ({
      status: call.status,
      finishReason: call.finishReason,
      errorCode: call.errorCode
    }))).toEqual([
      { status: 'success', finishReason: 'tool_calls', errorCode: undefined },
      { status: 'failed', finishReason: 'stop', errorCode: 'empty_round:stop' },
      { status: 'success', finishReason: 'stop', errorCode: undefined }
    ])
    // 补答请求 = 系统 + 历史 + 工具轨迹 + 收尾指令（不绑定工具，只依据既有事实作答）
    const passed = llmInvoke.mock.calls[0]![0] as Array<{ getType?: () => string, content?: unknown }>
    expect(passed.map(item => item.getType?.())).toEqual(['system', 'human', 'ai', 'tool', 'human'])
    expect(String(passed[passed.length - 1]!.content)).toContain('上一轮没有产出回答正文')
  })

  it('补答仍为空时按 no_output 收尾：记下上游结束原因，不重试也不产出兜底回答', async () => {
    streamEvents.mockImplementationOnce(() => chunks([...toolRound, emptyFinalRound]))
    llmInvoke.mockResolvedValueOnce({
      content: '',
      response_metadata: { finish_reason: 'insufficient_system_resource' }
    })

    const result = await invoke()

    expect(result.answer).toBe('')
    expect(result.exitReason).toBe('error')
    // 工具过程已经推给前端，整轮重试会重复展示，因此图只跑一次
    expect(streamEvents).toHaveBeenCalledTimes(1)
    expect(result.modelCalls?.at(-1)).toMatchObject({
      status: 'failed',
      finishReason: 'insufficient_system_resource',
      errorCode: 'empty_answer:insufficient_system_resource'
    })
  })

  it('没有工具结果时不补答，仍按整轮重试处理并标记异常往返', async () => {
    streamEvents
      .mockImplementationOnce(() => chunks([emptyFinalRound]))
      .mockImplementationOnce(() => chunks([textChunk('重试后的回答')]))

    const result = await invoke()

    expect(llmInvoke).not.toHaveBeenCalled()
    expect(streamEvents).toHaveBeenCalledTimes(2)
    expect(result.answer).toBe('重试后的回答')
    expect(result.modelCalls?.[0]).toMatchObject({
      status: 'failed',
      finishReason: 'stop',
      errorCode: 'empty_round:stop'
    })
  })

  it('正常产出文本的往返按成功记录，并带上结束原因与用量', async () => {
    streamEvents.mockImplementationOnce(() => chunks([
      {
        event: 'on_chat_model_end',
        data: {
          output: {
            content: '',
            response_metadata: { finish_reason: 'stop' },
            usage_metadata: { input_tokens: 100, output_tokens: 20 }
          }
        }
      },
      textChunk('先记事实，再决定要不要归类。')
    ]))

    const result = await invoke()

    expect(result.answer).toBe('先记事实，再决定要不要归类。')
    expect(result.modelCalls).toEqual([
      expect.objectContaining({ status: 'success', finishReason: 'stop', promptTokens: 100, completionTokens: 20 })
    ])
    expect(llmInvoke).not.toHaveBeenCalled()
  })

  it('ReAct 路径经回调取回结束原因：截断且无正文时按空轮次处理，收尾补答照常', async () => {
    streamEvents.mockImplementationOnce((_input: unknown, options: {
      callbacks?: Array<{ handleLLMEnd?: (output: unknown, runId: string) => void }>
    }) => {
      // 线上路径：on_chat_model_end 的 response_metadata 拿不到 finish_reason，只在回调里
      options.callbacks?.[0]?.handleLLMEnd?.({ generations: [[{ generationInfo: { finish_reason: 'length' } }]] }, 'run-2')
      return chunks([
        ...toolRound,
        {
          event: 'on_chat_model_end',
          run_id: 'run-2',
          data: { output: { content: '', usage_metadata: { input_tokens: 800, output_tokens: 4096 } } }
        }
      ])
    })
    llmInvoke.mockResolvedValueOnce({
      content: '思考被截断，这里依据已返回的事实作答。',
      response_metadata: { finish_reason: 'stop' }
    })

    const result = await invoke()

    expect(result.answer).toBe('思考被截断，这里依据已返回的事实作答。')
    expect(result.exitReason).toBe('done')
    expect(result.modelCalls?.[1]).toMatchObject({
      status: 'failed',
      finishReason: 'length',
      errorCode: 'truncated:length'
    })
  })

  it('截断且已经流出正文时按异常结束处理，不把半截回答返回给教师', async () => {
    streamEvents.mockImplementationOnce((_input: unknown, options: {
      callbacks?: Array<{ handleLLMEnd?: (output: unknown, runId: string) => void }>
    }) => {
      options.callbacks?.[0]?.handleLLMEnd?.({ generations: [[{ generationInfo: { finish_reason: 'length' } }]] }, 'run-3')
      return chunks([
        textChunk('先说第一点，'),
        {
          event: 'on_chat_model_end',
          run_id: 'run-3',
          data: { output: { content: '先说第一点，' } }
        }
      ])
    })

    const result = await invoke()

    expect(result.answer).toBe('')
    expect(result.exitReason).toBe('error')
    // 已经推过内容，不再整轮重试（避免重复展示），也不返回半截回答
    expect(streamEvents).toHaveBeenCalledTimes(1)
    expect(result.modelCalls?.[0]).toMatchObject({
      status: 'failed',
      finishReason: 'length',
      errorCode: 'truncated:length'
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 语义安全两轮判定（首轮识别 + 复核）的行为约束。
 *
 * 背景：2026-09-17 测试环境一条「教师转述学生打架、询问怎么处理」的普通提问
 * 被首轮语义判定为暴力（SAFE-SEMANTIC-VIOLENCE），直接触发安全熔断。
 * 这里固定三件事：命中要复核、复核清空即不熔断、复核调用失败保留首轮判定。
 */
const { inserted } = vi.hoisted(() => ({ inserted: [] as Record<string, unknown>[] }))
vi.mock('../server/utils/db', async () => {
  const original = await vi.importActual<typeof import('../server/utils/db')>('../server/utils/db')
  return {
    ...original,
    useDb: () => ({ insert: () => ({ values: async (row: Record<string, unknown>) => { inserted.push(row) } }) })
  }
})

import { confirmedSemanticSafetySignals } from '../server/integrations/deepseek'

const STRICT_PURPOSES = 'semantic_safety,semantic_safety_review'

/** strict 工具通道的模型响应：风险类别放在 tool_calls[0].function.arguments。 */
function toolCall(arguments_: unknown, status = 200) {
  return new Response(JSON.stringify({
    choices: [{
      message: {
        tool_calls: [{ function: { name: 'report_safety_risks', arguments: JSON.stringify(arguments_) } }]
      },
      finish_reason: 'tool_calls'
    }],
    usage: { prompt_tokens: 12, completion_tokens: 6 }
  }), { status, headers: { 'content-type': 'application/json' } })
}

/** 按调用顺序排队返回响应，并记录每次请求体。 */
function queueFetch(responses: Array<() => Response>) {
  const bodies: Record<string, unknown>[] = []
  const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
    bodies.push(JSON.parse(init?.body || '{}') as Record<string, unknown>)
    const next = responses.shift()
    if (!next) throw new Error('未预期的模型调用')
    return next()
  })
  vi.stubGlobal('fetch', fetchMock)
  return { bodies, fetchMock }
}

const audit = { schoolId: 'school-1', ownerUserId: 'teacher-1', sessionId: 'session-1' }

beforeEach(() => {
  inserted.length = 0
  vi.stubGlobal('useRuntimeConfig', () => ({
    deepseekApiKey: 'test-key',
    deepseekBaseUrl: 'https://example.test',
    deepseekRouterModel: 'test-model',
    aiStrictJsonPurposes: STRICT_PURPOSES
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('语义安全两轮判定', () => {
  it('首轮无风险时只调用一次模型，直接返回空结论', async () => {
    const { fetchMock, bodies } = queueFetch([() => toolCall({ risks: [] })])
    expect(await confirmedSemanticSafetySignals({} as never, '孩子上课走神如何提升专注力', false, audit))
      .toEqual({ matchedRules: [], detectedRules: [], review: 'none' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(bodies[0])).toContain('report_safety_risks')
    expect(inserted.map(row => row.purpose)).toEqual(['semantic_safety'])
  })

  it('首轮命中、复核确认时返回对应安全规则', async () => {
    queueFetch([
      () => toolCall({ risks: ['suicide', 'self_harm'] }),
      () => toolCall({ risks: ['suicide', 'self_harm'] })
    ])
    expect(await confirmedSemanticSafetySignals({} as never, '她说写过遗书，胳膊上还有自己划的痕', false, audit)).toEqual({
      matchedRules: ['SAFE-SEMANTIC-SUICIDE', 'SAFE-SEMANTIC-SELF-HARM'],
      detectedRules: ['SAFE-SEMANTIC-SUICIDE', 'SAFE-SEMANTIC-SELF-HARM'],
      review: 'confirmed'
    })
    expect(inserted.map(row => row.purpose)).toEqual(['semantic_safety', 'semantic_safety_review'])
  })

  it('复核只确认部分类别时，只保留复核成立的那些', async () => {
    queueFetch([
      () => toolCall({ risks: ['violence', 'threat'] }),
      () => toolCall({ risks: ['threat'] })
    ])
    const verdict = await confirmedSemanticSafetySignals({} as never, '有人发消息说要弄死他', false, audit)
    expect(verdict.matchedRules).toEqual(['SAFE-SEMANTIC-THREAT'])
    expect(verdict.detectedRules).toEqual(['SAFE-SEMANTIC-VIOLENCE', 'SAFE-SEMANTIC-THREAT'])
    expect(verdict.review).toBe('confirmed')
  })

  it('复核清空首轮判定时不熔断，并记误报产品事件', async () => {
    const { bodies } = queueFetch([
      () => toolCall({ risks: ['violence'] }),
      () => toolCall({ risks: [] })
    ])
    const text = '有俩孩子上课打起来了，A在课上喊B外号，B急了蹬了A一脚，把A打流鼻血了，我该怎么处理'
    const verdict = await confirmedSemanticSafetySignals({} as never, text, false, audit)
    expect(verdict).toEqual({ matchedRules: [], detectedRules: ['SAFE-SEMANTIC-VIOLENCE'], review: 'cleared' })
    // 复核请求：换工具、带上首轮命中的类别，供模型逐条核对
    expect(JSON.stringify(bodies[1])).toContain('confirm_safety_risks')
    expect(JSON.stringify(bodies[1])).toContain('上一轮识别出的风险类别：暴力(violence)')
    // 误报只记产品事件，不产生安全事件/转介：可观察到的落库只有模型调用与产品事件
    const event = inserted.find(row => row.eventName === 'assistant_semantic_safety_cleared')
    expect(event?.metadata).toEqual({ detected: 'SAFE-SEMANTIC-VIOLENCE' })
    expect(event?.targetId).toBe('session-1')
  })

  it('复核调用失败时保留首轮判定（安全侧不因技术失败放行）', async () => {
    queueFetch([
      () => toolCall({ risks: ['violence'] }),
      () => new Response('upstream error', { status: 500 }),
      () => new Response('upstream error', { status: 500 })
    ])
    const verdict = await confirmedSemanticSafetySignals({} as never, '学生说要用刀捅回去', false, audit)
    expect(verdict).toEqual({
      matchedRules: ['SAFE-SEMANTIC-VIOLENCE'],
      detectedRules: ['SAFE-SEMANTIC-VIOLENCE'],
      review: 'unavailable'
    })
    expect(inserted.filter(row => row.purpose === 'semantic_safety_review').every(row => row.status === 'failed')).toBe(true)
    expect(inserted.some(row => row.eventName === 'assistant_semantic_safety_cleared')).toBe(false)
  })

  it('本地数据模式不调用模型', async () => {
    const { fetchMock } = queueFetch([])
    expect(await confirmedSemanticSafetySignals({} as never, '班主任该怎么处理学生矛盾', true, audit))
      .toEqual({ matchedRules: [], detectedRules: [], review: 'none' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

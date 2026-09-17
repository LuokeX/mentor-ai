import { beforeEach, describe, expect, it, vi } from 'vitest'
import { teacherEvidence } from '../server/agent/evidence'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../server/integrations/models', () => ({ createAgentLlm: vi.fn(async () => ({ model: 'synthetic', invoke, bind: () => ({ invoke }) })) }))
import { reviewAssistantAnswer } from '../server/domain/assistant-answer-review'

const input = { answer: '平台规定所有学生必须补课。', evidence: [], systemPrompt: '只根据已知事实回答', schoolId: 's', userId: 'u', sessionId: 'c', audit: async () => {} }
const result = (content: string) => ({ content, response_metadata: { finish_reason: 'stop' }, usage_metadata: { input_tokens: 10, output_tokens: 10 } })

describe('回答依据校验', () => {
  beforeEach(() => invoke.mockReset())
  it('历史教师陈述参与检查，助手建议不能升级为证据', () => {
    expect(teacherEvidence([{ role: 'user', content: '我试过便签，没有用' }, { role: 'assistant', content: '已经改善' }], '怎么调整')).toEqual([
      { id: 'teacher:history:0', kind: 'teacher', content: '我试过便签，没有用' }, { id: 'teacher:current', kind: 'teacher', content: '怎么调整' }
    ])
  })
  it('无依据声明只修正一次，再失败则拒绝返回原文', async () => {
    invoke.mockResolvedValueOnce(result('{"supported":false,"unsupportedClaims":["没有制度依据"]}'))
      .mockResolvedValueOnce(result('平台规定所有学生必须补课。'))
      .mockResolvedValueOnce(result('{"supported":false,"unsupportedClaims":["仍没有依据"]}'))
    await expect(reviewAssistantAnswer({} as never, input)).rejects.toThrow('回答校验失败')
    expect(invoke).toHaveBeenCalledTimes(3)
  })
  it('接受有边界的通用建议，移除无依据正式要求', async () => {
    invoke.mockResolvedValueOnce(result('{"supported":false,"unsupportedClaims":["没有制度依据"]}'))
      .mockResolvedValueOnce(result('可以先查看作业中卡住的具体步骤，再给针对性提示。'))
    const reviewed = await reviewAssistantAnswer({} as never, input)
    expect(reviewed.repaired).toBe(true)
    expect(reviewed.answer).not.toContain('平台规定')
    expect(invoke).toHaveBeenCalledTimes(2)
  })
  it('不能因为有任意来源就跳过语义检查', async () => {
    invoke.mockResolvedValueOnce(result('{"supported":false,"unsupportedClaims":["来源只有沟通建议，没有补课制度"]}'))
      .mockResolvedValueOnce(result('可先了解当前困难。'))
    await reviewAssistantAnswer({} as never, { ...input, evidence: [{ id: 'k', kind: 'knowledge', content: '先倾听对方。' }] })
    expect(invoke).toHaveBeenCalledTimes(2)
  })
  it('格式错误、超时、中断都不放行未校验回答', async () => {
    invoke.mockResolvedValueOnce(result('不是JSON'))
    await expect(reviewAssistantAnswer({} as never, input)).rejects.toThrow()
    invoke.mockRejectedValueOnce(new Error('timeout'))
    await expect(reviewAssistantAnswer({} as never, input)).rejects.toThrow('回答校验失败')
  })
})

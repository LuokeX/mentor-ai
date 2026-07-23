import { describe, expect, it } from 'vitest'
import { composeClarificationSummaryHistory } from '../server/domain/chat-clarification'

describe('composeClarificationSummaryHistory', () => {
  const history = [
    { role: 'user' as const, content: '最近班上秩序很乱' },
    { role: 'assistant' as const, content: '最近一次最让你头疼的情况是什么？' },
    { role: 'user' as const, content: '午休总有人起哄' }
  ]

  it('includes the current teacher reply when the third clarification answer triggers auto summary', () => {
    const result = composeClarificationSummaryHistory({
      history,
      currentMessage: '主要是几个学生互相带头，提醒后很快又开始',
      includeCurrentMessage: true
    })

    expect(result.at(-1)).toEqual({
      role: 'user',
      content: '主要是几个学生互相带头，提醒后很快又开始'
    })
  })

  it('does not include the done control signal when teacher finishes manually', () => {
    const result = composeClarificationSummaryHistory({
      history,
      currentMessage: '[DONE]',
      includeCurrentMessage: false
    })

    expect(result).toEqual(history)
  })

  it('keeps entity memory before the active session history', () => {
    const result = composeClarificationSummaryHistory({
      entityMemory: [{ role: 'assistant', content: '历史方案：先观察午休座位安排。' }],
      history,
      currentMessage: '今天换座位后还是有点乱',
      includeCurrentMessage: true
    })

    expect(result[0]?.content).toBe('历史方案：先观察午休座位安排。')
    expect(result.at(-1)?.content).toBe('今天换座位后还是有点乱')
  })
})

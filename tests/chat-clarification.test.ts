import { describe, expect, it } from 'vitest'
import { sanitizeHistoryForSummary, topModuleFromScores } from '../server/domain/chat-clarification'

describe('sanitizeHistoryForSummary 历史清洗', () => {
  it('剥离 assistant 历史消息中的"选项："列表，只保留问题', () => {
    const result = sanitizeHistoryForSummary([
      { role: 'user', content: '小明上课经常走神' },
      { role: 'assistant', content: '最近一次让你印象特别深的是什么情况？\n\n选项：数学课上发呆、做作业坐不住' }
    ])
    expect(result[1]).toEqual({ role: 'assistant', content: '最近一次让你印象特别深的是什么情况？' })
    expect(result[0]).toEqual({ role: 'user', content: '小明上课经常走神' })
  })

  it('不含"选项："的消息原样保留', () => {
    const item = { role: 'assistant', content: '我们已经明确了问题方向。' }
    expect(sanitizeHistoryForSummary([item])[0]).toEqual(item)
  })
})

describe('topModuleFromScores 最高分模块', () => {
  it('返回评分最高的模块', () => {
    expect(topModuleFromScores({ self_growth: 0.1, student_case: 0.5, learning_problem: 0.8 })).toBe('learning_problem')
  })

  it('空评分或全零返回 undefined', () => {
    expect(topModuleFromScores({})).toBeUndefined()
    expect(topModuleFromScores({ self_growth: 0, class_system: 0 })).toBeUndefined()
    expect(topModuleFromScores(undefined)).toBeUndefined()
  })
})

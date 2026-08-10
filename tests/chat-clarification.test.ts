import { describe, expect, it } from 'vitest'
import { composeClarificationSummaryHistory, isFollowUpQuestionLike, isValidSummaryOutput, normalizeModuleProportions, sanitizeHistoryForSummary, topModuleFromScores } from '../server/domain/chat-clarification'

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

describe('isFollowUpQuestionLike 追问文本识别', () => {
  it('识别带"选项："的追问输出（模型在总结阶段复述追问的典型形态）', () => {
    const text = '这学期数学课的内容，你觉得对他来说难度怎么样？\n\n选项：主要是多步骤应用题，他好像跟不上思路'
    expect(isFollowUpQuestionLike(text)).toBe(true)
  })

  it('识别问号结尾的短追问句', () => {
    expect(isFollowUpQuestionLike('最近一次让你印象特别深的是什么情况？')).toBe(true)
    expect(isFollowUpQuestionLike('他发呆的时候，你观察到他眼神是放空的，还是在想别的事情？')).toBe(true)
  })

  it('不误判正常总结（长文本、无问号结尾）', () => {
    const summary = '从您描述的情况来看，小明的走神和拖拉背后可能是注意力调节和学习信心的问题。建议先通过平台量表系统评估，再结合归因结果匹配具体的应对工具，帮助孩子逐步建立学习节奏。'
    expect(isFollowUpQuestionLike(summary)).toBe(false)
  })

  it('不误判带问号的结语式长总结', () => {
    const longSummary = '综合几轮对话来看，问题核心集中在学生个体层面，同时也与课堂任务难度有关。可以先从学习问题模块入手做一次系统评估，评估结果会帮助您确定归因方向，再针对性地调整课堂策略和作业安排。以上分析供您参考，您可以结合实际情况判断。'
    expect(isFollowUpQuestionLike(longSummary)).toBe(false)
  })
})

describe('sanitizeHistoryForSummary 总结历史清洗', () => {
  it('剥离 assistant 追问消息中的"选项："列表，只保留问题', () => {
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

describe('isValidSummaryOutput 总结质量校验', () => {
  const validMeta = {
    rationale: '学生个体注意力与学习信心问题',
    primaryModule: 'learning_problem',
    moduleProportions: { self_growth: 0.1, class_system: 0.1, home_school: 0.1, student_case: 0.3, learning_problem: 0.4 }
  }
  const longAnswer = '从您描述的情况来看，小明的走神和拖拉背后可能是注意力调节和学习信心的问题，建议先通过平台量表系统评估，再结合归因结果匹配具体的应对工具，帮助孩子逐步建立学习节奏。'

  it('接受完整的总结输出', () => {
    expect(isValidSummaryOutput(longAnswer, validMeta)).toBe(true)
  })

  it('拒绝总结阶段输出追问（模型复述"问题+选项"的典型形态）', () => {
    const followUp = '这学期数学课的内容，你觉得对他来说难度怎么样？\n\n选项：主要是多步骤应用题，他好像跟不上思路'
    expect(isValidSummaryOutput(followUp, validMeta)).toBe(false)
  })

  it('拒绝 JSON 元数据缺失的输出', () => {
    expect(isValidSummaryOutput(longAnswer, {})).toBe(false)
    expect(isValidSummaryOutput(longAnswer, { rationale: '只有理由' })).toBe(false)
  })

  it('拒绝 primaryModule 非法的输出', () => {
    expect(isValidSummaryOutput(longAnswer, { ...validMeta, primaryModule: 'medical_diagnosis' })).toBe(false)
  })
})

describe('normalizeModuleProportions 占比收敛', () => {
  it('完整五模块评分原样返回', () => {
    const scores = { self_growth: 0.25, class_system: 0.2, home_school: 0.15, student_case: 0.25, learning_problem: 0.15 }
    expect(normalizeModuleProportions(scores)).toEqual(scores)
  })

  it('缺字段或含非法值时返回 null（让调用方使用默认值）', () => {
    expect(normalizeModuleProportions({ learning_problem: 0.8 })).toBeNull()
    expect(normalizeModuleProportions({ self_growth: 0.1, class_system: 0.1, home_school: 0.1, student_case: 0.1, learning_problem: 'x' as unknown as number })).toBeNull()
    expect(normalizeModuleProportions(undefined)).toBeNull()
  })
})

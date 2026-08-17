import { describe, expect, it } from 'vitest'
import {
  buildAttributionKeywords,
  buildPlanTitle,
  splitSentences,
  truncateByChars,
  PLAN_TITLE_MAX
} from '../server/domain/plan-titles'

describe('splitSentences', () => {
  it('按中文句号/分号/叹号/问号断句并保留标点', () => {
    expect(splitSentences('学习动机不足。时间管理混乱；课堂专注度低！为什么？')).toEqual([
      '学习动机不足。', '时间管理混乱；', '课堂专注度低！'
    ])
  })

  it('按换行断句', () => {
    expect(splitSentences('第一行\n第二行\n第三行')).toEqual(['第一行', '第二行', '第三行'])
  })

  it('过滤空串与纯标点段', () => {
    expect(splitSentences('句一。。；句二。')).toEqual(['句一。', '句二。'])
  })

  it('max 限制句数', () => {
    expect(splitSentences('一。二。三。四。', 2)).toEqual(['一。', '二。'])
  })

  it('空文本返回空数组', () => {
    expect(splitSentences('')).toEqual([])
    expect(splitSentences('   ')).toEqual([])
  })
})

describe('truncateByChars', () => {
  it('超出长度按码点截断，emoji 不被切断', () => {
    const text = 'a'.repeat(200) + '😀'
    const result = truncateByChars(text, 200)
    expect([...result]).toHaveLength(200)
    expect(result).not.toContain('\uFFFD')
  })

  it('未超长原样返回', () => {
    expect(truncateByChars('短标题', PLAN_TITLE_MAX)).toBe('短标题')
  })
})

describe('buildPlanTitle · assistant_dialogue', () => {
  const base = {
    sourceType: 'assistant_dialogue' as const,
    moduleTitle: '学生个体问题',
    questionSummary: '小明上课经常走神，作业拖拉到半夜',
    attributionNames: ['学习动机', '时间管理']
  }

  it('带关联对象：对象 ｜ 提问首句', () => {
    const { title, titleFull } = buildPlanTitle({ ...base, objectLabel: '小明' })
    expect(titleFull).toBe('小明 ｜ 小明上课经常走神，作业拖拉到半夜')
    expect(title).toBe(titleFull)
  })

  it('关联对象为空时省略该段', () => {
    const { titleFull } = buildPlanTitle({ ...base, objectLabel: '' })
    expect(titleFull).toBe(base.questionSummary)
  })

  it('提问为空时兜底模块名 ｜ 方案', () => {
    const { titleFull } = buildPlanTitle({ ...base, questionSummary: '  ' })
    expect(titleFull).toBe('学生个体问题 ｜ 方案')
  })

  it('超长标题截断到 200，titleFull 保留完整', () => {
    const long = '问'.repeat(250)
    const { title, titleFull } = buildPlanTitle({ ...base, questionSummary: long })
    expect(titleFull.length).toBeGreaterThan(PLAN_TITLE_MAX)
    expect([...title]).toHaveLength(PLAN_TITLE_MAX)
  })
})

describe('buildPlanTitle · direct_assessment', () => {
  const base = {
    sourceType: 'direct_assessment' as const,
    moduleTitle: '家校沟通合作',
    attributionNames: ['沟通渠道断裂', '家长信任不足']
  }

  it('归因描述取前三句', () => {
    const { titleFull } = buildPlanTitle({
      ...base,
      attributionDescriptions: [
        '沟通渠道基本断裂，家长拒绝正面沟通。',
        '家长对班主任缺乏信任，多次越级投诉。',
        '过去几次沟通都演变成冲突，双方关系紧张。'
      ]
    })
    expect(titleFull).toBe('沟通渠道基本断裂，家长拒绝正面沟通。家长对班主任缺乏信任，多次越级投诉。过去几次沟通都演变成冲突，双方关系紧张。')
  })

  it('无描述时回退归因关键词连接', () => {
    const { titleFull } = buildPlanTitle(base)
    expect(titleFull).toBe('沟通渠道断裂、家长信任不足')
  })

  it('完全无归因时兜底模块名 ｜ 方案', () => {
    const { titleFull } = buildPlanTitle({ ...base, attributionNames: [], attributionDescriptions: [] })
    expect(titleFull).toBe('家校沟通合作 ｜ 方案')
  })
})

describe('buildAttributionKeywords', () => {
  it('按序去重并截取前 5', () => {
    expect(buildAttributionKeywords(['学习动机', '时间管理', '学习动机', '专注度', '同伴关系', '家庭支持', '自我效能']))
      .toEqual(['学习动机', '时间管理', '专注度', '同伴关系', '家庭支持'])
  })

  it('过滤空值', () => {
    expect(buildAttributionKeywords(['', '  ', '有效'])).toEqual(['有效'])
  })

  it('空输入返回空数组', () => {
    expect(buildAttributionKeywords([])).toEqual([])
  })
})
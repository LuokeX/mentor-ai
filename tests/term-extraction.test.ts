import { describe, expect, it } from 'vitest'
import { MAX_TERM_LENGTH, normalizeTerms } from '../server/domain/term-extraction'

const source = '用先跟后带接住情绪；沟通按 73855 法则（70% 积极 + 30% 待改进）；班级进入堰塞湖状态。'

describe('normalizeTerms（术语清洗：防编造、限长、去重、限量）', () => {
  it('保留来自输入文本的词，并保持模型输出顺序', () => {
    expect(normalizeTerms(['先跟后带', '73855 法则', '堰塞湖'], source)).toEqual(['先跟后带', '73855 法则', '堰塞湖'])
  })

  it('丢弃输入文本里不存在的词（防编造）', () => {
    expect(normalizeTerms(['先跟后带', '认知重构', '正念呼吸'], source)).toEqual(['先跟后带'])
  })

  it('丢弃空串、非字符串与超长词', () => {
    const long = '甲'.repeat(MAX_TERM_LENGTH + 1)
    expect(normalizeTerms(['', '   ', 123, null, long, '堰塞湖'], source)).toEqual(['堰塞湖'])
  })

  it('去重且受上限约束', () => {
    const many = ['先跟后带', '先跟后带', '73855 法则', '堰塞湖', '法则', '积极', '改进', '状态', '班级', '沟通']
    const result = normalizeTerms(many, source, 3)
    expect(result).toEqual(['先跟后带', '73855 法则', '堰塞湖'])
  })

  it('非数组输入返回空数组', () => {
    expect(normalizeTerms(null, source)).toEqual([])
    expect(normalizeTerms('先跟后带', source)).toEqual([])
    expect(normalizeTerms(undefined, source)).toEqual([])
  })
})

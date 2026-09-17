import { describe, expect, it } from 'vitest'
import {
  INTERNAL_DOC_TITLE_PREFIXES,
  filterKnowledgeChunks,
  findBannedTerms,
  type GuardableChunk
} from '../server/domain/knowledge-text-guard'

const chunk = (overrides: Partial<GuardableChunk> = {}): GuardableChunk => ({
  content: '先跟后带技术：第一步倾听，第二步共情，第三步事实。',
  documentTitle: '16.3 先跟后带：从对抗到合作的沟通架构',
  heading: '16.3 先跟后带',
  ...overrides
})

describe('filterKnowledgeChunks', () => {
  it('正常片段保留，dropped 为 0、reasons 为空', () => {
    const result = filterKnowledgeChunks([chunk()])
    expect(result.kept).toHaveLength(1)
    expect(result.dropped).toBe(0)
    expect(result.reasons).toEqual([])
  })

  it('四种内部规则文档前缀命中即丢弃', () => {
    for (const prefix of INTERNAL_DOC_TITLE_PREFIXES) {
      const result = filterKnowledgeChunks([chunk({ documentTitle: `${prefix}yellow·summary` })])
      expect(result.kept).toHaveLength(0)
      expect(result.reasons).toEqual(['internal_document'])
    }
  })

  it('正文命中不含分隔符的红线词即丢弃', () => {
    for (const wording of ['危机', '红线', '预警', '立即', '110', '120']) {
      const result = filterKnowledgeChunks([chunk({ content: `触发条件：${wording}，请按流程处理` })])
      expect(result.kept).toHaveLength(0)
      expect(result.reasons).toEqual(['redline_wording'])
    }
  })

  it('红线词的空格与拆写变体同样命中（含数字形态）', () => {
    const variants = ['危 机', '危·机', '红-线', '预 警', '立 即', '110 电话', '拨打 120']
    for (const wording of variants) {
      const result = filterKnowledgeChunks([chunk({ content: `说明：${wording}` })])
      expect(result.kept).toHaveLength(0)
      expect(result.reasons).toEqual(['redline_wording'])
    }
  })

  it('数字非独立出现时不命中（1100 字 / 2024 年 / 1200 人）', () => {
    const result = filterKnowledgeChunks([
      chunk({ content: '全文 1100 字，2024 年修订，覆盖 1200 人' })
    ])
    expect(result.kept).toHaveLength(1)
    expect(result.reasons).toEqual([])
  })

  it('正文命中内部编码即丢弃（大小写不敏感）', () => {
    const cases: Array<[string, string]> = [
      ['六力', '采用六力小学制度'],
      ['A-E', '心理风险 A-E 五级分类'],
      ['a-e', '心理风险 a-e 五级分类'],
      ['SOP', '按重建 SOP 执行'],
      ['sop', '按重建 sop 执行'],
      ['OTC', '严重度：OTC'],
      ['CIPS', 'CIPS 评分说明'],
      ['BPNSF', 'BPNSF 需求满足度'],
      ['ACTR-M', 'ACTR-M 信任修复'],
      ['R类', 'R类命中数 2 条']
    ]
    for (const [label, content] of cases) {
      const result = filterKnowledgeChunks([chunk({ content })])
      expect(result.kept, label).toHaveLength(0)
      expect(result.reasons, label).toEqual(['internal_code'])
    }
  })

  it('内部编码的字母边界生效（SOPHIA / ERGO 不命中）', () => {
    const result = filterKnowledgeChunks([
      chunk({ content: 'SOPHIA 是学生姓名，ERGO 是另一个词的字母组合' })
    ])
    expect(result.kept).toHaveLength(1)
    expect(result.reasons).toEqual([])
  })

  it('混合输入：kept 顺序与内容不变、dropped 计数正确、reasons 去重且按固定顺序', () => {
    const first = chunk({ content: '正常内容一' })
    const second = chunk({ documentTitle: '红线·R1 自伤自杀相关表达', content: '正常内容二' })
    const third = chunk({ content: '正常内容三' })
    const fourth = chunk({ content: '按 SOP 执行重建' })
    const fifth = chunk({ content: '触发条件：预警，请按流程处理' })
    const result = filterKnowledgeChunks([first, second, third, fourth, fifth])
    expect(result.kept).toEqual([first, third])
    expect(result.dropped).toBe(3)
    expect(result.reasons).toEqual(['internal_document', 'redline_wording', 'internal_code'])
  })

  it('空数组与非法输入不抛错', () => {
    expect(filterKnowledgeChunks([])).toEqual({ kept: [], dropped: 0, reasons: [] })
    // 故意传入非法结构，验证兜底
    const weird = [null, undefined, { content: null }] as unknown as GuardableChunk[]
    expect(() => filterKnowledgeChunks(weird)).not.toThrow()
  })
})

describe('findBannedTerms', () => {
  it('命中时返回去重数组，顺序为红线词 → 内部编码（ASCII 项 → 中文项）', () => {
    const hits = findBannedTerms('涉及 危机 与 危 机，还提到 六力 与 SOP')
    expect(hits).toEqual(['危机', 'SOP', '六力'])
  })

  it('未命中返回空数组', () => {
    expect(findBannedTerms('先跟后带：先顺着对方情绪回应，再谈具体事')).toEqual([])
  })

  it('空字符串、空白与非法输入返回空数组', () => {
    expect(findBannedTerms('')).toEqual([])
    expect(findBannedTerms('   \n  ')).toEqual([])
    expect(findBannedTerms(null as unknown as string)).toEqual([])
    expect(findBannedTerms(undefined as unknown as string)).toEqual([])
    expect(findBannedTerms({} as unknown as string)).toEqual([])
  })

  it('数字与字母边界不误伤', () => {
    expect(findBannedTerms('全文 1100 字，SOPHIA 同学，2024 年')).toEqual([])
  })
})

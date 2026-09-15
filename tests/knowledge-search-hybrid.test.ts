import { describe, expect, it } from 'vitest'
import { extractSearchKeywords, mergeRankedLists } from '../server/domain/module-resource-knowledge-search'

interface Hit {
  chunkId: string
  score?: number
}

const chunk = (chunkId: string, score = 0): Hit => ({ chunkId, score })

describe('mergeRankedLists（RRF 融合）', () => {
  it('两路都命中的片段排在最前，且只出现一次', () => {
    const vector = [chunk('a'), chunk('b'), chunk('c')]
    const keyword = [chunk('c'), chunk('d')]
    const merged = mergeRankedLists([vector, keyword], item => item.chunkId)
    expect(merged.map(item => item.chunkId)).toEqual(['c', 'a', 'b', 'd'])
    expect(new Set(merged.map(item => item.chunkId)).size).toBe(merged.length)
  })

  it('空分支不影响结果，全部为空时返回空数组', () => {
    expect(mergeRankedLists([[], [chunk('a')]], item => item.chunkId).map(i => i.chunkId)).toEqual(['a'])
    expect(mergeRankedLists([[], []], item => item.chunkId)).toEqual([])
    expect(mergeRankedLists([], item => item.chunkId)).toEqual([])
  })

  it('k 越小越强调靠前排名', () => {
    // k=0 时第 1 名得分 1、第 2 名 1/2；第 2 路把 b 排在第 1
    const merged = mergeRankedLists([[chunk('a'), chunk('b')], [chunk('b')]], item => item.chunkId, 0)
    expect(merged[0]!.chunkId).toBe('b')
  })

  it('保留原始对象（不做字段裁剪）', () => {
    const merged = mergeRankedLists([[chunk('a', 0.9)]], item => item.chunkId)
    expect(merged[0]!.score).toBe(0.9)
  })
})

describe('extractSearchKeywords（关键词提取）', () => {
  it('从中文查询里抽 2 字关键词并去重', () => {
    const keywords = extractSearchKeywords('个别学生课堂走神怎么处理')
    expect(keywords.length).toBeGreaterThan(0)
    expect(keywords.length).toBeLessThanOrEqual(4)
    expect(new Set(keywords).size).toBe(keywords.length)
  })

  it('过滤停用词（怎么/老师/家长等）', () => {
    const keywords = extractSearchKeywords('怎么跟家长沟通')
    expect(keywords).not.toContain('怎么')
    expect(keywords).not.toContain('家长')
  })

  it('纯英文或空文本返回空数组（调用方退化为纯向量检索）', () => {
    expect(extractSearchKeywords('classroom discipline')).toEqual([])
    expect(extractSearchKeywords('')).toEqual([])
    expect(extractSearchKeywords('   ')).toEqual([])
  })

  it('单字文本不产生关键词', () => {
    expect(extractSearchKeywords('累')).toEqual([])
  })

  it('最多返回指定个数的关键词', () => {
    const keywords = extractSearchKeywords('班级纪律反复课堂秩序混乱小组合作松散', 2)
    expect(keywords).toHaveLength(2)
  })
})

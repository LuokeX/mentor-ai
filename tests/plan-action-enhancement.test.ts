import { describe, expect, it } from 'vitest'
import {
  hasAiManagedActionItems,
  resolveAttributions,
  resolveSeverity
} from '../server/domain/plan-action-enhancement'

describe('resolveAttributions', () => {
  it('优先取报告顶层的 attributions，只保留有名称的项', () => {
    const report = {
      attributions: [
        { name: '情绪觉察薄弱', strength: 'primary', reasons: ['情绪识别不足'] },
        { name: '  ', strength: 'secondary' }
      ]
    }
    expect(resolveAttributions(report)).toEqual([
      { name: '情绪觉察薄弱', strength: 'primary', reasons: ['情绪识别不足'] }
    ])
  })

  it('顶层为空时回退 planStructure.attribution.items（旧方案快照）', () => {
    const report = {
      planStructure: {
        attribution: { items: [{ name: '意义感流失', strength: 'secondary' }] }
      }
    }
    expect(resolveAttributions(report)).toEqual([{ name: '意义感流失', strength: 'secondary', reasons: undefined }])
  })

  it('空/非法报告返回空数组', () => {
    expect(resolveAttributions(null)).toEqual([])
    expect(resolveAttributions({})).toEqual([])
  })
})

describe('resolveSeverity', () => {
  it('只接受合法严重度枚举', () => {
    expect(resolveSeverity({ risk: { severity: 'high' } })).toBe('high')
    expect(resolveSeverity({ risk: { severity: 'crisis' } })).toBe('crisis')
    expect(resolveSeverity({ risk: { severity: 'unknown' } })).toBeUndefined()
    expect(resolveSeverity(null)).toBeUndefined()
  })
})

describe('hasAiManagedActionItems（方案页读取时判断是否需要补跑 AI 改写）', () => {
  it('有工具即需要改写', () => {
    expect(hasAiManagedActionItems({ tools: [{ title: '正念饮水', content: 'x' }], actions: [] })).toBe(true)
  })

  it('无工具但有归因建议行动（针对「…」）时需要改写', () => {
    expect(hasAiManagedActionItems({
      tools: [],
      actions: [{ title: '针对「情绪觉察薄弱」', detail: '每天记录' }]
    })).toBe(true)
  })

  it('只有确定性待办与教师自建行动时不需要改写', () => {
    expect(hasAiManagedActionItems({
      tools: [],
      actions: [
        { title: '建议完成深度诊断「情绪觉察量表」', detail: '...' },
        { title: '找学生聊一次', detail: '...' }
      ]
    })).toBe(false)
  })

  it('空方案返回 false', () => {
    expect(hasAiManagedActionItems({})).toBe(false)
    expect(hasAiManagedActionItems({ tools: [], actions: [] })).toBe(false)
  })
})

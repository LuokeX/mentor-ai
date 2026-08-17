import { describe, expect, it } from 'vitest'
import type { AttributionOutcome, RuleExecResult } from '../shared/contracts'
import {
  mergeActions,
  mergeAttributions,
  mergeGroupResults,
  mergeTools,
  severityRank,
  worseSeverity,
} from '../server/domain/plan-merge'

const attribution = (overrides: Partial<AttributionOutcome>): AttributionOutcome => ({
  code: 'AT_A',
  name: '归因A',
  rawScore: 1,
  share: 0.5,
  rank: 0,
  strength: 'primary',
  reasons: [],
  evidenceCodes: [],
  ...overrides,
})

const result = (overrides: Partial<RuleExecResult>): RuleExecResult => ({
  level: 'level-1',
  levelName: '等级一',
  severity: 'low',
  reasons: ['原因A'],
  blocked: false,
  matchedRuleIds: ['RULE-1'],
  attributions: [attribution({})],
  primaryAttribution: '归因A',
  secondaryAttributions: [],
  toolTags: ['tag-a'],
  computedValues: {},
  unavailableVariables: [],
  dimensions: { D_A: 2 },
  dimensionLabels: { D_A: '维度A' },
  actions: [{ title: '行动1', detail: '细节1', status: 'pending' }],
  tools: [{ title: '工具1', content: '正文1', code: 'TOOL-1' }],
  ...overrides,
})

describe('severityRank / worseSeverity', () => {
  it('严重度按 crisis > high > medium > low 排序', () => {
    expect(severityRank('crisis')).toBe(4)
    expect(severityRank('low')).toBe(1)
    expect(severityRank('unknown')).toBe(0)
    expect(severityRank()).toBe(0)
    expect(worseSeverity('medium', 'high')).toBe('high')
    expect(worseSeverity('high', 'crisis')).toBe('crisis')
  })

  it('并列时返回较新的评估（后者）', () => {
    expect(worseSeverity('medium', 'medium')).toBe('medium')
    expect(worseSeverity(undefined, 'low')).toBe('low')
  })
})

describe('mergeAttributions', () => {
  it('按提交顺序合并并按 code 去重，保留首次出现的项', () => {
    const first = [attribution({ code: 'AT_A', name: '归因A', strength: 'primary' })]
    const second = [
      attribution({ code: 'AT_B', name: '归因B', strength: 'primary' }),
      attribution({ code: 'AT_A', name: '归因A（重复）', strength: 'reference' }),
    ]
    const merged = mergeAttributions([first, second])
    expect(merged.map(item => item.code)).toEqual(['AT_A', 'AT_B'])
    expect(merged[0].name).toBe('归因A')
  })
})

describe('mergeTools / mergeActions', () => {
  it('工具按编码去重，保留先提交的工具', () => {
    const merged = mergeTools([
      [{ title: '工具1', content: '正文1', code: 'TOOL-1' }],
      [{ title: '工具2', content: '正文2', code: 'TOOL-2' }, { title: '工具1（旧版）', content: '正文1旧', code: 'TOOL-1' }],
    ])
    expect(merged.map(tool => tool.code)).toEqual(['TOOL-1', 'TOOL-2'])
    expect(merged[0].content).toBe('正文1')
  })

  it('无编码的工具按标题去重', () => {
    const merged = mergeTools([[{ title: '通用工具', content: 'a' }, { title: '通用工具', content: 'b' }]])
    expect(merged).toHaveLength(1)
  })

  it('行动项按标题+正文去重合并，保持顺序', () => {
    const merged = mergeActions([
      [{ title: '行动1', detail: '细节1', status: 'pending' }],
      [{ title: '行动2', detail: '细节2', status: 'pending' }, { title: '行动1', detail: '细节1', status: 'completed' }],
    ])
    expect(merged.map(action => action.title)).toEqual(['行动1', '行动2'])
  })
})

describe('mergeGroupResults', () => {
  it('空数组返回 null，过滤 blocked 结果', () => {
    expect(mergeGroupResults([])).toBeNull()
    expect(mergeGroupResults([result({ blocked: true })])).toBeNull()
  })

  it('严重度取组内最严重，等级取最近一次评估', () => {
    const merged = mergeGroupResults([
      result({ severity: 'medium', level: 'level-1', levelName: '一级' }),
      result({ severity: 'high', level: 'level-2', levelName: '二级' }),
    ])
    expect(merged?.severity).toBe('high')
    expect(merged?.level).toBe('level-2')
    expect(merged?.levelName).toBe('二级')
  })

  it('归因按组序合并去重，主归因取首张量表', () => {
    const merged = mergeGroupResults([
      result({ attributions: [attribution({ code: 'AT_A', name: '归因A', strength: 'primary' })] }),
      result({ attributions: [
        attribution({ code: 'AT_B', name: '归因B', strength: 'primary' }),
        attribution({ code: 'AT_C', name: '归因C', strength: 'secondary' }),
      ] }),
    ])
    expect(merged?.primaryAttribution).toBe('归因A')
    expect(merged?.secondaryAttributions).toEqual(['归因B', '归因C'])
  })

  it('维度并集取最大值，标签取并集', () => {
    const merged = mergeGroupResults([
      result({ dimensions: { D_A: 2, D_B: 4 }, dimensionLabels: { D_A: '维度A', D_B: '维度B' } }),
      result({ dimensions: { D_A: 3 }, dimensionLabels: { D_A: '维度A' } }),
    ])
    expect(merged?.dimensions).toEqual({ D_A: 3, D_B: 4 })
    expect(merged?.dimensionLabels).toEqual({ D_A: '维度A', D_B: '维度B' })
  })

  it('原因、规则、工具、行动项全部合并去重', () => {
    const merged = mergeGroupResults([
      result({
        reasons: ['原因A'],
        matchedRuleIds: ['RULE-1'],
        tools: [{ title: '工具1', content: '正文1', code: 'TOOL-1' }],
        actions: [{ title: '行动1', detail: '细节1', status: 'pending' }],
      }),
      result({
        reasons: ['原因B', '原因A'],
        matchedRuleIds: ['RULE-2', 'RULE-1'],
        tools: [{ title: '工具2', content: '正文2', code: 'TOOL-2' }],
        actions: [{ title: '行动2', detail: '细节2', status: 'pending' }],
      }),
    ])
    expect(merged?.reasons).toEqual(['原因A', '原因B'])
    expect(merged?.matchedRuleIds).toEqual(['RULE-1', 'RULE-2'])
    expect(merged?.tools.map(tool => tool.code)).toEqual(['TOOL-1', 'TOOL-2'])
    expect(merged?.actions.map(action => action.title)).toEqual(['行动1', '行动2'])
  })

  it('单量表合并结果与原结果等价（严重度/维度/归因不变）', () => {
    const single = result({ severity: 'medium' })
    const merged = mergeGroupResults([single])
    expect(merged?.severity).toBe('medium')
    expect(merged?.dimensions).toEqual(single.dimensions)
    expect(merged?.attributions).toHaveLength(1)
  })
})
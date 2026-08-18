import { describe, expect, it } from 'vitest'
import type { RuleExecResult } from '../shared/contracts'
import { isNoPlanNeeded } from '../server/domain/no-plan-needed'

const result = (overrides: Partial<RuleExecResult>): RuleExecResult => ({
  level: 'green',
  levelName: '状态良好',
  severity: 'low',
  reasons: [],
  blocked: false,
  matchedRuleIds: ['SG_GR_DEFAULT'],
  attributions: [],
  primaryAttribution: '',
  secondaryAttributions: [],
  toolTags: [],
  computedValues: {},
  unavailableVariables: [],
  dimensions: {},
  dimensionLabels: {},
  actions: [],
  tools: [],
  ...overrides,
})

describe('isNoPlanNeeded', () => {
  it('self_growth 绿色兜底且无归因/行动/工具时判定为无需方案', () => {
    expect(isNoPlanNeeded(result({}), 'self_growth')).toBe(true)
  })

  it('各模块的绿色兜底规则都能识别', () => {
    expect(isNoPlanNeeded(result({ matchedRuleIds: ['CS_GR_DEFAULT'] }), 'class_system')).toBe(true)
    expect(isNoPlanNeeded(result({ matchedRuleIds: ['HS_GR_DEFAULT'] }), 'home_school')).toBe(true)
    expect(isNoPlanNeeded(result({ matchedRuleIds: ['SC_GR_DEFAULT'] }), 'student_case')).toBe(true)
    expect(isNoPlanNeeded(result({ matchedRuleIds: ['LP_GR_DEFAULT'] }), 'learning_problem')).toBe(true)
  })

  it('非绿色级别不拦截（橙色/黄色仍需方案）', () => {
    expect(isNoPlanNeeded(result({ level: 'orange' }), 'self_growth')).toBe(false)
    expect(isNoPlanNeeded(result({ level: 'yellow' }), 'home_school')).toBe(false)
  })

  it('绿色但命中非兜底规则不拦截（如紫色待观察、A级）', () => {
    expect(isNoPlanNeeded(result({ matchedRuleIds: ['SC_GR_05'] }), 'student_case')).toBe(false)
    expect(isNoPlanNeeded(result({ matchedRuleIds: ['HS_GR_05'] }), 'home_school')).toBe(false)
  })

  it('有归因时不拦截', () => {
    expect(isNoPlanNeeded(result({ attributions: [{ code: 'SG_AT_01', name: '情绪耗竭', rawScore: 1, share: 1, rank: 0, strength: 'primary', reasons: [], evidenceCodes: [] }] }), 'self_growth')).toBe(false)
  })

  it('有行动时不拦截', () => {
    expect(isNoPlanNeeded(result({ actions: [{ title: '行动1', detail: '细节1', status: 'pending' }] }), 'self_growth')).toBe(false)
  })

  it('绿色兜底且匹配到通用工具时仍判定无需方案（工具与是否有问题无关）', () => {
    expect(isNoPlanNeeded(result({ tools: [{ title: '478呼吸法', content: '正文' }] }), 'self_growth')).toBe(true)
  })

  it('熔断结果永不拦截', () => {
    expect(isNoPlanNeeded(result({ blocked: true }), 'self_growth')).toBe(false)
  })

  it('组内多张量表都命中同一兜底规则时仍判定无需方案', () => {
    expect(isNoPlanNeeded(result({ matchedRuleIds: ['SG_GR_DEFAULT', 'SG_GR_DEFAULT'] }), 'self_growth')).toBe(true)
  })

  it('组内混入其他规则时不拦截', () => {
    expect(isNoPlanNeeded(result({ matchedRuleIds: ['SG_GR_DEFAULT', 'SG_GR_AUTO_01'] }), 'self_growth')).toBe(false)
  })
})
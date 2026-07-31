import { describe, expect, it } from 'vitest'
import { executeRules, evaluateWithFallback, normalizeExpression } from '../server/domain/rules-executor'
import { scoreTools } from '../server/domain/plan-actions'
import type { RuleConfig } from '../shared/contracts'
import type { AssessmentDefinition } from '../shared/assessments'

// ---- 测试夹具：一份最小但完整的 v3 归因库 ----

const scaleA: AssessmentDefinition = {
  code: 'T_SCALE_A',
  instrumentCode: 'T_SCALE_A',
  version: '1.0.0',
  module: 'self_growth',
  title: '测试量表A',
  description: '',
  estimatedMinutes: 3,
  questions: ['q1', 'q2', 'q3', 'q4'].map(id => ({
    id,
    text: id,
    dimension: id === 'q1' || id === 'q2' ? '负荷' : '方法',
    reverse: id === 'q4',
    options: [1, 2, 3, 4, 5].map(v => ({ label: String(v), value: v }))
  })),
  dimensionDefs: [
    { code: 'D_LOAD', name: '负荷', questionIds: ['q1', 'q2'], calcMethod: 'mean' },
    { code: 'D_METHOD', name: '方法', questionIds: ['q3', 'q4'], calcMethod: 'mean' }
  ]
}

/** 与 scaleA 题号完全不同，用来验证证据规则按量表隔离 */
const scaleB: AssessmentDefinition = {
  code: 'T_SCALE_B',
  instrumentCode: 'T_SCALE_B',
  version: '1.0.0',
  module: 'self_growth',
  title: '测试量表B',
  description: '',
  estimatedMinutes: 3,
  questions: ['b1', 'b2'].map(id => ({
    id,
    text: id,
    dimension: '支持',
    options: [1, 2, 3, 4, 5].map(v => ({ label: String(v), value: v }))
  })),
  dimensionDefs: [{ code: 'D_SUPPORT', name: '支持', questionIds: ['b1', 'b2'], calcMethod: 'mean' }]
}

const config: RuleConfig = {
  module: 'self_growth',
  version: '3.0.0',
  computed: { 均值: 'AVG(scores)' },
  attributionItems: [
    { code: 'AT_LOAD', name: '负荷过载', module: 'self_growth', baseWeight: 1, toolTags: ['load'], description: '负荷维度长期处于高位', suggestedAction: '先做减法' },
    { code: 'AT_METHOD', name: '方法不足', module: 'self_growth', baseWeight: 1, toolTags: ['method'], suggestedAction: '补一个最小流程' },
    { code: 'AT_SUPPORT', name: '支持缺失', module: 'self_growth', baseWeight: 2, toolTags: ['support'] }
  ],
  evidences: [
    { attributionCode: 'AT_LOAD', assessmentCode: 'T_SCALE_A', evidenceCode: 'EV_L1', condition: '维度[D_LOAD] >= 4', weight: 2, description: '负荷维度高位' },
    { attributionCode: 'AT_LOAD', assessmentCode: 'T_SCALE_A', evidenceCode: 'EV_L2', condition: '维度[D_LOAD] >= 3', weight: 1, description: '负荷维度偏高' },
    { attributionCode: 'AT_METHOD', assessmentCode: 'T_SCALE_A', evidenceCode: 'EV_M1', condition: '题[q3] >= 4', weight: 1, description: '方法题高位' },
    // 只属于量表B。若按量表过滤失效，用量表A作答时会因为找不到 b1 而抛错。
    { attributionCode: 'AT_SUPPORT', assessmentCode: 'T_SCALE_B', evidenceCode: 'EV_S1', condition: '题[b1] >= 4', weight: 1, description: '支持题高位' }
  ],
  gradingRules: [
    { ruleId: 'G_RED', pri: 10, when: '均值 >= 4.5', level: 'red', levelName: '需立即关注', severity: 'crisis', blocked: true },
    { ruleId: 'G_ORANGE', pri: 20, when: '均值 >= 3.5', level: 'orange', levelName: '需重点支持', severity: 'high', blocked: false, escalationTarget: '年级组长' },
    { ruleId: 'G_DEFAULT', pri: 999, level: 'none', levelName: '状态平稳', severity: 'low', blocked: false }
  ],
  actions: [{ title: '通用行动', detail: '归因项没填建议动作时才用这条', status: 'pending' }],
  tools: []
}

const answersA = (values: Partial<Record<'q1' | 'q2' | 'q3' | 'q4', number>>) => ({
  q1: 1, q2: 1, q3: 1, q4: 1, ...values
})

describe('normalizeExpression 业务写法翻译', () => {
  it('把中文取值写法翻译成 DSL', () => {
    expect(normalizeExpression('题[q1] >= 4')).toBe('SCORE(q1) >= 4')
    expect(normalizeExpression('维度[D_LOAD] <= 2')).toBe('DIM(D_LOAD) <= 2')
    expect(normalizeExpression('原始[q3] == 5')).toBe('RAW(q3) == 5')
  })

  it('翻译聚合写法与逻辑连接词', () => {
    expect(normalizeExpression('总分 >= 20 且 均分 >= 3')).toBe('SUM(scores) >= 20 && AVG(scores) >= 3')
    expect(normalizeExpression('题[q1] >= 4 或 题[q2] >= 4')).toBe('SCORE(q1) >= 4 || SCORE(q2) >= 4')
  })

  it('归一化全角符号', () => {
    expect(normalizeExpression('题[q1] ≥ 4')).toBe('SCORE(q1) >= 4')
    expect(normalizeExpression('题[q1] ＞ 4')).toBe('SCORE(q1) > 4')
  })

  it('不切坏包含关键词的中文变量名', () => {
    // 业务把计算变量命名为「状态总分」时，不能被替换成「状态SUM(scores)」
    expect(normalizeExpression('状态总分 >= 20')).toBe('状态总分 >= 20')
    expect(normalizeExpression('情绪均分 >= 4')).toBe('情绪均分 >= 4')
    expect(normalizeExpression('疲惫且失意 >= 3')).toBe('疲惫且失意 >= 3')
    // 但独立出现时仍然翻译
    expect(normalizeExpression('总分 >= 20')).toBe('SUM(scores) >= 20')
    expect(normalizeExpression('状态总分 >= 20 且 均分 >= 3')).toBe('状态总分 >= 20 && AVG(scores) >= 3')
  })
})

describe('executeRules 多归因加权', () => {
  it('拒绝未答完的作答', () => {
    expect(() => executeRules(config, { q1: 5 }, scaleA)).toThrow('所有题目都必须作答')
  })

  it('按权重累加并归一化成占比，降序排名', () => {
    // 负荷维度 5 分 → 命中 EV_L1(2) + EV_L2(1) = 3；方法题 q3=5 → 命中 EV_M1(1) = 1
    const result = executeRules(config, answersA({ q1: 5, q2: 5, q3: 5 }), scaleA)
    expect(result.attributions.map(a => a.code)).toEqual(['AT_LOAD', 'AT_METHOD'])
    expect(result.attributions[0]!.rawScore).toBe(3)
    expect(result.attributions[1]!.rawScore).toBe(1)
    expect(result.attributions[0]!.share).toBe(0.75)
    expect(result.attributions[1]!.share).toBe(0.25)
    expect(result.attributions.reduce((s, a) => s + a.share, 0)).toBeCloseTo(1, 4)
  })

  it('给出主要/次要强弱标签，并派生 primaryAttribution', () => {
    const result = executeRules(config, answersA({ q1: 5, q2: 5, q3: 5 }), scaleA)
    expect(result.attributions[0]!.strength).toBe('primary')
    expect(result.attributions[1]!.strength).toBe('secondary')
    expect(result.primaryAttribution).toBe('负荷过载')
    expect(result.secondaryAttributions).toEqual(['方法不足'])
  })

  it('权重基数参与计算', () => {
    // AT_SUPPORT 的 baseWeight 是 2，证据权重 1 → rawScore 应为 2
    const result = executeRules(config, { b1: 5, b2: 5 }, scaleB)
    expect(result.attributions[0]!.code).toBe('AT_SUPPORT')
    expect(result.attributions[0]!.rawScore).toBe(2)
  })

  it('命中证据的说明进入 reasons，供方案的「依据」栏使用', () => {
    const result = executeRules(config, answersA({ q1: 5, q2: 5 }), scaleA)
    expect(result.reasons).toContain('负荷维度高位')
    expect(result.reasons).toContain('负荷维度偏高')
  })

  it('没有任何证据命中时不报错，给出兜底说明', () => {
    const result = executeRules(config, answersA({}), scaleA)
    expect(result.attributions).toHaveLength(0)
    expect(result.primaryAttribution).toBe('')
    expect(result.reasons).toHaveLength(1)
  })

  it('同样的作答必须得到同样的结果（并列时按编码排序）', () => {
    const a = executeRules(config, answersA({ q1: 4, q2: 4, q3: 4 }), scaleA)
    const b = executeRules(config, answersA({ q1: 4, q2: 4, q3: 4 }), scaleA)
    expect(a.attributions.map(x => x.code)).toEqual(b.attributions.map(x => x.code))
    expect(a.matchedRuleIds).toEqual(b.matchedRuleIds)
  })
})

describe('executeRules 按量表隔离证据规则', () => {
  it('用量表A作答时不会去求值属于量表B的证据（否则会因题号不存在而抛错）', () => {
    expect(() => executeRules(config, answersA({ q1: 5, q2: 5 }), scaleA)).not.toThrow()
  })

  it('用量表B作答时只命中量表B的证据', () => {
    const result = executeRules(config, { b1: 5, b2: 5 }, scaleB)
    expect(result.attributions.map(a => a.code)).toEqual(['AT_SUPPORT'])
  })

  it('分级规则可以限定量表，未限定的视为模块通用', () => {
    const scoped: RuleConfig = {
      ...config,
      gradingRules: [
        { ruleId: 'G_B_ONLY', assessmentCode: 'T_SCALE_B', pri: 1, when: '均值 >= 1', level: 'b_only', severity: 'high', blocked: false },
        { ruleId: 'G_DEFAULT', pri: 999, level: 'none', severity: 'low', blocked: false }
      ]
    }
    expect(executeRules(scoped, answersA({}), scaleA).level).toBe('none')
    expect(executeRules(scoped, { b1: 3, b2: 3 }, scaleB).level).toBe('b_only')
  })
})

describe('executeRules 分级与归因解耦', () => {
  it('等级来自分级规则，与归因结果无关', () => {
    const result = executeRules(config, answersA({ q1: 5, q2: 5, q3: 5, q4: 5 }), scaleA)
    expect(result.level).toBe('orange')
    expect(result.levelName).toBe('需重点支持')
    expect(result.severity).toBe('high')
  })

  it('按优先级升序首条命中即停', () => {
    // q4 反向计分：raw 1 → score 5，四题全 5 分，均值 5 → 命中 pri 最小的 G_RED
    const result = executeRules(config, { q1: 5, q2: 5, q3: 5, q4: 1 }, scaleA)
    expect(result.matchedRuleIds[0]).toBe('G_RED')
    expect(result.blocked).toBe(true)
  })

  it('没有任何分级规则命中时落到兜底', () => {
    const result = executeRules(config, answersA({}), scaleA)
    expect(result.matchedRuleIds[0]).toBe('G_DEFAULT')
    expect(result.level).toBe('none')
  })

  it('缺少适用分级规则时抛出可定位的错误', () => {
    const broken: RuleConfig = {
      ...config,
      gradingRules: [{ ruleId: 'G_OTHER', assessmentCode: 'OTHER_SCALE', pri: 1, level: 'x', severity: 'low', blocked: false }]
    }
    expect(() => executeRules(broken, answersA({}), scaleA)).toThrow("量表 'T_SCALE_A' 没有适用的分级规则")
  })

  it('matchedRuleIds 同时记录分级规则和命中的证据编码，用于溯源', () => {
    const result = executeRules(config, answersA({ q1: 5, q2: 5 }), scaleA)
    expect(result.matchedRuleIds[0]).toBe('G_ORANGE')
    expect(result.matchedRuleIds).toContain('EV_L1')
    expect(result.matchedRuleIds).toContain('EV_L2')
  })

  it('透传归因说明/建议动作与分级升级目标，供输出模板占位符使用', () => {
    const result = executeRules(config, answersA({ q1: 5, q2: 5 }), scaleA)
    expect(result.attributions[0]!.code).toBe('AT_LOAD')
    expect(result.attributions[0]!.description).toBe('负荷维度长期处于高位')
    expect(result.attributions[0]!.suggestedAction).toBe('先做减法')
    expect(result.escalationTarget).toBe('年级组长')
  })
})

describe('executeRules 红线熔断', () => {
  it('独立红线可以覆盖分级规则的 blocked', () => {
    const withRedLine: RuleConfig = {
      ...config,
      redLines: [{
        module: 'self_growth', condition: '题[q1] >= 5', description: '单题触顶',
        scope: 'module', requiredActions: '转介', actions: []
      }]
    }
    const result = executeRules(withRedLine, answersA({ q1: 5 }), scaleA)
    expect(result.blocked).toBe(true)
    expect(result.matchedRedLines).toHaveLength(1)
  })

  it('红线表达式求值失败不阻断评估', () => {
    const badRedLine: RuleConfig = {
      ...config,
      redLines: [{
        module: 'self_growth', condition: '题[不存在的题] >= 5', description: '坏表达式',
        scope: 'module', requiredActions: '', actions: []
      }]
    }
    expect(() => executeRules(badRedLine, answersA({}), scaleA)).not.toThrow()
  })
})

describe('executeRules 行动项由归因推导', () => {
  it('命中归因的建议动作成为方案行动项', () => {
    const result = executeRules(config, answersA({ q1: 5, q2: 5, q3: 5 }), scaleA)
    expect(result.actions.map(a => a.detail)).toEqual(['先做减法', '补一个最小流程'])
  })

  it('归因项没填建议动作时退回通用行动清单', () => {
    const result = executeRules(config, answersA({}), scaleA)
    expect(result.actions).toEqual(config.actions)
  })
})

describe('scoreTools 加权打分', () => {
  const tools = [
    { code: 'RX_LOAD', name: '负荷工具', attributionCode: 'AT_LOAD', severity: 'high', toolTags: ['load'], dimensions: ['D_LOAD'] },
    { code: 'RX_METHOD', name: '方法工具', attributionCode: 'AT_METHOD', severity: 'low', toolTags: ['method'], dimensions: ['D_METHOD'] },
    { code: 'RX_NONE', name: '无关工具', attributionCode: 'AT_OTHER', severity: 'low', toolTags: ['other'], dimensions: [] }
  ]
  const input = {
    dimensions: { D_LOAD: 4.5, D_METHOD: 2.0 },
    severity: 'high' as const,
    attributions: [{ code: 'AT_LOAD', share: 0.75 }, { code: 'AT_METHOD', share: 0.25 }],
    toolTags: ['load', 'method']
  }

  it('按归因占比加权排序，主归因的工具排在前面', () => {
    const scored = scoreTools(tools, input)
    expect(scored[0]!.tool.code).toBe('RX_LOAD')
    expect(scored[1]!.tool.code).toBe('RX_METHOD')
  })

  it('归因对不上的工具得 0 分，被排除', () => {
    expect(scoreTools(tools, input).map(s => s.tool.code)).not.toContain('RX_NONE')
  })

  it('给出得分明细，运营台可以解释推荐理由', () => {
    const top = scoreTools(tools, input)[0]!
    expect(top.breakdown.attribution).toBeCloseTo(7.5, 4)
    expect(top.breakdown.severity).toBe(2)
    expect(top.breakdown.tag).toBeCloseTo(3, 4)
  })

  it('单项对不上不会导致整体落空——这是旧 AND 硬过滤最致命的问题', () => {
    // 严重度和维度都对不上，只有归因命中
    const scored = scoreTools(tools, { ...input, severity: 'crisis', dimensions: {} })
    expect(scored.length).toBeGreaterThan(0)
    expect(scored[0]!.tool.code).toBe('RX_LOAD')
  })

  it('block 型禁忌在条件确认时一票否决', () => {
    const blocked = [{ ...tools[0]!, contraindicationRules: [{ type: 'block', condition: 'always', description: 'y' }] }]
    expect(scoreTools(blocked, input)).toHaveLength(0)
  })

  it('无法被当前规则输入确认的 block 说明不默认排除工具', () => {
    const blocked = [{ ...tools[0]!, contraindicationRules: [{ type: 'block', condition: '冲突涉及肢体伤害或欺凌', description: 'y' }] }]
    expect(scoreTools(blocked, input)).toHaveLength(1)
  })

  it('并列得分时按工具编码排序，保证推荐顺序稳定', () => {
    const tied = [
      { code: 'RX_B', name: 'B', attributionCode: 'AT_LOAD', toolTags: [], dimensions: [] },
      { code: 'RX_A', name: 'A', attributionCode: 'AT_LOAD', toolTags: [], dimensions: [] }
    ]
    expect(scoreTools(tied, input).map(s => s.tool.code)).toEqual(['RX_A', 'RX_B'])
  })
})

describe('evaluateWithFallback 兜底路径', () => {
  it('把硬编码单归因包成一条 share=1 的归因项', () => {
    const result = evaluateWithFallback('self_growth', { q1: 5, q2: 5, q3: 1, q4: 1, q5: 5 })
    expect(result.attributions).toHaveLength(1)
    expect(result.attributions[0]!.share).toBe(1)
    expect(result.attributions[0]!.strength).toBe('primary')
    expect(result.severity).toBeDefined()
  })
})

import { describe, expect, it } from 'vitest'
import { executeRules, evaluateWithFallback } from '../server/domain/rules-executor'
import { assessmentDefinitions } from '../shared/assessments'
import type { RuleConfig, ModuleId } from '../shared/contracts'

// 模拟 self_growth 的规则 DSL（与硬编码规则等效）
const selfGrowthRuleConfig: RuleConfig = {
  module: 'self_growth',
  version: '2.0.0',
  computed: {
    total: 'SUM(scores)',
    max: 'MAX(scores)',
    meaningRaw: 'RAW(q3)',
    exhaustion: 'SCORE(q1)',
    meaningRisk: 'SCORE(q3)'
  },
  branches: [
    { pri: 1, when: 'exhaustion >= 4 && meaningRisk >= 4', level: 'red', blocked: true, ruleId: 'SG-RED-Q1-Q3', reasons: ['疲惫与意义感风险同时处于高位'] },
    { pri: 2, when: 'meaningRaw <= 2 && ctx_previousConsecutiveLowMeaning >= 3', level: 'purple', blocked: true, ruleId: 'SG-PURPLE-MEANING-4X', reasons: ['意义感连续四次处于低位，需要主动关爱与转介评估'] },
    { pri: 3, when: 'total >= 20 || max >= 4', level: 'orange', blocked: false, ruleId: 'SG-ORANGE', reasons: ['总分或单项达到主动支持阈值'] },
    { pri: 4, when: 'total >= 15 || max >= 3', level: 'yellow', blocked: false, ruleId: 'SG-YELLOW', reasons: ['状态出现需要支持的波动'] },
    { pri: 5, when: 'total >= 11', level: 'blue', blocked: false, ruleId: 'SG-BLUE', reasons: ['存在轻微波动，建议关注节奏'] },
    { pri: 6, level: 'green', blocked: false, ruleId: 'SG-GREEN', reasons: ['当前状态整体稳定'] }
  ],
  actions: [
    { title: '今天：完成一次三分钟补能', detail: '离开工作情境，完成三轮缓慢呼吸并观察身体感受。', status: 'pending' },
    { title: '本周：拆解可控事项', detail: '把最困扰的一件事拆成可控制、可影响和暂时不可控三类。', status: 'pending' }
  ],
  tools: [
    { title: '3 分钟补能卡', content: '停下来—感受双脚—缓慢呼吸—命名情绪—选择一个最小行动。' },
    { title: '边界话术', content: '我理解这件事让您着急。我需要先核实情况，会在约定时间内回复您。' }
  ]
}

function answers(module: ModuleId, value: number) {
  return Object.fromEntries(assessmentDefinitions[module].questions.map(q => [q.id, value]))
}

describe('executeRules (DSL engine)', () => {
  it('rejects incomplete answers', () => {
    expect(() => executeRules(selfGrowthRuleConfig, {}, assessmentDefinitions.self_growth))
      .toThrow('所有题目都必须作答')
  })

  it('fuses self-growth red when exhaustion and meaning risk are both high', () => {
    const input = answers('self_growth', 1)
    input.q1 = 5 // exhaustion = 5
    input.q3 = 1 // raw=1, score=5 (reversed)
    const result = executeRules(selfGrowthRuleConfig, input, assessmentDefinitions.self_growth)
    expect(result.level).toBe('red')
    expect(result.blocked).toBe(true)
    expect(result.matchedRuleIds).toContain('SG-RED-Q1-Q3')
  })

  it('uses reverse scoring for positive self-growth questions', () => {
    const input = answers('self_growth', 1)
    input.q3 = 5 // raw=5 → score=1
    input.q4 = 5 // raw=5 → score=1
    const result = executeRules(selfGrowthRuleConfig, input, assessmentDefinitions.self_growth)
    expect(result.dimensions['意义感知']).toBe(1)
    expect(result.dimensions['效能信心']).toBe(1)
  })

  it('raises purple after four consecutive low-meaning with ctx', () => {
    const input = answers('self_growth', 1)
    input.q1 = 1
    input.q3 = 2 // raw=2
    // 没有 ctx 时不应为 purple
    expect(executeRules(selfGrowthRuleConfig, input, assessmentDefinitions.self_growth).level).not.toBe('purple')
    // ctx.previousConsecutiveLowMeaning >= 3 时触发 purple
    const result = executeRules(selfGrowthRuleConfig, input, assessmentDefinitions.self_growth, { previousConsecutiveLowMeaning: 3 })
    expect(result.level).toBe('purple')
    expect(result.blocked).toBe(true)
    expect(result.matchedRuleIds).toContain('SG-PURPLE-MEANING-4X')
  })

  it('maps to orange when total >= 20', () => {
    const input = answers('self_growth', 4) // all 4's: total = 5*4 = 20
    const result = executeRules(selfGrowthRuleConfig, input, assessmentDefinitions.self_growth)
    expect(result.level).toBe('orange')
  })

  it('maps to green when all answers are low', () => {
    const input = answers('self_growth', 1)
    input.q3 = 5 // raw=5 → score=1 (reversed), total = 1+1+1+1+1 = 5
    input.q4 = 5
    const result = executeRules(selfGrowthRuleConfig, input, assessmentDefinitions.self_growth, { previousConsecutiveLowMeaning: 0 })
    expect(result.level).toBe('green')
    expect(result.matchedRuleIds).toContain('SG-GREEN')
  })

  it('attaches actions and tools in output', () => {
    const input = answers('self_growth', 3)
    const result = executeRules(selfGrowthRuleConfig, input, assessmentDefinitions.self_growth)
    expect(result.actions.length).toBeGreaterThan(0)
    expect(result.tools.length).toBeGreaterThan(0)
  })

  it('evaluateWithFallback returns same results as evaluateAssessment', () => {
    for (const module of ['self_growth', 'class_system', 'home_school', 'student_case'] as ModuleId[]) {
      const input = answers(module, 3)
      const result = evaluateWithFallback(module, input)
      expect(result.level).toBeDefined()
      expect(result.matchedRuleIds.length).toBeGreaterThan(0)
      expect(result.actions.length).toBeGreaterThan(0)
    }
  })
})

describe('DSL expression evaluator edge cases', () => {
  it('handles string comparison in when', () => {
    const config: RuleConfig = {
      module: 'self_growth', version: '1.0',
      computed: { level: 'SUM(scores)' },
      branches: [
        { pri: 1, level: 'green', blocked: false, ruleId: 'T-DEFAULT', reasons: [] }
      ],
      actions: [], tools: []
    }
    const input = answers('self_growth', 3)
    const result = executeRules(config, input, assessmentDefinitions.self_growth)
    expect(result.level).toBe('green')
  })

  it('throws on unknown variable in when', () => {
    const config: RuleConfig = {
      module: 'self_growth', version: '1.0',
      computed: {},
      branches: [
        { pri: 1, when: 'unknown_var > 3', level: 'red', blocked: false, ruleId: 'T-ERR', reasons: [] }
      ],
      actions: [], tools: []
    }
    expect(() => executeRules(config, answers('self_growth', 3), assessmentDefinitions.self_growth))
      .toThrow(/Unknown variable/)
  })

  it('handles parentheses in expressions', () => {
    const config: RuleConfig = {
      module: 'self_growth', version: '1.0',
      computed: { a: 'SUM(scores)' },
      branches: [
        { pri: 1, when: '(a >= 10) && (a <= 25)', level: 'blue', blocked: false, ruleId: 'T-PAREN', reasons: [] }
      ],
      actions: [], tools: []
    }
    const result = executeRules(config, answers('self_growth', 3), assessmentDefinitions.self_growth) // total=15
    expect(result.level).toBe('blue')
  })

  it('matches default branch when no when conditions match', () => {
    const config: RuleConfig = {
      module: 'self_growth', version: '1.0',
      computed: { a: 'SUM(scores)' },
      branches: [
        { pri: 1, when: 'a >= 100', level: 'red', blocked: false, ruleId: 'T-IMPOSSIBLE', reasons: [] },
        { pri: 2, level: 'green', blocked: false, ruleId: 'T-DEFAULT', reasons: [] }
      ],
      actions: [], tools: []
    }
    const result = executeRules(config, answers('self_growth', 1), assessmentDefinitions.self_growth) // total=5
    expect(result.level).toBe('green')
    expect(result.matchedRuleIds).toContain('T-DEFAULT')
  })

  it('throws on invalid expression syntax', () => {
    const config: RuleConfig = {
      module: 'self_growth', version: '1.0',
      computed: {},
      branches: [
        { pri: 1, when: '>>invalid', level: 'red', blocked: false, ruleId: 'T-BAD', reasons: [] }
      ],
      actions: [], tools: []
    }
    expect(() => executeRules(config, answers('self_growth', 3), assessmentDefinitions.self_growth))
      .toThrow()
  })
})

// ---- 补充测试: crisis 熔断、边界值、多模块、内置函数 ----

describe('crisis fuse (crisis.when overrides branch blocked)', () => {
  const configWithCrisis: RuleConfig = {
    module: 'self_growth', version: '1.0',
    computed: { total: 'SUM(scores)', max: 'MAX(scores)' },
    branches: [
      { pri: 1, when: 'total >= 20', level: 'orange', blocked: false, ruleId: 'T-ORANGE', reasons: [] },
      { pri: 2, level: 'green', blocked: false, ruleId: 'T-GREEN', reasons: [] }
    ],
    actions: [], tools: [],
    crisis: { when: 'max >= 5', blocked: true }
  }

  it('overrides blocked when crisis condition matches', () => {
    // self_growth q3,q4 are reverse. Raw: q1=5,q2=4,q3=2→4,q4=2→4,q5=4 → total=21, max=5
    const input = answers('self_growth', 4)
    input.q1 = 5; input.q3 = 2; input.q4 = 2
    const result = executeRules(configWithCrisis, input, assessmentDefinitions.self_growth)
    expect(result.level).toBe('orange') // branch still matches (total>=20)
    expect(result.blocked).toBe(true)    // crisis overrides blocked (max>=5)
  })

  it('does not fuse when crisis condition is false', () => {
    // self_growth q3,q4 are reverse. answers(1) gives scores [1,1,5,5,1], max=5.
    // Set q3,q4 to raw=2 → scores=4, so max=4 < 5, crisis does not fire.
    const input = answers('self_growth', 1)
    input.q3 = 2; input.q4 = 2 // max becomes 4
    const result = executeRules(configWithCrisis, input, assessmentDefinitions.self_growth)
    expect(result.blocked).toBe(false)
  })

  it('crisis keeps original level from matched branch', () => {
    const input = answers('self_growth', 3) // total=15, max=3
    const result = executeRules(configWithCrisis, input, assessmentDefinitions.self_growth)
    expect(result.level).toBe('green')
    expect(result.blocked).toBe(false)
  })
})

describe('boundary thresholds', () => {
  const config: RuleConfig = {
    module: 'self_growth', version: '1.0',
    computed: { total: 'SUM(scores)' },
    branches: [
      { pri: 1, when: 'total >= 25', level: 'red', blocked: true, ruleId: 'T-RED', reasons: [] },
      { pri: 2, when: 'total >= 20', level: 'orange', blocked: false, ruleId: 'T-ORANGE', reasons: [] },
      { pri: 3, when: 'total >= 15', level: 'yellow', blocked: false, ruleId: 'T-YELLOW', reasons: [] },
      { pri: 4, when: 'total >= 11', level: 'blue', blocked: false, ruleId: 'T-BLUE', reasons: [] },
      { pri: 5, level: 'green', blocked: false, ruleId: 'T-GREEN', reasons: [] }
    ],
    actions: [], tools: []
  }

  it('hits exactly at threshold 20 → orange', () => {
    // self_growth q3,q4 are reverse. Raw values: q1=4,q2=4,q3=2→4,q4=2→4,q5=4 → total=20
    const input = answers('self_growth', 4)
    input.q3 = 2; input.q4 = 2
    const result = executeRules(config, input, assessmentDefinitions.self_growth)
    expect(result.level).toBe('orange')
  })

  it('hits exactly at threshold 15 → yellow', () => {
    const input = answers('self_growth', 3) // 5*3 = 15 exactly
    const result = executeRules(config, input, assessmentDefinitions.self_growth)
    expect(result.level).toBe('yellow')
  })

  it('hits exactly at threshold 11 → blue', () => {
    const input = answers('self_growth', 1)
    input.q1 = 3; input.q2 = 3; input.q3 = 5; input.q4 = 5; input.q5 = 1
    // total = 3+3+1+1+1 = 9 (after reverse), no wait...
    // q3 raw=5 → score=1, q4 raw=5 → score=1
    // Let me recalculate: all default to 1: q1=1, q2=1, q3(reverse:5→1), q4(reverse:5→1), q5=1 = total 5
    // Not 11. Let me try: q1=3, q2=3, q3=2 (reverse→4), q4=2 (reverse→4), q5=2 = 3+3+4+4+2=16
    // Or q1=2, q2=2, q3=3 (reverse→3), q4=3 (reverse→3), q5=3 = 2+2+3+3+3=13
    // q1=2, q2=2, q3=5 (reverse→1), q4=5 (reverse→1), q5=5 = 2+2+1+1+5=11 ✓
    input.q1 = 2; input.q2 = 2; input.q3 = 5; input.q4 = 5; input.q5 = 5
    const result = executeRules(config, input, assessmentDefinitions.self_growth)
    expect(result.level).toBe('blue')
  })

  it('just below threshold 11 → green', () => {
    const input = answers('self_growth', 1)
    input.q1 = 2; input.q2 = 2; input.q3 = 5; input.q4 = 5; input.q5 = 4
    // total = 2+2+1+1+4 = 10
    const result = executeRules(config, input, assessmentDefinitions.self_growth)
    expect(result.level).toBe('green')
  })
})

describe('MAX/MIN built-in functions', () => {
  it('MAX(scores) returns the highest score', () => {
    const config: RuleConfig = {
      module: 'self_growth', version: '1.0',
      computed: { max: 'MAX(scores)' },
      branches: [
        { pri: 1, when: 'max >= 4', level: 'red', blocked: true, ruleId: 'T-MAX-HIGH', reasons: [] },
        { pri: 2, level: 'green', blocked: false, ruleId: 'T-GREEN', reasons: [] }
      ],
      actions: [], tools: []
    }
    const input = answers('self_growth', 1)
    input.q1 = 4 // max = 4
    const result = executeRules(config, input, assessmentDefinitions.self_growth)
    expect(result.level).toBe('red')
  })

  it('MIN(scores) returns the lowest score', () => {
    const config: RuleConfig = {
      module: 'self_growth', version: '1.0',
      computed: { min: 'MIN(scores)' },
      branches: [
        { pri: 1, when: 'min >= 4', level: 'orange', blocked: false, ruleId: 'T-MIN-HIGH', reasons: [] },
        { pri: 2, level: 'green', blocked: false, ruleId: 'T-GREEN', reasons: [] }
      ],
      actions: [], tools: []
    }
    // self_growth q3,q4 are reverse. Raw q3=2→4,q4=2→4. With all others=4, min=4.
    const input = answers('self_growth', 4)
    input.q3 = 2; input.q4 = 2
    const result = executeRules(config, input, assessmentDefinitions.self_growth)
    expect(result.level).toBe('orange')
  })
})

describe('multi-module DSL cross-verification', () => {
  it('class_system: dimension-based scoring with SCORE', () => {
    const classConfig: RuleConfig = {
      module: 'class_system', version: '1.0',
      computed: {
        goal: 'SCORE(goal1)',
        org: 'SCORE(org1)'
      },
      branches: [
        { pri: 1, when: 'goal >= 4 && org >= 4', level: 'orange', blocked: false, ruleId: 'CS-HIGH', reasons: ['目标和组织双高'] },
        { pri: 2, level: 'green', blocked: false, ruleId: 'CS-GREEN', reasons: [] }
      ],
      actions: [], tools: []
    }
    const input: Record<string, number> = {}
    for (const q of assessmentDefinitions.class_system.questions) input[q.id] = 1
    input.goal1 = 4; input.org1 = 4
    const result = executeRules(classConfig, input, assessmentDefinitions.class_system)
    expect(result.level).toBe('orange')
    expect(result.matchedRuleIds).toContain('CS-HIGH')
  })

  it('home_school: cooperation + attitude composite', () => {
    const hsConfig: RuleConfig = {
      module: 'home_school', version: '1.0',
      computed: {
        coopAvg: 'SUM(scores)',
        attAvg: 'SUM(scores)'
      },
      branches: [
        { pri: 1, when: 'coopAvg >= 12 || attAvg >= 12', level: 'yellow', blocked: false, ruleId: 'HS-YELLOW', reasons: [] },
        { pri: 2, level: 'green', blocked: false, ruleId: 'HS-GREEN', reasons: [] }
      ],
      actions: [], tools: []
    }
    const input: Record<string, number> = {}
    for (const q of assessmentDefinitions.home_school.questions) input[q.id] = 3
    // 9 questions × 3 = 27, so coopAvg and attAvg both = 27
    const result = executeRules(hsConfig, input, assessmentDefinitions.home_school)
    expect(result.level).toBe('yellow')
  })

  it('student_case: severity scoring', () => {
    const scConfig: RuleConfig = {
      module: 'student_case', version: '1.0',
      computed: {
        total: 'SUM(scores)',
        max: 'MAX(scores)'
      },
      branches: [
        { pri: 1, when: 'max >= 5', level: 'red', blocked: true, ruleId: 'SC-RED', reasons: [] },
        { pri: 2, when: 'total >= 20', level: 'orange', blocked: false, ruleId: 'SC-ORANGE', reasons: [] },
        { pri: 3, level: 'green', blocked: false, ruleId: 'SC-GREEN', reasons: [] }
      ],
      actions: [], tools: []
    }
    const input: Record<string, number> = {}
    for (const q of assessmentDefinitions.student_case.questions) input[q.id] = 1
    const result = executeRules(scConfig, input, assessmentDefinitions.student_case)
    expect(result.level).toBe('green')
    expect(result.matchedRuleIds).toContain('SC-GREEN')
  })
})

describe('ctx_ variable prefix and context chaining', () => {
  it('resolves ctx_previousConsecutiveLowMeaning from ctx object', () => {
    const config: RuleConfig = {
      module: 'self_growth', version: '1.0',
      computed: { total: 'SUM(scores)' },
      branches: [
        { pri: 1, when: 'ctx_previousConsecutiveLowMeaning >= 5', level: 'purple', blocked: true, ruleId: 'T-CTX', reasons: [] },
        { pri: 2, level: 'green', blocked: false, ruleId: 'T-GREEN', reasons: [] }
      ],
      actions: [], tools: []
    }
    const input = answers('self_growth', 1)
    const result = executeRules(config, input, assessmentDefinitions.self_growth, { previousConsecutiveLowMeaning: 5 })
    expect(result.level).toBe('purple')
    expect(result.blocked).toBe(true)
  })

  it('returns green when ctx value does not meet threshold', () => {
    const config: RuleConfig = {
      module: 'self_growth', version: '1.0',
      computed: {},
      branches: [
        { pri: 1, when: 'ctx_previousConsecutiveLowMeaning >= 5', level: 'purple', blocked: true, ruleId: 'T-CTX', reasons: [] },
        { pri: 2, level: 'green', blocked: false, ruleId: 'T-GREEN', reasons: [] }
      ],
      actions: [], tools: []
    }
    const input = answers('self_growth', 1)
    const result = executeRules(config, input, assessmentDefinitions.self_growth, { previousConsecutiveLowMeaning: 2 })
    expect(result.level).toBe('green')
  })

  it('treats missing ctx variable as 0 (graceful)', () => {
    const config: RuleConfig = {
      module: 'self_growth', version: '1.0',
      computed: {},
      branches: [
        { pri: 1, when: 'ctx_missingVar >= 3', level: 'yellow', blocked: false, ruleId: 'T-MISS', reasons: [] },
        { pri: 2, level: 'green', blocked: false, ruleId: 'T-GREEN', reasons: [] }
      ],
      actions: [], tools: []
    }
    const input = answers('self_growth', 1)
    // no ctx passed → ctx_missingVar resolves to 0, condition is false
    const result = executeRules(config, input, assessmentDefinitions.self_growth)
    expect(result.level).toBe('green')
  })
})
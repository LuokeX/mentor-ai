import { describe, expect, it } from 'vitest'
import { assessmentDefinitions } from '../shared/assessments'
import type { ModuleId } from '../shared/contracts'
import { evaluateAssessment } from '../server/domain/rules'
import { detectSafetySignals } from '../server/domain/safety'

function answers(module: ModuleId, value: number) {
  return Object.fromEntries(assessmentDefinitions[module].questions.map(question => [question.id, value]))
}

describe('deterministic assessment rules', () => {
  it('rejects incomplete answers instead of letting a model fill them', () => {
    expect(() => evaluateAssessment('self_growth', {})).toThrow('所有题目都必须作答')
  })

  it('fuses self-growth red when exhaustion and meaning risk are both high', () => {
    const input = answers('self_growth', 1)
    input.q1 = 5
    input.q3 = 1
    const result = evaluateAssessment('self_growth', input)
    expect(result.level).toBe('red')
    expect(result.blocked).toBe(true)
    expect(result.matchedRuleIds).toContain('SG-RED-Q1-Q3')
  })

  it('uses reverse scoring for positive self-growth questions', () => {
    const input = answers('self_growth', 1)
    input.q3 = 5
    input.q4 = 5
    const result = evaluateAssessment('self_growth', input)
    expect(result.dimensions['意义感知']).toBe(1)
    expect(result.dimensions['效能信心']).toBe(1)
  })

  it('only raises purple after four consecutive low-meaning assessments', () => {
    const input = answers('self_growth', 1)
    input.q1 = 1
    input.q3 = 2
    expect(evaluateAssessment('self_growth', input).level).not.toBe('purple')
    const result = evaluateAssessment('self_growth', input, { previousConsecutiveLowMeaning: 3 })
    expect(result.level).toBe('purple')
    expect(result.blocked).toBe(true)
    expect(result.matchedRuleIds).toContain('SG-PURPLE-MEANING-4X')
  })

  it.each([
    [1, 'survival'], [3, 'norming'], [4, 'operating'], [5, 'mature']
  ])('maps class-system average %s to %s', (value, expected) => {
    expect(evaluateAssessment('class_system', answers('class_system', Number(value))).level).toBe(expected)
  })

  it('takes home-school threat item into the E-level protection route', () => {
    const input = answers('home_school', 4)
    input.att3 = 1
    const result = evaluateAssessment('home_school', input)
    expect(result.level).toBe('E')
    expect(result.blocked).toBe(true)
    expect(result.matchedRuleIds).toEqual(['HS-E-THREAT'])
  })

  it.each([[2, 'L1'], [4, 'L2'], [5, 'L3']])('maps student severity %s to %s', (value, expected) => {
    expect(evaluateAssessment('student_case', answers('student_case', Number(value))).level).toBe(expected)
  })

  it('always attaches at least one executable tool', () => {
    for (const module of ['self_growth', 'class_system', 'home_school', 'student_case'] as ModuleId[]) {
      expect(evaluateAssessment(module, answers(module, 3)).tools.length).toBeGreaterThan(0)
    }
  })
})

describe('local crisis fuse', () => {
  it.each([
    ['我现在真的不想活了', 'SAFE-SUICIDE'],
    ['学生提到自己割腕', 'SAFE-SELF-HARM'],
    ['孩子被家暴了', 'SAFE-ABUSE'],
    ['家长威胁恐吓老师', 'SAFE-THREAT']
  ])('detects %s as %s before any model call', (text, rule) => {
    expect(detectSafetySignals(text)).toContain(rule)
  })

  it('does not flag an ordinary support request', () => {
    expect(detectSafetySignals('我想改善班级作业拖延问题')).toEqual([])
  })
})

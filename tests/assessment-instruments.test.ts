import { describe, expect, it } from 'vitest'
import { buildInstrumentOptions, filterTeacherVisibleInstruments } from '../server/domain/assessment-instruments'
import type { AssessmentDefinition } from '../shared/assessments'

const instrument = (code: string, over: Partial<AssessmentDefinition> = {}): AssessmentDefinition => ({
  code,
  version: '1.0.0',
  module: 'self_growth',
  title: code,
  description: '',
  estimatedMinutes: 3,
  questions: [
    { id: 'q1', text: '题1', dimension: 'D', options: [{ label: '少', value: 1 }, { label: '多', value: 5 }] }
  ],
  ...over
})

describe('instrument roles on teacher-facing options', () => {
  it('carries the ③ role onto built options', () => {
    const options = buildInstrumentOptions([
      instrument('SG_SCREEN', { instrumentRole: 'screening', isRequired: true }),
      instrument('SG_DEEP', { instrumentRole: 'deep_dive', triggerCondition: '量表[SG_SCREEN].总分 >= 4' })
    ], new Map())
    expect(options.find(option => option.code === 'SG_SCREEN')?.role).toBe('screening')
    expect(options.find(option => option.code === 'SG_DEEP')?.role).toBe('deep_dive')
  })

  it('hides red-line instruments until the high-risk threshold is met', () => {
    const library = [
      instrument('SG_SCREEN', { instrumentRole: 'screening', isRequired: true }),
      instrument('SG_RED', { instrumentRole: 'red_line', triggerCondition: '量表[SG_SCREEN].总分 >= 4' })
    ]

    // 教师还没做过任何量表：红线清单不可见，也不会被兜底推荐挑中
    const fresh = buildInstrumentOptions(library, new Map())
    expect(filterTeacherVisibleInstruments(fresh).map(option => option.code)).toEqual(['SG_SCREEN'])

    // 筛查已提交且命中高危阈值：红线清单出现并标为「建议做」
    const done = new Map([['SG_SCREEN', {
      submittedAt: new Date(),
      level: 'orange',
      levelName: null,
      severity: 'high',
      dimensions: {},
      answers: { q1: 5 }
    }]])
    const afterScreen = buildInstrumentOptions(library, done)
    const red = afterScreen.find(option => option.code === 'SG_RED')
    expect(red?.status).toBe('suggested')
    expect(filterTeacherVisibleInstruments(afterScreen).map(option => option.code)).toContain('SG_RED')
  })
})
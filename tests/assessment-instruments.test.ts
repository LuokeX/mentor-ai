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

  it('screening completion unlocks deep instrument to suggested for continuous flow', () => {
    // 连续量表流程的衔接判定：提交入口筛查后，触发条件满足的深度量表必须变成
    // suggested，前端据此自动续做下一张；未满足时维持 not_needed（可跳过）。
    const library = [
      instrument('HS_SCREEN', { instrumentRole: 'screening', isRequired: true }),
      instrument('HS_DEEP', { instrumentRole: 'deep_dive', triggerCondition: '量表[HS_SCREEN].均分 >= 3', triggerConditionNote: '筛查均分 ≥ 3 时建议做深度评估' })
    ]

    // 未达触发条件：not_needed，不进入连续流程的必做集合
    const weak = buildInstrumentOptions(library, new Map([['HS_SCREEN', {
      submittedAt: new Date(), level: 'A', levelName: null, severity: 'low',
      dimensions: {}, answers: { q1: 1 }
    }]]))
    expect(weak.find(option => option.code === 'HS_DEEP')?.status).toBe('not_needed')

    // 达到触发条件：suggested，连续流程应自动续做
    const strong = buildInstrumentOptions(library, new Map([['HS_SCREEN', {
      submittedAt: new Date(), level: 'B', levelName: null, severity: 'medium',
      dimensions: {}, answers: { q1: 4 }
    }]]))
    const deep = strong.find(option => option.code === 'HS_DEEP')
    expect(deep?.status).toBe('suggested')

    // 深度量表完成后：completed，不再出现在「剩余建议」里
    const finished = buildInstrumentOptions(library, new Map([
      ['HS_SCREEN', {
        submittedAt: new Date(), level: 'B', levelName: null, severity: 'medium',
        dimensions: {}, answers: { q1: 4 }
      }],
      ['HS_DEEP', {
        submittedAt: new Date(), level: 'C', levelName: null, severity: 'high',
        dimensions: {}, answers: { q1: 4 }
      }]
    ]))
    expect(finished.find(option => option.code === 'HS_DEEP')?.status).toBe('completed')
    // 连续流程的收尾判定：没有任何 suggested 剩余时即可统一生成方案
    expect(finished.some(option => option.status === 'suggested')).toBe(false)
  })
})
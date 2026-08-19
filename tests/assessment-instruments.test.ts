import { describe, expect, it } from 'vitest'
import { buildInstrumentOptions, fallbackInstrument, filterTeacherVisibleInstruments, resolveReachableInstrument } from '../server/domain/assessment-instruments'
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

describe('instrument gating（前置/互斥锁定与完成状态优先级）', () => {
  const screening = { submittedAt: new Date(), level: 'B', levelName: null, severity: 'medium', dimensions: {}, answers: { q1: 4 } }
  const done = (answers: Record<string, number> = { q1: 2 }) => ({
    submittedAt: new Date(), level: 'C', levelName: null, severity: 'high', dimensions: {}, answers
  })

  it('前置量表未完成 → locked，且门禁优先于触发条件（不降级为 not_needed）', () => {
    const library = [
      instrument('HS_SCREEN', { instrumentRole: 'screening', isRequired: true }),
      instrument('HS_DEEP', {
        instrumentRole: 'deep_dive',
        prerequisiteCodes: ['HS_SCREEN'],
        triggerCondition: '量表[HS_SCREEN].均分 >= 3'
      })
    ]
    const options = buildInstrumentOptions(library, new Map())
    const deep = options.find(option => option.code === 'HS_DEEP')
    expect(deep?.status).toBe('locked')
    expect(deep?.missingPrerequisites.map(ref => ref.code)).toEqual(['HS_SCREEN'])
    // 已锁定时触发条件根本不求值：条件未满足也不应显示为 not_needed，求值错误也不该出现
    expect(deep?.triggerError).toBeNull()
  })

  it('前置完成后解锁为 suggested，resolveReachableInstrument 把锁定的推荐指回前置量表', () => {
    const library = [
      instrument('HS_SCREEN', { instrumentRole: 'screening', isRequired: true }),
      instrument('HS_DEEP', {
        instrumentRole: 'deep_dive',
        prerequisiteCodes: ['HS_SCREEN'],
        triggerCondition: '量表[HS_SCREEN].均分 >= 3'
      })
    ]
    // 前置未完成：推荐 HS_DEEP 时被重定向到 HS_SCREEN
    const lockedOptions = buildInstrumentOptions(library, new Map())
    const redirected = resolveReachableInstrument(lockedOptions, 'HS_DEEP')
    expect(redirected?.instrument.code).toBe('HS_SCREEN')
    expect(redirected?.redirectedFrom?.code).toBe('HS_DEEP')
    // 前置已完成且触发条件满足：不再重定向
    const unlocked = buildInstrumentOptions(library, new Map([['HS_SCREEN', screening]]))
    expect(unlocked.find(option => option.code === 'HS_DEEP')?.status).toBe('suggested')
    expect(resolveReachableInstrument(unlocked, 'HS_DEEP')?.redirectedFrom).toBeNull()
  })

  it('已完成互斥量表 → locked，且互斥优先于触发条件', () => {
    const library = [
      instrument('HS_QUICK', { instrumentRole: 'screening', isRequired: true }),
      instrument('HS_FULL', { instrumentRole: 'deep_dive', exclusiveCodes: ['HS_QUICK'] }),
      // 触发条件本应命中（已完成），但互斥门禁仍然锁住
      instrument('HS_EXTRA', {
        instrumentRole: 'special',
        exclusiveCodes: ['HS_QUICK'],
        triggerCondition: '量表[HS_QUICK].已完成 == 1'
      })
    ]
    const options = buildInstrumentOptions(library, new Map([['HS_QUICK', screening]]))
    expect(options.find(option => option.code === 'HS_FULL')?.status).toBe('locked')
    expect(options.find(option => option.code === 'HS_FULL')?.blockingExclusives.map(ref => ref.code)).toEqual(['HS_QUICK'])
    expect(options.find(option => option.code === 'HS_EXTRA')?.status).toBe('locked')
  })

  it('无触发条件、无门禁的量表状态为 available，随时可做', () => {
    const options = buildInstrumentOptions([instrument('HS_FREE', {})], new Map())
    expect(options[0]?.status).toBe('available')
  })

  it('已提交 → completed，不再被触发条件降级（条件未命中也保持 completed）', () => {
    // 筛查结果弱（均分 1 < 3，条件未命中），但 HS_DEEP 已提交：
    // 状态必须保持 completed，不能回到 not_needed/suggested，否则前端会重复建议续做
    const library = [
      instrument('HS_SCREEN', { instrumentRole: 'screening', isRequired: true }),
      instrument('HS_DEEP', { instrumentRole: 'deep_dive', triggerCondition: '量表[HS_SCREEN].均分 >= 3' })
    ]
    const finished = buildInstrumentOptions(library, new Map([
      ['HS_SCREEN', { submittedAt: new Date(), level: 'A', levelName: null, severity: 'low', dimensions: {}, answers: { q1: 1 } }],
      ['HS_DEEP', done()]
    ]))
    expect(finished.find(option => option.code === 'HS_DEEP')?.status).toBe('completed')
    expect(finished.some(option => option.status === 'suggested')).toBe(false)
  })

  it('已完成量表仍按触发条件标记 triggerHit（命中才可重做提示）', () => {
    const library = [
      instrument('HS_SCREEN', { instrumentRole: 'screening', isRequired: true }),
      instrument('HS_DEEP', { instrumentRole: 'deep_dive', triggerCondition: '量表[HS_SCREEN].均分 >= 3' })
    ]
    // 触发条件命中 + 已完成：triggerHit 为 true，前端据此允许重做
    const hit = buildInstrumentOptions(library, new Map([
      ['HS_SCREEN', { submittedAt: new Date(), level: 'B', levelName: null, severity: 'medium', dimensions: {}, answers: { q1: 4 } }],
      ['HS_DEEP', done()]
    ]))
    const deepHit = hit.find(option => option.code === 'HS_DEEP')
    expect(deepHit?.status).toBe('completed')
    expect(deepHit?.triggerHit).toBe(true)

    // 触发条件未命中 + 已完成：triggerHit 为 false，不提示重做
    const miss = buildInstrumentOptions(library, new Map([
      ['HS_SCREEN', { submittedAt: new Date(), level: 'A', levelName: null, severity: 'low', dimensions: {}, answers: { q1: 1 } }],
      ['HS_DEEP', done()]
    ]))
    const deepMiss = miss.find(option => option.code === 'HS_DEEP')
    expect(deepMiss?.status).toBe('completed')
    expect(deepMiss?.triggerHit).toBe(false)

    // 无触发条件的量表：triggerHit 恒为 false（不属于「命中触发条件」）
    const free = buildInstrumentOptions([instrument('HS_FREE', {})], new Map([['HS_FREE', done()]]))
    expect(free[0]?.triggerHit).toBe(false)
  })
})

describe('连续量表流程的续做衔接（fallbackInstrument 推荐下一张）', () => {
  const library = [
    instrument('HS_SCREEN', { instrumentRole: 'screening', isRequired: true }),
    instrument('HS_DEEP', { instrumentRole: 'deep_dive', triggerCondition: '量表[HS_SCREEN].均分 >= 3' })
  ]

  it('筛查提交且触发条件命中后，续做推荐落到深度量表', () => {
    const strong = buildInstrumentOptions(library, new Map([['HS_SCREEN', {
      submittedAt: new Date(), level: 'B', levelName: null, severity: 'medium',
      dimensions: {}, answers: { q1: 4 }
    }]]))
    expect(strong.find(option => option.code === 'HS_DEEP')?.status).toBe('suggested')
    expect(fallbackInstrument(strong)?.code).toBe('HS_DEEP')
  })

  it('触发条件未命中时，兜底推荐不会挑深度量表（教师可手动做）', () => {
    const weak = buildInstrumentOptions(library, new Map([['HS_SCREEN', {
      submittedAt: new Date(), level: 'A', levelName: null, severity: 'low',
      dimensions: {}, answers: { q1: 1 }
    }]]))
    expect(weak.find(option => option.code === 'HS_DEEP')?.status).toBe('not_needed')
    expect(fallbackInstrument(weak)?.code).not.toBe('HS_DEEP')
  })
})
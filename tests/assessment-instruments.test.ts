import { describe, expect, it } from 'vitest'
import {
  buildInstrumentOptions,
  describeTriggerEvidence,
  fallbackInstrument,
  filterTeacherVisibleInstruments,
  isAttemptEligibleForTrigger,
  isObjectScopedInstrument,
  resolveReachableInstrument
} from '../server/domain/assessment-instruments'
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

describe('对象级量表的触发只看同一咨询对象', () => {
  // 家校沟通：六维评估（per_case）→ 红线检查（红线 + 前置六维）
  const library = [
    instrument('HS_SIX', { instrumentRole: 'screening', isRequired: true, frequency: 'per_case' }),
    instrument('HS_RED', {
      instrumentRole: 'red_line',
      frequency: 'per_case',
      prerequisiteCodes: ['HS_SIX'],
      triggerCondition: '量表[HS_SIX].均分 <= 4',
      triggerConditionNote: '六维评估均分低于 4.0（出现风险迹象）时建议做红线检查'
    })
  ]
  const sixAttempt = (answers: Record<string, number>) => ({
    submittedAt: new Date('2026-09-04T08:01:47.926Z'),
    level: 'yellow',
    levelName: '3级·中度（定向干预）',
    severity: 'medium',
    dimensions: {},
    answers
  })

  it('六维评估完成时，后续模块级的提交/其它家庭的提交都进不了判定', () => {
    const teacherLevel = sixAttempt({ q1: 2 })
    // 教师级视图里有六维提交，但对象视图为空（当前对话没有关联这位家长）
    const options = buildInstrumentOptions(library, new Map([['HS_SIX', teacherLevel]]), new Map())
    // 完成状态按对象算：对该对象还没做过
    const six = options.find(option => option.code === 'HS_SIX')
    expect(six?.status).toBe('available')
    expect(six?.lastSubmittedAt).toBeNull()
    // 前置不满足 → 红线检查锁定（拿不到别的提交当依据）
    const red = options.find(option => option.code === 'HS_RED')
    expect(red?.status).toBe('locked')
    expect(red?.triggerHit).toBe(false)
    // 教师端因此看不到这张红线清单（未命中高危阈值时不可见）
    expect(filterTeacherVisibleInstruments(options).map(option => option.code)).toEqual(['HS_SIX'])
  })

  it('同一对象下六维低于阈值 → 红线清单建议做，并带实测依据（分数/结论/时间）', () => {
    const six = sixAttempt({ q1: 2 })
    const options = buildInstrumentOptions(library, new Map([['HS_SIX', six]]), new Map([['HS_SIX', six]]))
    const red = options.find(option => option.code === 'HS_RED')
    expect(red?.status).toBe('suggested')
    expect(red?.triggerEvidence).toEqual([{
      code: 'HS_SIX',
      title: 'HS_SIX',
      average: 2,
      levelName: '3级·中度（定向干预）',
      submittedAt: '2026-09-04T08:01:47.926Z'
    }])
    const text = describeTriggerEvidence(red!)
    expect(text).toContain('2026-09-04')
    expect(text).toContain('均分 2.0')
    expect(text).toContain('3级·中度（定向干预）')
    // 说明里不复述触发条件原文（「均分低于 4.0（出现风险迹象）」这类条件式描述）
    expect(text).not.toContain('出现风险迹象')
    expect(text).not.toContain('4.0')
    // 六维均分健康（5 分）时不建议做
    const healthy = sixAttempt({ q1: 5 })
    const healthyOptions = buildInstrumentOptions(library, new Map([['HS_SIX', healthy]]), new Map([['HS_SIX', healthy]]))
    expect(healthyOptions.find(option => option.code === 'HS_RED')?.status).toBe('not_needed')
    expect(describeTriggerEvidence(healthyOptions.find(option => option.code === 'HS_RED')!)).toBeNull()
  })

  it('对象级与教师级量表的判定口径互不影响', () => {
    const selfLibrary = [
      instrument('SG_Q', { instrumentRole: 'screening', isRequired: true, frequency: 'monthly' }),
      instrument('SG_D', { instrumentRole: 'deep_dive', triggerCondition: '量表[SG_Q].均分 >= 3' })
    ]
    const attempt = {
      submittedAt: new Date('2026-09-04T08:01:47.926Z'),
      level: 'B', levelName: null, severity: 'medium', dimensions: {}, answers: { q1: 4 }
    }
    // 教师级量表：即使当前对话没有绑定对象，历史提交照样参与触发求值
    const options = buildInstrumentOptions(selfLibrary, new Map([['SG_Q', attempt]]), new Map([['SG_Q', attempt]]))
    expect(options.find(option => option.code === 'SG_D')?.status).toBe('suggested')
  })

  it('isObjectScopedInstrument：per_case、红线检查，以及评估对象是班级/学生的模块', () => {
    expect(isObjectScopedInstrument(instrument('A', { frequency: 'per_case' }))).toBe(true)
    expect(isObjectScopedInstrument(instrument('B', { instrumentRole: 'red_line' }))).toBe(true)
    // 班级系统的五系统自评表频率写的是 weekly，但结果属于某一个班，也要按对象判定
    expect(isObjectScopedInstrument(instrument('CS_S1', { module: 'class_system', frequency: 'weekly' }))).toBe(true)
    // 自我成长是教师级量表，任何频率都不按对象判定
    expect(isObjectScopedInstrument(instrument('SG_S1', { module: 'self_growth', frequency: 'weekly' }))).toBe(false)
    expect(isObjectScopedInstrument(instrument('SG_X', { module: 'self_growth' }))).toBe(false)
  })

  it('班级系统认班级：A 班的提交不算 B 班的完成，也不触发 B 班的深度量表', () => {
    const classLibrary = [
      instrument('CS_S1', { module: 'class_system', instrumentRole: 'screening', isRequired: true, frequency: 'weekly' }),
      instrument('CS_S2', { module: 'class_system', instrumentRole: 'deep_dive', triggerCondition: '量表[CS_S1].均分 >= 3' })
    ]
    const classA = {
      submittedAt: new Date('2026-09-14T08:00:00.000Z'),
      level: 'B', levelName: null, severity: 'medium', dimensions: {}, answers: { q1: 4 }
    }
    // A 班做过：A 班视图里 S1 已完成、S2 触发命中
    const optionsA = buildInstrumentOptions(classLibrary, new Map([['CS_S1', classA]]), new Map([['CS_S1', classA]]))
    expect(optionsA.find(option => option.code === 'CS_S1')?.status).toBe('completed')
    expect(optionsA.find(option => option.code === 'CS_S2')?.status).toBe('suggested')
    // B 班没做过：B 班视图里 S1 是可做、S2 无法判断（不把 A 班的结果当依据）
    const optionsB = buildInstrumentOptions(classLibrary, new Map([['CS_S1', classA]]), new Map())
    const classB = optionsB.find(option => option.code === 'CS_S1')
    expect(classB?.status).toBe('available')
    expect(classB?.lastSubmittedAt).toBeNull()
    expect(classB?.lastAverage).toBeNull()
    expect(optionsB.find(option => option.code === 'CS_S2')?.status).toBe('not_needed')
  })

  it('isAttemptEligibleForTrigger：对象级要求同一对象，教师级任何提交都算', () => {
    const scoped = new Set(['HS_SIX'])
    expect(isAttemptEligibleForTrigger({ code: 'HS_SIX', scopedCodes: scoped, attemptBinding: 'guardian:g1', contextKey: 'guardian:g1' })).toBe(true)
    // 别的家庭的提交、没有对象的模块级提交、以及当前对话未绑定对象时都不算
    expect(isAttemptEligibleForTrigger({ code: 'HS_SIX', scopedCodes: scoped, attemptBinding: 'guardian:g2', contextKey: 'guardian:g1' })).toBe(false)
    expect(isAttemptEligibleForTrigger({ code: 'HS_SIX', scopedCodes: scoped, attemptBinding: null, contextKey: 'guardian:g1' })).toBe(false)
    expect(isAttemptEligibleForTrigger({ code: 'HS_SIX', scopedCodes: scoped, attemptBinding: 'guardian:g1', contextKey: null })).toBe(false)
    // 教师级量表不受对象限制
    expect(isAttemptEligibleForTrigger({ code: 'SG_Q', scopedCodes: scoped, attemptBinding: null, contextKey: null })).toBe(true)
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
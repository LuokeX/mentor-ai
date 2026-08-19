import { describe, expect, it } from 'vitest'
import { buildPlanAssessmentAttemptRows, type SessionAttemptRow } from '../server/domain/plan-session'

const attempt = (id: string, sequence: number): SessionAttemptRow => ({
  id,
  assessmentCode: `INSTR-${id}`,
  definitionVersion: '1.0.0',
  sequence,
  result: null
})

describe('buildPlanAssessmentAttemptRows', () => {
  it('maps session attempts to plan rows preserving sequence', () => {
    expect(buildPlanAssessmentAttemptRows('plan-1', [attempt('a1', 0), attempt('a2', 1)], 'a1')).toEqual([
      { planId: 'plan-1', assessmentAttemptId: 'a1', sequence: 0 },
      { planId: 'plan-1', assessmentAttemptId: 'a2', sequence: 1 }
    ])
  })

  it('deduplicates repeated attempt ids (idempotent re-merge, first wins)', () => {
    // 同组重复合并时同一 attempt 可能出现多次（复评/网络重试），只保留首次
    expect(buildPlanAssessmentAttemptRows('plan-1', [attempt('a1', 0), attempt('a1', 1), attempt('a2', 2)], null)).toEqual([
      { planId: 'plan-1', assessmentAttemptId: 'a1', sequence: 0 },
      { planId: 'plan-1', assessmentAttemptId: 'a2', sequence: 2 }
    ])
  })

  it('falls back to source attempt with sequence 0 when no session attempts', () => {
    // 与 0034 回填形态一致：(plan_id, source_assessment_attempt_id, sequence=0)
    expect(buildPlanAssessmentAttemptRows('plan-1', [], 'src-1')).toEqual([
      { planId: 'plan-1', assessmentAttemptId: 'src-1', sequence: 0 }
    ])
  })

  it('does not emit fallback when session attempts exist', () => {
    expect(buildPlanAssessmentAttemptRows('plan-1', [attempt('a1', 3)], 'src-1')).toEqual([
      { planId: 'plan-1', assessmentAttemptId: 'a1', sequence: 3 }
    ])
  })

  it('returns no rows when both attempts and source attempt are missing', () => {
    expect(buildPlanAssessmentAttemptRows('plan-1', [], null)).toEqual([])
  })

  it('is idempotent: same input twice yields identical rows', () => {
    const attempts = [attempt('a1', 0), attempt('a2', 1)]
    expect(buildPlanAssessmentAttemptRows('plan-1', attempts, 'a1'))
      .toEqual(buildPlanAssessmentAttemptRows('plan-1', attempts, 'a1'))
  })
})
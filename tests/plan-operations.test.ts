import { describe, expect, it } from 'vitest'
import { extractSourceResourceVersionIds, planStatusAfterReview } from '../server/domain/plan-operations'

describe('plan operation domain', () => {
  it('moves low score reviews into adjustment', () => {
    expect(planStatusAfterReview({ effectScore: 2, decision: 'continue_plan' })).toBe('adjustment_needed')
  })

  it('honors explicit review decisions', () => {
    expect(planStatusAfterReview({ effectScore: 4, decision: 'need_collaboration' })).toBe('escalated')
    expect(planStatusAfterReview({ effectScore: 5, decision: 'close_success' })).toBe('completed')
    expect(planStatusAfterReview({ effectScore: 4, decision: 'close_no_longer_needed' })).toBe('closed')
    expect(planStatusAfterReview({ effectScore: 4, decision: 'adjust_actions' })).toBe('adjustment_needed')
  })

  it('extracts module resource versions from source labels', () => {
    expect(extractSourceResourceVersionIds([
      'fallback:assessment:home_school:1.0.0',
      'module-resource:home_school:assessment:global:1.0.0',
      'hs-high'
    ])).toEqual(['module-resource:home_school:assessment:global:1.0.0'])
  })
})

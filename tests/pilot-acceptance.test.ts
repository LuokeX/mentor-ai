import { describe, expect, it } from 'vitest'
import { buildPilotAcceptance } from '../server/domain/pilot-acceptance'

describe('pilot acceptance scoring', () => {
  it('marks a pilot ready when all acceptance checks pass', () => {
    const result = buildPilotAcceptance({
      activationRate: 0.9,
      firstTaskRate: 0.7,
      planExecutionRate: 0.6,
      reviewRate: 0.4,
      assistantFailureRate: 0.05,
      crisisAckWithinSlaRate: 1,
      resourceCoverageRate: 1,
      resourceProjectionReadyRate: 1,
      planFeedbackCount: 8,
      attributionAccuracyAvg: 4,
      toolUsabilityAvg: 4.2,
      reportCompletenessRate: 0.9
    })

    expect(result.status).toBe('ready')
    expect(result.score).toBe(100)
    expect(result.items.every(item => item.status === 'pass')).toBe(true)
  })

  it('keeps a pilot on watch when feedback is insufficient but core safety has no crisis data', () => {
    const result = buildPilotAcceptance({
      activationRate: 0.7,
      firstTaskRate: 0.55,
      planExecutionRate: 0.45,
      reviewRate: 0.25,
      assistantFailureRate: 0.12,
      crisisAckWithinSlaRate: null,
      resourceCoverageRate: 1,
      resourceProjectionReadyRate: 1,
      planFeedbackCount: 2,
      attributionAccuracyAvg: null,
      toolUsabilityAvg: null,
      reportCompletenessRate: 0.75
    })

    expect(result.status).toBe('watch')
    expect(result.items.find(item => item.key === 'feedback_count')?.status).toBe('fail')
    expect(result.items.some(item => item.key === 'crisis_sla')).toBe(false)
  })

  it('marks a pilot not ready when resource and solution quality fail', () => {
    const result = buildPilotAcceptance({
      activationRate: 0.3,
      firstTaskRate: 0.2,
      planExecutionRate: 0.1,
      reviewRate: 0,
      assistantFailureRate: 0.35,
      crisisAckWithinSlaRate: 0.5,
      resourceCoverageRate: 0.6,
      resourceProjectionReadyRate: 0.4,
      planFeedbackCount: 0,
      attributionAccuracyAvg: 2.8,
      toolUsabilityAvg: 2.5,
      reportCompletenessRate: 0.3
    })

    expect(result.status).toBe('not_ready')
    expect(result.items.filter(item => item.status === 'fail').length).toBeGreaterThan(2)
  })
})

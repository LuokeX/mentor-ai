import { describe, expect, it } from 'vitest'
import { isPlanFrozenBeforeAcceptance } from '../shared/reports'
import {
  canReviewPlan,
  canTransitionPlanStatus,
  canUpdatePlanActions,
  extractSourceResourceVersionIds,
  planStatusAfterActionUpdate,
  planStatusAfterReview
} from '../server/domain/plan-operations'

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

  it('moves a plan awaiting review once every executable action is done', () => {
    // 行动全部完成 → 待复盘（不再显示「进行中」），由教师复盘决定完成或继续
    expect(planStatusAfterActionUpdate({
      currentStatus: 'in_progress', nextActionStatus: 'completed', allIncludedActionsCompleted: true
    })).toBe('review_due')
    expect(planStatusAfterActionUpdate({
      currentStatus: 'accepted', nextActionStatus: 'completed', allIncludedActionsCompleted: true
    })).toBe('review_due')
    // 撤销完成、或还有未完成的行动 → 回到进行中
    expect(planStatusAfterActionUpdate({
      currentStatus: 'review_due', nextActionStatus: 'pending', allIncludedActionsCompleted: false
    })).toBe('in_progress')
    expect(planStatusAfterActionUpdate({
      currentStatus: 'in_progress', nextActionStatus: 'in_progress', allIncludedActionsCompleted: false
    })).toBe('in_progress')
  })

  it('keeps the plan status for skipped actions and non-execution states', () => {
    // 跳过/取消只是这条不做，不算「做完了」
    expect(planStatusAfterActionUpdate({
      currentStatus: 'in_progress', nextActionStatus: 'skipped', allIncludedActionsCompleted: false
    })).toBe(null)
    // 待确认与已完成/已关闭都不在执行流里，行动本身也不可写
    expect(planStatusAfterActionUpdate({
      currentStatus: 'pending_acceptance', nextActionStatus: 'completed', allIncludedActionsCompleted: true
    })).toBe(null)
    expect(planStatusAfterActionUpdate({
      currentStatus: 'completed', nextActionStatus: 'completed', allIncludedActionsCompleted: true
    })).toBe(null)
  })

  it('requires acceptance before action execution or review', () => {
    expect(canUpdatePlanActions({ status: 'pending_acceptance', acceptedAt: null })).toBe(false)
    expect(canReviewPlan({ status: 'pending_acceptance', acceptedAt: null })).toBe(false)
    expect(canUpdatePlanActions({ status: 'adjustment_needed', acceptedAt: null })).toBe(false)
    expect(canReviewPlan({ status: 'adjustment_needed', acceptedAt: new Date() })).toBe(true)
    expect(canUpdatePlanActions({ status: 'accepted', acceptedAt: new Date() })).toBe(true)
  })

  it('rejects generic status bypasses from pending acceptance', () => {
    expect(canTransitionPlanStatus({ status: 'pending_acceptance' }, 'in_progress')).toBe(false)
    expect(canTransitionPlanStatus({ status: 'pending_acceptance' }, 'completed')).toBe(false)
    expect(canTransitionPlanStatus({ status: 'accepted', acceptedAt: new Date() }, 'in_progress')).toBe(true)
    expect(canTransitionPlanStatus({ status: 'in_progress' }, 'completed')).toBe(true)
  })

  it('tells the two escalated origins apart (crisis freeze vs review escalation)', () => {
    // 接受前被安全熔断冻结：没有 acceptedAt，不能接受/执行/复盘，教师端只留停止说明
    expect(isPlanFrozenBeforeAcceptance({ status: 'escalated', acceptedAt: null })).toBe(true)
    expect(isPlanFrozenBeforeAcceptance({ status: 'escalated' })).toBe(true)
    // 复盘判定「需要协同」：acceptedAt 非空，行动只读但仍可复盘，必须继续可见
    expect(isPlanFrozenBeforeAcceptance({ status: 'escalated', acceptedAt: new Date() })).toBe(false)
    expect(isPlanFrozenBeforeAcceptance({ status: 'pending_acceptance', acceptedAt: null })).toBe(false)
    expect(isPlanFrozenBeforeAcceptance({ status: 'accepted', acceptedAt: new Date() })).toBe(false)
  })

  it('keeps frozen plans out of every teacher-side write path', () => {
    const frozen = { status: 'escalated', acceptedAt: null }
    expect(canUpdatePlanActions(frozen)).toBe(false)
    expect(canReviewPlan(frozen)).toBe(false)
  })
})

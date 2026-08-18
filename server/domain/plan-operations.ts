import type { H3Event } from 'h3'
import { schema, useDb, type DbClient } from '../utils/db'

const allowedMetadataTypes = new Set(['string', 'number', 'boolean'])

export type PlanOperationEventType =
  | 'plan_generated'
  | 'plan_merged'
  | 'plan_acceptance_updated'
  | 'plan_action_updated'
  | 'plan_action_added'
  | 'plan_action_decision_updated'
  | 'plan_action_blocked'
  | 'plan_review_completed'
  | 'plan_feedback_submitted'
  | 'plan_collaboration_needed'
  | 'plan_closed'

export async function recordPlanOperationEvent(event: H3Event, input: {
  schoolId: string
  planId: string
  actionId?: string | null
  ownerUserId: string
  eventType: PlanOperationEventType
  metadata?: Record<string, unknown>
}, db: DbClient = useDb(event)) {
  const metadata = Object.fromEntries(Object.entries(input.metadata || {})
    .filter(([, value]) => value === null || allowedMetadataTypes.has(typeof value))
    .slice(0, 24)) as Record<string, string | number | boolean | null>
  await db.insert(schema.planOperationEvents).values({
    schoolId: input.schoolId,
    planId: input.planId,
    actionId: input.actionId || null,
    ownerUserId: input.ownerUserId,
    eventType: input.eventType,
    metadata
  }).catch(() => undefined)
}

export function planStatusAfterReview(input: {
  effectScore: number
  decision: string
}) {
  if (input.decision === 'close_success') return 'completed'
  if (input.decision === 'close_no_longer_needed') return 'closed'
  if (input.decision === 'need_collaboration') return 'escalated'
  if (input.decision === 'adjust_actions' || input.effectScore <= 2) return 'adjustment_needed'
  return 'in_progress'
}

type PlanOperationState = {
  status: string
  acceptedAt?: Date | string | null
}

/** 只有接受后的方案才能执行行动；旧版已进入执行态的方案继续兼容。 */
export function canUpdatePlanActions(plan: PlanOperationState) {
  if (['accepted', 'in_progress', 'review_due'].includes(plan.status)) return true
  return plan.status === 'adjustment_needed' && Boolean(plan.acceptedAt)
}

/** 复盘可处理执行中、待复盘、已接受调整或已升级的方案。 */
export function canReviewPlan(plan: PlanOperationState) {
  if (['accepted', 'in_progress', 'review_due'].includes(plan.status)) return true
  return ['adjustment_needed', 'escalated'].includes(plan.status) && Boolean(plan.acceptedAt)
}

const PLAN_STATUS_TRANSITIONS: Record<string, string[]> = {
  accepted: ['in_progress', 'closed'],
  in_progress: ['completed', 'closed'],
  review_due: ['in_progress', 'completed', 'closed'],
  adjustment_needed: ['in_progress', 'closed'],
  escalated: ['closed']
}

export function canTransitionPlanStatus(plan: PlanOperationState, nextStatus: string) {
  if (!PLAN_STATUS_TRANSITIONS[plan.status]?.includes(nextStatus)) return false
  if (plan.status === 'adjustment_needed' && !plan.acceptedAt) return false
  return true
}

export function extractSourceResourceVersionIds(sourceVersions: string[] = []) {
  return sourceVersions.filter(item => item.startsWith('module-resource:'))
}

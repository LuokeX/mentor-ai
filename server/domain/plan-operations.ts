import type { H3Event } from 'h3'
import { schema, useDb } from '../utils/db'

const allowedMetadataTypes = new Set(['string', 'number', 'boolean'])

export type PlanOperationEventType =
  | 'plan_generated'
  | 'plan_acceptance_updated'
  | 'plan_action_updated'
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
}) {
  const metadata = Object.fromEntries(Object.entries(input.metadata || {})
    .filter(([, value]) => value === null || allowedMetadataTypes.has(typeof value))
    .slice(0, 24)) as Record<string, string | number | boolean | null>
  await useDb(event).insert(schema.planOperationEvents).values({
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

export function extractSourceResourceVersionIds(sourceVersions: string[] = []) {
  return sourceVersions.filter(item => item.startsWith('module-resource:'))
}

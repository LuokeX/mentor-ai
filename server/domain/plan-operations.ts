import type { H3Event } from 'h3'
import { isNotNull, ne, or } from 'drizzle-orm'
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

/** 方案处于执行流（行动可写）的状态。 */
const PLAN_EXECUTION_STATUSES = ['accepted', 'in_progress', 'review_due', 'adjustment_needed']
/** 会改变「这条行动做完了没有」的行动状态；跳过/取消表示这条不做，不算完成。 */
const PLAN_ACTION_EXECUTION_STATUSES = ['pending', 'in_progress', 'completed']

/**
 * 行动状态更新后方案的自动流转。
 *
 * 背景：行动项全部勾完以后方案一直停在 `in_progress`，教师端出现「4/4 项完成」但徽章
 * 仍是「进行中」的矛盾状态；`review_due`（待复盘）在状态枚举、标签和状态机里都已写好，
 * 却没有任何写入点。这里补上这一环：
 *   - 展示层可执行行动全部完成 → 进入「待复盘」，等教师复盘决定完成或继续；
 *   - 撤销完成、或仍有未完成的行动 → 回到「进行中」；
 *   - 「跳过 / 取消」只是这条不做，不改变方案状态。
 *
 * 返回 null 表示保持方案原有状态：非执行态（待确认 / 需协同 / 已完成 / 已关闭）、
 * 以及跳过/取消两类情形都走这一支。
 */
export function planStatusAfterActionUpdate(input: {
  currentStatus: string
  nextActionStatus: string
  allIncludedActionsCompleted: boolean
}): string | null {
  if (!PLAN_ACTION_EXECUTION_STATUSES.includes(input.nextActionStatus)) return null
  if (!PLAN_EXECUTION_STATUSES.includes(input.currentStatus)) return null
  return input.allIncludedActionsCompleted ? 'review_due' : 'in_progress'
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

/**
 * 教师端列表/待办的共同查询条件：把「接受前被安全熔断冻结」的方案排除在外
 * （`escalated` 且无 `acceptedAt`）。
 *
 * 这类方案不能接受、不能执行、也不能复盘，教师端只剩一份停止说明；继续把它列进
 * 「进行中」「待复盘」只会制造点进去无事可做的死胡同。复盘判定「需要协同」升级出的
 * 方案 `acceptedAt` 非空，仍要正常列出，所以这里不能只按状态过滤。
 */
export function teacherPlanVisibleCondition() {
  return or(ne(schema.plans.status, 'escalated'), isNotNull(schema.plans.acceptedAt))!
}

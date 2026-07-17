import type { H3Event } from 'h3'
import { and, asc, eq } from 'drizzle-orm'
import { schema, useDb } from '../utils/db'

type LegacyAction = { title: string, detail: string, status: string }

export function defaultActionDueAt(createdAt: Date, sequence: number) {
  const due = new Date(createdAt)
  due.setDate(due.getDate() + Math.min(sequence + 1, 3))
  return due
}

export function defaultReviewAt(createdAt = new Date()) {
  const review = new Date(createdAt)
  review.setDate(review.getDate() + 7)
  return review
}

/** 懒迁移旧 JSON 动作；保留 plans.actions 和报告快照作为历史证据。 */
export async function ensurePlanActions(event: H3Event, planId: string, ownerUserId: string) {
  const db = useDb(event)
  const existing = await db.select().from(schema.planActions)
    .where(and(eq(schema.planActions.planId, planId), eq(schema.planActions.ownerUserId, ownerUserId)))
    .orderBy(asc(schema.planActions.sequence))
  if (existing.length) return existing

  const [plan] = await db.select().from(schema.plans)
    .where(and(eq(schema.plans.id, planId), eq(schema.plans.ownerUserId, ownerUserId))).limit(1)
  if (!plan) return []
  const legacy = (plan.actions || []) as LegacyAction[]
  if (!legacy.length) return []
  return db.insert(schema.planActions).values(legacy.map((action, sequence) => ({
    schoolId: plan.schoolId,
    planId: plan.id,
    ownerUserId: plan.ownerUserId,
    sequence,
    title: action.title,
    detail: action.detail,
    status: action.status || 'pending',
    dueAt: defaultActionDueAt(plan.createdAt, sequence),
    completedAt: action.status === 'completed' ? plan.updatedAt : null
  }))).onConflictDoNothing().returning()
}

export async function createPlanActions(event: H3Event, input: {
  planId: string
  schoolId: string
  ownerUserId: string
  createdAt?: Date
  actions: LegacyAction[]
}) {
  const createdAt = input.createdAt || new Date()
  if (!input.actions.length) return []
  return useDb(event).insert(schema.planActions).values(input.actions.map((action, sequence) => ({
    schoolId: input.schoolId,
    planId: input.planId,
    ownerUserId: input.ownerUserId,
    sequence,
    title: action.title,
    detail: action.detail,
    status: action.status || 'pending',
    dueAt: defaultActionDueAt(createdAt, sequence)
  }))).returning()
}

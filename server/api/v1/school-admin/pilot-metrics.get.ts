import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const db = useDb(event)
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)
  const [accounts, weeklyActive, firstTasks, moduleUsage, plansWithReviews, crisis, feedback, assistantAnswers, assistantFailures] = await Promise.all([
    db.select({ status: schema.users.status, count: sql<number>`count(*)::int` }).from(schema.users)
      .where(and(eq(schema.users.schoolId, admin.schoolId), inArray(schema.users.role, ['teacher', 'psychologist'])))
      .groupBy(schema.users.status),
    db.select({ count: sql<number>`count(distinct ${schema.productEvents.userId})::int` }).from(schema.productEvents)
      .innerJoin(schema.users, eq(schema.users.id, schema.productEvents.userId))
      .where(and(
        eq(schema.productEvents.schoolId, admin.schoolId), eq(schema.users.role, 'teacher'), gte(schema.productEvents.createdAt, weekAgo)
      )),
    db.select({
      total: sql<number>`count(*)::int`,
      withinTenMinutes: sql<number>`count(*) filter (where exists (
        select 1 from product_events first_event
        where first_event.user_id = ${schema.users.id}
          and first_event.event_name in ('assistant_question_submitted', 'assessment_completed')
          and first_event.created_at between ${schema.users.activatedAt} and ${schema.users.activatedAt} + interval '10 minutes'
      ))::int`
    }).from(schema.users).where(and(
      eq(schema.users.schoolId, admin.schoolId), eq(schema.users.role, 'teacher'), sql`${schema.users.activatedAt} is not null`
    )),
    db.select({ module: schema.assessmentAttempts.module, count: sql<number>`count(*)::int` }).from(schema.assessmentAttempts)
      .where(and(eq(schema.assessmentAttempts.schoolId, admin.schoolId), eq(schema.assessmentAttempts.status, 'submitted')))
      .groupBy(schema.assessmentAttempts.module),
    db.select({
      total: sql<number>`count(distinct ${schema.plans.id})::int`,
      acted: sql<number>`count(distinct ${schema.plans.id}) filter (where ${schema.planActions.completedAt} is not null and ${schema.planActions.completedAt} <= ${schema.plans.createdAt} + interval '7 days')::int`,
      reviewed: sql<number>`count(distinct ${schema.plans.id}) filter (where ${schema.planReviews.createdAt} is not null and ${schema.planReviews.createdAt} <= ${schema.plans.createdAt} + interval '7 days')::int`
    }).from(schema.plans)
      .leftJoin(schema.planActions, eq(schema.planActions.planId, schema.plans.id))
      .leftJoin(schema.planReviews, eq(schema.planReviews.planId, schema.plans.id))
      .where(and(eq(schema.plans.schoolId, admin.schoolId), gte(schema.plans.createdAt, weekAgo))),
    db.select({
      total: sql<number>`count(*)::int`,
      assigned: sql<number>`count(${schema.referrals.psychologistId})::int`,
      acknowledged: sql<number>`count(${schema.referrals.acknowledgedAt})::int`,
      acknowledgedWithinSla: sql<number>`count(*) filter (where ${schema.referrals.acknowledgedAt} is not null and ${schema.referrals.acknowledgedAt} <= ${schema.referrals.acknowledgeDueAt})::int`,
      escalated: sql<number>`count(${schema.referrals.escalatedAt})::int`
    }).from(schema.referrals).where(eq(schema.referrals.schoolId, admin.schoolId)),
    db.select({ rating: schema.assistantFeedback.rating, count: sql<number>`count(*)::int` }).from(schema.assistantFeedback)
      .where(and(eq(schema.assistantFeedback.schoolId, admin.schoolId), gte(schema.assistantFeedback.createdAt, weekAgo)))
      .groupBy(schema.assistantFeedback.rating),
    db.select({
      total: sql<number>`count(*)::int`,
      localFallback: sql<number>`count(*) filter (where ${schema.productEvents.metadata}->>'mode' = 'local_fallback')::int`,
      withoutSources: sql<number>`count(*) filter (where coalesce((${schema.productEvents.metadata}->>'hasSources')::boolean, false) = false)::int`
    }).from(schema.productEvents).where(and(
      eq(schema.productEvents.schoolId, admin.schoolId), eq(schema.productEvents.eventName, 'assistant_answered'), gte(schema.productEvents.createdAt, weekAgo)
    )),
    db.select({
      total: sql<number>`count(*)::int`,
      timeout: sql<number>`count(*) filter (where ${schema.productEvents.metadata}->>'category' = 'timeout')::int`
    }).from(schema.productEvents).where(and(
      eq(schema.productEvents.schoolId, admin.schoolId), eq(schema.productEvents.eventName, 'assistant_answer_failed'), gte(schema.productEvents.createdAt, weekAgo)
    ))
  ])
  const accountTotal = accounts.reduce((sum, item) => sum + item.count, 0)
  const active = accounts.find(item => item.status === 'active')?.count || 0
  const firstTask = firstTasks[0] || { total: 0, withinTenMinutes: 0 }
  const review = plansWithReviews[0] || { total: 0, acted: 0, reviewed: 0 }
  const crisisStats = crisis[0] || { total: 0, assigned: 0, acknowledged: 0, acknowledgedWithinSla: 0, escalated: 0 }
  const helpful = feedback.find(item => item.rating === 'helpful')?.count || 0
  const feedbackTotal = feedback.reduce((sum, item) => sum + item.count, 0)
  const answers = assistantAnswers[0] || { total: 0, localFallback: 0, withoutSources: 0 }
  const failures = assistantFailures[0] || { total: 0, timeout: 0 }
  return {
    activation: { active, total: accountTotal, rate: accountTotal ? active / accountTotal : 0 },
    weeklyActiveTeachers: weeklyActive[0]?.count || 0,
    firstTask: { ...firstTask, rate: firstTask.total ? firstTask.withinTenMinutes / firstTask.total : 0 },
    moduleUsage,
    planExecution: { completed: review.acted, total: review.total, rate: review.total ? review.acted / review.total : 0 },
    reviews: { ...review, rate: review.total ? review.reviewed / review.total : 0 },
    assistant: {
      feedbackTotal, helpful, helpfulRate: feedbackTotal ? helpful / feedbackTotal : 0,
      answers: answers.total, localFallback: answers.localFallback, withoutSources: answers.withoutSources,
      failures: failures.total, timeouts: failures.timeout
    },
    crisis: { ...crisisStats, ackWithinSlaRate: crisisStats.total ? crisisStats.acknowledgedWithinSla / crisisStats.total : 0 }
  }
})

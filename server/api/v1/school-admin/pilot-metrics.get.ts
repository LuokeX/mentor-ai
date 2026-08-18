import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import { moduleIdSchema, libraryTypeSchema } from '../../../../shared/contracts'
import { buildPilotAcceptance } from '../../../domain/pilot-acceptance'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

const moduleIds = moduleIdSchema.options
const libraryTypes = libraryTypeSchema.options

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const db = useDb(event)
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)
  const [accounts, weeklyActive, firstTasks, moduleUsage, plansWithReviews, crisis, feedback, assistantAnswers, assistantFailures, planFeedbackQuality, reportCompleteness, resourceRows] = await Promise.all([
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
      acted: sql<number>`count(distinct ${schema.plans.id}) filter (where ${schema.planActions.decision} = 'included' and ${schema.planActions.completedAt} is not null and ${schema.planActions.completedAt} <= ${schema.plans.createdAt} + interval '7 days')::int`,
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
    )),
    db.select({
      total: sql<number>`count(*)::int`,
      attributionAccuracy: sql<number | null>`avg(${schema.planFeedback.attributionAccuracy})`,
      toolUsability: sql<number | null>`avg(${schema.planFeedback.toolUsability})`,
      scriptNaturalness: sql<number | null>`avg(${schema.planFeedback.scriptNaturalness})`,
      actionDifficulty: sql<number | null>`avg(${schema.planFeedback.actionDifficulty})`,
      reviewUsefulness: sql<number | null>`avg(${schema.planFeedback.reviewUsefulness})`
    }).from(schema.planFeedback).where(and(eq(schema.planFeedback.schoolId, admin.schoolId), gte(schema.planFeedback.createdAt, weekAgo))),
    db.select({
      total: sql<number>`count(*)::int`,
      withSupportGoal: sql<number>`count(*) filter (where ${schema.plans.report} ? 'supportGoal')::int`,
      withFirstAction: sql<number>`count(*) filter (where ${schema.plans.report} ? 'firstAction')::int`,
      withToolPrescriptions: sql<number>`count(*) filter (where jsonb_array_length(coalesce(${schema.plans.report}->'toolPrescriptions', '[]'::jsonb)) > 0)::int`,
      withSuccessCriteria: sql<number>`count(*) filter (where jsonb_array_length(coalesce(${schema.plans.report}->'successCriteria', '[]'::jsonb)) > 0)::int`
    }).from(schema.plans).where(and(eq(schema.plans.schoolId, admin.schoolId), gte(schema.plans.createdAt, weekAgo))),
    db.select({
      module: schema.moduleResourceLibraries.module,
      libraryType: schema.moduleResourceLibraries.libraryType,
      versionId: schema.moduleResourceVersions.id,
      scope: schema.moduleResourceLibraries.scope,
      schoolId: schema.moduleResourceLibraries.schoolId,
      assessmentItems: sql<number>`(select count(*)::int from module_resource_assessment_items item where item.version_id = ${schema.moduleResourceVersions.id})`,
      attributionRules: sql<number>`(select count(*)::int from module_resource_attribution_rules item where item.version_id = ${schema.moduleResourceVersions.id})`,
      toolItems: sql<number>`(select count(*)::int from module_resource_tool_items item where item.version_id = ${schema.moduleResourceVersions.id})`
    })
      .from(schema.moduleResourceVersions)
      .innerJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
      .where(and(
        eq(schema.moduleResourceVersions.status, 'published'),
        or(
          and(eq(schema.moduleResourceLibraries.scope, 'global'), isNull(schema.moduleResourceLibraries.schoolId)),
          and(eq(schema.moduleResourceLibraries.scope, 'school'), eq(schema.moduleResourceLibraries.schoolId, admin.schoolId))
        )
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
  const quality = planFeedbackQuality[0] || {
    total: 0,
    attributionAccuracy: null,
    toolUsability: null,
    scriptNaturalness: null,
    actionDifficulty: null,
    reviewUsefulness: null
  }
  const report = reportCompleteness[0] || {
    total: 0,
    withSupportGoal: 0,
    withFirstAction: 0,
    withToolPrescriptions: 0,
    withSuccessCriteria: 0
  }
  const reportChecks = report.total * 4
  const reportReady = report.withSupportGoal + report.withFirstAction + report.withToolPrescriptions + report.withSuccessCriteria
  const resourceCoverage = buildResourceCoverage(resourceRows)
  const assistantTotal = answers.total + failures.total
  const assistantFailureRate = assistantTotal ? failures.total / assistantTotal : 0
  const crisisAckWithinSlaRate = crisisStats.total ? crisisStats.acknowledgedWithinSla / crisisStats.total : null
  const acceptance = buildPilotAcceptance({
    activationRate: accountTotal ? active / accountTotal : 0,
    firstTaskRate: firstTask.total ? firstTask.withinTenMinutes / firstTask.total : 0,
    planExecutionRate: review.total ? review.acted / review.total : 0,
    reviewRate: review.total ? review.reviewed / review.total : 0,
    assistantFailureRate,
    crisisAckWithinSlaRate,
    resourceCoverageRate: resourceCoverage.rate,
    resourceProjectionReadyRate: resourceCoverage.projectionReadyRate,
    planFeedbackCount: quality.total,
    attributionAccuracyAvg: normalizeAvg(quality.attributionAccuracy),
    toolUsabilityAvg: normalizeAvg(quality.toolUsability),
    reportCompletenessRate: reportChecks ? reportReady / reportChecks : 0
  })
  return {
    period: { days: 7, from: weekAgo.toISOString(), to: new Date().toISOString() },
    activation: { active, total: accountTotal, rate: accountTotal ? active / accountTotal : 0 },
    weeklyActiveTeachers: weeklyActive[0]?.count || 0,
    firstTask: { ...firstTask, rate: firstTask.total ? firstTask.withinTenMinutes / firstTask.total : 0 },
    moduleUsage,
    planExecution: { completed: review.acted, total: review.total, rate: review.total ? review.acted / review.total : 0 },
    reviews: { ...review, rate: review.total ? review.reviewed / review.total : 0 },
    assistant: {
      feedbackTotal, helpful, helpfulRate: feedbackTotal ? helpful / feedbackTotal : 0,
      answers: answers.total, localFallback: answers.localFallback, withoutSources: answers.withoutSources,
      failures: failures.total, timeouts: failures.timeout, failureRate: assistantFailureRate
    },
    crisis: { ...crisisStats, ackWithinSlaRate: crisisStats.total ? crisisStats.acknowledgedWithinSla / crisisStats.total : 0 },
    planQuality: {
      feedbackCount: quality.total,
      attributionAccuracy: normalizeAvg(quality.attributionAccuracy),
      toolUsability: normalizeAvg(quality.toolUsability),
      scriptNaturalness: normalizeAvg(quality.scriptNaturalness),
      actionDifficulty: normalizeAvg(quality.actionDifficulty),
      reviewUsefulness: normalizeAvg(quality.reviewUsefulness)
    },
    reportCompleteness: {
      ...report,
      rate: reportChecks ? reportReady / reportChecks : 0
    },
    resourceQuality: resourceCoverage,
    acceptance
  }
})

function buildResourceCoverage(rows: Array<{
  module: string
  libraryType: string
  assessmentItems: number
  attributionRules: number
  toolItems: number
}>) {
  const expected = moduleIds.flatMap(module => libraryTypes.map(libraryType => `${module}:${libraryType}`))
  const rowMap = new Map(rows.map(row => [`${row.module}:${row.libraryType}`, row]))
  const items = expected.map(key => {
    const [module, libraryType] = key.split(':')
    const row = rowMap.get(key)
    const projectionCount = row
      ? libraryType === 'assessment'
        ? row.assessmentItems
        : libraryType === 'attribution'
          ? row.attributionRules
          : row.toolItems
      : 0
    return {
      module,
      libraryType,
      published: Boolean(row),
      projectionCount,
      projectionReady: Boolean(row && projectionCount > 0)
    }
  })
  const published = items.filter(item => item.published).length
  const projectionReady = items.filter(item => item.projectionReady).length
  return {
    expected: expected.length,
    published,
    projectionReady,
    rate: expected.length ? published / expected.length : 0,
    projectionReadyRate: expected.length ? projectionReady / expected.length : 0,
    items
  }
}

function normalizeAvg(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : null
}

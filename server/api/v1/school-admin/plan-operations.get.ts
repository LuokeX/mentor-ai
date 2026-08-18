import { and, desc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })

  const db = useDb(event)
  const now = new Date()
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)

  const [statusRows, actionStats, reviewStats, blockedActions, overdueActions, dueReviews, lowFeedback, teacherRows, recentEvents] = await Promise.all([
    db.select({ status: schema.plans.status, count: sql<number>`count(*)::int` })
      .from(schema.plans)
      .where(eq(schema.plans.schoolId, admin.schoolId))
      .groupBy(schema.plans.status),
    db.select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${schema.planActions.status} = 'completed')::int`,
      blocked: sql<number>`count(*) filter (where ${schema.planActions.status} = 'blocked')::int`,
      overdue: sql<number>`count(*) filter (where ${schema.planActions.status} in ('pending','in_progress','blocked') and ${schema.planActions.dueAt} < ${now})::int`
    }).from(schema.planActions).where(and(
      eq(schema.planActions.schoolId, admin.schoolId),
      eq(schema.planActions.decision, 'included')
    )),
    db.select({
      total: sql<number>`count(distinct ${schema.plans.id})::int`,
      due: sql<number>`count(distinct ${schema.plans.id}) filter (where ${schema.plans.status} in ('accepted','in_progress','review_due','adjustment_needed','escalated') and ${schema.plans.nextReviewAt} <= ${now})::int`,
      reviewed7d: sql<number>`count(*) filter (where ${schema.planReviews.createdAt} >= ${sevenDaysAgo})::int`
    }).from(schema.plans)
      .leftJoin(schema.planReviews, eq(schema.planReviews.planId, schema.plans.id))
      .where(eq(schema.plans.schoolId, admin.schoolId)),
    db.select({
      actionId: schema.planActions.id,
      planId: schema.plans.id,
      planTitle: schema.plans.title,
      teacherName: schema.users.name,
      blockReason: schema.planActions.blockReason,
      updatedAt: schema.planActions.updatedAt
    }).from(schema.planActions)
      .innerJoin(schema.plans, eq(schema.plans.id, schema.planActions.planId))
      .innerJoin(schema.users, eq(schema.users.id, schema.planActions.ownerUserId))
      .where(and(
        eq(schema.planActions.schoolId, admin.schoolId),
        eq(schema.planActions.decision, 'included'),
        eq(schema.planActions.status, 'blocked')
      ))
      .orderBy(desc(schema.planActions.updatedAt))
      .limit(30),
    db.select({
      actionId: schema.planActions.id,
      planId: schema.plans.id,
      planTitle: schema.plans.title,
      teacherName: schema.users.name,
      dueAt: schema.planActions.dueAt,
      status: schema.planActions.status
    }).from(schema.planActions)
      .innerJoin(schema.plans, eq(schema.plans.id, schema.planActions.planId))
      .innerJoin(schema.users, eq(schema.users.id, schema.planActions.ownerUserId))
      .where(and(
        eq(schema.planActions.schoolId, admin.schoolId),
        eq(schema.planActions.decision, 'included'),
        inArray(schema.planActions.status, ['pending', 'in_progress', 'blocked']),
        lt(schema.planActions.dueAt, threeDaysAgo)
      ))
      .orderBy(schema.planActions.dueAt)
      .limit(30),
    db.select({
      planId: schema.plans.id,
      planTitle: schema.plans.title,
      teacherName: schema.users.name,
      status: schema.plans.status,
      nextReviewAt: schema.plans.nextReviewAt
    }).from(schema.plans)
      .innerJoin(schema.users, eq(schema.users.id, schema.plans.ownerUserId))
      .where(and(
        eq(schema.plans.schoolId, admin.schoolId),
        inArray(schema.plans.status, ['accepted', 'in_progress', 'review_due', 'adjustment_needed', 'escalated']),
        lte(schema.plans.nextReviewAt, now)
      ))
      .orderBy(schema.plans.nextReviewAt)
      .limit(30),
    db.select({
      planId: schema.planFeedback.planId,
      planTitle: schema.plans.title,
      teacherName: schema.users.name,
      attributionAccuracy: schema.planFeedback.attributionAccuracy,
      toolUsability: schema.planFeedback.toolUsability,
      actionDifficulty: schema.planFeedback.actionDifficulty,
      reviewUsefulness: schema.planFeedback.reviewUsefulness,
      createdAt: schema.planFeedback.createdAt
    }).from(schema.planFeedback)
      .innerJoin(schema.plans, eq(schema.plans.id, schema.planFeedback.planId))
      .innerJoin(schema.users, eq(schema.users.id, schema.planFeedback.ownerUserId))
      .where(and(
        eq(schema.planFeedback.schoolId, admin.schoolId),
        or(
          lt(schema.planFeedback.attributionAccuracy, 3),
          lt(schema.planFeedback.toolUsability, 3),
          lt(schema.planFeedback.reviewUsefulness, 3),
          eq(schema.planFeedback.actionDifficulty, 5)
        )
      ))
      .orderBy(desc(schema.planFeedback.createdAt))
      .limit(30),
    db.select({
      teacherId: schema.users.id,
      teacherName: schema.users.name,
      planCount: sql<number>`count(distinct ${schema.plans.id})::int`,
      pendingCount: sql<number>`count(distinct ${schema.plans.id}) filter (where ${schema.plans.status} = 'pending_acceptance')::int`,
      dueReviewCount: sql<number>`count(distinct ${schema.plans.id}) filter (where ${schema.plans.nextReviewAt} <= ${now} and ${schema.plans.status} in ('accepted','in_progress','review_due','adjustment_needed','escalated'))::int`,
      blockedActionCount: sql<number>`count(${schema.planActions.id}) filter (where ${schema.planActions.decision} = 'included' and ${schema.planActions.status} = 'blocked')::int`,
      overdueActionCount: sql<number>`count(${schema.planActions.id}) filter (where ${schema.planActions.decision} = 'included' and ${schema.planActions.status} in ('pending','in_progress','blocked') and ${schema.planActions.dueAt} < ${now})::int`,
      completedActionCount: sql<number>`count(${schema.planActions.id}) filter (where ${schema.planActions.decision} = 'included' and ${schema.planActions.status} = 'completed')::int`,
      totalActionCount: sql<number>`count(${schema.planActions.id}) filter (where ${schema.planActions.decision} = 'included')::int`
    }).from(schema.users)
      .leftJoin(schema.plans, and(eq(schema.plans.ownerUserId, schema.users.id), eq(schema.plans.schoolId, admin.schoolId)))
      .leftJoin(schema.planActions, eq(schema.planActions.planId, schema.plans.id))
      .where(and(eq(schema.users.schoolId, admin.schoolId), eq(schema.users.role, 'teacher')))
      .groupBy(schema.users.id, schema.users.name)
      .orderBy(desc(sql`count(${schema.planActions.id}) filter (where ${schema.planActions.decision} = 'included' and ${schema.planActions.status} in ('pending','in_progress','blocked') and ${schema.planActions.dueAt} < ${now})`))
      .limit(50),
    db.select({
      eventType: schema.planOperationEvents.eventType,
      planId: schema.planOperationEvents.planId,
      actionId: schema.planOperationEvents.actionId,
      teacherName: schema.users.name,
      metadata: schema.planOperationEvents.metadata,
      createdAt: schema.planOperationEvents.createdAt
    }).from(schema.planOperationEvents)
      .innerJoin(schema.users, eq(schema.users.id, schema.planOperationEvents.ownerUserId))
      .where(eq(schema.planOperationEvents.schoolId, admin.schoolId))
      .orderBy(desc(schema.planOperationEvents.createdAt))
      .limit(50)
  ])

  const statusCounts = Object.fromEntries(statusRows.map(row => [row.status, row.count]))
  const action = actionStats[0] || { total: 0, completed: 0, blocked: 0, overdue: 0 }
  const review = reviewStats[0] || { total: 0, due: 0, reviewed7d: 0 }
  return {
    statusCounts,
    summary: {
      totalPlans: Object.values(statusCounts).reduce((sum, count) => sum + Number(count), 0),
      pendingAcceptance: statusCounts.pending_acceptance || 0,
      inProgress: (statusCounts.accepted || 0) + (statusCounts.in_progress || 0) + (statusCounts.review_due || 0),
      adjustmentNeeded: statusCounts.adjustment_needed || 0,
      escalated: statusCounts.escalated || 0,
      completed: statusCounts.completed || 0
    },
    actionMetrics: {
      ...action,
      completionRate: action.total ? Math.round((action.completed / action.total) * 100) : 0,
      blockedRate: action.total ? Math.round((action.blocked / action.total) * 100) : 0,
      overdueRate: action.total ? Math.round((action.overdue / action.total) * 100) : 0
    },
    reviewMetrics: {
      ...review,
      dueRate: review.total ? Math.round((review.due / review.total) * 100) : 0
    },
    queues: {
      blockedActions,
      overdueActions: overdueActions.map(item => ({
        ...item,
        overdueDays: item.dueAt ? Math.floor((Date.now() - new Date(item.dueAt).getTime()) / 86_400_000) : 0
      })),
      dueReviews,
      lowFeedback
    },
    teacherOperations: teacherRows.map(item => ({
      ...item,
      actionCompletionRate: item.totalActionCount ? Math.round((item.completedActionCount / item.totalActionCount) * 100) : 0
    })),
    recentEvents
  }
})

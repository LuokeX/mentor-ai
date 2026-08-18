import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })

  const db = useDb(event)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)

  // 方案完成率（全部时间）
  const [planStats] = await db.select({
    total: sql<number>`count(*)::int`,
    completed: sql<number>`count(*) filter (where ${schema.plans.status} = 'completed')::int`,
    inProgress: sql<number>`count(*) filter (where ${schema.plans.status} in ('accepted','in_progress','review_due','adjustment_needed','escalated'))::int`,
  }).from(schema.plans).where(eq(schema.plans.schoolId, admin.schoolId))

  // 超期方案（执行中且 updated_at 超过 7 天未更新）
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
  const overduePlans = await db.select({
    id: schema.plans.id,
    title: schema.plans.title,
    ownerUserId: schema.plans.ownerUserId,
    teacherName: schema.users.name,
    status: schema.plans.status,
    updatedAt: schema.plans.updatedAt,
    nextReviewAt: schema.plans.nextReviewAt,
  }).from(schema.plans)
    .innerJoin(schema.users, eq(schema.users.id, schema.plans.ownerUserId))
    .where(and(
      eq(schema.plans.schoolId, admin.schoolId),
      sql`${schema.plans.status} in ('accepted','in_progress','review_due','adjustment_needed','escalated')`,
      lt(schema.plans.updatedAt, new Date(Date.now() - sevenDaysMs))
    ))
    .orderBy(desc(schema.plans.updatedAt))

  // 班主任执行排名（最近 7 天，统计完成动作数）
  const teacherRanking = await db.select({
    teacherId: schema.plans.ownerUserId,
    teacherName: schema.users.name,
    planCount: sql<number>`count(distinct ${schema.plans.id})::int`,
    completedActionCount: sql<number>`count(*) filter (where ${schema.planActions.status} = 'completed' and ${schema.planActions.completedAt} >= ${sevenDaysAgo})::int`,
    totalActionCount: sql<number>`count(*)::int`,
  }).from(schema.planActions)
    .innerJoin(schema.plans, eq(schema.plans.id, schema.planActions.planId))
    .innerJoin(schema.users, eq(schema.users.id, schema.plans.ownerUserId))
    .where(and(
      eq(schema.plans.schoolId, admin.schoolId),
      eq(schema.planActions.decision, 'included'),
      eq(schema.users.role, 'teacher')
    ))
    .groupBy(schema.plans.ownerUserId, schema.users.name)
    .orderBy(desc(sql`count(*) filter (where ${schema.planActions.status} = 'completed' and ${schema.planActions.completedAt} >= ${sevenDaysAgo})`))
    .limit(20)

  const [quality] = await db.select({
    feedbackCount: sql<number>`count(*)::int`,
    attributionAccuracy: sql<number>`coalesce(round(avg(${schema.planFeedback.attributionAccuracy}), 1), 0)::float`,
    toolUsability: sql<number>`coalesce(round(avg(${schema.planFeedback.toolUsability}), 1), 0)::float`,
    scriptNaturalness: sql<number>`coalesce(round(avg(${schema.planFeedback.scriptNaturalness}), 1), 0)::float`,
    actionDifficulty: sql<number>`coalesce(round(avg(${schema.planFeedback.actionDifficulty}), 1), 0)::float`,
  }).from(schema.planFeedback).where(eq(schema.planFeedback.schoolId, admin.schoolId))

  const feedbackTagSource = await db.select({ tags: schema.planFeedback.tags })
    .from(schema.planFeedback)
    .where(eq(schema.planFeedback.schoolId, admin.schoolId))
    .limit(500)
  const tagCounts = new Map<string, number>()
  for (const row of feedbackTagSource) {
    for (const tag of row.tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
  }
  const feedbackTagRows = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }))

  const lowRatedTools = await db.select({
    planId: schema.planFeedback.planId,
    planTitle: schema.plans.title,
    teacherName: schema.users.name,
    toolUsability: schema.planFeedback.toolUsability,
    attributionAccuracy: schema.planFeedback.attributionAccuracy,
    createdAt: schema.planFeedback.createdAt,
  }).from(schema.planFeedback)
    .innerJoin(schema.plans, eq(schema.plans.id, schema.planFeedback.planId))
    .innerJoin(schema.users, eq(schema.users.id, schema.planFeedback.ownerUserId))
    .where(and(
      eq(schema.planFeedback.schoolId, admin.schoolId),
      lt(schema.planFeedback.toolUsability, 3)
    ))
    .orderBy(desc(schema.planFeedback.createdAt))
    .limit(10)

  return {
    planCompletion: {
      total: planStats?.total ?? 0,
      completed: planStats?.completed ?? 0,
      inProgress: planStats?.inProgress ?? 0,
      rate: planStats?.total ? Math.round((planStats.completed / planStats.total) * 100) : 0,
    },
    overduePlans: overduePlans.map(p => ({
      ...p,
      daysSinceUpdate: Math.floor((Date.now() - new Date(p.updatedAt).getTime()) / 86_400_000),
    })),
    teacherRanking,
    quality: {
      feedbackCount: quality?.feedbackCount ?? 0,
      attributionAccuracy: quality?.attributionAccuracy ?? 0,
      toolUsability: quality?.toolUsability ?? 0,
      scriptNaturalness: quality?.scriptNaturalness ?? 0,
      actionDifficulty: quality?.actionDifficulty ?? 0,
      tagDistribution: feedbackTagRows,
      lowRatedTools
    }
  }
})

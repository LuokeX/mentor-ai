import { and, desc, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { ensurePlanActions } from '../../../domain/plan-actions'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const db = useDb(event)
  const tomorrow = new Date(); tomorrow.setHours(24, 0, 0, 0)
  const plans = await db.select({ id: schema.plans.id }).from(schema.plans).where(and(
    eq(schema.plans.ownerUserId, user.id), eq(schema.plans.status, 'in_progress')
  )).limit(100)
  await Promise.all(plans.map(plan => ensurePlanActions(event, plan.id, user.id)))

  const [drafts, actions, reviews, assignments, notifications, unread, contextCount, chatCount, assessmentCount, planCount, consentCount, submittedAttempts, openActions] = await Promise.all([
    db.select({ id: schema.assessmentAttempts.id, module: schema.assessmentAttempts.module, answers: schema.assessmentAttempts.answers, updatedAt: schema.assessmentAttempts.updatedAt })
      .from(schema.assessmentAttempts).where(and(eq(schema.assessmentAttempts.ownerUserId, user.id), eq(schema.assessmentAttempts.status, 'draft')))
      .orderBy(desc(schema.assessmentAttempts.updatedAt)).limit(50),
    db.select({ action: schema.planActions, planTitle: schema.plans.title }).from(schema.planActions)
      .innerJoin(schema.plans, eq(schema.planActions.planId, schema.plans.id)).where(and(
        eq(schema.planActions.ownerUserId, user.id),
        inArray(schema.planActions.status, ['pending', 'in_progress']),
        lte(schema.planActions.dueAt, tomorrow)
      )).orderBy(schema.planActions.dueAt).limit(20),
    db.select({ id: schema.plans.id, module: schema.plans.module, title: schema.plans.title, nextReviewAt: schema.plans.nextReviewAt })
      .from(schema.plans).where(and(
        eq(schema.plans.ownerUserId, user.id), eq(schema.plans.status, 'in_progress'), lte(schema.plans.nextReviewAt, tomorrow)
      )).orderBy(schema.plans.nextReviewAt).limit(10),
    db.select().from(schema.recordAssignments).where(eq(schema.recordAssignments.toUserId, user.id))
      .orderBy(desc(schema.recordAssignments.createdAt)).limit(10),
    db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id))
      .orderBy(desc(schema.notifications.createdAt)).limit(10),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.notifications)
      .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.chatSessions)
      .where(and(eq(schema.chatSessions.ownerUserId, user.id), ne(schema.chatSessions.contextType, 'none'))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.chatMessages)
      .where(and(eq(schema.chatMessages.ownerUserId, user.id), eq(schema.chatMessages.role, 'user'))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.assessmentAttempts)
      .where(and(eq(schema.assessmentAttempts.ownerUserId, user.id), eq(schema.assessmentAttempts.status, 'submitted'))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.plans).where(eq(schema.plans.ownerUserId, user.id)),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.userConsents)
      .where(and(eq(schema.userConsents.userId, user.id), isNull(schema.userConsents.revokedAt))),
    db.select({ module: schema.assessmentAttempts.module, result: schema.assessmentAttempts.result, submittedAt: schema.assessmentAttempts.submittedAt })
      .from(schema.assessmentAttempts).where(and(
        eq(schema.assessmentAttempts.ownerUserId, user.id), eq(schema.assessmentAttempts.status, 'submitted')
      )).orderBy(desc(schema.assessmentAttempts.submittedAt)).limit(100),
    db.select({ id: schema.planActions.id, planId: schema.planActions.planId, module: schema.plans.module, status: schema.planActions.status })
      .from(schema.planActions).innerJoin(schema.plans, eq(schema.planActions.planId, schema.plans.id)).where(and(
        eq(schema.planActions.ownerUserId, user.id), inArray(schema.planActions.status, ['pending', 'in_progress'])
      )).limit(200)
  ])
  const now = Date.now()
  const moduleIds = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem'] as const
  const moduleStates = Object.fromEntries(moduleIds.map(module => {
    const draft = drafts.find(item => item.module === module)
    const latest = submittedAttempts.find(item => item.module === module)
    const pendingActions = openActions.filter(item => item.module === module)
    const pendingReviews = reviews.filter(item => item.module === module)
    const result = (latest?.result || {}) as Record<string, unknown>
    return [module, {
      draftId: draft?.id,
      draftUpdatedAt: draft?.updatedAt,
      draftAnswerCount: draft ? Object.keys(draft.answers || {}).length : 0,
      lastSubmittedAt: latest?.submittedAt,
      lastLevel: typeof result.level === 'string' ? result.level : undefined,
      pendingActions: pendingActions.length,
      reviewDue: pendingReviews.length,
      latestPlanId: pendingActions[0]?.planId || pendingReviews[0]?.id
    }]
  }))
  return {
    drafts: drafts.slice(0, 10).map(({ answers, ...draft }) => ({ ...draft, answerCount: Object.keys(answers || {}).length })),
    actions: actions.map(item => ({ ...item.action, planTitle: item.planTitle, overdue: Boolean(item.action.dueAt && item.action.dueAt.getTime() < now) })),
    reviews,
    recentAssignments: assignments,
    notifications,
    unreadCount: unread[0]?.count || 0,
    moduleStates,
    onboarding: [
      { key: 'activated', label: '激活账号', completed: true },
      { key: 'privacy', label: '确认隐私告知', completed: (consentCount[0]?.count || 0) > 0 },
      { key: 'context', label: '选择咨询对象', completed: (contextCount[0]?.count || 0) > 0 },
      { key: 'first_use', label: '完成第一次咨询或评估', completed: (chatCount[0]?.count || 0) > 0 || (assessmentCount[0]?.count || 0) > 0 },
      { key: 'first_plan', label: '查看第一份方案', completed: (planCount[0]?.count || 0) > 0 }
    ]
  }
})

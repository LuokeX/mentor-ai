import { assessmentBadge } from '#shared/assessments'
import { and, desc, eq, sql, type AnyColumn } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const db = useDb(event)
  const owner = (column: AnyColumn, schoolColumn: AnyColumn) => and(
    eq(column, user.id),
    eq(schoolColumn, user.schoolId!),
  )

  const [
    [classCount],
    [studentCount],
    [guardianCount],
    [relationCount],
    [communicationCount],
    [planCount],
    [reviewCount],
    attempts,
    planLinks,
  ] = await Promise.all([
    db.select({ value: sql<number>`count(*)::int` }).from(schema.classes)
      .where(owner(schema.classes.ownerUserId, schema.classes.schoolId)),
    db.select({ value: sql<number>`count(*)::int` }).from(schema.students)
      .where(owner(schema.students.ownerUserId, schema.students.schoolId)),
    db.select({ value: sql<number>`count(*)::int` }).from(schema.guardians)
      .where(owner(schema.guardians.ownerUserId, schema.guardians.schoolId)),
    db.select({ value: sql<number>`count(*)::int` }).from(schema.studentGuardians)
      .innerJoin(schema.students, and(
        eq(schema.students.id, schema.studentGuardians.studentId),
        eq(schema.students.schoolId, user.schoolId),
        eq(schema.students.ownerUserId, user.id),
      ))
      .where(and(
        eq(schema.studentGuardians.schoolId, user.schoolId),
        eq(schema.studentGuardians.status, 'active'),
      )),
    db.select({ value: sql<number>`count(*)::int` }).from(schema.communications)
      .where(owner(schema.communications.ownerUserId, schema.communications.schoolId)),
    db.select({ value: sql<number>`count(*)::int` }).from(schema.plans)
      .where(owner(schema.plans.ownerUserId, schema.plans.schoolId)),
    db.select({ value: sql<number>`count(*)::int` }).from(schema.planReviews)
      .where(owner(schema.planReviews.ownerUserId, schema.planReviews.schoolId)),
    db.select({
      id: schema.assessmentAttempts.id,
      module: schema.assessmentAttempts.module,
      status: schema.assessmentAttempts.status,
      result: schema.assessmentAttempts.result,
      submittedAt: schema.assessmentAttempts.submittedAt,
      updatedAt: schema.assessmentAttempts.updatedAt,
    }).from(schema.assessmentAttempts)
      .where(owner(schema.assessmentAttempts.ownerUserId, schema.assessmentAttempts.schoolId))
      .orderBy(desc(schema.assessmentAttempts.updatedAt))
      .limit(5),
    db.select({
      id: schema.plans.id,
      sourceAssessmentAttemptId: schema.plans.sourceAssessmentAttemptId,
    }).from(schema.plans)
      .where(owner(schema.plans.ownerUserId, schema.plans.schoolId)),
  ])

  const planByAttempt = new Map(planLinks
    .filter(plan => plan.sourceAssessmentAttemptId)
    .map(plan => [plan.sourceAssessmentAttemptId!, plan.id]))

  return {
    ownershipNote: '班级、学生、家长、沟通和方案是学校业务档案；当前页面只汇总当前由你负责的记录。',
    overviewCards: [
      { label: '负责班级', value: classCount?.value ?? 0, hint: `${studentCount?.value ?? 0} 名学生` },
      { label: '关联家长', value: guardianCount?.value ?? 0, hint: `${relationCount?.value ?? 0} 条有效关系` },
      { label: '家校沟通', value: communicationCount?.value ?? 0, hint: '沟通正文仅在授权详情中展示' },
      { label: '方案记录', value: planCount?.value ?? 0, hint: `${reviewCount?.value ?? 0} 条复盘` },
    ],
    assessments: attempts.map((attempt) => {
      const result = attempt.result as { level?: string } | null
      const badge = assessmentBadge(result?.level)
      return {
        ...attempt,
        planId: planByAttempt.get(attempt.id) || null,
        levelLabel: badge?.label || null,
        levelColor: badge?.color || null,
      }
    }),
  }
})

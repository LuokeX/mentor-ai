import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { decryptSensitive } from '../../../utils/crypto'
import { schema, useDb } from '../../../utils/db'
import { ensurePlanActions } from '../../../domain/plan-actions'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)

  const [plan] = await db.select().from(schema.plans).where(and(
    eq(schema.plans.id, id),
    eq(schema.plans.ownerUserId, user.id)
  )).limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })

  const config = useRuntimeConfig(event)
  const secret = config.encryptionKey

  // LEFT JOIN 学生
  let student: { name: string; gender: string } | null = null
  if (plan.studentId) {
    const [row] = await db.select({ nameEnc: schema.students.nameEnc, gender: schema.students.gender })
      .from(schema.students).where(eq(schema.students.id, plan.studentId)).limit(1)
    if (row) student = { name: decryptSensitive(row.nameEnc, secret), gender: row.gender || '' }
  }

  // LEFT JOIN 班级
  let klass: { name: string; grade: number } | null = null
  if (plan.classId) {
    const [row] = await db.select({ name: schema.classes.name, grade: schema.classes.grade })
      .from(schema.classes).where(eq(schema.classes.id, plan.classId)).limit(1)
    if (row) klass = { name: row.name, grade: row.grade }
  }

  // LEFT JOIN 来源评估
  let sourceAssessment: { module: string; result: Record<string, unknown>; submittedAt: Date | null } | null = null
  if (plan.sourceAssessmentAttemptId) {
    const [row] = await db.select({ module: schema.assessmentAttempts.module, result: schema.assessmentAttempts.result, submittedAt: schema.assessmentAttempts.submittedAt })
      .from(schema.assessmentAttempts).where(eq(schema.assessmentAttempts.id, plan.sourceAssessmentAttemptId)).limit(1)
    if (row) sourceAssessment = { module: row.module, result: (row.result as Record<string, unknown>) || {}, submittedAt: row.submittedAt }
  }

  // LEFT JOIN 复盘记录
  const reviews = await db.select().from(schema.planReviews)
    .where(eq(schema.planReviews.planId, id))
    .orderBy(desc(schema.planReviews.reviewAt), desc(schema.planReviews.createdAt))
  const actions = await ensurePlanActions(event, plan.id, user.id)

  return {
    ...plan,
    summary: decryptSensitive(plan.summaryEnc, secret),
    summaryEnc: undefined,
    student,
    class: klass,
    sourceAssessment,
    actions,
    reviews,
  }
})

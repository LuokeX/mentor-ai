import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { decryptSensitive } from '../../../utils/crypto'
import { schema, useDb } from '../../../utils/db'
import { ensurePlanActions } from '../../../domain/plan-actions'
import { truncateByChars } from '../../../domain/plan-titles'
import { redactPii } from '../../../integrations/deepseek'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)

  const [plan] = await db.select().from(schema.plans).where(and(
    eq(schema.plans.id, id),
    eq(schema.plans.ownerUserId, user.id),
    eq(schema.plans.schoolId, user.schoolId)
  )).limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })

  const config = useRuntimeConfig(event)
  const secret = config.encryptionKey

  // LEFT JOIN 学生（方案、学生、班级同属一个学校才可见）
  let student: { name: string; gender: string } | null = null
  if (plan.studentId) {
    const [row] = await db.select({ nameEnc: schema.students.nameEnc, gender: schema.students.gender })
      .from(schema.students)
      .where(and(
        eq(schema.students.id, plan.studentId),
        eq(schema.students.schoolId, user.schoolId)
      )).limit(1)
    if (row) student = { name: decryptSensitive(row.nameEnc, secret), gender: row.gender || '' }
  }

  // LEFT JOIN 班级
  let klass: { name: string; grade: number } | null = null
  if (plan.classId) {
    const [row] = await db.select({ name: schema.classes.name, grade: schema.classes.grade })
      .from(schema.classes)
      .where(and(
        eq(schema.classes.id, plan.classId),
        eq(schema.classes.schoolId, user.schoolId)
      )).limit(1)
    if (row) klass = { name: row.name, grade: row.grade }
  }

  // LEFT JOIN 来源评估（多量表按提交顺序；迁移已把旧方案的单量表关系回填到 plan_assessment_attempts）
  const assessmentRows = await db.select({
    attemptId: schema.assessmentAttempts.id,
    module: schema.assessmentAttempts.module,
    code: schema.assessmentAttempts.assessmentCode,
    result: schema.assessmentAttempts.result,
    submittedAt: schema.assessmentAttempts.submittedAt
  })
    .from(schema.planAssessmentAttempts)
    .innerJoin(schema.assessmentAttempts, eq(schema.planAssessmentAttempts.assessmentAttemptId, schema.assessmentAttempts.id))
    .where(eq(schema.planAssessmentAttempts.planId, id))
    .orderBy(asc(schema.planAssessmentAttempts.sequence))
  const assessments = assessmentRows.map(row => ({
    attemptId: row.attemptId,
    module: row.module,
    code: row.code,
    result: (row.result as Record<string, unknown>) || {},
    submittedAt: row.submittedAt
  }))
  // 兼容字段：首个来源评估，供既有消费方使用
  const sourceAssessment = assessments[0] || null

  // 来源对话摘要：仅 AI 来源且会话仍属于当前教师/学校时返回（跨教师/跨学校视为不存在）
  let sourceConversation: { sessionId: string, questionSummary: string | null, createdAt: Date } | null = null
  if (plan.sourceChatSessionId) {
    const [session] = await db.select({ id: schema.chatSessions.id, createdAt: schema.chatSessions.createdAt })
      .from(schema.chatSessions)
      .where(and(
        eq(schema.chatSessions.id, plan.sourceChatSessionId),
        eq(schema.chatSessions.ownerUserId, user.id),
        eq(schema.chatSessions.schoolId, user.schoolId!)
      ))
      .limit(1)
    if (session) {
      const [firstUser] = await db.select({ contentEnc: schema.chatMessages.contentEnc })
        .from(schema.chatMessages)
        .where(and(
          eq(schema.chatMessages.sessionId, session.id),
          eq(schema.chatMessages.role, 'user')
        ))
        .orderBy(asc(schema.chatMessages.createdAt))
        .limit(1)
      sourceConversation = {
        sessionId: session.id,
        questionSummary: firstUser
          ? truncateByChars(redactPii(decryptSensitive(firstUser.contentEnc, secret)), 80)
          : plan.sourceQuestionSummary || null,
        createdAt: session.createdAt
      }
    }
  }

  // LEFT JOIN 复盘记录
  const [reviews, feedback] = await Promise.all([
    db.select().from(schema.planReviews)
      .where(eq(schema.planReviews.planId, id))
      .orderBy(desc(schema.planReviews.reviewAt), desc(schema.planReviews.createdAt)),
    db.select().from(schema.planFeedback)
      .where(and(eq(schema.planFeedback.planId, id), eq(schema.planFeedback.ownerUserId, user.id)))
      .orderBy(desc(schema.planFeedback.createdAt))
      .limit(10)
  ])
  const actions = await ensurePlanActions(event, plan.id, user.id)
  const evidenceRows = actions.length ? await db.select({
    id: schema.planActionEvidence.id,
    actionId: schema.planActionEvidence.actionId,
    kind: schema.planActionEvidence.kind,
    filename: schema.planActionEvidence.filename,
    mimeType: schema.planActionEvidence.mimeType,
    byteSize: schema.planActionEvidence.byteSize,
    createdAt: schema.planActionEvidence.createdAt
  }).from(schema.planActionEvidence).where(and(
    inArray(schema.planActionEvidence.actionId, actions.map(action => action.id)),
    eq(schema.planActionEvidence.planId, plan.id),
    eq(schema.planActionEvidence.ownerUserId, user.id),
    eq(schema.planActionEvidence.schoolId, user.schoolId),
    eq(schema.planActionEvidence.status, 'active')
  )).orderBy(asc(schema.planActionEvidence.createdAt)) : []
  const evidenceByAction = new Map<string, typeof evidenceRows>()
  for (const file of evidenceRows) {
    evidenceByAction.set(file.actionId, [...(evidenceByAction.get(file.actionId) || []), file])
  }
  const { summaryEnc, acceptanceReasonEnc, ...publicPlan } = plan

  return {
    ...publicPlan,
    summary: decryptSensitive(summaryEnc, secret),
    acceptanceReason: acceptanceReasonEnc ? decryptSensitive(acceptanceReasonEnc, secret) : null,
    student,
    class: klass,
    sourceAssessment,
    assessments,
    sourceConversation,
    actions: actions.map(({ blockNoteEnc, evidenceSummaryEnc, decisionNoteEnc, ...action }) => ({
      ...action,
      blockNote: blockNoteEnc ? decryptSensitive(blockNoteEnc, secret) : null,
      evidenceSummary: evidenceSummaryEnc ? decryptSensitive(evidenceSummaryEnc, secret) : null,
      decisionNote: decisionNoteEnc ? decryptSensitive(decisionNoteEnc, secret) : null,
      evidenceFiles: evidenceByAction.get(action.id) || []
    })),
    reviews,
    feedback: feedback.map(({ noteEnc, ...item }) => ({
      ...item,
      note: noteEnc ? decryptSensitive(noteEnc, secret) : null
    })),
  }
})

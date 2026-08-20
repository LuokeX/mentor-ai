import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import type { ModuleId } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { decryptSensitive } from '../../../utils/crypto'
import { schema, useDb } from '../../../utils/db'
import { ensurePlanActions } from '../../../domain/plan-actions'
import { truncateByChars } from '../../../domain/plan-titles'
import { redactPii } from '../../../integrations/deepseek'
import { listInstrumentOptions } from '../../../domain/assessment-instruments'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)

  const [plan] = await db.select().from(schema.plans).where(and(
    eq(schema.plans.id, id),
    eq(schema.plans.ownerUserId, user.id),
    eq(schema.plans.schoolId, user.schoolId),
    // 管理员归档/弃用的方案对教师不可见
    ne(schema.plans.status, 'archived')
  )).limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })

  // 后台 AI 增强兜底：进程崩溃会留下 pending 状态且无任务可收敛。
  // 超过模型超时上限（360s）仍 pending 视为任务丢失，收敛为 failed（保留确定性报告）。
  if (plan.aiReportStatus === 'pending' && Date.now() - plan.updatedAt.getTime() > 360_000) {
    await db.update(schema.plans).set({ aiReportStatus: 'failed' }).where(eq(schema.plans.id, id))
    plan.aiReportStatus = 'failed'
  }

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
          eq(schema.chatMessages.role, 'user'),
          isNull(schema.chatMessages.deletedAt)
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

  // 深度诊断建议：
  // 1) 生成方案时写入的真实行动项（kind=instrument_suggestion）：教师完成对应量表后
  //    惰性置为 completed——「完成即不再待办」由量表完成状态驱动；
  // 2) 动态卡片（归因构成下方提醒）：满足触发条件但尚未完成的量表。
  let nextInstrumentSuggestion: { code: string, title: string, note: string | null } | null = null
  const suggestionByActionTitle = new Map<string, { instrumentCode: string }>()
  try {
    const options = await listInstrumentOptions(event, plan.module as ModuleId, { id: user.id, schoolId: user.schoolId })
    const snapshots = (plan.actions || []) as Array<Record<string, unknown>>
    for (const snapshot of snapshots) {
      if (snapshot.kind !== 'instrument_suggestion') continue
      const title = String(snapshot.title || '')
      const code = String(snapshot.instrumentCode || '')
      if (!title || !code) continue
      suggestionByActionTitle.set(title, { instrumentCode: code })
      // 完成联动：对应量表已由该教师提交完成 → 惰性将行动项置为已完成
      const done = options.some(option => option.code === code && option.status === 'completed')
      if (!done) continue
      const [row] = await db.select({ id: schema.planActions.id, status: schema.planActions.status })
        .from(schema.planActions)
        .where(and(
          eq(schema.planActions.planId, id),
          eq(schema.planActions.ownerUserId, user.id),
          eq(schema.planActions.title, title)
        ))
        .limit(1)
      if (row && row.status !== 'completed') {
        await db.update(schema.planActions).set({ status: 'completed', completedAt: new Date() })
          .where(eq(schema.planActions.id, row.id))
      }
    }
    const linkedCodes = new Set(assessmentRows.map(row => row.code))
    const candidate = options.find(option =>
      option.status === 'suggested'
      && !linkedCodes.has(option.code)
      // 红线检查量表由系统在高危阈值命中时触发，不通过方案待办向教师提示
      && option.role !== 'red_line'
    )
    if (candidate) {
      nextInstrumentSuggestion = {
        code: candidate.code,
        title: candidate.title,
        note: candidate.triggerConditionNote || candidate.description || null
      }
    }
  } catch {
    // 建议计算失败不阻断方案查看
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
    nextInstrumentSuggestion,
    actions: actions.map(({ blockNoteEnc, evidenceSummaryEnc, decisionNoteEnc, ...action }) => ({
      ...action,
      blockNote: blockNoteEnc ? decryptSensitive(blockNoteEnc, secret) : null,
      evidenceSummary: evidenceSummaryEnc ? decryptSensitive(evidenceSummaryEnc, secret) : null,
      decisionNote: decisionNoteEnc ? decryptSensitive(decisionNoteEnc, secret) : null,
      evidenceFiles: evidenceByAction.get(action.id) || [],
      // 深度诊断建议行动项：附带量表编码，前端渲染「去完成」跳转
      suggestion: suggestionByActionTitle.get(action.title) || null
    })),
    reviews,
    feedback: feedback.map(({ noteEnc, ...item }) => ({
      ...item,
      note: noteEnc ? decryptSensitive(noteEnc, secret) : null
    })),
  }
})

import { z } from 'zod'
import { and, desc, eq, ne } from 'drizzle-orm'
import { assessmentDefinitions } from '../../../../../shared/assessments'
import type { AssessmentDefinition } from '../../../../../shared/assessments'
import { moduleIdSchema } from '../../../../../shared/contracts'
import type { RuleConfig } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { evaluateAssessment } from '../../../../domain/rules'
import { executeRules } from '../../../../domain/rules-executor'
import { encryptSensitive } from '../../../../utils/crypto'
import { createSafetyReferral } from '../../../../domain/safety'
import { createPlanActions, defaultReviewAt } from '../../../../domain/plan-actions'
import { trackProductEvent } from '../../../../domain/product-events'
import { writeAudit } from '../../../../utils/audit'
import { generateAssessmentReport } from '../../../../integrations/deepseek'

const bodySchema = z.object({
  attemptId: z.string().uuid().optional(),
  answers: z.record(z.string(), z.number().int().min(1).max(5)),
  studentId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  guardianId: z.string().uuid().optional(),
  sourceChatSessionId: z.string().uuid().optional()
})

// 从 content_packages 加载已发布的定义 / 规则
async function loadPublished<T>(db: ReturnType<typeof useDb>, code: string): Promise<{ payload: T; code: string; version: string } | null> {
  const [row] = await db
    .select({ payload: schema.contentPackages.payload, code: schema.contentPackages.code, version: schema.contentPackages.version })
    .from(schema.contentPackages)
    .where(and(
      eq(schema.contentPackages.code, code),
      eq(schema.contentPackages.status, 'published')
    ))
    .orderBy(desc(schema.contentPackages.version))
    .limit(1)
  return row ? { payload: row.payload as unknown as T, code: row.code, version: row.version } : null
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)

  // 动态加载题库定义（优先 content_packages，fallback 硬编码）
  const publishedDef = await loadPublished<AssessmentDefinition>(db, `assessment-${module}`)
  const definition: AssessmentDefinition = publishedDef
    ? { ...publishedDef.payload, code: (publishedDef.payload as any).code || publishedDef.code, version: (publishedDef.payload as any).version || publishedDef.version }
    : assessmentDefinitions[module]

  if (definition.questions.some(question => !body.answers[question.id])) {
    throw createError({ statusCode: 422, message: '请完成全部题目' })
  }

  // 上下文验证（学生/班级/家长/对话）
  let linkedClassId = body.classId
  if (body.studentId) {
    const [student] = await db.select({ id: schema.students.id, classId: schema.students.classId }).from(schema.students).where(and(
      eq(schema.students.id, body.studentId),
      eq(schema.students.ownerUserId, user.id),
      eq(schema.students.schoolId, user.schoolId)
    )).limit(1)
    if (!student) throw createError({ statusCode: 404, message: '关联学生不存在或不属于当前负责范围' })
    linkedClassId ||= student.classId || undefined
  }
  if (linkedClassId) {
    const [klass] = await db.select({ id: schema.classes.id }).from(schema.classes).where(and(
      eq(schema.classes.id, linkedClassId),
      eq(schema.classes.ownerUserId, user.id),
      eq(schema.classes.schoolId, user.schoolId)
    )).limit(1)
    if (!klass) throw createError({ statusCode: 404, message: '关联班级不存在或不属于当前负责范围' })
  }
  if (body.guardianId) {
    const [guardian] = await db.select({ id: schema.guardians.id }).from(schema.guardians).where(and(
      eq(schema.guardians.id, body.guardianId),
      eq(schema.guardians.ownerUserId, user.id),
      eq(schema.guardians.schoolId, user.schoolId)
    )).limit(1)
    if (!guardian) throw createError({ statusCode: 404, message: '关联家长不存在或不属于当前负责范围' })
  }
  if (body.sourceChatSessionId) {
    const [session] = await db.select({ id: schema.chatSessions.id }).from(schema.chatSessions).where(and(
      eq(schema.chatSessions.id, body.sourceChatSessionId),
      eq(schema.chatSessions.ownerUserId, user.id),
      eq(schema.chatSessions.schoolId, user.schoolId)
    )).limit(1)
    if (!session) throw createError({ statusCode: 404, message: '来源对话不存在或不属于当前账号' })
  }

  // 计算之前连续低意义感次数（self_growth 模块需要）
  const previous = module === 'self_growth'
    ? await db.select({ answers: schema.assessmentAttempts.answers })
        .from(schema.assessmentAttempts)
        .where(and(
          eq(schema.assessmentAttempts.ownerUserId, user.id),
          eq(schema.assessmentAttempts.module, module),
          eq(schema.assessmentAttempts.status, 'submitted')
        ))
        .orderBy(desc(schema.assessmentAttempts.submittedAt))
        .limit(3)
    : []
  let previousConsecutiveLowMeaning = 0
  for (const item of previous) {
    if (Number(item.answers.q3) <= 2) previousConsecutiveLowMeaning++
    else break
  }

  // 动态加载规则配置（优先 content_packages，fallback 硬编码）
  const publishedRules = await loadPublished<RuleConfig>(db, `rules-${module}`)
  const ruleConfig = publishedRules?.payload ?? null
  const result = ruleConfig
    ? executeRules(ruleConfig, body.answers, definition, { previousConsecutiveLowMeaning })
    : evaluateAssessment(module, body.answers, { previousConsecutiveLowMeaning })

  const report = result.blocked ? null : await generateAssessmentReport(event, {
    schoolId: user.schoolId,
    ownerUserId: user.id,
    module,
    result
  })
  const narrative = report?.profile.summary || result.reasons.join('；')
  const presentedResult = { ...result, narrative: result.blocked ? null : narrative, report }

  const [attempt] = body.attemptId
    ? await db.update(schema.assessmentAttempts).set({
        answers: body.answers, result: presentedResult as unknown as Record<string, unknown>, status: 'submitted', submittedAt: new Date(), updatedAt: new Date()
      }).where(and(
        eq(schema.assessmentAttempts.id, body.attemptId),
        eq(schema.assessmentAttempts.ownerUserId, user.id),
        eq(schema.assessmentAttempts.schoolId, user.schoolId),
        ne(schema.assessmentAttempts.status, 'submitted')
      )).returning()
    : await db.insert(schema.assessmentAttempts).values({
        schoolId: user.schoolId, ownerUserId: user.id, module,
        assessmentCode: definition.code, definitionVersion: definition.version,
        status: 'submitted', answers: body.answers, result: presentedResult as unknown as Record<string, unknown>, submittedAt: new Date()
      }).returning()
  if (!attempt) throw createError({ statusCode: body.attemptId ? 404 : 500, message: body.attemptId ? '草稿不存在或已经提交' : '评估记录保存失败' })

  let fuse: { eventId: string, referralId: string, crisisGuide: string } | null = null
  let planId: string | null = null
  if (result.blocked) {
    const referral = await createSafetyReferral(event, {
      schoolId: user.schoolId, ownerUserId: user.id, sourceType: 'assessment', sourceId: attempt.id,
      text: `${definition.title}触发高风险规则：${result.reasons.join('；')}`, matchedRules: result.matchedRuleIds
    })
    fuse = { eventId: referral.safety.id, referralId: referral.referral.id, crisisGuide: referral.crisisGuide }
  } else {
    const [plan] = await db.insert(schema.plans).values({
      schoolId: user.schoolId, ownerUserId: user.id, module,
      studentId: body.studentId,
      classId: linkedClassId,
      guardianId: body.guardianId,
      sourceChatSessionId: body.sourceChatSessionId,
      sourceAssessmentAttemptId: attempt.id,
      title: `${definition.title}行动方案`,
      summaryEnc: encryptSensitive(narrative || result.reasons.join('；'), useRuntimeConfig(event).encryptionKey),
      actions: result.actions, tools: result.tools,
      report: report as unknown as Record<string, unknown>,
      sourceVersions: [`${definition.code}@${definition.version}`, ...result.matchedRuleIds],
      nextReviewAt: defaultReviewAt()
    }).returning({ id: schema.plans.id, createdAt: schema.plans.createdAt })
    planId = plan?.id || null
    if (plan) {
      await createPlanActions(event, {
        planId: plan.id, schoolId: user.schoolId, ownerUserId: user.id,
        createdAt: plan.createdAt, actions: result.actions
      })
    }
  }
  await writeAudit(event, {
    schoolId: user.schoolId, actorId: user.id, action: 'assessment.submit', targetType: 'assessment', targetId: attempt.id,
    metadata: { module, level: result.level, blocked: result.blocked, ruleIds: result.matchedRuleIds, studentId: body.studentId, classId: linkedClassId, guardianId: body.guardianId, sourceChatSessionId: body.sourceChatSessionId }
  })
  await trackProductEvent(event, {
    schoolId: user.schoolId, userId: user.id, eventName: 'assessment_completed',
    targetType: 'assessment', targetId: attempt.id, metadata: { module, blocked: result.blocked, planGenerated: Boolean(planId) }
  })
  if (planId) {
    await trackProductEvent(event, {
      schoolId: user.schoolId, userId: user.id, eventName: 'plan_generated',
      targetType: 'plan', targetId: planId, metadata: { module }
    })
  }
  return { attemptId: attempt.id, planId, result: presentedResult, report, fuse }
})

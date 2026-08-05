import { z } from 'zod'
import { and, desc, eq, ne } from 'drizzle-orm'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { executeRules, evaluateWithFallback } from '../../../../domain/rules-executor'
import { resolveAssessmentDefinition, resolveAttributionConfig } from '../../../../domain/module-resources'
import { moduleMeta } from '../../../../../shared/assessments'
import { encryptSensitive, decryptSensitive } from '../../../../utils/crypto'
import { createSafetyReferral } from '../../../../domain/safety'
import { createPlanActions, defaultReviewAt, resolveToolsForPlan } from '../../../../domain/plan-actions'
import { extractSourceResourceVersionIds, recordPlanOperationEvent } from '../../../../domain/plan-operations'
import { writeEntitySnapshot } from '../../../../domain/entity-snapshots'
import { trackProductEvent } from '../../../../domain/product-events'
import { writeAudit } from '../../../../utils/audit'
import { generateAssessmentReport } from '../../../../integrations/deepseek'
import { findInvalidAnswers } from '../../../../domain/assessment-answers'

const bodySchema = z.object({
  attemptId: z.string().uuid().optional(),
  // 取值范围不能写死 1..5，否则 0/1 二值选项组的量表整张不可用。
  // 实际值域按题目自己的选项集合校验，见 findInvalidAnswers。
  answers: z.record(z.string(), z.number().int()),
  studentId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  guardianId: z.string().uuid().optional(),
  sourceChatSessionId: z.string().uuid().optional(),
  instrumentCode: z.string().max(200).optional()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)

  // 动态加载题库定义（支持多 instrument）
  const resolvedDefinition = await resolveAssessmentDefinition(event, module, user.schoolId, body.instrumentCode)
  const definition = resolvedDefinition.payload

  // 不能用 !body.answers[id] 判断：0 是合法分值，会被判成未作答。
  const invalidAnswers = findInvalidAnswers(definition.questions, body.answers)
  if (invalidAnswers.length) {
    throw createError({
      statusCode: 422,
      message: `请完成全部题目（缺失或超出选项范围：${invalidAnswers.slice(0, 5).join('、')}）`
    })
  }

  // 上下文验证（学生/班级/家长/对话）
  let linkedClassId = body.classId
  let studentName: string | undefined
  let guardianName: string | undefined
  if (body.studentId) {
    const [student] = await db.select({ id: schema.students.id, classId: schema.students.classId, nameEnc: schema.students.nameEnc }).from(schema.students).where(and(
      eq(schema.students.id, body.studentId),
      eq(schema.students.ownerUserId, user.id),
      eq(schema.students.schoolId, user.schoolId)
    )).limit(1)
    if (!student) throw createError({ statusCode: 404, message: '关联学生不存在或不属于当前负责范围' })
    linkedClassId ||= student.classId || undefined
    studentName = decryptSensitive(student.nameEnc, useRuntimeConfig(event).encryptionKey)
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
    const [guardian] = await db.select({ id: schema.guardians.id, nameEnc: schema.guardians.nameEnc }).from(schema.guardians).where(and(
      eq(schema.guardians.id, body.guardianId),
      eq(schema.guardians.ownerUserId, user.id),
      eq(schema.guardians.schoolId, user.schoolId)
    )).limit(1)
    if (!guardian) throw createError({ statusCode: 404, message: '关联家长不存在或不属于当前负责范围' })
    guardianName = decryptSensitive(guardian.nameEnc, useRuntimeConfig(event).encryptionKey)
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

  // 动态加载归因配置；归因库承载规则引擎，不再使用独立规则库。
  const publishedAttribution = await resolveAttributionConfig(event, module, user.schoolId)
  const attributionConfig = publishedAttribution?.payload ?? null
  const result = attributionConfig
    ? executeRules(attributionConfig, body.answers, definition, { previousConsecutiveLowMeaning })
    : evaluateWithFallback(module, body.answers, { previousConsecutiveLowMeaning })

  // 工具匹配必须排在生成报告之前。
  // 报告里的「工具处方」取自 result.tools，而 result.tools 是归因库的 config.tools——
  // v3/v4 导入器根本不填这个字段，恒为空数组。加权匹配的结果如果只写进 plans.tools，
  // 报告页渲染空数组、方案页因为「空数组也是 truthy」走不到回退分支，两边都看不到工具，
  //「量表 → 归因 → 工具 → 方案」的最后一环在教师端就是断的。
  const matchedTools = result.blocked ? [] : await resolveToolsForPlan(event, module, {
    dimensions: result.dimensions,
    severity: result.severity,
    attributions: result.attributions.map(attribution => ({ code: attribution.code, share: attribution.share })),
    toolTags: result.toolTags,
    // 等级干预通道：命中等级直选的工具编码无条件入选，与归因加权结果按编码去重
    requiredCodes: result.interventionToolCodes,
    schoolId: user.schoolId
  })
  if (matchedTools.length) result.tools = [...result.tools, ...matchedTools]

  const report = result.blocked ? null : await generateAssessmentReport(event, {
    schoolId: user.schoolId,
    ownerUserId: user.id,
    module,
    result,
    definition
  })
  const narrative = report?.profile.summary || result.reasons.join('；')
  const presentedResult = { ...result, narrative: result.blocked ? null : narrative, report }

  const [attempt] = body.attemptId
    ? await db.update(schema.assessmentAttempts).set({
        answers: body.answers, result: presentedResult as unknown as Record<string, unknown>,
        // 必须一并改写量表编码：草稿可能是在另一张量表上起的，不改写会把本次作答
        // 记成那张量表，导致 completed 状态和跨量表触发条件（PRIOR_*）读错量表。
        assessmentCode: definition.code, definitionVersion: definition.version,
        status: 'submitted', submittedAt: new Date(), updatedAt: new Date()
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
    // result.tools 上面已经并入了 matchedTools，直接用即可，不要再拼一次
    const planTools = result.tools
    const nextReviewAt = defaultReviewAt()
    const sourceResourceVersionIds = [
      resolvedDefinition.versionId,
      publishedAttribution?.versionId,
      ...matchedTools.map(tool => tool.sourceVersionId)
    ].filter((item): item is string => Boolean(item))
    const matchedToolCodes = planTools
      .map(tool => (tool as { code?: string }).code)
      .filter((item): item is string => Boolean(item))
    // 方案标题可读化：对象（家长优先于学生）+ 模块 + 等级短名 + 主归因；匿名评估省略对象段
    const levelShort = (result.levelName || '').split('（')[0]
    const title = [
      guardianName || studentName,
      `${moduleMeta[module].title} ${levelShort}${result.primaryAttribution ? `（${result.primaryAttribution}）` : ''}方案`
    ].filter(Boolean).join(' · ')
    const [plan] = await db.insert(schema.plans).values({
      schoolId: user.schoolId, ownerUserId: user.id, module,
      studentId: body.studentId,
      classId: linkedClassId,
      guardianId: body.guardianId,
      sourceChatSessionId: body.sourceChatSessionId,
      sourceAssessmentAttemptId: attempt.id,
      title,
      summaryEnc: encryptSensitive(narrative || result.reasons.join('；'), useRuntimeConfig(event).encryptionKey),
      actions: result.actions,
      tools: planTools,
      report: {
        ...(report as unknown as Record<string, unknown>),
        planStructure: {
          summary: narrative || result.reasons.join('；'),
          assessment: { code: definition.code, version: definition.version },
          attribution: {
            level: result.level,
            levelName: result.levelName,
            severity: result.severity,
            primary: result.primaryAttribution,
            secondary: result.secondaryAttributions,
            // 完整归因构成（含占比）留在方案快照里做溯源，前端只呈现强弱标签
            items: result.attributions.map(attribution => ({
              code: attribution.code,
              name: attribution.name,
              share: attribution.share,
              strength: attribution.strength,
              evidenceCodes: attribution.evidenceCodes
            })),
            reasons: result.reasons
          },
          tools: planTools.map(tool => tool.title),
          review: { nextReviewAt: nextReviewAt.toISOString(), mode: 'periodic_with_ai_prompt' }
        }
      },
      sourceVersions: [...resolvedDefinition.sourceVersions, ...(publishedAttribution?.sourceVersions || [`fallback-attribution:${module}`]), ...result.matchedRuleIds],
      status: 'pending_acceptance',
      matchedRuleIds: result.matchedRuleIds,
      matchedToolCodes,
      sourceResourceVersionIds: sourceResourceVersionIds.length
        ? sourceResourceVersionIds
        : extractSourceResourceVersionIds([...resolvedDefinition.sourceVersions, ...(publishedAttribution?.sourceVersions || [])]),
      nextReviewAt
    }).returning({ id: schema.plans.id, createdAt: schema.plans.createdAt })
    planId = plan?.id || null
    if (plan) {
      await createPlanActions(event, {
        planId: plan.id, schoolId: user.schoolId, ownerUserId: user.id,
        createdAt: plan.createdAt, actions: result.actions
      })
      await recordPlanOperationEvent(event, {
        schoolId: user.schoolId,
        ownerUserId: user.id,
        planId: plan.id,
        eventType: 'plan_generated',
        metadata: { module, ruleCount: result.matchedRuleIds.length, toolCount: planTools.length }
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
  // 业务状态快照回写：能量场阶段/个体支持等级/沟通风险等级/自我状态等级。
  // 评估是事实来源，这里把结果投影到档案标量与明细，管理后台列表直接可见。
  await writeEntitySnapshot(event, {
    module,
    schoolId: user.schoolId,
    ownerUserId: user.id,
    studentId: body.studentId,
    classId: linkedClassId,
    guardianId: body.guardianId,
    result,
    submittedAt: attempt.submittedAt ?? new Date()
  })
  return { attemptId: attempt.id, planId, result: presentedResult, report, fuse }
})

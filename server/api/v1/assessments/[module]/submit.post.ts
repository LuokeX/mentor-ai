import { z } from 'zod'
import { and, asc, desc, eq, inArray, isNull, max, ne } from 'drizzle-orm'
import type { RuleExecResult } from '../../../../../shared/contracts'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { type DbClient, useDb, schema } from '../../../../utils/db'
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
import { generateAssessmentReport, redactPii } from '../../../../integrations/deepseek'
import { findInvalidAnswers } from '../../../../domain/assessment-answers'
import { buildAttributionKeywords, buildPlanTitle, truncateByChars, type PlanSourceType } from '../../../../domain/plan-titles'
import { mergeGroupResults } from '../../../../domain/plan-merge'

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

function mergeUnique(values: string[]): string[] {
  return [...new Set(values.map(item => item?.trim()).filter((item): item is string => Boolean(item)))]
}

/** 评估组内按提交顺序的全部量表结果（供合并方案时重算）。 */
async function collectGroupResults(db: DbClient, sessionId: string): Promise<RuleExecResult[]> {
  const rows = await db.select({ result: schema.assessmentAttempts.result })
    .from(schema.assessmentSessionAttempts)
    .innerJoin(schema.assessmentAttempts, eq(schema.assessmentSessionAttempts.assessmentAttemptId, schema.assessmentAttempts.id))
    .where(eq(schema.assessmentSessionAttempts.assessmentSessionId, sessionId))
    .orderBy(asc(schema.assessmentSessionAttempts.sequence))
  return rows
    .map(row => row.result as Record<string, unknown> | null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map(item => item as unknown as RuleExecResult)
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const schoolId = user.schoolId
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey

  // 动态加载题库定义（支持多 instrument）
  const resolvedDefinition = await resolveAssessmentDefinition(event, module, schoolId, body.instrumentCode)
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
      eq(schema.students.schoolId, schoolId)
    )).limit(1)
    if (!student) throw createError({ statusCode: 404, message: '关联学生不存在或不属于当前负责范围' })
    linkedClassId ||= student.classId || undefined
    studentName = decryptSensitive(student.nameEnc, secret)
  }
  if (linkedClassId) {
    const [klass] = await db.select({ id: schema.classes.id }).from(schema.classes).where(and(
      eq(schema.classes.id, linkedClassId),
      eq(schema.classes.ownerUserId, user.id),
      eq(schema.classes.schoolId, schoolId)
    )).limit(1)
    if (!klass) throw createError({ statusCode: 404, message: '关联班级不存在或不属于当前负责范围' })
  }
  if (body.guardianId) {
    const [guardian] = await db.select({ id: schema.guardians.id, nameEnc: schema.guardians.nameEnc }).from(schema.guardians).where(and(
      eq(schema.guardians.id, body.guardianId),
      eq(schema.guardians.ownerUserId, user.id),
      eq(schema.guardians.schoolId, schoolId)
    )).limit(1)
    if (!guardian) throw createError({ statusCode: 404, message: '关联家长不存在或不属于当前负责范围' })
    guardianName = decryptSensitive(guardian.nameEnc, secret)
  }
  if (body.sourceChatSessionId) {
    const [session] = await db.select({ id: schema.chatSessions.id }).from(schema.chatSessions).where(and(
      eq(schema.chatSessions.id, body.sourceChatSessionId),
      eq(schema.chatSessions.ownerUserId, user.id),
      eq(schema.chatSessions.schoolId, schoolId)
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
  const publishedAttribution = await resolveAttributionConfig(event, module, schoolId)
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
    schoolId: schoolId
  })
  if (matchedTools.length) result.tools = [...result.tools, ...matchedTools]

  const report = result.blocked ? null : await generateAssessmentReport(event, {
    schoolId: schoolId,
    ownerUserId: user.id,
    module,
    result,
    definition
  })
  const narrative = report?.profile.summary || result.reasons.join('；')
  const presentedResult = { ...result, narrative: result.blocked ? null : narrative, report }

  // AI 来源的提问首句（教师本人可见的摘要，截 80 字；URL 不携带正文）。
  // 解密后必须先脱敏再落库：教师提问可能包含学生姓名、电话等 PII。
  let questionSummary: string | null = null
  if (body.sourceChatSessionId) {
    const [firstUser] = await db.select({ contentEnc: schema.chatMessages.contentEnc }).from(schema.chatMessages)
      .where(and(
        eq(schema.chatMessages.sessionId, body.sourceChatSessionId),
        eq(schema.chatMessages.role, 'user')
      ))
      .orderBy(asc(schema.chatMessages.createdAt))
      .limit(1)
    if (firstUser) {
      questionSummary = truncateByChars(redactPii(decryptSensitive(firstUser.contentEnc, secret)), 80)
    }
  }
  const objectLabel = guardianName || studentName || undefined

  // ---- 事务内写入：量表、评估组、方案关系与快照必须原子提交 ----
  const outcome = await db.transaction(async (tx) => {
    const client = tx
    const now = new Date()

    const [attempt] = body.attemptId
      ? await client.update(schema.assessmentAttempts).set({
          answers: body.answers, result: presentedResult as unknown as Record<string, unknown>,
          // 必须一并改写量表编码：草稿可能是在另一张量表上起的，不改写会把本次作答
          // 记成那张量表，导致 completed 状态和跨量表触发条件（PRIOR_*）读错量表。
          assessmentCode: definition.code, definitionVersion: definition.version,
          status: 'submitted', submittedAt: now, updatedAt: now
        }).where(and(
          eq(schema.assessmentAttempts.id, body.attemptId),
          eq(schema.assessmentAttempts.ownerUserId, user.id),
          eq(schema.assessmentAttempts.schoolId, schoolId),
          ne(schema.assessmentAttempts.status, 'submitted')
        )).returning()
      : await client.insert(schema.assessmentAttempts).values({
          schoolId: schoolId, ownerUserId: user.id, module,
          assessmentCode: definition.code, definitionVersion: definition.version,
          status: 'submitted', answers: body.answers, result: presentedResult as unknown as Record<string, unknown>, submittedAt: now
        }).returning()
    if (!attempt) throw createError({ statusCode: body.attemptId ? 404 : 500, message: body.attemptId ? '草稿不存在或已经提交' : '评估记录保存失败' })

    // ---- 评估组：同一业务问题（同一对话或同一咨询上下文）的多次量表提交聚合载体 ----
    // 对话来源按模块分组：同一对话进入两个模块时各自成组，避免跨模块量表混入同一方案。
    const sourceType = body.sourceChatSessionId ? 'assistant_dialogue' : 'direct_assessment'
    const contextType = body.studentId ? 'student' : linkedClassId ? 'class' : body.guardianId ? 'guardian' : 'none'
    const contextId = body.studentId || linkedClassId || body.guardianId || null
    const sessionGroupWhere = body.sourceChatSessionId
      ? and(
          eq(schema.assessmentSessions.ownerUserId, user.id),
          eq(schema.assessmentSessions.schoolId, schoolId),
          eq(schema.assessmentSessions.module, module),
          eq(schema.assessmentSessions.sourceType, 'assistant_dialogue'),
          eq(schema.assessmentSessions.sourceChatSessionId, body.sourceChatSessionId),
          eq(schema.assessmentSessions.status, 'open')
        )
      : and(
          eq(schema.assessmentSessions.ownerUserId, user.id),
          eq(schema.assessmentSessions.schoolId, schoolId),
          eq(schema.assessmentSessions.module, module),
          eq(schema.assessmentSessions.sourceType, 'direct_assessment'),
          eq(schema.assessmentSessions.contextType, contextType),
          contextId ? eq(schema.assessmentSessions.contextId, contextId) : isNull(schema.assessmentSessions.contextId),
          eq(schema.assessmentSessions.status, 'open')
        )
    let assessmentSessionId: string | null = null
    let sequence = 0
    {
      // FOR UPDATE 锁住评估组行：同一组并发提交时串行化 sequence 分配，
      // 避免 max+1 得到相同序号后 onConflictDoNothing 静默丢关系。
      const [existing] = await client.select({ id: schema.assessmentSessions.id }).from(schema.assessmentSessions)
        .where(sessionGroupWhere)
        .orderBy(desc(schema.assessmentSessions.createdAt))
        .limit(1)
        .for('update')
      assessmentSessionId = existing?.id || null
    }
    if (!assessmentSessionId) {
      const [created] = await client.insert(schema.assessmentSessions).values({
        schoolId: schoolId,
        ownerUserId: user.id,
        module,
        sourceType,
        sourceChatSessionId: body.sourceChatSessionId || null,
        contextType,
        contextId,
        status: 'open'
      }).returning({ id: schema.assessmentSessions.id })
      assessmentSessionId = created?.id || null
    }
    if (assessmentSessionId) {
      const [{ maxSeq } = { maxSeq: -1 }] = await client
        .select({ maxSeq: max(schema.assessmentSessionAttempts.sequence) })
        .from(schema.assessmentSessionAttempts)
        .where(eq(schema.assessmentSessionAttempts.assessmentSessionId, assessmentSessionId))
      sequence = Number(maxSeq) + 1
      await client.insert(schema.assessmentSessionAttempts).values({
        assessmentSessionId,
        assessmentAttemptId: attempt.id,
        sequence
      }).onConflictDoNothing()
    }

    // 组内全部已提交量表的结果归因（按提交顺序），供合并方案时重算标题、正文与报告。
    const groupResults = assessmentSessionId
      ? await collectGroupResults(client, assessmentSessionId)
      : [result]
    // 合并全部量表结果（含本次）：归因、严重度、工具、行动项、维度均重新汇总。
    const mergedResult = mergeGroupResults(groupResults) ?? result
    // 合并报告基于合并后的结果重新生成：多量表方案不再只反映第一张量表。
    const mergedReport = result.blocked ? null : await generateAssessmentReport(event, {
      schoolId: schoolId,
      ownerUserId: user.id,
      module,
      result: mergedResult,
      definition
    })
    const mergedNarrative = result.blocked ? null : (mergedReport?.profile.summary || mergedResult.reasons.join('；'))

    let fuse: { eventId: string, referralId: string, crisisGuide: string } | null = null
    let planId: string | null = null

    if (result.blocked) {
      const referral = await createSafetyReferral(event, {
        schoolId: schoolId, ownerUserId: user.id, sourceType: 'assessment', sourceId: attempt.id,
        text: `${definition.title}触发高风险规则：${result.reasons.join('；')}`, matchedRules: result.matchedRuleIds
      }, client)
      fuse = { eventId: referral.safety.id, referralId: referral.referral.id, crisisGuide: referral.crisisGuide }
      // 安全闭环：危机熔断时冻结本评估组关联的待确认普通方案并关闭评估组，
      // 教师不能再打开旧方案接受执行——执行路径已切换为转介处置。
      if (assessmentSessionId) {
        const pendingPlans: Array<{ id: string }> = await client.select({ id: schema.plans.id }).from(schema.plans)
          .innerJoin(schema.planAssessmentAttempts, eq(schema.planAssessmentAttempts.planId, schema.plans.id))
          .innerJoin(schema.assessmentSessionAttempts, eq(schema.assessmentSessionAttempts.assessmentAttemptId, schema.planAssessmentAttempts.assessmentAttemptId))
          .where(and(
            eq(schema.assessmentSessionAttempts.assessmentSessionId, assessmentSessionId),
            inArray(schema.plans.status, ['pending_acceptance', 'adjustment_needed'])
          ))
        if (pendingPlans.length) {
          const frozenAt = new Date()
          await client.update(schema.plans).set({ status: 'escalated', updatedAt: frozenAt })
            .where(inArray(schema.plans.id, pendingPlans.map(item => item.id)))
          for (const plan of pendingPlans) {
            await recordPlanOperationEvent(event, {
              schoolId: schoolId, ownerUserId: user.id, planId: plan.id,
              eventType: 'plan_collaboration_needed',
              metadata: { reason: 'crisis_fuse', attemptId: attempt.id, ruleIds: result.matchedRuleIds }
            }, client)
          }
        }
        await client.update(schema.assessmentSessions).set({
          status: 'completed', completedAt: new Date(), updatedAt: new Date()
        }).where(eq(schema.assessmentSessions.id, assessmentSessionId))
      }
    } else {
      // result.tools 上面已经并入了 matchedTools，直接用即可，不要再拼一次
      const planTools = mergedResult.tools
      const nextReviewAt = defaultReviewAt()
      const sourceResourceVersionIds = [
        resolvedDefinition.versionId,
        publishedAttribution?.versionId,
        ...matchedTools.map(tool => tool.sourceVersionId)
      ].filter((item): item is string => Boolean(item))
      const matchedToolCodes = planTools
        .map(tool => (tool as { code?: string }).code)
        .filter((item): item is string => Boolean(item))

      // 标题与快照：按来源生成并固化为 plan 列，列表/详情只投影快照，
      // 避免旧方案随三库版本发布而「变标题、变归因」。
      const attributionNames = mergedResult.attributions
        .filter(attribution => attribution.strength !== 'reference')
        .map(attribution => attribution.name)
      const attributionDescriptions = mergedResult.attributions
        .filter(attribution => attribution.strength !== 'reference')
        .map(attribution => attribution.description || attribution.name)
      const buildTitle = (names: string[], descriptions: string[]) => buildPlanTitle({
        sourceType: sourceType as PlanSourceType,
        moduleTitle: moduleMeta[module].title,
        objectLabel,
        questionSummary,
        attributionNames: names,
        attributionDescriptions: descriptions
      })
      const instrumentSnapshot = {
        code: definition.code || definition.instrumentCode || '',
        name: definition.title || definition.code || '',
        version: definition.version,
        sequence
      }

      // 合并规则：评估组内已有方案且处于未接受执行状态 → 追加并更新该方案；
      // 否则（无方案或已进入执行态）新建方案。
      let mergeTargetId: string | null = null
      if (assessmentSessionId) {
        const [linked] = await client.select({ planId: schema.planAssessmentAttempts.planId })
          .from(schema.planAssessmentAttempts)
          .innerJoin(schema.assessmentSessionAttempts, eq(schema.planAssessmentAttempts.assessmentAttemptId, schema.assessmentSessionAttempts.assessmentAttemptId))
          .innerJoin(schema.plans, eq(schema.planAssessmentAttempts.planId, schema.plans.id))
          .where(and(
            eq(schema.assessmentSessionAttempts.assessmentSessionId, assessmentSessionId),
            eq(schema.plans.module, module),
            inArray(schema.plans.status, ['pending_acceptance', 'adjustment_needed'])
          ))
          .orderBy(desc(schema.plans.updatedAt))
          .limit(1)
        mergeTargetId = linked?.planId || null
      }

      if (mergeTargetId) {
        await client.insert(schema.planAssessmentAttempts).values({
          planId: mergeTargetId,
          assessmentAttemptId: attempt.id,
          sequence
        }).onConflictDoNothing()
        const [plan] = await client.select({
          instrumentSnapshots: schema.plans.instrumentSnapshots,
          attributionKeywords: schema.plans.attributionKeywords,
          sourceQuestionSummary: schema.plans.sourceQuestionSummary,
          matchedToolCodes: schema.plans.matchedToolCodes,
          sourceVersions: schema.plans.sourceVersions,
          sourceResourceVersionIds: schema.plans.sourceResourceVersionIds
        }).from(schema.plans).where(eq(schema.plans.id, mergeTargetId)).limit(1)
        // 合并后的归因是全部量表的重算结果，标题/关键词随之重算。
        const mergedNames = attributionNames
        const keywords = buildAttributionKeywords(mergedNames)
        const mergedTitle = buildTitle(mergedNames, attributionDescriptions)
        await client.update(schema.plans).set({
          title: mergedTitle.title,
          titleFull: mergedTitle.titleFull,
          sourceQuestionSummary: plan?.sourceQuestionSummary || questionSummary || null,
          attributionKeywords: keywords,
          instrumentSnapshots: [...(plan?.instrumentSnapshots || []), { ...instrumentSnapshot, sequence }],
          summaryEnc: encryptSensitive(mergedNarrative || mergedResult.reasons.join('；'), secret),
          actions: mergedResult.actions,
          tools: planTools,
          report: {
            ...(mergedReport as unknown as Record<string, unknown>),
            planStructure: {
              summary: mergedNarrative || mergedResult.reasons.join('；'),
              assessment: { code: definition.code, version: definition.version },
              attribution: {
                level: mergedResult.level,
                levelName: mergedResult.levelName,
                severity: mergedResult.severity,
                primary: mergedResult.primaryAttribution,
                secondary: mergedResult.secondaryAttributions,
                // 完整归因构成（含占比）留在方案快照里做溯源，前端只呈现强弱标签
                items: mergedResult.attributions.map(attribution => ({
                  code: attribution.code,
                  name: attribution.name,
                  share: attribution.share,
                  strength: attribution.strength,
                  evidenceCodes: attribution.evidenceCodes
                })),
                reasons: mergedResult.reasons
              },
              tools: planTools.map(tool => tool.title),
              review: { nextReviewAt: nextReviewAt.toISOString(), mode: 'periodic_with_ai_prompt' }
            }
          },
          matchedRuleIds: mergedResult.matchedRuleIds,
          matchedToolCodes: mergeUnique([...(plan?.matchedToolCodes || []), ...matchedToolCodes]),
          sourceVersions: mergeUnique([...(plan?.sourceVersions || []), ...resolvedDefinition.sourceVersions, ...(publishedAttribution?.sourceVersions || []), ...result.matchedRuleIds]),
          sourceResourceVersionIds: mergeUnique([...(plan?.sourceResourceVersionIds || []), ...(sourceResourceVersionIds.length ? sourceResourceVersionIds : extractSourceResourceVersionIds([...resolvedDefinition.sourceVersions, ...(publishedAttribution?.sourceVersions || [])]))]),
          // 方案内容已重算，复盘时间基于最后提交重新计算
          nextReviewAt,
          updatedAt: new Date()
        }).where(eq(schema.plans.id, mergeTargetId))
        planId = mergeTargetId
        // 只追加本次量表的行动项：此前量表的行动项已在方案生成时写入。
        await createPlanActions(event, {
          planId: mergeTargetId, schoolId: schoolId, ownerUserId: user.id,
          createdAt: now, actions: result.actions
        }, client)
        await recordPlanOperationEvent(event, {
          schoolId: schoolId,
          ownerUserId: user.id,
          planId: mergeTargetId,
          eventType: 'plan_merged',
          metadata: { module, attemptId: attempt.id, sequence }
        }, client)
      } else {
        const builtTitle = buildTitle(attributionNames, attributionDescriptions)
        const [plan] = await client.insert(schema.plans).values({
          schoolId: schoolId, ownerUserId: user.id, module,
          studentId: body.studentId,
          classId: linkedClassId,
          guardianId: body.guardianId,
          sourceChatSessionId: body.sourceChatSessionId,
          sourceAssessmentAttemptId: attempt.id,
          title: builtTitle.title,
          titleFull: builtTitle.titleFull,
          sourceType,
          sourceQuestionSummary: questionSummary,
          attributionKeywords: buildAttributionKeywords(attributionNames),
          instrumentSnapshots: [instrumentSnapshot],
          summaryEnc: encryptSensitive(mergedNarrative || mergedResult.reasons.join('；'), secret),
          actions: mergedResult.actions,
          tools: planTools,
          report: {
            ...(mergedReport as unknown as Record<string, unknown>),
            planStructure: {
              summary: mergedNarrative || mergedResult.reasons.join('；'),
              assessment: { code: definition.code, version: definition.version },
              attribution: {
                level: mergedResult.level,
                levelName: mergedResult.levelName,
                severity: mergedResult.severity,
                primary: mergedResult.primaryAttribution,
                secondary: mergedResult.secondaryAttributions,
                // 完整归因构成（含占比）留在方案快照里做溯源，前端只呈现强弱标签
                items: mergedResult.attributions.map(attribution => ({
                  code: attribution.code,
                  name: attribution.name,
                  share: attribution.share,
                  strength: attribution.strength,
                  evidenceCodes: attribution.evidenceCodes
                })),
                reasons: mergedResult.reasons
              },
              tools: planTools.map(tool => tool.title),
              review: { nextReviewAt: nextReviewAt.toISOString(), mode: 'periodic_with_ai_prompt' }
            }
          },
          sourceVersions: [...resolvedDefinition.sourceVersions, ...(publishedAttribution?.sourceVersions || [`fallback-attribution:${module}`]), ...result.matchedRuleIds],
          status: 'pending_acceptance',
          matchedRuleIds: mergedResult.matchedRuleIds,
          matchedToolCodes,
          sourceResourceVersionIds: sourceResourceVersionIds.length
            ? sourceResourceVersionIds
            : extractSourceResourceVersionIds([...resolvedDefinition.sourceVersions, ...(publishedAttribution?.sourceVersions || [])]),
          nextReviewAt
        }).returning({ id: schema.plans.id, createdAt: schema.plans.createdAt })
        planId = plan?.id || null
        if (plan) {
          await client.insert(schema.planAssessmentAttempts).values({
            planId: plan.id,
            assessmentAttemptId: attempt.id,
            sequence: 0
          }).onConflictDoNothing()
          await createPlanActions(event, {
            planId: plan.id, schoolId: schoolId, ownerUserId: user.id,
            createdAt: plan.createdAt, actions: result.actions
          }, client)
          await recordPlanOperationEvent(event, {
            schoolId: schoolId,
            ownerUserId: user.id,
            planId: plan.id,
            eventType: 'plan_generated',
            metadata: { module, ruleCount: result.matchedRuleIds.length, toolCount: planTools.length }
          }, client)
        }
      }
    }
    return { attemptId: attempt.id, planId, fuse, report: result.blocked ? null : mergedReport, submittedAt: now }
  })

  await writeAudit(event, {
    schoolId: schoolId, actorId: user.id, action: 'assessment.submit', targetType: 'assessment', targetId: outcome.attemptId,
    metadata: { module, level: result.level, blocked: result.blocked, ruleIds: result.matchedRuleIds, studentId: body.studentId, classId: linkedClassId, guardianId: body.guardianId, sourceChatSessionId: body.sourceChatSessionId }
  })
  await trackProductEvent(event, {
    schoolId: schoolId, userId: user.id, eventName: 'assessment_completed',
    targetType: 'assessment', targetId: outcome.attemptId, metadata: { module, blocked: result.blocked, planGenerated: Boolean(outcome.planId) }
  })
  if (outcome.planId) {
    await trackProductEvent(event, {
      schoolId: schoolId, userId: user.id, eventName: 'plan_generated',
      targetType: 'plan', targetId: outcome.planId, metadata: { module }
    })
  }
  // 业务状态快照回写：能量场阶段/个体支持等级/沟通风险等级/自我状态等级。
  // 评估是事实来源，这里把结果投影到档案标量与明细，管理后台列表直接可见。
  await writeEntitySnapshot(event, {
    module,
    schoolId: schoolId,
    ownerUserId: user.id,
    studentId: body.studentId,
    classId: linkedClassId,
    guardianId: body.guardianId,
    result,
    submittedAt: outcome.submittedAt
  })
  return { attemptId: outcome.attemptId, planId: outcome.planId, result: presentedResult, report: outcome.report, fuse: outcome.fuse }
})
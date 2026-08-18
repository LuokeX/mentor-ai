import { z } from 'zod'
import { and, asc, desc, eq, inArray, max, ne } from 'drizzle-orm'
import type { OutputTemplateEntry, RuleExecResult } from '../../../../../shared/contracts'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { type DbClient, useDb, schema } from '../../../../utils/db'
import { executeRules, evaluateWithFallback } from '../../../../domain/rules-executor'
import { resolveAssessmentDefinition, resolveAttributionConfig, resolvePublishedModuleResource } from '../../../../domain/module-resources'
import { encryptSensitive, decryptSensitive } from '../../../../utils/crypto'
import { createSafetyReferral } from '../../../../domain/safety'
import { resolveToolsForPlan } from '../../../../domain/plan-actions'
import { recordPlanOperationEvent } from '../../../../domain/plan-operations'
import { collectSessionSnapshots, generateOrMergeSessionPlan } from '../../../../domain/plan-session'
import { isNoPlanNeeded } from '../../../../domain/no-plan-needed'
import { writeEntitySnapshot } from '../../../../domain/entity-snapshots'
import { trackProductEvent } from '../../../../domain/product-events'
import { writeAudit } from '../../../../utils/audit'
import { generateAssessmentReport, redactPii } from '../../../../integrations/deepseek'
import { findInvalidAnswers } from '../../../../domain/assessment-answers'
import { truncateByChars, type PlanSourceType } from '../../../../domain/plan-titles'
import { mergeGroupResults } from '../../../../domain/plan-merge'
import { createTemplateAssessmentReport } from '../../../../domain/reports'

const bodySchema = z.object({
  attemptId: z.string().uuid().optional(),
  // 取值范围不能写死 1..5，否则 0/1 二值选项组的量表整张不可用。
  // 实际值域按题目自己的选项集合校验，见 findInvalidAnswers。
  answers: z.record(z.string(), z.number().int()),
  studentId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  guardianId: z.string().uuid().optional(),
  sourceChatSessionId: z.string().uuid().optional(),
  instrumentCode: z.string().max(200).optional(),
  // 连续量表流程：显式指定评估组（前端持有首次提交返回的 assessmentSessionId），
  // 无关联对象、无来源对话的评估也能连续做多张量表并入同一组。
  sessionId: z.string().uuid().optional(),
  // 连续量表流程：true 时本次提交只记录量表结果，不生成方案；
  // 全部量表做完后由 finalize 用组内结果统一生成。
  deferPlan: z.boolean().optional()
})

/** 无来源对话、无评估对象的评估组超过该时长未提交视为过期，不再续接。 */
const STALE_SESSION_MS = 24 * 60 * 60 * 1000

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

  const outputTemplateResource = result.blocked
    ? null
    : await resolvePublishedModuleResource<{ templates?: OutputTemplateEntry[] }>(event, {
        module,
        libraryType: 'output_template',
        schoolId
      }).catch(() => null)
  const outputTemplates = Array.isArray(outputTemplateResource?.payload?.templates)
    ? outputTemplateResource.payload.templates
    : []

  // 事务先保存确定性结果占位；组内结果确定后在事务外生成一次模型报告，
  // 避免网络调用长期占用数据库事务和组行锁。
  const presentedResult = {
    ...result,
    narrative: result.blocked ? null : result.reasons.join('；'),
    report: null
  }

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
    let assessmentSessionId: string | null = null
    let sequence = 0
    // 无关联对象的直接评估没有稳定的“同一问题”标识，每次提交必须新建组；
    // 否则教师今天和下周做的两个无关问题会被永久合并到同一方案。
    const shouldReuseSession = Boolean(body.sourceChatSessionId || contextId)
    const sessionGroupWhere = body.sourceChatSessionId
      ? and(
          eq(schema.assessmentSessions.ownerUserId, user.id),
          eq(schema.assessmentSessions.schoolId, schoolId),
          eq(schema.assessmentSessions.module, module),
          eq(schema.assessmentSessions.sourceType, 'assistant_dialogue'),
          eq(schema.assessmentSessions.sourceChatSessionId, body.sourceChatSessionId),
          eq(schema.assessmentSessions.status, 'open')
        )
      : contextId ? and(
          eq(schema.assessmentSessions.ownerUserId, user.id),
          eq(schema.assessmentSessions.schoolId, schoolId),
          eq(schema.assessmentSessions.module, module),
          eq(schema.assessmentSessions.sourceType, 'direct_assessment'),
          eq(schema.assessmentSessions.contextType, contextType),
          eq(schema.assessmentSessions.contextId, contextId),
          eq(schema.assessmentSessions.status, 'open')
        ) : undefined
    // 连续量表流程：仅「无来源对话、无评估对象」的评估没有稳定的自动定位标识，
    // 此时前端显式指定评估组来衔接上一张量表；对话/对象场景仍按上下文自动定位，
    // 避免新问题被并入旧评估组。组不存在或已过期（超过 24 小时未提交）时忽略
    // 该参数并新建组，防止本地残留的旧组 id 把跨天的新问题误并入旧流程。
    if (body.sessionId && !body.sourceChatSessionId && !contextId) {
      const [session] = await client.select({ id: schema.assessmentSessions.id }).from(schema.assessmentSessions).where(and(
        eq(schema.assessmentSessions.id, body.sessionId),
        eq(schema.assessmentSessions.ownerUserId, user.id),
        eq(schema.assessmentSessions.schoolId, schoolId),
        eq(schema.assessmentSessions.module, module),
        eq(schema.assessmentSessions.status, 'open')
      )).limit(1).for('update')
      if (session) {
        const [{ lastSubmittedAt } = { lastSubmittedAt: null }] = await client
          .select({ lastSubmittedAt: max(schema.assessmentAttempts.submittedAt) })
          .from(schema.assessmentAttempts)
          .innerJoin(schema.assessmentSessionAttempts, eq(schema.assessmentSessionAttempts.assessmentAttemptId, schema.assessmentAttempts.id))
          .where(eq(schema.assessmentSessionAttempts.assessmentSessionId, session.id))
        const stale = !lastSubmittedAt || Date.now() - lastSubmittedAt.getTime() > STALE_SESSION_MS
        if (!stale) assessmentSessionId = session.id
      }
    } else if (shouldReuseSession && sessionGroupWhere) {
      // FOR UPDATE 锁住评估组行：同一组并发提交时串行化 sequence 分配，
      // 避免 max+1 得到相同序号后 onConflictDoNothing 静默丢关系。
      const [existing] = await client.select({ id: schema.assessmentSessions.id }).from(schema.assessmentSessions)
        .where(sessionGroupWhere)
        .orderBy(desc(schema.assessmentSessions.createdAt))
        .limit(1)
        .for('update')
      assessmentSessionId = existing?.id || null
    }
    // 连续量表流程：deferPlan 仅在非熔断且组可聚合时生效。
    // 熔断必须立即走转介；无组时结果无法聚合，defer 没有意义，仍按单张直接出方案。
    const deferPlan = Boolean(body.deferPlan) && !result.blocked && Boolean(assessmentSessionId)
    if (!assessmentSessionId) {
      const createQuery = client.insert(schema.assessmentSessions).values({
        schoolId: schoolId,
        ownerUserId: user.id,
        module,
        sourceType,
        sourceChatSessionId: body.sourceChatSessionId || null,
        contextType,
        contextId,
        status: 'open'
      })
      // 对话/对象组受局部唯一索引保护。并发首提时后到事务忽略冲突，
      // 随后重新锁定先到事务创建的开放组。
      const [created] = shouldReuseSession
        ? await createQuery.onConflictDoNothing().returning({ id: schema.assessmentSessions.id })
        : await createQuery.returning({ id: schema.assessmentSessions.id })
      assessmentSessionId = created?.id || null
      if (!assessmentSessionId && sessionGroupWhere) {
        const [concurrent] = await client.select({ id: schema.assessmentSessions.id })
          .from(schema.assessmentSessions)
          .where(sessionGroupWhere)
          .orderBy(desc(schema.assessmentSessions.createdAt))
          .limit(1)
          .for('update')
        assessmentSessionId = concurrent?.id || null
      }
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
    // 事务内只生成确定性报告；模型增强在事务提交后执行并以 updatedAt 防止覆盖
    // 并发补充评估刚写入的更新版本。
    const mergedReport = result.blocked ? null : createTemplateAssessmentReport({
      module,
      result: mergedResult,
      definition,
      outputTemplates
    })
    const mergedNarrative = result.blocked ? null : (mergedReport?.profile.summary || mergedResult.reasons.join('；'))
    const finalPresentedResult = {
      ...result,
      narrative: result.blocked ? null : mergedNarrative,
      report: mergedReport
    }
    await client.update(schema.assessmentAttempts).set({
      result: finalPresentedResult as unknown as Record<string, unknown>,
      updatedAt: new Date()
    }).where(and(
      eq(schema.assessmentAttempts.id, attempt.id),
      eq(schema.assessmentAttempts.ownerUserId, user.id),
      eq(schema.assessmentAttempts.schoolId, schoolId)
    ))

    let fuse: { eventId: string, referralId: string, crisisGuide: string } | null = null
    let planId: string | null = null
    let planUpdatedAt: Date | null = null
    let planReport: Record<string, unknown> | null = null
    let noPlanNeeded = false

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
      // 快照取组内全部量表：历史提交即使曾被延后（deferPlan），新建方案也能一次写全；
      // 合并分支按 code+sequence 去重，重复提交不会产生重复快照。
      const instrumentSnapshots = assessmentSessionId
        ? await collectSessionSnapshots(event, client, module, schoolId, assessmentSessionId)
        : [{
            code: definition.code || definition.instrumentCode || '',
            name: definition.title || definition.code || '',
            version: definition.version,
            sequence
          }]
      // 连续量表流程：deferPlan 时本次提交只落量表结果，不生成方案；
      // 全部量表做完后由 finalize 用组内结果统一生成，方案内容与提交时序解耦。
      // 绿色兜底（状态良好、无归因/行动/工具）时跳过方案生成，直接告知无需方案。
      if (!deferPlan) {
        if (isNoPlanNeeded(mergedResult, module)) {
          noPlanNeeded = true
        } else {
          const generated = await generateOrMergeSessionPlan({
          event,
          client,
          schoolId,
          ownerUserId: user.id,
          module,
          assessmentSessionId,
          mergedResult,
          mergedReport,
          mergedNarrative,
          definitionResource: resolvedDefinition,
          attributionConfig: publishedAttribution,
          sourceType: sourceType as PlanSourceType,
          sourceChatSessionId: body.sourceChatSessionId || null,
          studentId: body.studentId,
          classId: linkedClassId,
          guardianId: body.guardianId,
          objectLabel,
          questionSummary,
          secret,
          now,
          sourceAttemptId: attempt.id,
          instrumentSnapshots,
          actions: mergedResult.actions
        })
          planId = generated.planId || null
          planUpdatedAt = generated.planUpdatedAt
          planReport = generated.planReport
        }
      }
    }
    return {
      attemptId: attempt.id,
      planId,
      fuse,
      noPlanNeeded,
      levelName: noPlanNeeded ? mergedResult.levelName : undefined,
      deferred: deferPlan,
      assessmentSessionId,
      report: result.blocked ? null : mergedReport,
      result: finalPresentedResult,
      mergedResult,
      planReport,
      planUpdatedAt,
      submittedAt: now
    }
  })

  // 模型调用不持有数据库事务。若等待期间同组又补交了量表，plan.updatedAt
  // 会变化，本次增强报告只回写当前评估，不覆盖更新后的合并方案。
  if (!result.blocked) {
    const enhancedReport = await generateAssessmentReport(event, {
      schoolId,
      ownerUserId: user.id,
      module,
      result: outcome.mergedResult,
      definition
    })
    const enhancedNarrative = enhancedReport.profile.summary || outcome.mergedResult.reasons.join('；')
    outcome.report = enhancedReport
    outcome.result = {
      ...result,
      narrative: enhancedNarrative,
      report: enhancedReport
    }
    await db.transaction(async (tx) => {
      await tx.update(schema.assessmentAttempts).set({
        result: outcome.result as unknown as Record<string, unknown>,
        updatedAt: new Date()
      }).where(and(
        eq(schema.assessmentAttempts.id, outcome.attemptId),
        eq(schema.assessmentAttempts.ownerUserId, user.id),
        eq(schema.assessmentAttempts.schoolId, schoolId)
      ))
      if (outcome.planId && outcome.planUpdatedAt && outcome.planReport) {
        await tx.update(schema.plans).set({
          summaryEnc: encryptSensitive(enhancedNarrative, secret),
          report: {
            ...(enhancedReport as unknown as Record<string, unknown>),
            planStructure: outcome.planReport.planStructure
          },
          updatedAt: new Date()
        }).where(and(
          eq(schema.plans.id, outcome.planId),
          eq(schema.plans.ownerUserId, user.id),
          eq(schema.plans.schoolId, schoolId),
          eq(schema.plans.updatedAt, outcome.planUpdatedAt)
        ))
      }
    })
  }

  await writeAudit(event, {
    schoolId: schoolId, actorId: user.id, action: 'assessment.submit', targetType: 'assessment', targetId: outcome.attemptId,
    metadata: { module, level: result.level, blocked: result.blocked, noPlanNeeded: outcome.noPlanNeeded, ruleIds: result.matchedRuleIds, studentId: body.studentId, classId: linkedClassId, guardianId: body.guardianId, sourceChatSessionId: body.sourceChatSessionId }
  })
  await trackProductEvent(event, {
    schoolId: schoolId, userId: user.id, eventName: 'assessment_completed',
    targetType: 'assessment', targetId: outcome.attemptId, metadata: { module, blocked: result.blocked, noPlanNeeded: outcome.noPlanNeeded, planGenerated: Boolean(outcome.planId) }
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
  return {
    attemptId: outcome.attemptId,
    planId: outcome.planId,
    noPlanNeeded: outcome.noPlanNeeded,
    levelName: outcome.noPlanNeeded ? outcome.levelName : undefined,
    deferred: outcome.deferred,
    assessmentSessionId: outcome.assessmentSessionId,
    result: outcome.result,
    report: outcome.report,
    fuse: outcome.fuse
  }
})

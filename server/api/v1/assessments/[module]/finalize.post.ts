// POST /api/v1/assessments/[module]/finalize — 连续量表流程：用评估组内全部结果统一生成方案
//
// 与 submit 的关系：连续量表流程中每次提交都带 deferPlan: true，只落量表结果
// 不生成方案；全部量表做完后由本接口聚合组内结果，生成/合并一个方案。
// 方案内容只由组内已提交量表的确定性结果决定，与提交次数、提交时序无关。
import { z } from 'zod'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { OutputTemplateEntry, RuleExecResult } from '../../../../../shared/contracts'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import type { DbClient } from '../../../../utils/db'
import { useDb, schema } from '../../../../utils/db'
import { resolveAssessmentDefinition, resolveAttributionConfig, resolvePublishedModuleResource } from '../../../../domain/module-resources'
import { collectSessionAttempts, collectSessionSnapshots, generateOrMergeSessionPlan } from '../../../../domain/plan-session'
import { isNoPlanNeeded } from '../../../../domain/no-plan-needed'
import { mergeGroupResults } from '../../../../domain/plan-merge'
import { resolveNextInstrumentSuggestion } from '../../../../domain/assessment-instruments'
import { writeEntitySnapshot } from '../../../../domain/entity-snapshots'
import { createTemplateAssessmentReport } from '../../../../domain/reports'
import { truncateByChars, type PlanSourceType } from '../../../../domain/plan-titles'
import { redactPii } from '../../../../integrations/deepseek'
import { enhancePlanReportInBackground } from '../../../../domain/plan-enhancement'
import { decryptSensitive } from '../../../../utils/crypto'
import { trackProductEvent } from '../../../../domain/product-events'
import { writeAudit } from '../../../../utils/audit'

const bodySchema = z.object({
  sessionId: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const schoolId = user.schoolId
  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey

  // 事务外解析当前发布资源（只读）：组锁定只串行化方案生成，不阻塞量表库读取。
  const resolvedPromise = (async () => {
    const attempts = await collectSessionAttempts(db, body.sessionId)
    const latest = attempts[attempts.length - 1]
    if (!latest) return null
    const resolved = await resolveAssessmentDefinition(event, module, schoolId, latest.assessmentCode)
    return { attempts, resolved }
  })()
  const attributionPromise = resolveAttributionConfig(event, module, schoolId)
  const outputTemplatePromise = resolvePublishedModuleResource<{ templates?: OutputTemplateEntry[] }>(event, {
    module,
    libraryType: 'output_template',
    schoolId
  }).catch(() => null)

  const outcome = await db.transaction(async (tx) => {
    const [session] = await tx.select({
      id: schema.assessmentSessions.id,
      sourceType: schema.assessmentSessions.sourceType,
      sourceChatSessionId: schema.assessmentSessions.sourceChatSessionId,
      contextType: schema.assessmentSessions.contextType,
      contextId: schema.assessmentSessions.contextId
    }).from(schema.assessmentSessions).where(and(
      eq(schema.assessmentSessions.id, body.sessionId),
      eq(schema.assessmentSessions.ownerUserId, user.id),
      eq(schema.assessmentSessions.schoolId, schoolId),
      eq(schema.assessmentSessions.module, module),
      eq(schema.assessmentSessions.status, 'open')
    )).limit(1).for('update')
    if (!session) throw createError({ statusCode: 404, message: '评估会话不存在或已关闭' })

    const loaded = await resolvedPromise
    if (!loaded || !loaded.attempts.length || !loaded.resolved) {
      throw createError({ statusCode: 400, message: '评估组内还没有已提交的量表结果' })
    }
    const { attempts, resolved } = loaded
    const definition = resolved.payload

    // 组内全部结果合并：归因、严重度、工具、行动项、维度均重新汇总。
    const groupResults = attempts
      .map(attempt => attempt.result)
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map(item => item as unknown as RuleExecResult)
    const mergedResult = mergeGroupResults(groupResults)
    // deferPlan 只对非熔断提交生效，组内理论上不会出现 blocked 结果；防御性拦截。
    if (!mergedResult || mergedResult.blocked) {
      throw createError({ statusCode: 400, message: '评估组内包含需要安全转介的结果，方案生成已停止' })
    }

    const attributionConfig = await attributionPromise
    const outputTemplateResource = await outputTemplatePromise
    const outputTemplates = Array.isArray(outputTemplateResource?.payload?.templates)
      ? outputTemplateResource.payload.templates
      : []
    // 绿色兜底（状态良好、无归因/行动/工具）时不出方案，直接返回无需方案结论。
    if (isNoPlanNeeded(mergedResult, module)) {
      return {
        planId: null,
        noPlanNeeded: true,
        levelName: mergedResult.levelName,
        mergedResult,
        mergedReport: null,
        definition,
        planUpdatedAtForWrite: null,
        contextType: session.contextType,
        contextId: session.contextId
      }
    }
    const mergedReport = createTemplateAssessmentReport({
      module,
      result: mergedResult,
      definition,
      outputTemplates
    })
    const mergedNarrative = mergedReport.profile.summary || mergedResult.reasons.join('；')

    // 组内全部量表快照一次写全（新建方案）；合并已有方案时按 code+sequence 去重。
    const instrumentSnapshots = await collectSessionSnapshots(event, tx, module, schoolId, body.sessionId)

    // 标题上下文：来源对话首句（脱敏）与关联对象名，均从评估组恢复。
    let questionSummary: string | null = null
    if (session.sourceChatSessionId) {
      const [firstUser] = await tx.select({ contentEnc: schema.chatMessages.contentEnc }).from(schema.chatMessages)
        .where(and(
          eq(schema.chatMessages.sessionId, session.sourceChatSessionId),
          eq(schema.chatMessages.role, 'user'),
          isNull(schema.chatMessages.deletedAt)
        ))
        .orderBy(asc(schema.chatMessages.createdAt))
        .limit(1)
      if (firstUser) {
        questionSummary = truncateByChars(redactPii(decryptSensitive(firstUser.contentEnc, secret)), 80)
      }
    }
    const objectLabel = await resolveObjectLabel(tx, secret, session.contextType, session.contextId)

    // 深度诊断建议：满足触发条件但未完成的量表，作为待办行动项写入方案
    const nextInstrumentSuggestion = await resolveNextInstrumentSuggestion(
      event, module, { id: user.id, schoolId }, new Set(attempts.map(attempt => attempt.assessmentCode))
    )

    const generated = await generateOrMergeSessionPlan({
      event,
      client: tx,
      schoolId,
      ownerUserId: user.id,
      module,
      assessmentSessionId: body.sessionId,
      mergedResult,
      mergedReport,
      mergedNarrative,
      definitionResource: resolved,
      attributionConfig,
      sourceType: (session.sourceType || 'direct_assessment') as PlanSourceType,
      sourceChatSessionId: session.sourceChatSessionId,
      studentId: session.contextType === 'student' ? session.contextId : null,
      classId: session.contextType === 'class' ? session.contextId : null,
      guardianId: session.contextType === 'guardian' ? session.contextId : null,
      objectLabel,
      questionSummary,
      secret,
      now: new Date(),
      sourceAttemptId: attempts[0]?.id || null,
      instrumentSnapshots,
      actions: mergedResult.actions,
      nextInstrumentSuggestion
    })

    return {
      planId: generated.planId,
      noPlanNeeded: false,
      levelName: mergedResult.levelName,
      planReport: generated.planReport,
      mergedResult,
      mergedReport,
      definition,
      planUpdatedAtForWrite: generated.planUpdatedAt,
      contextType: session.contextType,
      contextId: session.contextId
    }
  })

  // AI 深度报告改为后台增强（fire-and-forget），与 submit 一致：
  // 事务内确定性方案已可立即返回，教师直接进入方案页；
  // 增强完成由方案详情页轮询 ai_report_status 感知，失败仅降级为确定性报告。
  if (outcome.planId) {
    void enhancePlanReportInBackground(event, {
      planId: outcome.planId,
      schoolId,
      ownerUserId: user.id,
      module,
      result: outcome.mergedResult,
      definition: outcome.definition,
      expectedPlanUpdatedAt: outcome.planUpdatedAtForWrite
    })
  }

  await writeAudit(event, {
    schoolId, actorId: user.id, action: 'assessment.finalize',
    targetType: outcome.noPlanNeeded ? 'assessment' : 'plan',
    targetId: outcome.planId || undefined,
    metadata: { module, sessionId: body.sessionId, noPlanNeeded: outcome.noPlanNeeded, level: outcome.mergedResult.level }
  })
  if (outcome.noPlanNeeded) {
    await trackProductEvent(event, {
      schoolId, userId: user.id, eventName: 'assessment_no_plan_needed',
      targetType: 'assessment',
      metadata: { module, sessionId: body.sessionId, levelName: outcome.levelName }
    })
  } else {
    await trackProductEvent(event, {
      schoolId, userId: user.id, eventName: 'plan_generated',
      targetType: 'plan', targetId: outcome.planId || undefined, metadata: { module, source: 'finalize' }
    })
  }

  // 业务状态快照回写：与 submit 一致，finalize 用组内合并结果投影档案标量
  // （学生个体支持等级、学习问题等级、能量场阶段、沟通风险等级…）。
  // noPlanNeeded 分支同样回写：submit 路径本就无条件写，finalize 对齐同一口径。
  await writeEntitySnapshot(event, {
    module,
    schoolId,
    ownerUserId: user.id,
    studentId: outcome.contextType === 'student' ? (outcome.contextId ?? undefined) : undefined,
    classId: outcome.contextType === 'class' ? (outcome.contextId ?? undefined) : undefined,
    guardianId: outcome.contextType === 'guardian' ? (outcome.contextId ?? undefined) : undefined,
    result: outcome.mergedResult,
    submittedAt: new Date()
  })

  return {
    planId: outcome.planId,
    noPlanNeeded: outcome.noPlanNeeded,
    levelName: outcome.levelName,
    assessmentSessionId: body.sessionId,
    result: outcome.mergedResult,
    report: outcome.mergedReport,
    planReport: outcome.planReport
  }
})

/** 从评估组的关联对象恢复标题用的人名/班级名（student/guardian 为加密存储）。 */
async function resolveObjectLabel(
  tx: DbClient,
  secret: string,
  contextType: string,
  contextId: string | null
): Promise<string | undefined> {
  if (!contextId) return undefined
  if (contextType === 'student') {
    const [student] = await tx.select({ nameEnc: schema.students.nameEnc }).from(schema.students)
      .where(eq(schema.students.id, contextId)).limit(1)
    return student ? decryptSensitive(student.nameEnc, secret) : undefined
  }
  if (contextType === 'guardian') {
    const [guardian] = await tx.select({ nameEnc: schema.guardians.nameEnc }).from(schema.guardians)
      .where(eq(schema.guardians.id, contextId)).limit(1)
    return guardian ? decryptSensitive(guardian.nameEnc, secret) : undefined
  }
  if (contextType === 'class') {
    const [klass] = await tx.select({ name: schema.classes.name }).from(schema.classes)
      .where(eq(schema.classes.id, contextId)).limit(1)
    return klass?.name ?? undefined
  }
  return undefined
}
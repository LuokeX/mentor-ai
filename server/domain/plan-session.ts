/**
 * 评估组 → 方案的统一生成入口。
 *
 * submit（单张提交立即出方案）与 finalize（连续量表做完后统一出方案）共用
 * 同一套生成/合并逻辑：
 *   组内已有未接受执行的方案 → 合并（补齐快照、重算归因/标题/行动项）
 *   否则 → 新建方案
 * 方案内容全部来自组内已提交量表的确定性结果，与「哪次提交触发生成」无关，
 * 因此最终方案只由组内量表结果决定，不会被提交次数或提交顺序改变。
 *
 * 调用方职责：收集组内结果（collectSessionAttempts）、解析最新量表与归因
 * 配置、计算 mergedResult / mergedReport，再把数据交给本模块写入。
 */
import type { H3Event } from 'h3'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { DbClient } from '../utils/db'
import { schema } from '../utils/db'
import type { AttributionConfig, ModuleId, OutputTemplateEntry, RuleExecResult } from '../../shared/contracts'
import type { AssessmentDefinition } from '../../shared/assessments'
import { moduleMeta } from '../../shared/assessments'
import type { ResolvedModuleResource } from './module-resources'
import { encryptSensitive } from '../utils/crypto'
import { createPlanActions, defaultReviewAt, mergePlanActionSnapshots, toToolActions } from './plan-actions'
import { extractSourceResourceVersionIds, recordPlanOperationEvent } from './plan-operations'
import { buildAttributionKeywords, buildPlanTitle, type PlanSourceType } from './plan-titles'
import { listAssessmentInstruments } from './module-resources'
import type { AssessmentReport } from '../../shared/reports'

function mergeUnique(values: string[]): string[] {
  return [...new Set(values.map(item => item?.trim()).filter((item): item is string => Boolean(item)))]
}

export interface SessionAttemptRow {
  id: string
  assessmentCode: string
  definitionVersion: string
  sequence: number
  result: Record<string, unknown> | null
}

/** 评估组内全部已提交量表（按提交顺序），供合并方案重算与快照补全。 */
export async function collectSessionAttempts(db: DbClient, sessionId: string): Promise<SessionAttemptRow[]> {
  return db.select({
    id: schema.assessmentAttempts.id,
    assessmentCode: schema.assessmentAttempts.assessmentCode,
    definitionVersion: schema.assessmentAttempts.definitionVersion,
    sequence: schema.assessmentSessionAttempts.sequence,
    result: schema.assessmentAttempts.result
  })
    .from(schema.assessmentSessionAttempts)
    .innerJoin(schema.assessmentAttempts, eq(schema.assessmentSessionAttempts.assessmentAttemptId, schema.assessmentAttempts.id))
    .where(eq(schema.assessmentSessionAttempts.assessmentSessionId, sessionId))
    .orderBy(asc(schema.assessmentSessionAttempts.sequence))
}

export interface SessionPlanSnapshotItem {
  code: string
  name: string
  version: string
  sequence: number
}

/**
 * 评估组内全部量表的方案快照（按提交顺序）。
 * 标题/版本从当前已发布量表目录解析；attempt 落库的 definitionVersion 优先，
 * 保证快照记录的是提交当时使用的版本，不被后续发布覆盖。
 */
export async function collectSessionSnapshots(
  event: H3Event,
  db: DbClient,
  module: ModuleId,
  schoolId: string,
  sessionId: string
): Promise<SessionPlanSnapshotItem[]> {
  const attempts = await collectSessionAttempts(db, sessionId)
  if (!attempts.length) return []
  const instruments = await listAssessmentInstruments(event, module, schoolId)
  const titleByCode = new Map(instruments.map(item => [item.code, item.title]))
  return attempts.map(attempt => ({
    code: attempt.assessmentCode,
    name: titleByCode.get(attempt.assessmentCode) || attempt.assessmentCode,
    version: attempt.definitionVersion,
    sequence: attempt.sequence
  }))
}

export interface PlanAssessmentAttemptRow {
  planId: string
  assessmentAttemptId: string
  sequence: number
}

/**
 * 构建「方案 ↔ 评估量表」关联行。
 *
 * - 组内量表按提交顺序映射为 (planId, attemptId, sequence)；
 * - 同一 attempt 重复出现时只保留首次（幂等：同组重复合并不会产生重复行）；
 * - 无组内量表时兜底挂来源 attempt（sequence=0，与 0034 回填形态一致）；
 *   两个唯一约束（plan_id+sequence、assessment_attempt_id）由 onConflictDoNothing 兜底。
 */
export function buildPlanAssessmentAttemptRows(
  planId: string,
  attempts: SessionAttemptRow[],
  sourceAttemptId: string | null
): PlanAssessmentAttemptRow[] {
  const seen = new Set<string>()
  const rows: PlanAssessmentAttemptRow[] = []
  for (const attempt of attempts) {
    if (seen.has(attempt.id)) continue
    seen.add(attempt.id)
    rows.push({ planId, assessmentAttemptId: attempt.id, sequence: attempt.sequence })
  }
  if (!rows.length && sourceAttemptId) {
    rows.push({ planId, assessmentAttemptId: sourceAttemptId, sequence: 0 })
  }
  return rows
}

/** 在事务内把评估组内全部量表（无组时兜底来源 attempt）关联到方案，两个唯一约束冲突时静默跳过。 */
async function linkPlanAssessmentAttempts(
  client: DbClient,
  planId: string,
  assessmentSessionId: string | null,
  sourceAttemptId: string | null
): Promise<void> {
  const attempts = assessmentSessionId ? await collectSessionAttempts(client, assessmentSessionId) : []
  const rows = buildPlanAssessmentAttemptRows(planId, attempts, sourceAttemptId)
  if (rows.length) {
    await client.insert(schema.planAssessmentAttempts).values(rows).onConflictDoNothing()
  }
}

export interface GenerateSessionPlanInput {
  event: H3Event
  client: DbClient
  schoolId: string
  ownerUserId: string
  module: ModuleId
  /** 评估组 id；无组（单张评估）时为 null */
  assessmentSessionId: string | null
  /** mergeGroupResults 的结果，非 blocked */
  mergedResult: RuleExecResult
  mergedReport: AssessmentReport | null
  mergedNarrative: string | null
  /** 本次/最新提交的量表定义及其解析元信息，用于归因展示与源版本溯源 */
  definitionResource: ResolvedModuleResource<AssessmentDefinition>
  attributionConfig: ResolvedModuleResource<AttributionConfig> | null
  sourceType: PlanSourceType
  sourceChatSessionId: string | null
  /** 方案关联的教育对象（来自本次提交的上下文，finalize 复用组内已存上下文） */
  studentId?: string | null
  classId?: string | null
  guardianId?: string | null
  objectLabel?: string | null
  questionSummary: string | null
  secret: string
  now: Date
  /** 方案来源 attempt（新建时写入 plans.source_assessment_attempt_id），无组时必传 */
  sourceAttemptId: string | null
  /** 需要进入方案快照的量表（调用方收集：无组=本次一张；finalize=组内全部） */
  instrumentSnapshots: SessionPlanSnapshotItem[]
  /** 组内全部行动项（新建时全部写入；合并时只追加差异） */
  actions: RuleExecResult['actions']
}

export interface GenerateSessionPlanResult {
  planId: string
  planUpdatedAt: Date | null
  planReport: Record<string, unknown> | null
}

function buildPlanReport(args: {
  mergedResult: RuleExecResult
  mergedNarrative: string | null
  definition: AssessmentDefinition
  mergedReport: AssessmentReport | null
  planTools: RuleExecResult['tools']
  nextReviewAt: Date
}): Record<string, unknown> {
  const { mergedResult, mergedNarrative, definition, mergedReport, planTools, nextReviewAt } = args
  return {
    ...(mergedReport as unknown as Record<string, unknown> | null),
    planStructure: {
      summary: mergedNarrative || mergedResult.reasons.join('；'),
      assessment: { code: definition.code, version: definition.version },
      attribution: {
        level: mergedResult.level,
        levelName: mergedResult.levelName,
        severity: mergedResult.severity,
        primary: mergedResult.primaryAttribution,
        secondary: mergedResult.secondaryAttributions,
        // 完整归因构成（含占比与描述）留在方案快照里做溯源，前端只呈现强弱标签
        items: mergedResult.attributions.map(attribution => ({
          code: attribution.code,
          name: attribution.name,
          share: attribution.share,
          strength: attribution.strength,
          evidenceCodes: attribution.evidenceCodes,
          // 归因项描述与命中的证据描述，供详情页归因构成完整展示；
          // 历史方案快照缺这两项，由 backfill-plan-attributions 从三库回填
          description: attribution.description || undefined,
          reasons: attribution.reasons
        })),
        reasons: mergedResult.reasons
      },
      tools: planTools.map(tool => tool.title),
      review: { nextReviewAt: nextReviewAt.toISOString(), mode: 'periodic_with_ai_prompt' }
    }
  }
}

/**
 * 在事务内为评估组生成或合并方案。
 *
 * 幂等约束：合并分支的快照、行动项都按「已存在内容之外的差异」追加，
 * finalize 重复调用（如网络重试）不会产生重复快照或重复行动项。
 */
export async function generateOrMergeSessionPlan(
  input: GenerateSessionPlanInput
): Promise<GenerateSessionPlanResult> {
  const {
    event, client, schoolId, ownerUserId, module, assessmentSessionId,
    mergedResult, mergedReport, mergedNarrative, definitionResource,
    attributionConfig, sourceType, sourceChatSessionId,
    studentId, classId, guardianId, objectLabel, questionSummary, secret, now,
    sourceAttemptId, instrumentSnapshots, actions
  } = input
  const definition = definitionResource.payload

  const planTools = mergedResult.tools
  // 工具正文并入行动项：方案建议里能直接看到结构化步骤内容。
  const planActionsInput = [...actions, ...toToolActions(planTools)]
  const nextReviewAt = defaultReviewAt()
  const sourceResourceVersionIds = [
    definitionResource.versionId,
    attributionConfig?.versionId,
    ...planTools.map(tool => (tool as { sourceVersionId?: string }).sourceVersionId)
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
  const builtTitle = buildPlanTitle({
    sourceType,
    moduleTitle: moduleMeta[module].title,
    objectLabel,
    questionSummary,
    attributionNames,
    attributionDescriptions
  })

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
    const [plan] = await client.select({
      actions: schema.plans.actions,
      instrumentSnapshots: schema.plans.instrumentSnapshots,
      attributionKeywords: schema.plans.attributionKeywords,
      sourceQuestionSummary: schema.plans.sourceQuestionSummary,
      matchedToolCodes: schema.plans.matchedToolCodes,
      sourceVersions: schema.plans.sourceVersions,
      sourceResourceVersionIds: schema.plans.sourceResourceVersionIds
    }).from(schema.plans).where(eq(schema.plans.id, mergeTargetId)).limit(1)

    // 快照按 code+sequence 去重追加：同一张量表重复提交（复评）不产生重复快照。
    const existingKeys = new Set((plan?.instrumentSnapshots || []).map(item => `${item.code}:${item.sequence}`))
    const appendSnapshots = instrumentSnapshots.filter(item => !existingKeys.has(`${item.code}:${item.sequence}`))

    const mergedNames = attributionNames
    const keywords = buildAttributionKeywords(mergedNames)
    const mergedTitle = builtTitle
    const existingActions = plan?.actions || []
    const mergedActions = mergePlanActionSnapshots(existingActions, planActionsInput)
    const appendedActions = mergedActions.slice(existingActions.length)
    const updatedAt = new Date()
    const planReport = buildPlanReport({
      mergedResult, mergedNarrative, definition, mergedReport, planTools, nextReviewAt
    })
    const [updatedPlan] = await client.update(schema.plans).set({
      title: mergedTitle.title,
      titleFull: mergedTitle.titleFull,
      sourceQuestionSummary: plan?.sourceQuestionSummary || questionSummary || null,
      attributionKeywords: keywords,
      instrumentSnapshots: [...(plan?.instrumentSnapshots || []), ...appendSnapshots],
      summaryEnc: encryptSensitive(mergedNarrative || mergedResult.reasons.join('；'), secret),
      actions: mergedActions,
      tools: planTools,
      report: planReport,
      matchedRuleIds: mergedResult.matchedRuleIds,
      matchedToolCodes: mergeUnique([...(plan?.matchedToolCodes || []), ...matchedToolCodes]),
      sourceVersions: mergeUnique([...(plan?.sourceVersions || []), ...definitionResource.sourceVersions, ...(attributionConfig?.sourceVersions || []), ...mergedResult.matchedRuleIds]),
      sourceResourceVersionIds: mergeUnique([...(plan?.sourceResourceVersionIds || []), ...(sourceResourceVersionIds.length ? sourceResourceVersionIds : extractSourceResourceVersionIds([...definitionResource.sourceVersions, ...(attributionConfig?.sourceVersions || [])]))]),
      // 方案内容已重算，复盘时间基于最后提交重新计算
      nextReviewAt,
      updatedAt
    }).where(and(
      eq(schema.plans.id, mergeTargetId),
      eq(schema.plans.ownerUserId, ownerUserId),
      eq(schema.plans.schoolId, schoolId)
    )).returning({ updatedAt: schema.plans.updatedAt })
    // 只追加合并后新增的行动项；旧行动状态和 sequence 保持稳定。
    await createPlanActions(event, {
      planId: mergeTargetId, schoolId, ownerUserId,
      createdAt: now, actions: appendedActions
    }, client)
    await recordPlanOperationEvent(event, {
      schoolId,
      ownerUserId,
      planId: mergeTargetId,
      eventType: 'plan_merged',
      metadata: { module, sequence: instrumentSnapshots.map(item => item.sequence) }
    }, client)
    // 关联组内全部量表到方案：合并后组内可能又追加了量表（复评/补评），
    // 全量重写关系由两个唯一约束幂等去重，不会产生重复行。
    await linkPlanAssessmentAttempts(client, mergeTargetId, assessmentSessionId, sourceAttemptId)
    return { planId: mergeTargetId, planUpdatedAt: updatedPlan?.updatedAt || null, planReport }
  }

  const planReport = buildPlanReport({
    mergedResult, mergedNarrative, definition, mergedReport, planTools, nextReviewAt
  })
  const [plan] = await client.insert(schema.plans).values({
    schoolId,
    ownerUserId,
    module,
    studentId: studentId ?? null,
    classId: classId ?? null,
    guardianId: guardianId ?? null,
    sourceChatSessionId,
    sourceAssessmentAttemptId: sourceAttemptId,
    title: builtTitle.title,
    titleFull: builtTitle.titleFull,
    sourceType,
    sourceQuestionSummary: questionSummary,
    attributionKeywords: buildAttributionKeywords(attributionNames),
    instrumentSnapshots,
    summaryEnc: encryptSensitive(mergedNarrative || mergedResult.reasons.join('；'), secret),
    actions: planActionsInput,
    tools: planTools,
    report: planReport,
    sourceVersions: [...definitionResource.sourceVersions, ...(attributionConfig?.sourceVersions || [`fallback-attribution:${module}`]), ...mergedResult.matchedRuleIds],
    status: 'pending_acceptance',
    matchedRuleIds: mergedResult.matchedRuleIds,
    matchedToolCodes,
    sourceResourceVersionIds: sourceResourceVersionIds.length
      ? sourceResourceVersionIds
      : extractSourceResourceVersionIds([...definitionResource.sourceVersions, ...(attributionConfig?.sourceVersions || [])]),
    nextReviewAt
  }).returning({ id: schema.plans.id, createdAt: schema.plans.createdAt, updatedAt: schema.plans.updatedAt })
  const planId = plan?.id || null
  if (plan) {
    await createPlanActions(event, {
      planId: plan.id, schoolId, ownerUserId,
      createdAt: plan.createdAt, actions: planActionsInput
    }, client)
    await recordPlanOperationEvent(event, {
      schoolId,
      ownerUserId,
      planId: plan.id,
      eventType: 'plan_generated',
      metadata: { module, ruleCount: mergedResult.matchedRuleIds.length, toolCount: planTools.length }
    }, client)
    // 关联评估组内全部量表到方案；无组（单张评估）时兜底挂来源 attempt（sequence=0，
    // 与 0034 回填形态一致），保证详情页「测评量表（N 份）」区块始终有数据。
    await linkPlanAssessmentAttempts(client, plan.id, assessmentSessionId, sourceAttemptId)
  }
  return { planId: planId || '', planUpdatedAt: plan?.updatedAt || null, planReport }
}
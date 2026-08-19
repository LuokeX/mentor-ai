/**
 * 学校管理员「评估与方案管理」共享领域逻辑。
 *
 * 所有写操作必须在调用方事务内执行（接收 tx 参数）；审计由路由写入。
 *
 * 依赖说明（评估结果重算）：
 * 复用评估提交链 server/api/v1/assessments/[module]/submit.post.ts 使用的同一批
 * 纯函数/服务 —— resolveAssessmentDefinition（三库当前发布量表定义）、
 * findInvalidAnswers（作答校验）、executeRules/evaluateWithFallback（规则执行与
 * result 生成）、resolveToolsForPlan（工具加权匹配）。不复制 submit 的提交/方案
 * 生成/模型报告逻辑。
 */
import type { H3Event } from 'h3'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import type { ModuleId } from '../../shared/contracts'
import { schema, type DbClient } from '../utils/db'
import { findInvalidAnswers } from './assessment-answers'
import { executeRules, evaluateWithFallback } from './rules-executor'
import { resolveAssessmentDefinition, resolveAttributionConfig } from './module-resources'
import { resolveToolsForPlan } from './plan-actions'

/** 经 plan_assessment_attempts 查评估所属方案（assessmentAttemptId 唯一，至多一个）；无则返回 null。 */
export async function findPlanForAttempt(tx: DbClient, assessmentAttemptId: string): Promise<string | null> {
  const [row] = await tx.select({ planId: schema.planAssessmentAttempts.planId })
    .from(schema.planAssessmentAttempts)
    .where(eq(schema.planAssessmentAttempts.assessmentAttemptId, assessmentAttemptId))
    .limit(1)
  return row?.planId ?? null
}

/** 连带归档方案：仅当方案未被归档时归档，原状态写入 archivedPreviousStatus。返回归档前状态；未处理返回 null。 */
export async function archivePlanCascade(
  tx: DbClient,
  input: { schoolId: string, planId: string, actorId: string, now: Date }
): Promise<string | null> {
  const [plan] = await tx.select({ status: schema.plans.status })
    .from(schema.plans)
    .where(and(eq(schema.plans.id, input.planId), eq(schema.plans.schoolId, input.schoolId)))
    .limit(1).for('update')
  if (!plan || plan.status === 'archived') return null
  await tx.update(schema.plans).set({
    status: 'archived',
    archivedAt: input.now,
    archivedBy: input.actorId,
    archivedPreviousStatus: plan.status,
    updatedAt: input.now
  }).where(eq(schema.plans.id, input.planId))
  return plan.status
}

/** 连带恢复方案：仅当方案处于归档态时恢复为 archivedPreviousStatus（缺省 in_progress）。返回恢复后状态；未处理返回 null。 */
export async function restorePlanCascade(
  tx: DbClient,
  input: { schoolId: string, planId: string, actorId: string, now: Date }
): Promise<string | null> {
  const [plan] = await tx.select({ status: schema.plans.status, archivedPreviousStatus: schema.plans.archivedPreviousStatus })
    .from(schema.plans)
    .where(and(eq(schema.plans.id, input.planId), eq(schema.plans.schoolId, input.schoolId)))
    .limit(1).for('update')
  if (!plan || plan.status !== 'archived') return null
  const restoredStatus = plan.archivedPreviousStatus || 'in_progress'
  await tx.update(schema.plans).set({
    status: restoredStatus,
    archivedAt: null,
    archivedBy: null,
    archivedPreviousStatus: null,
    updatedAt: input.now
  }).where(eq(schema.plans.id, input.planId))
  return restoredStatus
}

/**
 * 物理删除方案及其 5 张 restrict 子表，按外键约束顺序清理：
 * plan_action_evidence → plan_actions → plan_reviews → plan_feedback → plan_operation_events → plans。
 * （plan_assessment_attempts 对 plans 是 cascade，自动清理。）
 * 返回被删 action 的 id 列表，供调用方清理 plan_action 通知。
 */
export async function deletePlanCascade(tx: DbClient, planId: string): Promise<{ actionIds: string[] }> {
  await tx.delete(schema.planActionEvidence).where(eq(schema.planActionEvidence.planId, planId))
  const actions = await tx.delete(schema.planActions)
    .where(eq(schema.planActions.planId, planId))
    .returning({ id: schema.planActions.id })
  await tx.delete(schema.planReviews).where(eq(schema.planReviews.planId, planId))
  await tx.delete(schema.planFeedback).where(eq(schema.planFeedback.planId, planId))
  await tx.delete(schema.planOperationEvents).where(eq(schema.planOperationEvents.planId, planId))
  await tx.delete(schema.plans).where(eq(schema.plans.id, planId))
  return { actionIds: actions.map(action => action.id) }
}

/** 清理方案的 plan / plan_action 通知（notifications.target_type/target_id 无外键，需显式删除）。 */
export async function cleanupPlanNotifications(
  tx: DbClient,
  input: { planId: string, actionIds: string[] }
): Promise<void> {
  await tx.delete(schema.notifications).where(and(
    eq(schema.notifications.targetType, 'plan'),
    eq(schema.notifications.targetId, input.planId)
  ))
  if (input.actionIds.length) {
    await tx.delete(schema.notifications).where(and(
      eq(schema.notifications.targetType, 'plan_action'),
      inArray(schema.notifications.targetId, input.actionIds)
    ))
  }
}

/** 清理评估的通知（target_type='assessment'）。 */
export async function cleanupAssessmentNotifications(tx: DbClient, assessmentAttemptId: string): Promise<void> {
  await tx.delete(schema.notifications).where(and(
    eq(schema.notifications.targetType, 'assessment'),
    eq(schema.notifications.targetId, assessmentAttemptId)
  ))
}

/**
 * 管理员修正作答后重算评估结果（复用提交链的确定性部分）：
 * 1) 从三库当前发布版本取量表定义（resolveAssessmentDefinition，按评估自身 assessmentCode 定位量表；
 *    量表已下线时回退模块默认量表，此时校验可能失败，属预期提示）；
 * 2) findInvalidAnswers 按题目选项集合校验作答（不写死 1..5）；
 * 3) executeRules / evaluateWithFallback 重算 result（含 self_growth 的连续低意义感上下文，
 *    口径与提交链一致：取该教师最近 3 次已提交评估，不含本次修正）；
 * 4) resolveToolsForPlan 重跑工具加权匹配并入 result.tools（v3/v4 导入器的 config.tools 恒为空数组）。
 * 与提交链一致不在此生成 AI 增强报告（管理员修正走确定性路径，report 置 null）。
 * 方案快照（title/summary/actions/tools）不随重算更新，见评估 [id].patch.ts 注释。
 */
export async function recomputeAssessmentResult(
  event: H3Event,
  tx: DbClient,
  input: {
    schoolId: string
    ownerUserId: string
    module: string
    assessmentCode: string
    attemptId: string
    answers: Record<string, number | string | boolean>
  }
): Promise<{ result: Record<string, unknown>, definitionVersion: string }> {
  const definition = await resolveAssessmentDefinition(event, input.module as ModuleId, input.schoolId, input.assessmentCode)
  const payload = definition.payload
  const invalidAnswers = findInvalidAnswers(payload.questions, input.answers)
  if (invalidAnswers.length) {
    throw createError({
      statusCode: 422,
      message: `作答不合法（缺失或超出选项范围：${invalidAnswers.slice(0, 5).join('、')}）`
    })
  }

  const previous = input.module === 'self_growth'
    ? await tx.select({ answers: schema.assessmentAttempts.answers })
        .from(schema.assessmentAttempts)
        .where(and(
          eq(schema.assessmentAttempts.ownerUserId, input.ownerUserId),
          eq(schema.assessmentAttempts.module, input.module),
          eq(schema.assessmentAttempts.status, 'submitted'),
          ne(schema.assessmentAttempts.id, input.attemptId)
        ))
        .orderBy(desc(schema.assessmentAttempts.submittedAt))
        .limit(3)
    : []
  let previousConsecutiveLowMeaning = 0
  for (const item of previous) {
    if (Number(item.answers.q3) <= 2) previousConsecutiveLowMeaning++
    else break
  }

  const publishedAttribution = await resolveAttributionConfig(event, input.module as ModuleId, input.schoolId)
  const attributionConfig = publishedAttribution?.payload ?? null
  // findInvalidAnswers 已保证取值全部落在题目选项集合内（数值），可安全收窄类型
  const numericAnswers = input.answers as Record<string, number>
  const result = attributionConfig
    ? executeRules(attributionConfig, numericAnswers, payload, { previousConsecutiveLowMeaning })
    : evaluateWithFallback(input.module as ModuleId, numericAnswers, { previousConsecutiveLowMeaning })

  // 工具匹配与提交链一致：result.tools 恒为空数组时，必须重跑加权匹配
  const matchedTools = result.blocked ? [] : await resolveToolsForPlan(event, input.module, {
    dimensions: result.dimensions,
    severity: result.severity,
    attributions: result.attributions.map(attribution => ({ code: attribution.code, share: attribution.share })),
    toolTags: result.toolTags,
    requiredCodes: result.interventionToolCodes,
    schoolId: input.schoolId
  })
  if (matchedTools.length) result.tools = [...result.tools, ...matchedTools]

  return {
    result: {
      ...result,
      narrative: result.blocked ? null : result.reasons.join('；'),
      report: null
    } as unknown as Record<string, unknown>,
    definitionVersion: payload.version
  }
}
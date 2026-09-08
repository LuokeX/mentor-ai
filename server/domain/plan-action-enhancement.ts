// 方案行动步骤的 AI 改写后台增强
//
// 背景：早期实现把 tool_step_polish 放在 submit 请求里同步执行，模型慢或请求大时
// 频繁撞超时（实测 30s/60s 均有超时），失败即逐项回退三库原文，且方案一旦写入
// 就不会再升级——教师端看到的实施方案永远是机械条目。
//
// 现在与 AI 深度报告同构：提交/生成方案事务内先写入三库原文并置 aiActionsStatus=pending，
// 请求返回后由 enhancePlanInBackground 顺序执行「行动改写 → 深度报告」两个后台阶段。
// 改写完成回写 plans.actions / plans.tools / plan_actions.detail 与关联 attempt.result，
// 教师端轮询 aiActionsStatus 感知。
//
// 不兜底：AI 必须覆盖全部工具与行动才写入；未全覆盖（含超时/输出非法/漏条目）时
// 不写入任何部分结果，直接标记 failed，由方案页提供「重新生成实施方案」入口。
// 三库机械条目只作为 AI 输入与失败时的数据保留，不作为教师端最终展示正文。
//
// 输入以「方案里实际展示的条目」为准：读取 plans.tools 与 plans.actions 里的归因
// 建议行动，而不是调用方传入的合并结果——合并方案可能累积了更早量表的三库原文，
// 只按调用方入参改写会漏掉这些条目，导致同一方案里 AI 版与机械条目混排。
import type { H3Event } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import type { ModuleId, Severity } from '../../shared/contracts'
import { moduleMeta } from '../../shared/assessments'
import { useDb, schema } from '../utils/db'
import { polishToolSteps } from './tool-step-polish'

/** 归因建议行动的标题口径（与 rules-executor 生成口径一致）。 */
const ATTRIBUTION_ACTION_PREFIX = '针对「'

export interface PlanActionEnhancementInput {
  planId: string | null
  schoolId: string
  ownerUserId: string
  module: ModuleId
  /** 触发时事务内的 plan.updatedAt：改写前校验，任何并发更新（接受/调整/合并重算）都会使增强放弃 */
  expectedPlanUpdatedAt?: Date | null
}

/** 工具动作标题口径与 plan-actions.toToolActions 保持一致，用于按标题回写。 */
function toolActionTitle(toolTitle: string) {
  return `使用工具「${toolTitle.trim().slice(0, 180)}」`
}

/** 从方案报告快照恢复归因（只给名称/强弱/依据，占比小数不下发模型）。 */
export function resolveAttributions(report: unknown): Array<{ name: string, strength: string, reasons?: string[] }> {
  const source = report as {
    attributions?: Array<{ name?: string, strength?: string, reasons?: string[] }>
    planStructure?: { attribution?: { items?: Array<{ name?: string, strength?: string, reasons?: string[] }> } }
  } | null
  const items = source?.attributions?.length
    ? source.attributions
    : (source?.planStructure?.attribution?.items || [])
  return items
    .map(item => ({
      name: String(item.name || '').trim(),
      strength: String(item.strength || 'reference'),
      reasons: Array.isArray(item.reasons) ? item.reasons : undefined
    }))
    .filter(item => item.name)
}

/** 从方案报告快照恢复严重度。 */
export function resolveSeverity(report: unknown): Severity | undefined {
  const severity = (report as { risk?: { severity?: string } } | null)?.risk?.severity
  return severity === 'low' || severity === 'medium' || severity === 'high' || severity === 'crisis'
    ? severity
    : undefined
}

/** 从当前结果推导知识库检索词，口径与旧同步调用一致。 */
function buildKnowledgeQuery(
  module: ModuleId,
  tools: Array<{ title: string }>,
  attributions: Array<{ name: string }>
): string {
  if (tools.length) return tools.map(tool => tool.title).join('、')
  const primary = attributions[0]?.name || '状态待定'
  return `${moduleMeta[module].title}：${primary}，教师可执行的操作步骤`
}

/** 方案里需要 AI 改写、但当前正文可能仍是三库原文的条目是否存在。 */
export function hasAiManagedActionItems(plan: { tools?: unknown, actions?: unknown }): boolean {
  const tools = Array.isArray(plan.tools) ? plan.tools : []
  if (tools.length) return true
  const actions = Array.isArray(plan.actions) ? plan.actions : []
  return actions.some(action => String((action as { title?: unknown })?.title || '').trim().startsWith(ATTRIBUTION_ACTION_PREFIX))
}

/**
 * 执行一次 AI 行动改写并回写。
 *
 * 输入来自方案行本身（plans.tools + plans.actions 中的归因建议行动），因此
 * 「方案里展示什么」与「AI 必须覆盖什么」永远一致。归因/严重度从 plan.report 快照恢复。
 *
 * 返回回写后的 plan.updatedAt（供下一阶段做并发校验）；无方案、并发冲突或未启用增强时返回 null。
 * 内部不抛出：后台任务没有调用方兜底，失败只收敛状态。
 */
export async function enhancePlanActions(
  event: H3Event,
  input: PlanActionEnhancementInput
): Promise<{ planUpdatedAt: Date | null }> {
  const db = useDb(event)
  const config = useRuntimeConfig(event)
  if (!input.planId) return { planUpdatedAt: null }

  // 先读方案：既拿到要改写的条目，也用 updatedAt 做一次并发校验，避免为过期内容白跑模型。
  const [plan] = await db.select({
    actions: schema.plans.actions,
    tools: schema.plans.tools,
    report: schema.plans.report,
    updatedAt: schema.plans.updatedAt
  }).from(schema.plans).where(and(
    eq(schema.plans.id, input.planId),
    eq(schema.plans.ownerUserId, input.ownerUserId),
    eq(schema.plans.schoolId, input.schoolId),
    ...(input.expectedPlanUpdatedAt ? [eq(schema.plans.updatedAt, input.expectedPlanUpdatedAt)] : [])
  )).limit(1)
  if (!plan) return { planUpdatedAt: null }

  const aiTools = (plan.tools || []).map(tool => ({
    title: String(tool.title || '').trim(),
    content: String(tool.content || ''),
    code: (tool as { code?: string }).code
  })).filter(tool => tool.title && tool.content)
  const aiActions = (plan.actions || [])
    .filter(action => String(action.title || '').trim().startsWith(ATTRIBUTION_ACTION_PREFIX))
    .map(action => ({ title: String(action.title || '').trim(), detail: String(action.detail || '') }))
    .filter(action => action.title && action.detail)
  const attributions = resolveAttributions(plan.report)

  // 未配置密钥：无法改写，收敛为终态并打上完成标记，避免方案页反复触发补跑。
  if (!config.deepseekApiKey) {
    await settlePlanActionStatus(event, input.planId, 'done')
    return { planUpdatedAt: null }
  }
  // 没有需要 AI 改写的条目：方案里只有确定性内容（如深度诊断待办），直接终态。
  if (aiTools.length === 0 && aiActions.length === 0) {
    await settlePlanActionStatus(event, input.planId, 'done')
    return { planUpdatedAt: null }
  }

  try {
    const polished = await polishToolSteps(event, {
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      module: input.module,
      severity: resolveSeverity(plan.report),
      attributions,
      tools: aiTools,
      actions: aiActions,
      knowledgeQuery: buildKnowledgeQuery(input.module, aiTools, attributions)
    })

    // 全覆盖才写入：任一工具/行动未被 AI 改写命中就整体放弃，避免方案页出现
    // 「一半 AI 人话、一半三库机械条目」的混排。标记 failed 由方案页提示重试。
    if (!polished.complete) {
      console.warn('[plan-action-enhancement] AI 未覆盖全部条目，放弃本次改写：',
        `tools ${polished.tools.length}/${aiTools.length}，actions ${polished.actions.length}/${aiActions.length}`)
      await settlePlanActionStatus(event, input.planId, 'failed')
      return { planUpdatedAt: null }
    }

    // 标题 → 改写后正文。工具动作按「使用工具「X」」匹配，归因行动按原标题匹配。
    const detailByTitle = new Map<string, string>()
    for (const action of polished.actions) detailByTitle.set(action.title.trim(), action.content)
    for (const tool of polished.tools) detailByTitle.set(toolActionTitle(tool.title), tool.content)
    const toolContentByTitle = new Map(polished.tools.map(tool => [tool.title.trim(), tool.content]))

    return await db.transaction(async (tx) => {
      const [current] = await tx.select({
        actions: schema.plans.actions,
        tools: schema.plans.tools,
        updatedAt: schema.plans.updatedAt
      }).from(schema.plans).where(and(
        eq(schema.plans.id, input.planId!),
        eq(schema.plans.ownerUserId, input.ownerUserId),
        eq(schema.plans.schoolId, input.schoolId),
        eq(schema.plans.updatedAt, plan.updatedAt)
      )).limit(1)
      // 并发防护生效（方案被接受/调整/合并重算）：过期增强放弃，状态留给读取侧超时收敛。
      if (!current) return { planUpdatedAt: null }

      // 1) plans.actions / plans.tools 快照回写
      const nextActions = (current.actions || []).map(action => {
        const detail = detailByTitle.get(action.title.trim())
        return detail && detail !== action.detail ? { ...action, detail } : action
      })
      // 模式 B（无匹配工具、依据知识片段）生成的建议工具需要落进 plans.tools，
      // 否则 AI 生成的内容无处承载；对应的 plan_actions 行由读取侧
      // ensurePlanActions 依 plans.tools 惰性补齐。
      const knownToolTitles = new Set((current.tools || []).map(tool => tool.title.trim()))
      const generatedTools = polished.tools
        .filter(tool => !knownToolTitles.has(tool.title.trim()))
        .map(tool => ({ title: tool.title, content: tool.content }))
      const nextTools = [
        ...(current.tools || []).map(tool => {
          const content = toolContentByTitle.get(tool.title.trim())
          return content && content !== tool.content ? { ...tool, content } : tool
        }),
        ...generatedTools
      ]

      const now = new Date()
      const [updated] = await tx.update(schema.plans).set({
        actions: nextActions,
        tools: nextTools,
        aiActionsStatus: 'done',
        aiActionsEnhancedAt: now,
        updatedAt: now
      }).where(and(
        eq(schema.plans.id, input.planId!),
        eq(schema.plans.ownerUserId, input.ownerUserId),
        eq(schema.plans.schoolId, input.schoolId),
        eq(schema.plans.updatedAt, current.updatedAt)
      )).returning({ updatedAt: schema.plans.updatedAt })
      if (!updated) return { planUpdatedAt: null }

      // 2) plan_actions 明细回写（教师端详情页读这张表；只改标题命中的行）
      const rows = await tx.select({ id: schema.planActions.id, title: schema.planActions.title, detail: schema.planActions.detail })
        .from(schema.planActions)
        .where(and(
          eq(schema.planActions.planId, input.planId!),
          eq(schema.planActions.ownerUserId, input.ownerUserId)
        ))
      for (const row of rows) {
        const detail = detailByTitle.get(row.title.trim())
        if (!detail || detail === row.detail) continue
        await tx.update(schema.planActions).set({ detail, updatedAt: now })
          .where(eq(schema.planActions.id, row.id))
      }

      // 3) 关联 attempt.result 回写：后续 finalize 再合并时取到的是改写版，
      //    否则同一标题的原文会被当作新条目重新追加。
      const linked = await tx.select({ attemptId: schema.planAssessmentAttempts.assessmentAttemptId })
        .from(schema.planAssessmentAttempts)
        .where(eq(schema.planAssessmentAttempts.planId, input.planId!))
      if (linked.length) {
        const attempts = await tx.select({ id: schema.assessmentAttempts.id, result: schema.assessmentAttempts.result })
          .from(schema.assessmentAttempts)
          .where(inArray(schema.assessmentAttempts.id, linked.map(item => item.attemptId)))
        for (const attempt of attempts) {
          const result = attempt.result as Record<string, unknown> | null
          if (!result) continue
          const resultActions = Array.isArray(result.actions) ? result.actions as Array<Record<string, unknown>> : []
          const resultTools = Array.isArray(result.tools) ? result.tools as Array<Record<string, unknown>> : []
          const nextResultActions = resultActions.map(action => {
            const title = String(action.title || '')
            const detail = detailByTitle.get(title.trim())
            return detail && detail !== action.detail ? { ...action, detail } : action
          })
          const nextResultTools = resultTools.map(tool => {
            const title = String(tool.title || '')
            const content = toolContentByTitle.get(title.trim())
            return content && content !== tool.content ? { ...tool, content } : tool
          })
          await tx.update(schema.assessmentAttempts).set({
            result: { ...result, actions: nextResultActions, tools: nextResultTools } as unknown as Record<string, unknown>,
            updatedAt: now
          }).where(eq(schema.assessmentAttempts.id, attempt.id))
        }
      }

      return { planUpdatedAt: updated.updatedAt }
    })
  } catch (error) {
    console.error('[plan-action-enhancement] AI 行动改写失败，保留三库原文:',
      error instanceof Error ? error.message : error)
    await settlePlanActionStatus(event, input.planId, 'failed')
    return { planUpdatedAt: null }
  }
}

/**
 * 收敛 AI 行动改写状态（无方案时静默跳过）。
 * done 会同时打上 aiActionsEnhancedAt 完成标记：读取侧据此判断「是否还需要补跑」，
 * 避免每次打开方案页都重复触发。failed 不打标记，等待教师手动重试或下次合并重算。
 */
export async function settlePlanActionStatus(
  event: H3Event,
  planId: string | null,
  status: 'done' | 'failed'
): Promise<void> {
  if (!planId) return
  const db = useDb(event)
  const config = useRuntimeConfig(event)
  // 未配置密钥时视为「未启用增强」而非失败：方案从未等待过 AI，不必展示失败提示。
  const finalStatus = status === 'failed' && !config.deepseekApiKey ? 'done' : status
  await db.update(schema.plans).set({
    aiActionsStatus: finalStatus,
    ...(finalStatus === 'done' ? { aiActionsEnhancedAt: new Date() } : {})
  }).where(eq(schema.plans.id, planId))
}

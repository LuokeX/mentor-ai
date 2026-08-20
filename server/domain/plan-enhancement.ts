// 方案 AI 深度报告的后台增强（fire-and-forget）
//
// 方案生成拆成两段：
//   1) 确定性部分（归因/工具/模板报告/写库）在提交事务内完成，秒级返回 planId，
//      教师立即进入方案页，内容已完整可用；
//   2) DeepSeek 深度报告在请求返回后异步执行（实测常达 1-2 分钟，超时上限 360s），
//      完成后回写 plans.report / summaryEnc，并由方案详情页轮询 ai_report_status 感知。
// 后端不再向教师端暴露不可观测的同步等待；AI 失败仅降级为确定性报告，不影响方案本身。
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import type { ModuleId, RuleExecResult } from '../../shared/contracts'
import type { AssessmentDefinition } from '../../shared/assessments'
import { useDb, schema } from '../utils/db'
import { generateAssessmentReport } from '../integrations/deepseek'
import { encryptSensitive } from '../utils/crypto'

export interface PlanEnhancementInput {
  planId: string | null
  /** submit 场景回写本次评估结果（finalize 为 null：组内报告由 plan.report 承载） */
  attemptId?: string
  schoolId: string
  ownerUserId: string
  module: ModuleId
  /** 生成报告用的归因结果：组内合并结果（与事务内 generateAssessmentReport 入参一致） */
  result: RuleExecResult
  definition: AssessmentDefinition
  /** 回写 attempt.result 用的单量表结果（无则跳过 attempt 回写） */
  attemptResult?: RuleExecResult
  /** 提交时事务内的 plan.updatedAt：回写前校验，任何并发更新（合并重算/接受/调整）都会使增强放弃，防止过期报告覆盖新内容 */
  expectedPlanUpdatedAt?: Date | null
}

/**
 * 后台执行入口：内部自行吞掉所有异常，调用方直接 void 触发，不得 await。
 * 进程崩溃会留下 pending 状态，由方案详情读取时的超时兜底收敛为 failed。
 */
export async function enhancePlanReportInBackground(event: H3Event, input: PlanEnhancementInput): Promise<void> {
  try {
    const db = useDb(event)
    const config = useRuntimeConfig(event)
    const secret = config.encryptionKey
    const { planId, attemptId, schoolId, ownerUserId, module, result, definition } = input

    // 未配置模型密钥或高风险熔断结果：没有可执行的增强，直接把状态收敛为终态。
    if (!config.deepseekApiKey || result.blocked) {
      await settlePlanAiStatus(event, planId, 'done')
      return
    }

    const report = await generateAssessmentReport(event, {
      schoolId,
      ownerUserId,
      module,
      result,
      definition
    })

    // 已配置密钥但模型不可用/输出非法：generateAssessmentReport 已降级返回模板报告，
    // 此时方案内容完整可用，但教师端需感知「深度报告不可用」，标记 failed 展示提示。
    if (report.printMeta?.source !== 'ai') {
      await settlePlanAiStatus(event, planId, 'failed')
      return
    }

    const enhancedNarrative = report.profile.summary || result.reasons.join('；')

    if (planId) {
      // 保留当前 plan.report 的 planStructure（模板报告投影），与同步时代的写回口径一致。
      const [plan] = await db.select({ report: schema.plans.report, updatedAt: schema.plans.updatedAt })
        .from(schema.plans)
        .where(and(
          eq(schema.plans.id, planId),
          eq(schema.plans.ownerUserId, ownerUserId),
          eq(schema.plans.schoolId, schoolId)
        )).limit(1)
      if (!plan) return
      const planStructure = (plan.report as Record<string, unknown> | null)?.planStructure
      const writeGuard = input.expectedPlanUpdatedAt
        ? eq(schema.plans.updatedAt, input.expectedPlanUpdatedAt)
        : undefined
      const [updated] = await db.update(schema.plans).set({
        summaryEnc: encryptSensitive(enhancedNarrative, secret),
        report: planStructure
          ? { ...(report as unknown as Record<string, unknown>), planStructure }
          : (report as unknown as Record<string, unknown>),
        aiReportStatus: 'done',
        updatedAt: new Date()
      }).where(and(
        eq(schema.plans.id, planId),
        eq(schema.plans.ownerUserId, ownerUserId),
        eq(schema.plans.schoolId, schoolId),
        ...(writeGuard ? [writeGuard] : [])
      )).returning({ id: schema.plans.id })
      // 并发防护生效（方案已被合并重算/教师操作）：过期增强直接放弃，不降级状态。
      if (!updated) return
    }

    // submit 场景同步回写本次评估结果，与同步时代行为一致。
    if (attemptId && input.attemptResult) {
      await db.update(schema.assessmentAttempts).set({
        result: {
          ...input.attemptResult,
          narrative: enhancedNarrative,
          report
        } as unknown as Record<string, unknown>,
        updatedAt: new Date()
      }).where(and(
        eq(schema.assessmentAttempts.id, attemptId),
        eq(schema.assessmentAttempts.ownerUserId, ownerUserId),
        eq(schema.assessmentAttempts.schoolId, schoolId)
      ))
    }
  } catch (error) {
    console.error('[plan-enhancement] AI 深度报告增强失败，保留确定性报告:',
      error instanceof Error ? error.message : error)
    try {
      await settlePlanAiStatus(event, input.planId, 'failed')
    } catch {
      // 收敛状态失败不再抛出：后台任务没有调用方兜底。
    }
  }
}

/** 将方案 AI 报告状态收敛为终态（无 plan 时静默跳过）。 */
async function settlePlanAiStatus(event: H3Event, planId: string | null, status: 'done' | 'failed'): Promise<void> {
  if (!planId) return
  const db = useDb(event)
  const config = useRuntimeConfig(event)
  // 未配置密钥时视为「未启用增强」而非失败：方案从未等待过 AI，不必展示失败提示。
  const finalStatus = status === 'failed' && !config.deepseekApiKey ? 'done' : status
  await db.update(schema.plans).set({ aiReportStatus: finalStatus })
    .where(eq(schema.plans.id, planId))
}
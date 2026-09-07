import { z } from 'zod'
import type { ModuleId } from '../../../shared/contracts'
import { assessmentDefinitions, moduleMeta } from '../../../shared/assessments'
import { topModuleFromScores } from '../../domain/chat-clarification'
import type { ActionCard, AgentTool, AgentToolContext } from '../types'
import { pickModuleByKeywords } from './module-route'

const recommendAssessmentSchema = z.object({
  query: z.string().trim().min(4).max(200).describe('教师当前困扰的简短描述（50字内优先）')
})

/** 从已发布量表白名单中为某模块取「第一张可用量表」的确定性理由（无诊断性判断）。 */
function buildReason(module: ModuleId): string {
  const definition = assessmentDefinitions[module]
  const meta = moduleMeta[module]
  const moduleTitle = meta?.title || module
  if (!definition) return `「${moduleTitle}」暂无已发布可推荐量表，暂不发起作答。`
  return `「${definition.title}」是「${moduleTitle}」模块的入口筛查量表，约 ${definition.estimatedMinutes} 分钟可完成，先做它能给后续归因与行动建议提供依据。`
}

/**
 * 量表推荐（仅推荐，不发起作答）：
 * 1) 业务模块：优先 userCtx.lastModuleScores 的最高模块（topModuleFromScores）；
 *    无评分时按 query 关键词命中模块（pickModuleByKeywords）；
 *    仍无命中默认 self_growth；
 * 2) 从该模块量表白名单中取第一张可用量表（当前 assessmentDefinitions 每模块一张入口筛查）；
 * 3) 选不出合适量表时返回 actionCard: null（调用方可忽略），不做任何诊断性判断。
 */
export const recommendAssessmentTool: AgentTool = {
  name: 'recommend_assessment',
  description: '从已发布量表白名单中推荐一张与当前问题最相关的量表（仅推荐，不发起作答），返回模块、量表编码与「开始作答」动作卡。',
  schema: recommendAssessmentSchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = recommendAssessmentSchema.safeParse(args)
    if (!parsed.success) {
      console.warn('[agent:recommend_assessment] 参数无效:', parsed.error.issues[0]?.message)
      return { module: null, assessmentCode: null, title: null, reason: '暂无匹配量表', actionCard: null }
    }
    const query = parsed.data.query

    // 1) 选业务模块：上一轮模块评分最高者优先，其次关键词命中，兜底 self_growth
    const scoreModule = topModuleFromScores(ctx.user.lastModuleScores)
    const keywordModule = scoreModule ? null : pickModuleByKeywords(query)
    const module: ModuleId = scoreModule ?? keywordModule ?? 'self_growth'

    // 2) 白名单第一张可用量表（确定性契约 assessmentDefinitions 每模块一张入口筛查）
    const definition = assessmentDefinitions[module]
    if (!definition) {
      console.warn(`[agent:recommend_assessment] 模块 ${module} 无已发布量表定义`)
      return { module: null, assessmentCode: null, title: null, reason: '暂无匹配量表', actionCard: null }
    }

    const reason = buildReason(module)
    const actionCard: ActionCard = {
      kind: 'recommend_assessment',
      module,
      assessmentCode: definition.code,
      title: definition.title,
      reason,
      ctaLabel: '开始作答'
    }
    return {
      module,
      assessmentCode: definition.code,
      title: definition.title,
      reason,
      actionCard
    }
  }
}
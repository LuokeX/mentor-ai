import { z } from 'zod'
import type { ModuleId } from '../../../shared/contracts'
import { topModuleFromScores } from '../../domain/chat-clarification'
import type { AgentTool, AgentToolContext } from '../types'

/**
 * 关键词路由表：与 server/integrations/deepseek.ts 的 localRoute 内部 keywordRoutes
 * 同源复制（该表当前未导出，且工具层不应因此拉入整条 DeepSeek 依赖链）。
 * P1 接入 routeWithDeepSeek 时，建议把该表提升为共享导出并统一两处口径，
 * 避免两套关键词表漂移。
 */
const keywordRoutes: Array<[ModuleId, RegExp]> = [
  ['home_school', /(家长|投诉|家长群|家校|沟通)/i],
  ['class_system', /(班级|纪律|班干部|班规|班风|秩序)/i],
  ['student_case', /(学生|孩子|同学|打架|情绪|不合群|走神)/i],
  ['learning_problem', /(学不|学不会|不想学|成绩|作业|考试|偏科|补习|厌学|听不懂|记不住)/i],
  ['self_growth', /(我很累|疲惫|压力|倦怠|无力|委屈|崩溃)/i]
]

/** 按文本命中第一个业务模块关键词；无命中返回 null。供本工具与 recommend_assessment 复用。 */
export function pickModuleByKeywords(text: string): ModuleId | null {
  for (const [module, regex] of keywordRoutes) {
    if (regex.test(text)) return module
  }
  return null
}

const moduleRouteSchema = z.object({
  text: z.string().trim().min(2).max(500).describe('教师本轮输入原文（脱敏后），用于判定最相关的业务模块')
})

/**
 * 模块分诊（P0 确定性实现）：
 * 1) 上一轮澄清模块评分（topModuleFromScores）最高模块优先；
 * 2) 无评分时命中关键词路由；
 * 3) 仍无命中则兜底 self_growth。
 * 本阶段不调用 DeepSeek（routeWithDeepSeek 留待 P1 接入，控制成本与不确定行为）。
 */
export const moduleRouteTool: AgentTool = {
  name: 'module_route',
  description: '判定当前困扰最相关的业务模块（自我成长/班级系统/家校沟通/学生个体/学习问题），返回模块与置信度，供回答先行 Agent 选取后续只读动作。',
  schema: moduleRouteSchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = moduleRouteSchema.safeParse(args)
    if (!parsed.success) {
      console.warn('[agent:module_route] 参数无效:', parsed.error.issues[0]?.message)
      return { module: 'self_growth', confidence: 0.4, rationale: '输入无法解析，默认进入自我成长模块。' }
    }
    const text = parsed.data.text
    const scoreModule = topModuleFromScores(ctx.user.lastModuleScores)
    if (scoreModule) {
      return {
        module: scoreModule,
        confidence: 0.75,
        rationale: '结合上一轮澄清的模块评分，该模块占比最高，建议先进入对应评估。'
      }
    }
    const keywordModule = pickModuleByKeywords(text)
    if (keywordModule) {
      return {
        module: keywordModule,
        confidence: 0.6,
        rationale: '命中内置关键词路由（与消息分诊 localRoute 同一口径），建议先进入该模块评估。'
      }
    }
    return {
      module: 'self_growth',
      confidence: 0.4,
      rationale: '未命中明确模块关键词，默认进入自我成长模块评估；必要时先向教师澄清困扰重点。'
    }
  }
}
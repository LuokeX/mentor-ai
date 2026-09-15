import { z } from 'zod'
import { readAssessmentHistoryForAssistant } from '../../domain/assistant-readers'
import { toAssistantReaderUser } from './record-context'
import type { AgentTool, AgentToolContext } from '../types'

const assessmentHistorySchema = z.object({
  module: z.enum(['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']).optional()
    .describe('限定模块；不传则返回全部模块的评估历史'),
  limit: z.number().int().min(1).max(8).optional()
    .describe('已提交评估的返回条数上限，默认 8')
})

/**
 * 评估历史查询（只读）。
 * 结论字段（等级、严重度、维度、主归因）一律来自确定性规则写入的结果，本工具不做任何再判断。
 * 用途：教师问「我之前做过哪些量表」「上次评估的结论是什么」「哪张量表还没做完」。
 */
export const assessmentHistoryTool: AgentTool = {
  name: 'assessment_history',
  description: '查询当前教师已提交的量表结论（等级、严重度、维度、主归因）、未完成的量表草稿（已答题数）与开放中的评估组。教师问「我之前评估的结论」「还有哪张量表没做完」时调用；不要让模型自行推算分数或等级。',
  schema: assessmentHistorySchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = assessmentHistorySchema.safeParse(args)
    if (!parsed.success) {
      return { submitted: [], drafts: [], openSessions: [], message: '查询参数无效（module 与 limit 需在允许范围内）。' }
    }
    try {
      return await readAssessmentHistoryForAssistant(ctx.event, toAssistantReaderUser(ctx), parsed.data)
    } catch (error) {
      console.error('[agent:assessment_history] 读取评估历史失败，返回空结果:', error instanceof Error ? error.message : error)
      return {
        submitted: [],
        drafts: [],
        openSessions: [],
        message: '评估历史读取失败，请基于教师描述回答，不要编造量表结论或等级。'
      }
    }
  }
}

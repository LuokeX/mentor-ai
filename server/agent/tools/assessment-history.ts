import { assessmentNavigation } from '../navigation'
import { z } from 'zod'
import { readAssessmentHistoryForAssistant, type AssistantObjectRef } from '../../domain/assistant-readers'
import { effectiveObject, toAssistantReaderUser } from './record-context'
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
 *
 * 对象口径：会话绑定咨询对象时，只返回该对象的量表结论 + 教师本人的自我成长量表（教师级模块）；
 * 未进评估组、无法判定归属的对象级结论不返回，避免把别的班级或家庭的评估当成当前个案的依据。
 * 每条记录带 object 字段标明对象，引用时必须与之一致。
 */
export const assessmentHistoryTool: AgentTool = {
  name: 'assessment_history',
  description: '查询量表评估历史：已提交结论（等级、严重度、维度、主归因）、未完成草稿（已答题数）与开放中的评估组，每条带 object 标明所属咨询对象。教师问「我之前评估的结论」「还有哪张量表没做完」时调用；不要让模型自行推算分数或等级。会话已绑定咨询对象时只返回该对象的结论与教师本人的自我成长量表结论（scope=current_object），不要把其它对象的结论讲成本次对象的结果。',
  schema: assessmentHistorySchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = assessmentHistorySchema.safeParse(args)
    if (!parsed.success) {
      return { submitted: [], drafts: [], openSessions: [], message: '查询参数无效（module 与 limit 需在允许范围内）。' }
    }
    // 对象收口：教师选择「不带档案咨询」时 businessContext 为 null，此时按教师维度返回并逐条标注对象
    const scoped = effectiveObject(ctx.user)
    const object: AssistantObjectRef | null = scoped ? { type: scoped.type, id: scoped.id } : null
    try {
      const result = await readAssessmentHistoryForAssistant(ctx.event, toAssistantReaderUser(ctx), {
        ...parsed.data,
        object
      })
      const withCards = { ...result, actionCards: assessmentNavigation(result, ctx.user.currentQuestion ?? '') }
      return object ? { ...withCards, scope: 'current_object' } : withCards
    } catch (error) {
      console.error('[agent:assessment_history] 读取评估历史失败，返回空结果:', error instanceof Error ? error.message : error)
      return { status: 'error',
        submitted: [],
        drafts: [],
        openSessions: [],
        message: '评估历史读取失败，请基于教师描述回答，不要编造量表结论或等级。'
      }
    }
  }
}

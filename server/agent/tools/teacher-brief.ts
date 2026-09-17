import { z } from 'zod'
import { readTeacherBriefForAssistant } from '../../domain/assistant-readers'
import { toAssistantReaderUser } from './record-context'
import type { AgentTool, AgentToolContext } from '../types'

const teacherBriefSchema = z.object({})

/**
 * 教师待办简报（只读，无参数）。
 * 用途：教师问「我今天该先做什么」「有哪些事到期了」时给出真实待办清单。
 */
export const teacherBriefTool: AgentTool = {
  name: 'teacher_brief',
  description: '读取当前教师的待办简报：逾期行动项、最近的待复盘方案、未完成的量表草稿、未读通知数、需要关注的沟通记录。教师问「我该先做什么」「有哪些事到期了」时调用；回答里只能使用本工具返回的条目，不要补充未返回的待办。',
  schema: teacherBriefSchema,
  async execute(_args: unknown, ctx: AgentToolContext): Promise<unknown> {
    try {
      return await readTeacherBriefForAssistant(ctx.event, toAssistantReaderUser(ctx))
    } catch (error) {
      console.error('[agent:teacher_brief] 读取待办失败，返回空结果:', error instanceof Error ? error.message : error)
      return { status: 'error',
        overdueActions: [],
        upcomingReviews: [],
        draftAssessments: [],
        unreadNotifications: 0,
        riskCommunications: [],
        message: '待办读取失败，请基于教师描述回答，不要编造待办清单。'
      }
    }
  }
}

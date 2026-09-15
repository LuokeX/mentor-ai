import { z } from 'zod'
import { readPlansForAssistant } from '../../domain/assistant-readers'
import { toAssistantReaderUser } from './record-context'
import type { AgentTool, AgentToolContext } from '../types'

const planLookupSchema = z.object({
  studentId: z.string().uuid().optional()
    .describe('学生 id，必须来自 student_search 的返回结果；只看与该学生相关的在跟方案'),
  classId: z.string().uuid().optional()
    .describe('班级 id；只看与该班级相关的在跟方案（教师不确定时改用 class_overview 先确认）'),
  guardianId: z.string().uuid().optional()
    .describe('家长 id；只看与该家长相关的在跟方案'),
  limit: z.number().int().min(1).max(6).optional()
    .describe('返回方案条数上限，默认 6')
})

/**
 * 方案与复盘查询（只读）。
 * 用途：教师问「上周定的行动项做得怎么样」「哪些方案该复盘了」时给出真实清单，
 * 而不是让模型凭印象描述方案进度。
 */
export const planLookupTool: AgentTool = {
  name: 'plan_lookup',
  description: '查询当前教师进行中的方案：方案标题、状态、下次复盘时间、未完成行动项（含是否逾期）与最近一次复盘摘要。回答涉及方案进度、行动项完成情况或复盘安排前先调用一次；未指定学生/班级/家长时返回最近的在跟方案。',
  schema: planLookupSchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = planLookupSchema.safeParse(args)
    if (!parsed.success) {
      return { plans: [], message: '查询参数无效，请提供学生 id、班级 id 或家长 id（或都不提供以查看最近方案）。' }
    }
    try {
      return await readPlansForAssistant(ctx.event, toAssistantReaderUser(ctx), parsed.data)
    } catch (error) {
      console.error('[agent:plan_lookup] 读取方案失败，返回空结果:', error instanceof Error ? error.message : error)
      return { plans: [], message: '方案读取失败，请基于教师描述回答，不要编造方案、行动项或复盘内容。' }
    }
  }
}

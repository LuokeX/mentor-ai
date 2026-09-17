import { z } from 'zod'
import { readClassOverviewForAssistant } from '../../domain/assistant-readers'
import { toAssistantReaderUser } from './record-context'
import type { AgentTool, AgentToolContext } from '../types'

const classOverviewSchema = z.object({
  classId: z.string().uuid().optional()
    .describe('班级 id；指定后只看该班。教师只说班级名称时改用 className'),
  className: z.string().trim().min(2).max(120).optional()
    .describe('班级名称全名（精确匹配），用于「我班上」这类场景'),
  limit: z.number().int().min(1).max(30).optional()
    .describe('每班返回的学生条数上限，默认 30')
})

/**
 * 班级与所辖学生概览（只读）。
 * 用途：教师问「这个班我先关注谁」「哪些学生最近沟通比较多」时，给出沟通数、在跟方案数
 * 与最近方案等级，避免模型凭印象排优先级。
 */
export const classOverviewTool: AgentTool = {
  name: 'class_overview',
  description: '查询当前教师所带班级的概览：班级名称与年级、学生名单（姓名、沟通条数、在跟方案数、最近方案等级）。回答「这个班先看谁」「哪些学生需要关注」这类问题前先调用；不指定班级时返回最近更新的若干班级。',
  schema: classOverviewSchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = classOverviewSchema.safeParse(args)
    if (!parsed.success) {
      return { classes: [], message: '查询参数无效（classId 需为 id，className 需为班级全名）。' }
    }
    try {
      return await readClassOverviewForAssistant(ctx.event, toAssistantReaderUser(ctx), parsed.data)
    } catch (error) {
      console.error('[agent:class_overview] 读取班级概览失败，返回空结果:', error instanceof Error ? error.message : error)
      return { status: 'error', classes: [], message: '班级概览读取失败，请基于教师描述回答，不要编造学生名单或数据。' }
    }
  }
}

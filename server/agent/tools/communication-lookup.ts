import { z } from 'zod'
import { readCommunicationsForAssistant } from '../../domain/assistant-readers'
import { resolveObjectScopedArgs, toAssistantReaderUser } from './record-context'
import type { AgentTool, AgentToolContext } from '../types'

const communicationLookupSchema = z.object({
  studentId: z.string().uuid().optional()
    .describe('学生 id，必须来自 student_search 的返回结果；只看该学生的沟通记录'),
  guardianId: z.string().uuid().optional()
    .describe('家长 id；只看该家长的沟通记录'),
  limit: z.number().int().min(1).max(8).optional()
    .describe('返回条数上限，默认 8')
})

/**
 * 沟通记录查询（只读）。
 * 用途：教师问「上次跟这位家长是怎么谈的」「这位家长之前态度怎么样」时给出真实记录摘要。
 *
 * 对象口径：沟通记录只按学生、家长收口，当前对象是班级时不适用（退回教师维度）；
 * 未指定对象时按当前会话绑定的学生/家长过滤，返回体 scope=current_object 表示已收口。
 * 每条记录带 object 与 studentLabel / guardianRelation，引用时必须与之一致。
 */
export const communicationLookupTool: AgentTool = {
  name: 'communication_lookup',
  description: '查询当前教师与家长/学生的沟通记录：发生时间、涉及学生、家长关系、家长类型与态度、风险等级、沟通摘要，每条带 object 标明所属咨询对象。回答「上次沟通说了什么」「这位家长之前的态度」这类问题前先调用一次；未指定学生或家长时按当前会话的咨询对象返回（scope=current_object），当前对象是班级或教师选择不带档案咨询时按教师维度返回并逐条标注对象。',
  schema: communicationLookupSchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = communicationLookupSchema.safeParse(args)
    if (!parsed.success) {
      return { communications: [], message: '查询参数无效，请提供学生 id 或家长 id（或都不提供以查看当前对象或最近的沟通）。' }
    }
    // 沟通记录没有班级维度：当前对象是班级时不兜底，退回教师维度并由 object 字段标明每条归属
    const { args: scopedArgs, scopedObject } = resolveObjectScopedArgs(ctx.user.businessContext, parsed.data, ['student', 'guardian'])
    try {
      const result = await readCommunicationsForAssistant(ctx.event, toAssistantReaderUser(ctx), scopedArgs)
      return scopedObject ? { ...result, scope: 'current_object' } : result
    } catch (error) {
      console.error('[agent:communication_lookup] 读取沟通记录失败，返回空结果:', error instanceof Error ? error.message : error)
      return { communications: [], message: '沟通记录读取失败，请基于教师描述回答，不要编造沟通历史。' }
    }
  }
}

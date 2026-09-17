import { z } from 'zod'
import { readPublishedResourceCatalog } from '../../domain/assistant-readers'
import { viewerSchoolSections } from '../../utils/stage-filter'
import type { AgentTool, AgentToolContext } from '../types'

const resourceLookupSchema = z.object({
  module: z.enum(['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem'])
    .describe('要查询的模块（必填；一次查一个模块）'),
  libraryType: z.enum(['assessment', 'attribution', 'tool']).optional()
    .describe('限定库类型：assessment 量表库 / attribution 归因库 / tool 工具库；不传则三类都返回')
})

/**
 * 三库资源目录查询（只读，只返回标题与一句摘要）。
 *
 * 定位：让模型知道「平台已发布了哪些资源」，从而能回答「有没有相关工具/量表」并引导进入模块；
 * 正文与结论不在这里给出（工具原文、量表题项、归因结果由模块页与确定性规则产生）。
 * 禁止据此推断等级、归因或工具匹配结果。
 */
export const resourceLookupTool: AgentTool = {
  name: 'resource_lookup',
  description: '查询某个模块已发布的三库资源目录（量表、归因维度、工具的名称与一句摘要）。教师问「平台有没有相关的量表/工具」「这方面有没有现成方法」时调用；只能说明资源存在与大致用途，不得据此给出等级、归因或工具匹配结论，也不要编造资源正文。',
  schema: resourceLookupSchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = resourceLookupSchema.safeParse(args)
    if (!parsed.success) {
      return { items: [], message: '查询参数无效：module 必填且需为五个业务模块之一。' }
    }
    try {
      const items = await readPublishedResourceCatalog(ctx.event, {
        schoolId: ctx.user.schoolId,
        module: parsed.data.module,
        // 按教师任教年级折算学段：只列该学段适用的资源（未标注学部的资源始终可见）
        sections: viewerSchoolSections(ctx.event, ctx.user.teachingGrades)
      })
      const filtered = parsed.data.libraryType
        ? items.filter(item => item.libraryType === parsed.data.libraryType)
        : items
      if (!filtered.length) {
        return {
          items: [],
          message: '该模块当前没有可检索的已发布资源，请基于通用工作方法回答，不要编造平台资源。'
        }
      }
      return { items: filtered }
    } catch (error) {
      console.error('[agent:resource_lookup] 读取资源目录失败，返回空结果:', error instanceof Error ? error.message : error)
      return { status: 'error', items: [], message: '资源目录读取失败，请基于通用工作方法回答，不要编造平台资源。' }
    }
  }
}

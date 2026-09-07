import { z } from 'zod'
import type { AuthUser } from '../../../app/composables/useAuth'
import { fetchEntityMemory } from '../../domain/assistant-context'
import type { AgentTool, AgentToolContext } from '../types'

const entityMemorySchema = z.object({
  contextType: z.enum(['student', 'class', 'parent']).describe('咨询对象类型：student 学生 / class 班级 / parent 家长'),
  contextId: z.string().uuid().describe('咨询对象档案 ID（学生/班级/家长的 UUID）')
})

function truncateText(text: string, max = 300): string {
  const value = (text || '').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/**
 * 实体记忆读取（只读）：拉取绑定到同一咨询对象的跨会话历史摘要
 * （fetchEntityMemory，limit 8，排除当前会话）。
 * 注意：平台内咨询对象类型统一为 guardian（chatSessions.contextType /
 * assistant-context 一致），'parent' 是工具层面向调用方的说法，执行时映射为 guardian。
 * 任何异常返回 { memories: [] }，不向上抛错。
 */
export const entityMemoryTool: AgentTool = {
  name: 'entity_memory',
  description: '读取当前咨询对象（学生/班级/家长）跨会话的历史沟通摘要（最近 8 条），用于在回答前回顾已知事实；无上下文或读取失败时返回空列表。',
  schema: entityMemorySchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = entityMemorySchema.safeParse(args)
    if (!parsed.success) {
      console.warn('[agent:entity_memory] 参数无效:', parsed.error.issues[0]?.message)
      return { memories: [] }
    }
    const { contextType, contextId } = parsed.data
    const dbContextType = contextType === 'parent' ? 'guardian' : contextType
    const user: AuthUser = {
      id: ctx.user.userId,
      schoolId: ctx.user.schoolId,
      phone: '',
      name: '',
      role: 'teacher',
      roleLabel: ''
    }
    try {
      const raw = await fetchEntityMemory(ctx.event, user, dbContextType, contextId, ctx.user.sessionId, 8)
      return {
        memories: raw.map(item => ({
          role: item.role,
          content: truncateText(item.content),
          createdAt: item.createdAt
        }))
      }
    } catch (error) {
      console.error('[agent:entity_memory] 读取实体记忆失败，返回空结果:', error instanceof Error ? error.message : error)
      return { memories: [] }
    }
  }
}
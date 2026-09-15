import { z } from 'zod'
import type { AuthUser } from '../../../app/composables/useAuth'
import { fetchEntityMemory } from '../../domain/assistant-context'
import { redactOutboundText } from '../../domain/ai-governance'
import type { AgentTool, AgentToolContext } from '../types'

const entityMemorySchema = z.object({
  contextType: z.enum(['student', 'class', 'parent']).optional()
    .describe('咨询对象类型：student 学生 / class 班级 / parent 家长；当前会话已绑定对象时可不传'),
  contextId: z.string().uuid().optional()
    .describe('咨询对象档案 ID（学生/班级/家长的 UUID）；当前会话已绑定对象时可不传，默认读取当前咨询对象的记忆')
})

function truncateText(text: string, max = 300): string {
  const value = (text || '').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/**
 * 实体记忆读取（只读）：拉取绑定到同一咨询对象的跨会话历史摘要
 * （fetchEntityMemory，limit 8，排除当前会话）。
 *
 * 参数可省略：不传时使用当前会话绑定的咨询对象（与 record_snapshot 同一口径），
 * 否则模型必须先从 student_search 等渠道拿到对象 ID——这正是此前该工具几乎用不上的原因。
 * 会话未绑定对象（含教师选择「不带档案咨询」）时返回空列表与提示，不读取任何跨会话内容。
 *
 * 注意：平台内咨询对象类型统一为 guardian（chatSessions.contextType /
 * assistant-context 一致），'parent' 是工具层面向调用方的说法，执行时映射为 guardian。
 * 任何异常返回 { memories: [] }，不向上抛错。
 */
export const entityMemoryTool: AgentTool = {
  name: 'entity_memory',
  description: '读取当前咨询对象（学生/班级/家长）跨会话的历史沟通摘要（最近 8 条），用于在回答前回顾与该对象此前谈过什么；不传参数时读取当前会话绑定的对象，无绑定对象或读取失败时返回空列表。',
  schema: entityMemorySchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = entityMemorySchema.safeParse(args)
    if (!parsed.success) {
      console.warn('[agent:entity_memory] 参数无效:', parsed.error.issues[0]?.message)
      return { memories: [], message: '咨询对象参数无效，请传入合法的对象 ID 或改用当前会话绑定的对象。' }
    }
    const binding = ctx.user.businessContext
    const contextType = parsed.data.contextType ?? binding?.type
    const contextId = parsed.data.contextId ?? binding?.id
    if (!contextType || !contextId) {
      return { memories: [], message: '当前会话未绑定咨询对象，且未指定对象 ID，无法读取跨会话记忆。' }
    }
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
      // 外发脱敏：full_context 原样，其余模式过 redactPii（与入口历史脱敏保持同一套规则）
      const outbound = (text: string) => redactOutboundText(text, ctx.user.dataMode ?? 'redacted')
      return {
        memories: raw.map(item => ({
          role: item.role,
          content: truncateText(outbound(item.content)),
          createdAt: item.createdAt
        }))
      }
    } catch (error) {
      console.error('[agent:entity_memory] 读取实体记忆失败，返回空结果:', error instanceof Error ? error.message : error)
      return { memories: [] }
    }
  }
}
import type { AuthUser } from '../../../app/composables/useAuth'
import { buildAssistantBusinessContext, type AssistantContextType } from '../../domain/assistant-context'
import { governBusinessContext } from '../../domain/ai-governance'
import type { AssistantReaderUser } from '../../domain/assistant-readers'
import type { AgentToolContext } from '../types'

/**
 * 把工具上下文收窄成只读读取层需要的调用者视图（归属 + 数据模式）。
 * 读取层（server/domain/assistant-readers.ts）只认这三个字段，避免把整个工具上下文透传进数据层。
 */
export function toAssistantReaderUser(ctx: AgentToolContext): AssistantReaderUser {
  return {
    schoolId: ctx.user.schoolId,
    userId: ctx.user.userId,
    dataMode: ctx.user.dataMode
  }
}

/**
 * 读取咨询对象档案快照（受归属校验与数据模式治理）。
 *
 * record_snapshot（当前会话绑定的对象）与 student_snapshot（按 id 指定的学生）共用同一条读取路径：
 * 权限仍由 buildAssistantBusinessContext 按 schoolId + ownerUserId 校验，外发前按学校数据模式脱敏
 * （full_context 原样，其余走 governBusinessContext）；任何异常都返回提示文本，不向上抛错——
 * 工具失败要让模型能自愈，不能把整轮回答打断。
 */
export async function readGovernedContextSnapshot(
  ctx: AgentToolContext,
  type: AssistantContextType,
  id: string
): Promise<{ type: AssistantContextType; label: string; snapshot: Record<string, unknown> } | { message: string }> {
  const user: AuthUser = {
    id: ctx.user.userId,
    schoolId: ctx.user.schoolId,
    phone: '',
    name: '',
    role: 'teacher',
    roleLabel: ''
  }
  try {
    const context = await buildAssistantBusinessContext(ctx.event, user, type, id)
    if (!context) return { message: '未找到该咨询对象档案（可能已被归档或不属于当前负责范围）。' }
    // local 模式不会进入 Agent；其余模式按 redacted 处理（full_context 原样）
    const governed = governBusinessContext(context, ctx.user.dataMode === 'full_context' ? 'full_context' : 'redacted')
    if (!governed) return { message: '档案读取失败，请基于教师描述回答，不要编造档案内容。' }
    return {
      type: governed.type,
      label: governed.label,
      snapshot: governed.snapshot as Record<string, unknown>
    }
  } catch (error) {
    console.error('[agent:record-context] 读取档案失败:', error instanceof Error ? error.message : error)
    return { message: '档案读取失败，请基于教师描述回答，不要编造档案内容。' }
  }
}

import type { AuthUser } from '../../../app/composables/useAuth'
import { buildAssistantBusinessContext, type AssistantContextType } from '../../domain/assistant-context'
import { governBusinessContext } from '../../domain/ai-governance'
import type { AssistantReaderUser } from '../../domain/assistant-readers'
import type { AgentToolContext, AgentUserContext } from '../types'

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
 * 本轮回答按哪个对象收口：会话绑定的对象优先，其次是本轮消息里识别出的对象。
 *
 * 为什么会话绑定优先：绑定是教师的显式选择，跨会话记忆、摘要与方案收口都按它建立；
 * 一句顺带的提及不应该改变这些作用范围。只有在会话还没有绑定对象时，
 * 才用本轮识别到的对象兜底，解决「教师直接写学生姓名、助手却不查档案」的割裂。
 */
export function effectiveObject(
  user: Pick<AgentUserContext, 'businessContext' | 'turnContext'>
): { type: 'student' | 'class' | 'guardian', id: string, label?: string } | null {
  return user.businessContext ?? user.turnContext ?? null
}

/** 读取层按对象收口时可选用的对象字段。 */
export interface ObjectScopedArgs {
  studentId?: string
  classId?: string
  guardianId?: string
}

/**
 * 模型没有显式指定咨询对象时，用当前会话绑定的对象兜底过滤。
 *
 * 为什么要兜底：同一教师手上可能有多个学生/家长的方案、评估与沟通记录，
 * 不限定对象时工具会把不同对象的记录混在一起返回，模型无法分辨、容易把别人的情况讲成当前对象的。
 * 教师选择「不带档案咨询」时，工具注册层禁用档案读取工具。
 * 其他无绑定场景返回教师维度记录，读取层在每条记录上标明对象。
 *
 * supportedTypes：该工具的查询能力支持哪些对象类型（沟通记录没有班级维度，只支持学生与家长）。
 */
export function resolveObjectScopedArgs<T extends ObjectScopedArgs>(
  businessContext: { type: string, id: string } | null | undefined,
  args: T,
  supportedTypes: ReadonlyArray<'student' | 'guardian' | 'class'> = ['student', 'guardian', 'class']
): { args: T, scopedObject: { type: 'student' | 'guardian' | 'class', id: string } | null } {
  const hasExplicit = Boolean(args.studentId || args.classId || args.guardianId)
  if (hasExplicit || !businessContext) return { args, scopedObject: null }
  const type = businessContext.type as 'student' | 'guardian' | 'class'
  if (!supportedTypes.includes(type)) return { args, scopedObject: null }
  const field = type === 'student' ? 'studentId' : type === 'guardian' ? 'guardianId' : 'classId'
  return { args: { ...args, [field]: businessContext.id }, scopedObject: { type, id: businessContext.id } }
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
): Promise<{ type: AssistantContextType; label: string; snapshot: Record<string, unknown> } | { status: 'empty' | 'error'; message: string }> {
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
    if (!context) return { status: 'empty', message: '未找到该咨询对象档案（可能已被归档或不属于当前负责范围）。' }
    // local 模式不会进入 Agent；其余模式按 redacted 处理（full_context 原样）
    const governed = governBusinessContext(context, ctx.user.dataMode === 'full_context' ? 'full_context' : 'redacted')
    if (!governed) return { status: 'error', message: '档案读取失败，请基于教师描述回答，不要编造档案内容。' }
    return {
      type: governed.type,
      label: governed.label,
      snapshot: governed.snapshot as Record<string, unknown>
    }
  } catch (error) {
    console.error('[agent:record-context] 读取档案失败:', error instanceof Error ? error.message : error)
    return { status: 'error', message: '档案读取失败，请基于教师描述回答，不要编造档案内容。' }
  }
}

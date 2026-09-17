/**
 * 会话咨询对象绑定的写入（@ 选择、中途换绑、把「本轮对象」固定为会话对象）。
 *
 * 为什么单独成模块：绑定要同时保证三件事——归属校验、元数据留痕（contextSwitches，前端据此插分隔条
 * 与生成持续提示）、产品事件；普通提问入口与「固定为本会话对象」接口必须走同一条路径，
 * 否则换绑行为会出现两套口径。
 *
 * 边界：只写 chat_sessions 的 context_type/context_id 与元数据，不改变历史消息、不重建摘要；
 * 目标对象是否属于当前教师由调用方用 buildAssistantBusinessContext 校验（本模块只校验会话归属）。
 */
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { schema, useDb } from '../utils/db'
import { trackProductEvent } from './product-events'
import {
  appendContextSwitch,
  readContextLabel,
  toContextRef,
  type ChatContextType
} from './chat-context-switch'

export interface SessionBindingTarget {
  type: ChatContextType
  id: string
  label: string
}

export interface BindChatSessionContextInput {
  sessionId: string
  userId: string
  schoolId: string
  target: SessionBindingTarget
  /** 已加载的会话绑定信息（入口已查过时传入，避免重复查询） */
  current?: { contextType?: string | null, contextId?: string | null, status?: string | null, metadata?: Record<string, unknown> | null } | null
}

/**
 * 把会话绑定到目标对象；已是同一对象时不做任何写入。
 * 会话不存在或不属于当前教师抛 404；归档会话抛 409。
 */
export async function bindChatSessionContext(
  event: H3Event,
  input: BindChatSessionContextInput
): Promise<{ switched: boolean }> {
  const db = useDb(event)
  const current = input.current ?? await db.select({
    contextType: schema.chatSessions.contextType,
    contextId: schema.chatSessions.contextId,
    status: schema.chatSessions.status,
    metadata: schema.chatSessions.metadata
  }).from(schema.chatSessions)
    .where(and(eq(schema.chatSessions.id, input.sessionId), eq(schema.chatSessions.ownerUserId, input.userId)))
    .limit(1)
    .then(rows => rows[0] ?? null)
  if (!current) throw createError({ statusCode: 404, message: '对话不存在' })
  if (current.status === 'archived') throw createError({ statusCode: 409, message: '对话已归档' })

  const previousType = current.contextType === 'none' ? null : current.contextType ?? null
  const previousId = current.contextId || null
  if (previousType === input.target.type && previousId === input.target.id) return { switched: false }

  await db.update(schema.chatSessions).set({
    contextType: input.target.type,
    contextId: input.target.id,
    metadata: appendContextSwitch(current.metadata, {
      at: new Date().toISOString(),
      from: toContextRef(previousType, previousId, readContextLabel(current.metadata)),
      to: { type: input.target.type, id: input.target.id, label: input.target.label }
    })
  }).where(and(eq(schema.chatSessions.id, input.sessionId), eq(schema.chatSessions.ownerUserId, input.userId)))

  await trackProductEvent(event, {
    schoolId: input.schoolId, userId: input.userId, eventName: 'assistant_context_switched',
    targetType: input.target.type, targetId: input.target.id,
    metadata: { fromType: previousType || 'none', fromId: previousId }
  })
  return { switched: true }
}

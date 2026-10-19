/**
 * 会话咨询对象绑定的写入（@ 选择、中途换绑、把「本轮对象」固定为会话对象）。
 *
 * 为什么单独成模块：绑定要同时保证四件事——归属校验、对象集落库（主对象列 + 关联表，同一事务）、
 * 元数据留痕（contextSwitches，前端据此插分隔条与生成持续提示）、产品事件；
 * 普通提问入口与「固定为本会话对象」接口必须走同一条路径，否则换绑行为会出现两套口径。
 *
 * 边界：只写 chat_sessions 的 context_type/context_id、chat_session_objects 与元数据，
 * 不改变历史消息、不重建摘要；目标对象是否属于当前教师由调用方用 buildAssistantBusinessContext 校验
 * （本模块只校验会话归属）。
 */
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { schema, useDb } from '../utils/db'
import { trackProductEvent } from './product-events'
import { appendContextSwitch, type ChatContextType } from './chat-context-switch'
import {
  isSameContextSet,
  loadSessionContexts,
  normalizeSessionContexts,
  type SessionPrimaryContext
} from './chat-session-contexts'

export interface SessionBindingTarget {
  type: ChatContextType
  id: string
  label: string
}

export interface BindChatSessionContextInput {
  sessionId: string
  userId: string
  schoolId: string
  /** 目标对象集（首个为主对象，最多 SESSION_CONTEXT_LIMIT 个）；归属由调用方校验 */
  targets: SessionBindingTarget[]
  /** 已加载的会话绑定信息（入口已查过时传入，避免重复查询） */
  current?: (SessionPrimaryContext & { status?: string | null }) | null
}

/**
 * 把会话绑定到目标对象集：主对象写列、其余写关联表（同一事务），并追加换绑留痕。
 * 已是同一组对象时不做任何写入；会话不存在或不属于当前教师抛 404；归档会话抛 409。
 */
export async function bindChatSessionContext(
  event: H3Event,
  input: BindChatSessionContextInput
): Promise<{ switched: boolean }> {
  const targets = normalizeSessionContexts(input.targets)
  // 空目标集没有业务入口（没有解绑功能），直接视为无需写入
  if (!targets.length) return { switched: false }
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

  const previous = await loadSessionContexts(event, input.sessionId, current)
  if (isSameContextSet(previous, targets)) return { switched: false }

  const primary = targets[0]!
  const related = targets.slice(1)
  await db.transaction(async (tx) => {
    await tx.update(schema.chatSessions).set({
      contextType: primary.type,
      contextId: primary.id,
      metadata: appendContextSwitch(current.metadata, {
        at: new Date().toISOString(),
        from: previous,
        to: targets
      })
    }).where(and(eq(schema.chatSessions.id, input.sessionId), eq(schema.chatSessions.ownerUserId, input.userId)))
    // 关联表只存主对象之外的对象：先清空再写入，避免残留旧对象
    await tx.delete(schema.chatSessionObjects).where(eq(schema.chatSessionObjects.sessionId, input.sessionId))
    if (related.length) {
      await tx.insert(schema.chatSessionObjects).values(related.map((target, index) => ({
        sessionId: input.sessionId,
        schoolId: input.schoolId,
        objectType: target.type,
        objectId: target.id,
        label: target.label,
        position: index
      })))
    }
  })

  await trackProductEvent(event, {
    schoolId: input.schoolId, userId: input.userId, eventName: 'assistant_context_switched',
    targetType: primary.type, targetId: primary.id,
    // 只记类型与数量，不记姓名或正文
    metadata: {
      fromType: previous[0]?.type || 'none',
      fromCount: previous.length,
      toCount: targets.length,
      toTypes: targets.map(item => item.type).join(',')
    }
  })
  return { switched: true }
}

/**
 * 会话对象集（主对象 + 关联对象）的归一化与读取。
 *
 * 数据模型（2026-10-16 支持 @ 多名学生后）：
 * - 主对象仍存在 chat_sessions.context_type/context_id，展示名在 metadata.contextLabel；
 * - 关联对象（主对象之外的其余对象）存在 chat_session_objects，只存增量、不重复存主对象，
 *   因此不存在「两处都写、写岔了」的可能；
 * - 唯一写入点是 server/domain/chat-session-binding.ts 的 bindChatSessionContext（同一事务内改主对象列 + 重建关联表）。
 *
 * 主对象这个位置不是纯展示：看板归属、通知跳转、导入与 ai_model_calls.context_type 等既有链路
 * 仍按主对象口径读取，见 docs/AI_ASSISTANT_AND_KNOWLEDGE.md。
 */
import type { H3Event } from 'h3'
import { asc, eq, inArray } from 'drizzle-orm'
import { CHAT_CONTEXT_MAX, type ChatContextType } from '../../shared/contracts'
import { schema, useDb } from '../utils/db'
import { readContextLabel, toContextRef, type ChatContextRef } from './chat-context-switch'

/** 一次绑定允许携带的对象数上限（含主对象），与 shared/contracts.ts 的 CHAT_CONTEXT_MAX 同源。 */
export const SESSION_CONTEXT_LIMIT = CHAT_CONTEXT_MAX

/** 未落库的目标对象（入口已完成归属校验）：首个为主对象。 */
export interface SessionContextTarget {
  type: ChatContextType
  id: string
  label: string
}

/** 会话行里读取对象集所需的字段（调用方通常已经查过，避免重复查询）。 */
export interface SessionPrimaryContext {
  contextType?: string | null
  contextId?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * 归一化对象集：过滤非法项、按 (type, id) 去重、按上限截断，保持传入顺序（首个为主对象）。
 * 纯函数，便于测试。
 */
export function normalizeSessionContexts(inputs: ReadonlyArray<{ type: string, id: string, label?: string | null }>): ChatContextRef[] {
  const seen = new Set<string>()
  const refs: ChatContextRef[] = []
  for (const item of inputs) {
    const ref = toContextRef(item.type, item.id, item.label)
    if (!ref) continue
    const key = `${ref.type}:${ref.id}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
    if (refs.length >= SESSION_CONTEXT_LIMIT) break
  }
  return refs
}

/** 两组对象集是否相同（忽略顺序，只看 (type, id) 集合）。纯函数。 */
export function isSameContextSet(
  left: ReadonlyArray<{ type: string, id: string }>,
  right: ReadonlyArray<{ type: string, id: string }>
): boolean {
  if (left.length !== right.length) return false
  const keys = new Set(left.map(item => `${item.type}:${item.id}`))
  for (const item of right) {
    if (!keys.has(`${item.type}:${item.id}`)) return false
  }
  return true
}

/** 读取关联对象行（按 position 排序；表里只有主对象之外的对象）。 */
async function readRelatedContexts(event: H3Event, sessionIds: string[]): Promise<Map<string, ChatContextRef[]>> {
  const bySession = new Map<string, ChatContextRef[]>()
  if (!sessionIds.length) return bySession
  const db = useDb(event)
  const rows = await db.select({
    sessionId: schema.chatSessionObjects.sessionId,
    objectType: schema.chatSessionObjects.objectType,
    objectId: schema.chatSessionObjects.objectId,
    label: schema.chatSessionObjects.label
  }).from(schema.chatSessionObjects)
    .where(inArray(schema.chatSessionObjects.sessionId, sessionIds))
    .orderBy(asc(schema.chatSessionObjects.position), asc(schema.chatSessionObjects.createdAt))
  for (const row of rows) {
    const ref = toContextRef(row.objectType, row.objectId, row.label)
    if (!ref) continue
    const list = bySession.get(row.sessionId) || []
    list.push(ref)
    bySession.set(row.sessionId, list)
  }
  return bySession
}

/**
 * 读取单个会话的完整对象集（主对象在前）。
 * `primary` 未传时自行查询会话行；调用方已查过会话行时应传入，避免重复查询。
 */
export async function loadSessionContexts(
  event: H3Event,
  sessionId: string,
  primary?: SessionPrimaryContext | null
): Promise<ChatContextRef[]> {
  let row = primary
  if (row === undefined) {
    const db = useDb(event)
    const [found] = await db.select({
      contextType: schema.chatSessions.contextType,
      contextId: schema.chatSessions.contextId,
      metadata: schema.chatSessions.metadata
    }).from(schema.chatSessions).where(eq(schema.chatSessions.id, sessionId)).limit(1)
    row = found ?? null
  }
  if (!row || row.contextType === 'none') return []
  const ref = toContextRef(row.contextType, row.contextId, readContextLabel(row.metadata))
  return ref ? [ref] : []
}

/** 批量读取多个会话的完整对象集（会话列表 / 详情用），主对象在前。 */
export async function loadSessionContextsBatch(
  event: H3Event,
  sessions: ReadonlyArray<{ id: string } & SessionPrimaryContext>
): Promise<Map<string, ChatContextRef[]>> {
  const related = await readRelatedContexts(event, sessions.map(item => item.id))
  const bySession = new Map<string, ChatContextRef[]>()
  for (const session of sessions) {
    const refs: ChatContextRef[] = []
    if (session.contextType && session.contextType !== 'none') {
      const primary = toContextRef(session.contextType, session.contextId, readContextLabel(session.metadata))
      if (primary) refs.push(primary)
    }
    for (const ref of related.get(session.id) || []) {
      if (refs.some(item => item.type === ref.type && item.id === ref.id)) continue
      refs.push(ref)
    }
    bySession.set(session.id, refs)
  }
  return bySession
}

/** 读取单个会话的关联对象（不含主对象），供绑定写入前比较使用。 */
export async function readRelatedSessionContexts(event: H3Event, sessionId: string): Promise<ChatContextRef[]> {
  const bySession = await readRelatedContexts(event, [sessionId])
  return bySession.get(sessionId) || []
}

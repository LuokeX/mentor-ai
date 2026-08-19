/**
 * 学校管理员后台 AI 对话管理共享逻辑。
 *
 * 物理删除语义：评估/方案等业务产物保留，仅来源引用置空。
 *   - assessment_sessions.source_chat_session_id、plans.source_chat_session_id
 *     均为 onDelete 'set null'：删除会话后评估/方案记录保留，来源会话引用自动置空。
 *   - ai_model_calls.sessionId 同为 onDelete 'set null'。
 *   - assistant_feedback.messageId 为 onDelete 'cascade'：删除消息时反馈记录级联删除。
 * 因此级联删除只处理 chat_messages → routing_decisions → chat_sessions 与悬空通知。
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { DbTx } from '../utils/db'
import { schema } from '../utils/db'

/**
 * 清理会话相关的站内通知。
 * notifications.target_type/target_id 无外键，物理删除会话后可能残留悬空通知；
 * 按 targetId（会话 id 及其消息 id，叠加 schoolId 兜底）匹配删除。
 * 当前业务中通知 target_type 取值仅有 referral / safety_event / plan / plan_action，
 * 对话本身不产生站内通知，此处为通用兜底清理。
 */
export async function cleanupConversationNotifications(
  tx: DbTx,
  schoolId: string,
  sessionId: string,
  messageIds: string[],
): Promise<void> {
  const targetIds = [sessionId, ...messageIds]
  if (!targetIds.length) return
  await tx.delete(schema.notifications).where(and(
    eq(schema.notifications.schoolId, schoolId),
    inArray(schema.notifications.targetId, targetIds),
  ))
}

/**
 * 物理删除会话的级联删除（必须在事务内调用）：
 * 1. chat_messages：sessionId 为 onDelete 'restrict'，必须先删（含软删消息）；
 *    assistant_feedback 随消息级联删除。
 * 2. routing_decisions：sessionId 无 onDelete（restrict 语义），删会话前必须先删。
 * 3. chat_sessions。
 * 业务产物（评估/方案）由数据库 set null 自动保留，见文件头注释。
 */
export async function deleteConversationCascade(
  tx: DbTx,
  schoolId: string,
  sessionId: string,
): Promise<{ messageCount: number }> {
  const messages = await tx.delete(schema.chatMessages)
    .where(eq(schema.chatMessages.sessionId, sessionId))
    .returning({ id: schema.chatMessages.id })
  await cleanupConversationNotifications(tx, schoolId, sessionId, messages.map((m) => m.id))
  await tx.delete(schema.routingDecisions).where(eq(schema.routingDecisions.sessionId, sessionId))
  const [deleted] = await tx.delete(schema.chatSessions)
    .where(and(eq(schema.chatSessions.id, sessionId), eq(schema.chatSessions.schoolId, schoolId)))
    .returning({ id: schema.chatSessions.id })
  if (!deleted) throw createError({ statusCode: 404, message: '对话不存在' })
  return { messageCount: messages.length }
}
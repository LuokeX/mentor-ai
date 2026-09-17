/**
 * 评估组生命周期领域逻辑。
 *
 * 评估组（assessment_sessions）是同一业务问题下多张量表提交的聚合载体：
 * 从第一次提交开始 open，方案被接受或进入执行态后 completed。
 * 组关闭后再次评估会开新组、建新方案，避免标题归因混入旧量表。
 */
import { and, eq, inArray } from 'drizzle-orm'
import { type DbClient, schema } from '../utils/db'

/** 方案已进入执行态（不再可接受、不再追加量表）时关闭其关联的评估组。 */export async function closeAssessmentSessionsForPlan(
  db: DbClient,
  planId: string,
  now = new Date()
): Promise<number> {
  const linked = await db.select({ id: schema.assessmentSessions.id })
    .from(schema.assessmentSessions)
    .innerJoin(schema.assessmentSessionAttempts,
      eq(schema.assessmentSessionAttempts.assessmentSessionId, schema.assessmentSessions.id))
    .innerJoin(schema.planAssessmentAttempts,
      eq(schema.planAssessmentAttempts.assessmentAttemptId, schema.assessmentSessionAttempts.assessmentAttemptId))
    .where(and(
      eq(schema.planAssessmentAttempts.planId, planId),
      eq(schema.assessmentSessions.status, 'open')
    ))
  if (!linked.length) return 0
  await db.update(schema.assessmentSessions).set({
    status: 'completed',
    completedAt: now,
    updatedAt: now
  }).where(inArray(schema.assessmentSessions.id, linked.map(item => item.id)))
  return linked.length
}

/**
 * 一次提交是否按「显式续接」并入已有评估组。
 *
 * 只有教师主动选择继续时才允许续接：本轮连续流程内（提交后选「先做这张量表」）由提交
 * 响应带回组 id，或从方案页「去完成」带 `continueSession` 深链进入。客户端不再读取浏览器
 * 里残留的评估组 id 静默续接——那会让新的作答悄悄并进旧组：旧组里待确认的方案可能被
 * 这次结果冻结，两个不相关的问题也可能被合并成一份方案。
 *
 * 有来源对话或有咨询对象时不适用：这两种场景由服务端按上下文定位组，不依赖前端传 id。
 */
export function shouldContinueRequestedSession(input: {
  continueSession?: boolean | null
  requestedSessionId?: string | null
  hasChatSource?: boolean
  hasContext?: boolean
}) {
  if (!input.continueSession || !input.requestedSessionId) return false
  return !input.hasChatSource && !input.hasContext
}
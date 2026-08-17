/**
 * 评估组生命周期领域逻辑。
 *
 * 评估组（assessment_sessions）是同一业务问题下多张量表提交的聚合载体：
 * 从第一次提交开始 open，方案被接受或进入执行态后 completed。
 * 组关闭后再次评估会开新组、建新方案，避免标题归因混入旧量表。
 */
import { and, eq, inArray } from 'drizzle-orm'
import { type DbClient, schema } from '../utils/db'

/** 方案已进入执行态（不再可接受、不再追加量表）时关闭其关联的评估组。 */
export async function closeAssessmentSessionsForPlan(
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
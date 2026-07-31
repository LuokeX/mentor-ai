/**
 * 历史评估回看。
 *
 * assessment_attempts.result.report 一直存着完整报告，但在此之前没有任何读取入口——
 * 教师只有在提交那一刻能看到评估结论，离开页面就再也打不开了。
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { moduleMeta } from '../../../../../shared/assessments'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)

  const [attempt] = await db.select({
    id: schema.assessmentAttempts.id,
    module: schema.assessmentAttempts.module,
    assessmentCode: schema.assessmentAttempts.assessmentCode,
    definitionVersion: schema.assessmentAttempts.definitionVersion,
    status: schema.assessmentAttempts.status,
    result: schema.assessmentAttempts.result,
    submittedAt: schema.assessmentAttempts.submittedAt,
    createdAt: schema.assessmentAttempts.createdAt
  }).from(schema.assessmentAttempts).where(and(
    eq(schema.assessmentAttempts.id, id),
    eq(schema.assessmentAttempts.ownerUserId, user.id)
  )).limit(1)
  if (!attempt) throw createError({ statusCode: 404, message: '评估记录不存在' })
  if (attempt.status !== 'submitted') {
    throw createError({ statusCode: 409, message: '该评估尚未提交，没有可查看的报告' })
  }

  const result = (attempt.result || {}) as Record<string, any>
  // 不回传 answers：回看只需要结论，逐题作答是更敏感的原始数据。
  const [plan] = await db.select({ id: schema.plans.id, title: schema.plans.title, status: schema.plans.status })
    .from(schema.plans)
    .where(and(
      eq(schema.plans.sourceAssessmentAttemptId, attempt.id),
      eq(schema.plans.ownerUserId, user.id)
    )).limit(1)

  return {
    id: attempt.id,
    module: attempt.module,
    moduleTitle: (moduleMeta as Record<string, { title: string }>)[attempt.module]?.title || attempt.module,
    assessmentCode: attempt.assessmentCode,
    definitionVersion: attempt.definitionVersion,
    submittedAt: attempt.submittedAt || attempt.createdAt,
    report: result.report ?? null,
    level: result.level ?? null,
    levelName: result.levelName ?? null,
    severity: result.severity ?? null,
    blocked: Boolean(result.blocked),
    tools: Array.isArray(result.tools) ? result.tools : [],
    plan: plan || null
  }
})

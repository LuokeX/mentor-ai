import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)

  // 方案：禁止物理删除，已提交的方案只能关闭，草稿方案可以抛弃（标记为草稿删除/关闭）
  const [plan] = await db.select({
    id: schema.plans.id,
    schoolId: schema.plans.schoolId,
    status: schema.plans.status,
    sourceAssessmentAttemptId: schema.plans.sourceAssessmentAttemptId,
  }).from(schema.plans).where(and(
    eq(schema.plans.id, id),
    eq(schema.plans.ownerUserId, user.id),
    eq(schema.plans.schoolId, user.schoolId!)
  )).limit(1)

  if (plan) {
    if (plan.status === 'closed') {
      throw createError({ statusCode: 409, message: '方案已关闭' })
    }

    await db.transaction(async (tx) => {
      await tx.update(schema.plans).set({
        status: 'closed',
        closedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(schema.plans.id, plan.id),
        eq(schema.plans.ownerUserId, user.id),
        eq(schema.plans.schoolId, user.schoolId!)
      ))

      // 关联的已提交评估不允许删除，只能保留
      // 草稿评估可以标记为删除（归档）
    })

    await writeAudit(event, {
      schoolId: user.schoolId,
      actorId: user.id,
      action: 'support_case.close',
      targetType: 'plan',
      targetId: plan.id,
      metadata: { previousStatus: plan.status, sourceAssessmentAttemptId: plan.sourceAssessmentAttemptId }
    })

    return { closed: true, type: 'plan' }
  }

  // 独立的草稿评估：可以标记为删除
  const [attempt] = await db.select({ id: schema.assessmentAttempts.id, status: schema.assessmentAttempts.status }).from(schema.assessmentAttempts).where(and(
    eq(schema.assessmentAttempts.id, id),
    eq(schema.assessmentAttempts.ownerUserId, user.id),
    eq(schema.assessmentAttempts.schoolId, user.schoolId!)
  )).limit(1)

  if (attempt) {
    if (attempt.status === 'submitted') {
      throw createError({ statusCode: 409, message: '已提交的评估不支持删除，如需弃用请联系管理员处理' })
    }

    await db.update(schema.assessmentAttempts).set({
      status: 'archived',
      updatedAt: new Date(),
    }).where(and(
      eq(schema.assessmentAttempts.id, attempt.id),
      eq(schema.assessmentAttempts.ownerUserId, user.id),
      eq(schema.assessmentAttempts.schoolId, user.schoolId!)
    ))

    await writeAudit(event, {
      schoolId: user.schoolId,
      actorId: user.id,
      action: 'support_case.archive',
      targetType: 'assessment',
      targetId: attempt.id
    })

    return { archived: true, type: 'assessment' }
  }

  throw createError({ statusCode: 404, message: '支持案例不存在' })
})
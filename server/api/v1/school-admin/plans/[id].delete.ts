import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { cleanupPlanNotifications, deletePlanCascade } from '../../../../domain/plan-admin'
import { requireSchoolManagement } from '../../../../domain/school-management'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

const bodySchema = z.object({ reason: z.string().trim().min(10).max(500) })

export default defineEventHandler(async (event) => {
  const { actor: user, schoolId } = await requireSchoolManagement(event, ['plans'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))

  const [plan] = await useDb(event).select({
    id: schema.plans.id,
    title: schema.plans.title
  }).from(schema.plans)
    .where(and(eq(schema.plans.id, id), eq(schema.plans.schoolId, schoolId)))
    .limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })

  // 物理删除方案（评估保留）：5 张 restrict 子表按外键顺序清理，再清理通知
  await useDb(event).transaction(async (tx) => {
    const { actionIds } = await deletePlanCascade(tx, id)
    await cleanupPlanNotifications(tx, { planId: id, actionIds })
    await writeAudit(event, {
      schoolId, actorId: user.id, action: 'school_admin.plan.hard_delete',
      targetType: 'plan', targetId: id,
      metadata: { reason: body.reason, title: plan.title }
    }, tx)
  })
  return { ok: true }
})
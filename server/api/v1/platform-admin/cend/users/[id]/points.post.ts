import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { grantPoints } from '../../../../../../domain/cend-points'
import { findCendSchool } from '../../../../../../domain/cend-school'
import { requireUser } from '../../../../../../utils/auth'
import { writeAudit } from '../../../../../../utils/audit'
import { schema, useDb } from '../../../../../../utils/db'

const bodySchema = z.object({
  amount: z.coerce.number().int().min(-100000).max(100000).refine(value => value !== 0, { message: '积分变动不能为 0' }),
  reason: z.string().trim().min(10).max(500)
})

/** 平台后台：手动补/扣 C 端积分（写流水与审计）。 */
export default defineEventHandler(async (event) => {
  const actor = await requireUser(event, ['platform_admin'])
  const userId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const cend = await findCendSchool(db)
  if (!cend) throw createError({ statusCode: 500, message: 'C 端租户未初始化' })

  const [target] = await db.select({ id: schema.userRoles.id })
    .from(schema.userRoles)
    .where(and(
      eq(schema.userRoles.userId, userId),
      eq(schema.userRoles.schoolId, cend.id),
      eq(schema.userRoles.roleCode, 'teacher')
    )).limit(1)
  if (!target) throw createError({ statusCode: 404, message: 'C 端用户不存在' })

  const result = await grantPoints(db, {
    userId,
    amount: body.amount,
    type: 'admin_adjust',
    status: 'settled',
    idempotencyKey: `admin:${randomUUID()}`,
    referenceType: 'platform_admin',
    referenceId: actor.id,
    note: body.reason
  })
  if (!result.ok) {
    throw createError({ statusCode: 422, message: `积分不足，当前余额 ${result.balance}` })
  }

  await writeAudit(event, {
    schoolId: cend.id,
    actorId: actor.id,
    action: 'platform_admin.cend.points.adjust',
    targetType: 'user',
    targetId: userId,
    metadata: { amount: body.amount, balanceAfter: result.balance, reason: body.reason }
  })
  return { ok: true, balance: result.balance, transaction: result.transaction }
})

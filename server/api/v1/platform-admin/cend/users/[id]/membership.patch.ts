import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { findCendSchool } from '../../../../../../domain/cend-school'
import { requireUser } from '../../../../../../utils/auth'
import { writeAudit } from '../../../../../../utils/audit'
import { schema, useDb } from '../../../../../../utils/db'

const bodySchema = z.object({
  tier: z.enum(['month', 'quarter', 'half_year', 'year']),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(10).max(500)
})

const TIER_DAYS: Record<string, number> = { month: 30, quarter: 90, half_year: 182, year: 365 }
const TIER_LABELS: Record<string, string> = { month: '月度会员', quarter: '季度会员', half_year: '半年会员', year: '年度会员' }

/** 平台后台：给 C 端用户线下开通/续期会员（覆盖现有 active 会员）。 */
export default defineEventHandler(async (event) => {
  const actor = await requireUser(event, ['platform_admin'])
  const userId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const cend = await findCendSchool(db)
  if (!cend) throw createError({ statusCode: 500, message: 'C 端租户未初始化' })

  const [target] = await db.select({ id: schema.users.id, name: schema.users.name, phone: schema.users.phone })
    .from(schema.userRoles)
    .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
    .where(and(
      eq(schema.userRoles.userId, userId),
      eq(schema.userRoles.schoolId, cend.id),
      eq(schema.userRoles.roleCode, 'teacher')
    )).limit(1)
  if (!target) throw createError({ statusCode: 404, message: 'C 端用户不存在' })

  const startAt = body.startAt ? new Date(body.startAt) : new Date()
  const endAt = body.endAt
    ? new Date(body.endAt)
    : new Date(startAt.getTime() + TIER_DAYS[body.tier]! * 86_400_000)
  if (!(startAt < endAt)) throw createError({ statusCode: 422, message: '会员结束时间必须晚于开始时间' })

  const membership = await db.transaction(async (tx) => {
    await tx.update(schema.cendMemberships)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(and(
        eq(schema.cendMemberships.userId, userId),
        eq(schema.cendMemberships.status, 'active')
      ))
    const [created] = await tx.insert(schema.cendMemberships).values({
      userId,
      tier: body.tier,
      status: 'active',
      startAt,
      endAt,
      grantedBy: actor.id,
      note: body.note ?? null
    }).returning()
    await writeAudit(event, {
      schoolId: cend.id,
      actorId: actor.id,
      action: 'platform_admin.cend.membership.update',
      targetType: 'user',
      targetId: userId,
      metadata: {
        tier: body.tier,
        tierLabel: TIER_LABELS[body.tier],
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        reason: body.reason
      }
    }, tx)
    return created
  })

  return { ok: true, membership }
})

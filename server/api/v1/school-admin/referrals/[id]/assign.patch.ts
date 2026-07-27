import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { schema, useDb } from '../../../../../utils/db'
import { writeAudit } from '../../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = z.object({ psychologistId: z.string().uuid(), reason: z.string().trim().min(10).max(300) }).parse(await readBody(event))
  const db = useDb(event)
  const [[psychologist], [referral]] = await Promise.all([
    db.select().from(schema.users).where(and(
      eq(schema.users.id, body.psychologistId), eq(schema.users.schoolId, admin.schoolId),
      eq(schema.users.role, 'psychologist'), eq(schema.users.status, 'active')
    )).limit(1),
    db.select().from(schema.referrals).where(and(eq(schema.referrals.id, id), eq(schema.referrals.schoolId, admin.schoolId))).limit(1)
  ])
  if (!psychologist) throw createError({ statusCode: 422, message: '心理专员不存在或不可用' })
  if (!referral) throw createError({ statusCode: 404, message: '转介工单不存在' })
  if (referral.acknowledgedAt || referral.status === 'closed') throw createError({ statusCode: 409, message: '仅可转派尚未确认的工单' })
  const now = new Date()
  await db.transaction(async (tx) => {
    const [updated] = await tx.update(schema.referrals).set({
      psychologistId: psychologist.id, assignedAt: now, status: 'created', escalatedAt: null, updatedAt: now
    }).where(and(
      eq(schema.referrals.id, referral.id),
      eq(schema.referrals.schoolId, admin.schoolId!),
      eq(schema.referrals.status, 'created'),
    )).returning({ id: schema.referrals.id })
    if (!updated) throw createError({ statusCode: 409, message: '工单状态已变化，请刷新后重试' })
    await tx.insert(schema.referralEvents).values({
      schoolId: admin.schoolId!, referralId: referral.id, actorId: admin.id,
      eventType: 'reassigned', fromStatus: referral.status, toStatus: 'created',
      metadata: { fromPsychologistId: referral.psychologistId, toPsychologistId: psychologist.id, reason: body.reason }
    })
    await tx.insert(schema.notifications).values({
      schoolId: admin.schoolId!, userId: psychologist.id, type: 'referral_assigned',
      title: '危机转介工单已转派给你', body: `危机事件 ${referral.safetyEventId.slice(0, 8)} 待确认，请立即进入工作台。`,
      targetType: 'referral', targetId: referral.id, deduplicationKey: `referral-reassigned:${referral.id}:${now.getTime()}`
    })
    await writeAudit(event, {
      schoolId: admin.schoolId,
      actorId: admin.id,
      action: 'referral.reassign',
      targetType: 'referral',
      targetId: id,
      metadata: {
        fromPsychologistId: referral.psychologistId,
        toPsychologistId: psychologist.id,
        reason: body.reason,
      },
    }, tx)
  })
  return { ok: true }
})

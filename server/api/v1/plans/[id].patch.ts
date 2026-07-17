import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = z.object({
    status: z.enum(['in_progress', 'completed', 'closed']).optional(),
    nextReviewAt: z.string().datetime().nullable().optional()
  }).refine(value => value.status || value.nextReviewAt !== undefined).parse(await readBody(event))
  const now = new Date()
  const [updated] = await useDb(event).update(schema.plans).set({
    status: body.status,
    nextReviewAt: body.nextReviewAt === null ? null : body.nextReviewAt ? new Date(body.nextReviewAt) : undefined,
    completedAt: body.status === 'completed' ? now : undefined,
    closedAt: body.status === 'closed' ? now : undefined,
    updatedAt: now
  }).where(and(eq(schema.plans.id, id), eq(schema.plans.ownerUserId, user.id))).returning({ id: schema.plans.id })
  if (!updated) throw createError({ statusCode: 404, message: '方案不存在' })
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'plan.status.update', targetType: 'plan', targetId: id, metadata: { status: body.status } })
  return { ok: true }
})

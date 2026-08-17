import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { matchesExpectedUpdatedAt, updatedAtMatches } from '../../../../utils/concurrency'
import { useDb, schema } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'

const updateSchema = z.object({
  eventType: z.enum(['德育活动', '班级冲突', '集体异常', '班级建设', '其他']).optional(),
  severity: z.enum(['低', '中', '高', '严重']).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
  resolution: z.string().optional(),
  status: z.enum(['open', 'resolved', 'closed']).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = updateSchema.parse(await readBody(event))
  const expectedUpdatedAt = z.string().datetime().parse(getQuery(event).expectedUpdatedAt)
  const db = useDb(event)

  const [record] = await db.select().from(schema.classEvents).where(and(
    eq(schema.classEvents.id, id),
    eq(schema.classEvents.ownerUserId, user.id),
    eq(schema.classEvents.schoolId, user.schoolId),
  )).limit(1)
  if (!record) throw createError({ statusCode: 404, message: '班级事件不存在' })
  if (expectedUpdatedAt && !matchesExpectedUpdatedAt(record.updatedAt, expectedUpdatedAt)) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '事件记录已被其他用户修改，请刷新后重试' })
  }

  const updates: Record<string, unknown> = {}
  if (body.eventType !== undefined) updates.eventType = body.eventType
  if (body.severity !== undefined) updates.severity = body.severity
  if (body.title !== undefined) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.occurredAt !== undefined) updates.occurredAt = new Date(body.occurredAt)
  if (body.resolution !== undefined) updates.resolution = body.resolution
  if (body.status !== undefined) updates.status = body.status
  updates.updatedAt = new Date()

  const [updated] = await db.update(schema.classEvents).set(updates)
    .where(and(
      eq(schema.classEvents.id, id),
      eq(schema.classEvents.ownerUserId, user.id),
      eq(schema.classEvents.schoolId, user.schoolId),
      updatedAtMatches(schema.classEvents.updatedAt, expectedUpdatedAt),
    ))
    .returning()
  if (!updated) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '事件记录已被其他用户修改，请刷新后重试' })

  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'class_event.update',
    targetType: 'class_event',
    targetId: id,
    metadata: { changes: Object.keys(body) }
  })

  return updated
})
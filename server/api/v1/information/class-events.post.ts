import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { writeAudit } from '../../../utils/audit'

const createSchema = z.object({
  classId: z.string().uuid(),
  eventType: z.enum(['德育活动', '班级冲突', '集体异常', '班级建设', '其他']),
  severity: z.enum(['低', '中', '高', '严重']),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
  resolution: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = createSchema.parse(await readBody(event))
  const db = useDb(event)

  // 验证班级属于当前教师
  const [klass] = await db.select({ id: schema.classes.id })
    .from(schema.classes)
    .where(and(
      eq(schema.classes.id, body.classId),
      eq(schema.classes.schoolId, user.schoolId),
      eq(schema.classes.ownerUserId, user.id),
      eq(schema.classes.status, 'active'),
    ))
    .limit(1)
  if (!klass) throw createError({ statusCode: 404, message: '班级不存在' })

  const [record] = await db.insert(schema.classEvents).values({
    schoolId: user.schoolId,
    ownerUserId: user.id,
    classId: body.classId,
    eventType: body.eventType,
    severity: body.severity,
    title: body.title,
    description: body.description || null,
    occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
    resolution: body.resolution || null,
    status: 'open',
  }).returning()

  if (!record) throw createError({ statusCode: 500, message: '创建班级事件失败' })

  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'class_event.create',
    targetType: 'class_event',
    targetId: record.id,
    metadata: { eventType: body.eventType, severity: body.severity, classId: body.classId }
  })

  return record
})
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { writeAudit } from '../../../utils/audit'

const createSchema = z.object({
  studentId: z.string().uuid(),
  eventType: z.enum(['违纪', '冲突', '异常行为', '学业波动', '其他']),
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

  // 验证学生属于当前教师
  const [student] = await db.select({ id: schema.students.id })
    .from(schema.students)
    .where(and(
      eq(schema.students.id, body.studentId),
      eq(schema.students.schoolId, user.schoolId),
      eq(schema.students.ownerUserId, user.id),
      eq(schema.students.status, 'active'),
    ))
    .limit(1)
  if (!student) throw createError({ statusCode: 404, message: '学生不存在' })

  const [record] = await db.insert(schema.studentEvents).values({
    schoolId: user.schoolId,
    ownerUserId: user.id,
    studentId: body.studentId,
    eventType: body.eventType,
    severity: body.severity,
    title: body.title,
    description: body.description || null,
    occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
    resolution: body.resolution || null,
    status: 'open',
  }).returning()

  if (!record) throw createError({ statusCode: 500, message: '创建事件记录失败' })

  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'student_event.create',
    targetType: 'student_event',
    targetId: record.id,
    metadata: { eventType: body.eventType, severity: body.severity, studentId: body.studentId }
  })

  return record
})

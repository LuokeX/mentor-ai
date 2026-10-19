import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { eventStatusSchema, studentEventTypeSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { writeAudit } from '../../../utils/audit'
import { assertChatMessageSource } from '../../../domain/chat-transfer-source'
import { RECORD_RELATED_TARGET_MAX, resolveOwnedRecordTargets } from '../../../domain/information-record-targets'

const createSchema = z.object({
  /** 关联学生（首个为主学生，最多 RECORD_RELATED_TARGET_MAX 个） */
  studentIds: z.array(z.string().uuid()).min(1).max(RECORD_RELATED_TARGET_MAX),
  eventType: studentEventTypeSchema,
  severity: z.enum(['低', '中', '高', '严重']),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
  resolution: z.string().optional(),
  // 允许登记时直接给状态（例如补录一条已处理完的事件），不传默认「待处理」
  status: eventStatusSchema.optional(),
  /** 来源：从 AI 对话「转存」创建时携带（会话 + 消息，归属在服务端校验） */
  sourceChatSessionId: z.string().uuid().optional(),
  sourceChatMessageId: z.string().uuid().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = createSchema.parse(await readBody(event))
  const db = useDb(event)

  // 逐个校验学生归属（越权整体拒绝），首个为主学生、其余写关联表
  const targets = await resolveOwnedRecordTargets(event, user, {
    kind: 'student',
    ids: body.studentIds,
    requireActive: true
  })
  if (!targets.primary) throw createError({ statusCode: 422, message: '请选择关联学生' })
  const source = await assertChatMessageSource(event, user, body.sourceChatSessionId, body.sourceChatMessageId)

  const record = await db.transaction(async (tx) => {
    const [created] = await tx.insert(schema.studentEvents).values({
      schoolId: user.schoolId!,
      ownerUserId: user.id,
      studentId: targets.primary!,
      eventType: body.eventType,
      severity: body.severity,
      title: body.title,
      description: body.description || null,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      resolution: body.resolution || null,
      status: body.status ?? 'open',
      sourceChatSessionId: source?.sessionId ?? null,
      sourceChatMessageId: source?.messageId ?? null,
    }).returning()
    if (!created) return null
    if (targets.related.length) {
      await tx.insert(schema.studentEventStudents).values(targets.related.map(studentId => ({
        eventId: created.id,
        studentId,
        schoolId: user.schoolId!
      })))
    }
    return created
  })
  if (!record) throw createError({ statusCode: 500, message: '创建事件记录失败' })

  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'student_event.create',
    targetType: 'student_event',
    targetId: record.id,
    metadata: {
      eventType: body.eventType,
      severity: body.severity,
      status: record.status,
      studentId: targets.primary,
      studentCount: targets.related.length + 1,
      ...(source ? { source: 'chat', sourceChatSessionId: source.sessionId, sourceChatMessageId: source.messageId } : {})
    }
  })

  return record
})

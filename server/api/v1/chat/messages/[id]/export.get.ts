import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { requireUser } from '../../../../../utils/auth'
import { decryptSensitive } from '../../../../../utils/crypto'
import { schema, useDb } from '../../../../../utils/db'
import { writeAudit } from '../../../../../utils/audit'
import { formatBeijingDateStamp } from '../../../../../utils/format-time'
import { buildLessonPlanDocx } from '../../../../../domain/lesson-plan-docx'
import { trackProductEvent } from '../../../../../domain/product-events'

const querySchema = z.object({
  /** 目前只支持 Word；后续可扩展 markdown / pdf */
  format: z.literal('docx').optional()
})

/** 文件名只做展示：去掉路径分隔符与控制字符，避免下载名出问题。 */
function sanitizeFilenamePart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/**
 * 导出助手回答为 Word（.docx）。
 *
 * 只允许导出当前教师自己的、未删除的助手消息；不落盘、不缓存，审计只记格式与模式。
 * 备课模式与普通问答都可导出，用来保存完整教案或长回答。
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  if (!querySchema.safeParse(getQuery(event)).success) {
    throw createError({ statusCode: 400, message: '导出格式仅支持 Word（docx）' })
  }
  const messageId = z.string().uuid().parse(getRouterParam(event, 'id'))

  const db = useDb(event)
  const [message] = await db.select({
    id: schema.chatMessages.id,
    sessionId: schema.chatMessages.sessionId,
    contentEnc: schema.chatMessages.contentEnc,
    metadata: schema.chatMessages.metadata
  }).from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.id, messageId),
      eq(schema.chatMessages.schoolId, user.schoolId),
      eq(schema.chatMessages.ownerUserId, user.id),
      eq(schema.chatMessages.role, 'assistant'),
      isNull(schema.chatMessages.deletedAt)
    ))
    .limit(1)
  if (!message) throw createError({ statusCode: 404, message: '回答不存在' })

  const [session] = await db.select({ title: schema.chatSessions.title })
    .from(schema.chatSessions)
    .where(and(
      eq(schema.chatSessions.id, message.sessionId),
      eq(schema.chatSessions.ownerUserId, user.id),
      eq(schema.chatSessions.schoolId, user.schoolId)
    ))
    .limit(1)

  const config = useRuntimeConfig(event)
  const markdown = decryptSensitive(message.contentEnc, config.encryptionKey)
  if (!markdown.trim()) throw createError({ statusCode: 409, message: '回答内容为空，无法导出' })

  const mode = (message.metadata as { mode?: unknown } | null)?.mode === 'lesson_prep' ? 'lesson_prep' : 'chat'
  const prefix = mode === 'lesson_prep' ? '备课方案' : 'AI助手回答'
  const title = sanitizeFilenamePart(session?.title || '') || prefix
  const docx = buildLessonPlanDocx({ title, markdown, exportedAt: new Date() })

  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'chat.message.export',
    targetType: 'chat_message',
    targetId: messageId,
    metadata: { format: 'docx', mode }
  })
  await trackProductEvent(event, {
    schoolId: user.schoolId,
    userId: user.id,
    eventName: 'assistant_answer_exported',
    targetType: 'chat_message',
    targetId: messageId,
    metadata: { format: 'docx', mode }
  })

  const titlePart = title && title !== prefix ? `-${title}` : ''
  const filename = `${prefix}${titlePart}-${formatBeijingDateStamp()}.docx`
  const asciiFallback = `lesson-plan-${formatBeijingDateStamp()}.docx`
  setResponseHeaders(event, {
    'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'content-disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff'
  })
  return docx
})

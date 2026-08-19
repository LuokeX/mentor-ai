import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'
import { deleteConversationCascade } from '../../../../domain/conversation-admin'

const bodySchema = z.object({ reason: z.string().trim().min(10).max(500) })

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)

  const [session] = await db.select({ id: schema.chatSessions.id, title: schema.chatSessions.title })
    .from(schema.chatSessions)
    .where(and(eq(schema.chatSessions.id, id), eq(schema.chatSessions.schoolId, user.schoolId)))
    .limit(1)
  if (!session) throw createError({ statusCode: 404, message: '对话不存在' })

  // 物理删除顺序：消息（含软删）→ 分诊决策 → 会话；评估/方案由 DB set null 自动保留（见 conversation-admin.ts 文件头注释）
  const { messageCount } = await db.transaction(async (tx) => {
    const result = await deleteConversationCascade(tx, user.schoolId!, id)
    await writeAudit(event, {
      schoolId: user.schoolId, actorId: user.id, action: 'school_admin.conversation.hard_delete',
      targetType: 'conversation', targetId: id,
      metadata: { reason: body.reason, title: session.title, messageCount: result.messageCount },
    }, tx)
    return result
  })
  return { ok: true, messageCount }
})
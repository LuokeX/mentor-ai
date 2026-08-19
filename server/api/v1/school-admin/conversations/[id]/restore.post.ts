import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { matchesExpectedUpdatedAt, updatedAtMatches } from '../../../../../utils/concurrency'
import { schema, useDb } from '../../../../../utils/db'

const bodySchema = z.object({ expectedUpdatedAt: z.string().datetime(), reason: z.string().trim().min(10).max(500) })

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['school_admin'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)

  await db.transaction(async (tx) => {
    const [session] = await tx.select().from(schema.chatSessions)
      .where(and(eq(schema.chatSessions.id, id), eq(schema.chatSessions.schoolId, user.schoolId!)))
      .limit(1)
    if (!session) throw createError({ statusCode: 404, message: '对话不存在' })
    if (session.status !== 'archived') {
      throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '只能恢复已归档的对话' })
    }
    if (!matchesExpectedUpdatedAt(session.updatedAt, body.expectedUpdatedAt)) {
      throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '记录已被他人修改，请刷新后重试' })
    }
    const [updated] = await tx.update(schema.chatSessions).set({
      status: 'active',
      archivedAt: null,
      archivedBy: null,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.chatSessions.id, id),
      eq(schema.chatSessions.schoolId, user.schoolId!),
      eq(schema.chatSessions.status, 'archived'),
      updatedAtMatches(schema.chatSessions.updatedAt, body.expectedUpdatedAt),
    )).returning({ id: schema.chatSessions.id })
    if (!updated) {
      throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '记录已被他人修改，请刷新后重试' })
    }
    await writeAudit(event, {
      schoolId: user.schoolId, actorId: user.id, action: 'school_admin.conversation.restore',
      targetType: 'conversation', targetId: id,
      metadata: { reason: body.reason },
    }, tx)
  })
  return { ok: true }
})
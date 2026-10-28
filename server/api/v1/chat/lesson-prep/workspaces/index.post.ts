import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { createLessonPrepWorkspace } from '../../../../../domain/lesson-prep-workspace'

const bodySchema = z.object({
  sessionId: z.string().uuid().optional()
})

/** 创建（或复用）当前教师的备课资料工作区；浏览器只拿到本表 id。 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = bodySchema.parse((await readBody(event).catch(() => ({}))) || {})
  const row = await createLessonPrepWorkspace(event, { id: user.id, schoolId: user.schoolId }, body.sessionId)
  return {
    workspaceId: row.id,
    expiresAt: row.expiresAt.toISOString()
  }
})

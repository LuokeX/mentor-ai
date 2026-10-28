import { z } from 'zod'
import { requireUser } from '../../../../../../utils/auth'
import { listLessonPrepFiles } from '../../../../../../domain/lesson-prep-workspace'

/** 列出当前教师工作区中的资料（只返回名称/大小/更新时间，不返回文件内容）。 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const files = await listLessonPrepFiles(event, { id: user.id, schoolId: user.schoolId }, id)
  return { files }
})

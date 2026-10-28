import { z } from 'zod'
import { requireUser } from '../../../../../utils/auth'
import { deleteLessonPrepWorkspace } from '../../../../../domain/lesson-prep-workspace'

/** 删除资料工作区：同时清理 runner 的临时文件，并把元数据标记为 deleted。 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  await deleteLessonPrepWorkspace(event, { id: user.id, schoolId: user.schoolId }, id)
  return { ok: true }
})

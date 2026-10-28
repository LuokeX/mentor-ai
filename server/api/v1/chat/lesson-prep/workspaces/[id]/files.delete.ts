import { z } from 'zod'
import { requireUser } from '../../../../../../utils/auth'
import { deleteLessonPrepFile } from '../../../../../../domain/lesson-prep-workspace'

/** 删除工作区中的一个资料文件；文件内容不落库，只删 runner 临时文件。 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const name = z.string().min(1).max(300).parse(getQuery(event).name)
  await deleteLessonPrepFile(event, { id: user.id, schoolId: user.schoolId }, id, name)
  return { ok: true }
})

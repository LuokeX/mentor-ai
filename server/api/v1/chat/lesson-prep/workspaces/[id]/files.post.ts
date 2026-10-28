import { z } from 'zod'
import { requireUser } from '../../../../../../utils/auth'
import { uploadLessonPrepFile } from '../../../../../../domain/lesson-prep-workspace'

/**
 * 上传一个备课资料。
 *
 * 使用原始 body + x-file-name 头（文件名 URL 编码），避免 multipart 解析；
 * 前端一次上传一个文件，类型/大小在 app 与 runner 双侧校验。
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))

  const rawName = getHeader(event, 'x-file-name')
  if (!rawName) throw createError({ statusCode: 400, message: '缺少文件名' })
  let name: string
  try {
    name = decodeURIComponent(rawName)
  } catch {
    throw createError({ statusCode: 400, message: '文件名不合法' })
  }

  const data = await readRawBody(event, false)
  if (!data || !Buffer.isBuffer(data)) throw createError({ statusCode: 400, message: '文件内容为空' })

  const file = await uploadLessonPrepFile(event, { id: user.id, schoolId: user.schoolId }, id, name, data)
  return { name: file.name, size: file.size }
})

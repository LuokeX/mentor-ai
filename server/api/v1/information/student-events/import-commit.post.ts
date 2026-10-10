import { z } from 'zod'
import { createHash } from 'node:crypto'
import { requireUser } from '../../../../utils/auth'
import { commitBusinessImport, parseImportWorkbookOrThrow } from '../../../../domain/information-import-io'

const bodySchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  contentBase64: z.string().min(1).max(2_900_000),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = bodySchema.parse(await readBody(event))
  const parsed = parseImportWorkbookOrThrow(event, 'student_events', body.contentBase64)
  const actualChecksum = createHash('sha256').update(Buffer.from(body.contentBase64, 'base64')).digest('hex')
  if (actualChecksum !== body.checksum || actualChecksum !== parsed.checksum) {
    throw createError({ statusCode: 409, message: '文件在预检后发生变化，请重新预检' })
  }
  const result = await commitBusinessImport(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    type: 'student_events',
    scope: { kind: 'teacher', userId: user.id },
    contentBase64: body.contentBase64,
  })
  if (!result.ok) {
    throw createError({ statusCode: 422, message: '文件内容已不满足导入条件，请重新预检' })
  }
  return { ok: true, totalRows: result.totalRows, created: result.created }
})

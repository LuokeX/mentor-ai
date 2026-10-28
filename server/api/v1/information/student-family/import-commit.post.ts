import { z } from 'zod'
import { createHash } from 'node:crypto'
import { requireUser } from '../../../../utils/auth'
import { commitStudentFamilyImport } from '../../../../domain/student-family-import-io'

const bodySchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  contentBase64: z.string().min(1).max(2_900_000),
  section: z.enum(['primary', 'junior']).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = bodySchema.parse(await readBody(event))
  const actualChecksum = createHash('sha256').update(Buffer.from(body.contentBase64, 'base64')).digest('hex')
  if (actualChecksum !== body.checksum) {
    throw createError({ statusCode: 409, message: '文件在预检后发生变化，请重新预检' })
  }
  const result = await commitStudentFamilyImport(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    scope: { kind: 'teacher', userId: user.id },
    contentBase64: body.contentBase64,
    expectedSection: body.section,
  })
  if (!result.ok) throw createError({ statusCode: 422, message: '文件内容已不满足导入条件，请重新预检' })
  return {
    ...result,
    created: result.studentsCreated,
    updated: result.studentsUpdated,
  }
})

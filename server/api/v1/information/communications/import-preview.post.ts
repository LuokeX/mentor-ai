import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { parseImportWorkbookOrThrow, previewBusinessImport } from '../../../../domain/information-import-io'

const bodySchema = z.object({
  contentBase64: z.string().min(1).max(2_900_000),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = bodySchema.parse(await readBody(event))
  const parsed = parseImportWorkbookOrThrow(event, 'communications', body.contentBase64)
  return previewBusinessImport(event, {
    schoolId: user.schoolId,
    type: 'communications',
    scope: { kind: 'teacher', userId: user.id },
    rows: parsed.rows,
    checksum: parsed.checksum,
  })
})

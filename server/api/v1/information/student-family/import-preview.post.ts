import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { parseStudentFamilyWorkbookOrThrow, previewStudentFamilyImport } from '../../../../domain/student-family-import-io'

const bodySchema = z.object({
  contentBase64: z.string().min(1).max(2_900_000),
  section: z.enum(['primary', 'junior']).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = bodySchema.parse(await readBody(event))
  const parsed = parseStudentFamilyWorkbookOrThrow(event, body.contentBase64, body.section)
  return previewStudentFamilyImport(event, {
    schoolId: user.schoolId,
    scope: { kind: 'teacher', userId: user.id },
    parsed,
  })
})

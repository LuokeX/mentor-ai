import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { validateSchoolImport } from '../../../../domain/school-imports'

const bodySchema = z.object({
  type: z.enum(['users', 'classes', 'students', 'guardians']),
  contentBase64: z.string().min(1).max(2_900_000)
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const body = bodySchema.parse(await readBody(event))
  let preview
  try { preview = await validateSchoolImport(event, { schoolId: admin.schoolId, ...body }) }
  catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_FILE'
    const messages: Record<string, string> = { FILE_TOO_LARGE: '文件不能超过 2 MB', TOO_MANY_ROWS: '单个文件不能超过 2,000 行', EMPTY_FILE: '文件为空' }
    throw createError({ statusCode: 422, message: messages[code] || '文件编码或格式不正确' })
  }
  const [record] = await useDb(event).insert(schema.schoolImports).values({
    schoolId: admin.schoolId, importType: body.type, checksum: preview.checksum,
    status: preview.errors.length ? 'invalid' : 'previewed', totalRows: preview.rows.length,
    errorCount: preview.errors.length, errors: preview.errors.map(item => ({ row: item.row, code: item.code })), createdBy: admin.id
  }).returning({ id: schema.schoolImports.id })
  return {
    previewId: record!.id, checksum: preview.checksum, encoding: preview.encoding,
    totalRows: preview.rows.length, validRows: preview.rows.length - new Set(preview.errors.map(item => item.row)).size,
    errors: preview.errors, sample: preview.rows.slice(0, 5)
  }
})

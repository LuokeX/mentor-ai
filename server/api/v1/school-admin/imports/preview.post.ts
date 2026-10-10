import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { SCHOOL_IMPORT_TYPES, validateSchoolImport } from '../../../../domain/school-imports'
import { isBusinessImportType, type ImportRowError } from '../../../../domain/information-imports'
import { parseImportWorkbookOrThrow, previewBusinessImport } from '../../../../domain/information-import-io'

const bodySchema = z.object({
  type: z.enum(SCHOOL_IMPORT_TYPES),
  contentBase64: z.string().min(1).max(2_900_000)
})

type PreviewPayload = {
  checksum: string
  encoding: string
  totalRows: number
  validRows: number
  errors: ImportRowError[]
  sample: Array<Record<string, unknown>>
}

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const body = bodySchema.parse(await readBody(event))
  let preview: PreviewPayload
  if (isBusinessImportType(body.type)) {
    // 家校沟通 / 学生事件记录：走信息中心的 xlsx 校验，范围是全校在册学生
    const parsed = parseImportWorkbookOrThrow(event, body.type, body.contentBase64)
    const result = await previewBusinessImport(event, {
      schoolId: admin.schoolId,
      type: body.type,
      scope: { kind: 'school' },
      rows: parsed.rows,
      checksum: parsed.checksum,
    })
    preview = { checksum: result.checksum, encoding: 'xlsx', totalRows: result.totalRows, validRows: result.validRows, errors: result.errors, sample: result.sample }
  } else {
    let validated
    try { validated = await validateSchoolImport(event, { schoolId: admin.schoolId, type: body.type, contentBase64: body.contentBase64 }) }
    catch (error) {
      const code = error instanceof Error ? error.message : 'INVALID_FILE'
      const messages: Record<string, string> = { FILE_TOO_LARGE: '文件不能超过 2 MB', TOO_MANY_ROWS: '单个文件不能超过 2,000 行', EMPTY_FILE: '文件为空' }
      throw createError({ statusCode: 422, message: messages[code] || '文件编码或格式不正确' })
    }
    preview = {
      checksum: validated.checksum,
      encoding: validated.encoding,
      totalRows: validated.rows.length,
      validRows: validated.rows.length - new Set(validated.errors.map(item => item.row)).size,
      errors: validated.errors,
      sample: validated.rows.slice(0, 5),
    }
  }
  const [record] = await useDb(event).insert(schema.schoolImports).values({
    schoolId: admin.schoolId, importType: body.type, checksum: preview.checksum,
    status: preview.errors.length ? 'invalid' : 'previewed', totalRows: preview.totalRows,
    errorCount: preview.errors.length, errors: preview.errors.map(item => ({ row: item.row, code: item.code })), createdBy: admin.id
  }).returning({ id: schema.schoolImports.id })
  return {
    previewId: record!.id, checksum: preview.checksum, encoding: preview.encoding,
    totalRows: preview.totalRows, validRows: preview.validRows,
    errors: preview.errors, sample: preview.sample
  }
})

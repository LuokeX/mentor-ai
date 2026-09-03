import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { loadGuardianDeps } from '../../../../domain/information-import-io'
import { parseWorkbookRows, validateGuardianRows } from '../../../../domain/information-imports'

const bodySchema = z.object({
  contentBase64: z.string().min(1).max(2_900_000),
})

const PARSE_MESSAGES: Record<string, string> = {
  EMPTY_FILE: '文件为空',
  FILE_TOO_LARGE: '文件不能超过 2 MB',
  TOO_MANY_ROWS: '单个文件不能超过 2,000 行',
  INVALID_XLSX: '文件编码或格式不正确，请使用提供的 Excel 模板',
  NO_DATA_SHEET: '文件中没有可解析的数据表（请使用提供的 Excel 模板）',
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = bodySchema.parse(await readBody(event))
  let parsed
  try {
    parsed = parseWorkbookRows('guardians', body.contentBase64)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_XLSX'
    throw createError({ statusCode: 422, message: PARSE_MESSAGES[code] || '文件编码或格式不正确' })
  }
  const deps = await loadGuardianDeps(event, user.id, user.schoolId)
  const { errors, resolved } = validateGuardianRows(parsed.rows, deps)
  return {
    checksum: parsed.checksum,
    totalRows: parsed.rows.length,
    validRows: resolved.length,
    errors,
    sample: resolved.slice(0, 5).map(item => ({ row: item.row, studentName: item.values.studentName, name: item.values.name, relation: item.values.relation })),
  }
})
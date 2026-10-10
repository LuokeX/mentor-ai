import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { commitSchoolImport, parseImportFile, SCHOOL_IMPORT_TYPES } from '../../../../domain/school-imports'
import { isBusinessImportType } from '../../../../domain/information-imports'
import { commitBusinessImport, parseImportWorkbookOrThrow } from '../../../../domain/information-import-io'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

const bodySchema = z.object({
  previewId: z.string().uuid(),
  type: z.enum(SCHOOL_IMPORT_TYPES),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  contentBase64: z.string().min(1).max(2_900_000)
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  if (!admin.schoolId) throw createError({ statusCode: 400, message: '管理员未关联学校' })
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  const [preview] = await db.select().from(schema.schoolImports).where(and(
    eq(schema.schoolImports.id, body.previewId), eq(schema.schoolImports.schoolId, admin.schoolId),
    eq(schema.schoolImports.importType, body.type), eq(schema.schoolImports.checksum, body.checksum), eq(schema.schoolImports.status, 'previewed')
  )).limit(1)
  if (!preview) throw createError({ statusCode: 409, message: '预检记录不存在、已提交或文件校验值不一致' })
  let actualChecksum: string
  if (isBusinessImportType(body.type)) {
    actualChecksum = parseImportWorkbookOrThrow(event, body.type, body.contentBase64).checksum
  } else {
    try { actualChecksum = parseImportFile(body.type, body.contentBase64).checksum }
    catch { throw createError({ statusCode: 422, message: '文件编码或格式不正确' }) }
  }
  if (actualChecksum !== body.checksum) throw createError({ statusCode: 409, message: '文件在预检后发生变化，请重新预检' })

  if (isBusinessImportType(body.type)) {
    // 家校沟通 / 学生事件记录：只新增记录，归属学生的负责教师
    const result = await commitBusinessImport(event, {
      schoolId: admin.schoolId,
      actorId: admin.id,
      type: body.type,
      scope: { kind: 'school' },
      contentBase64: body.contentBase64,
      previewId: preview.id,
    })
    if (!result.ok) throw createError({ statusCode: 422, message: '文件内容已不满足导入条件，请重新预检' })
    return {
      ok: true, importId: preview.id, totalRows: result.totalRows,
      created: result.created, updated: 0, skipped: 0,
      invitations: []
    }
  }

  const result = await commitSchoolImport(event, {
    schoolId: admin.schoolId,
    adminId: admin.id,
    previewId: preview.id,
    type: body.type,
    contentBase64: body.contentBase64,
  })
  if (result.errors.length) throw createError({ statusCode: 422, message: '文件内容已不满足导入条件，请重新预检', data: { errors: result.errors } })
  return {
    ok: true, importId: preview.id, totalRows: result.rows.length,
    created: result.created, updated: result.updated, skipped: result.skipped,
    invitations: result.invitations
  }
})

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { commitSchoolImport, parseImportFile } from '../../../../domain/school-imports'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'

const bodySchema = z.object({
  previewId: z.string().uuid(),
  type: z.enum(['users', 'classes', 'students', 'guardians']),
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
  try { actualChecksum = parseImportFile(body.type, body.contentBase64).checksum }
  catch { throw createError({ statusCode: 422, message: '文件编码或格式不正确' }) }
  if (actualChecksum !== body.checksum) throw createError({ statusCode: 409, message: '文件在预检后发生变化，请重新预检' })
  const result = await commitSchoolImport(event, { schoolId: admin.schoolId, adminId: admin.id, type: body.type, contentBase64: body.contentBase64 })
  if (result.errors.length) throw createError({ statusCode: 422, message: '文件内容已不满足导入条件，请重新预检', data: { errors: result.errors } })
  await db.update(schema.schoolImports).set({
    status: 'committed', createdRows: result.created, updatedRows: result.updated,
    skippedRows: result.skipped, errorCount: 0
  }).where(eq(schema.schoolImports.id, preview.id))
  await writeAudit(event, {
    schoolId: admin.schoolId, actorId: admin.id, action: 'school_admin.import.commit',
    targetType: 'school_import', targetId: preview.id,
    metadata: { type: body.type, totalRows: result.rows.length, created: result.created, updated: result.updated, skipped: result.skipped }
  })
  return {
    ok: true, importId: preview.id, totalRows: result.rows.length,
    created: result.created, updated: result.updated, skipped: result.skipped,
    invitations: result.invitations
  }
})

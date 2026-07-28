import { eq } from 'drizzle-orm'
import XLSX from 'xlsx'
import { requireUser } from '../../../../../../utils/auth'
import { schema, useDb } from '../../../../../../utils/db'
import { exportVersionToXlsx } from '../../../../../../domain/module-resource-export'
import type { LibraryType, ModuleId } from '../../../../../../../shared/contracts'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const id = getRouterParam(event, 'id') || ''

  const db = useDb(event)
  const [version] = await db.select({
    id: schema.moduleResourceVersions.id,
    version: schema.moduleResourceVersions.version,
    payload: schema.moduleResourceVersions.payload,
    module: schema.moduleResourceLibraries.module,
    libraryType: schema.moduleResourceLibraries.libraryType,
  })
    .from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(eq(schema.moduleResourceVersions.id, id))
    .limit(1)

  if (!version) throw createError({ statusCode: 404, message: '资源版本不存在' })

  const workbook = exportVersionToXlsx(
    version.libraryType as LibraryType,
    version.module as ModuleId,
    version.payload as Record<string, unknown>,
  )

  const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const filename = `${version.module}_${version.libraryType}_v${version.version}.xlsx`

  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)

  return xlsxBuffer
})
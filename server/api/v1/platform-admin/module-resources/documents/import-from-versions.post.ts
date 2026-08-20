import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { createDocumentWithChunks } from '../../../../../domain/module-resource-documents'
import { renderVersionDocument } from '../../../../../domain/module-resource-document-render'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { useDb, schema } from '../../../../../utils/db'
import { isUniqueConstraintError } from '../../../../../utils/db-helpers'

const importFromVersionsSchema = z.object({
  versionIds: z.array(z.string().uuid()).min(1).max(100)
})

type LibraryType = 'assessment' | 'attribution' | 'tool'
const SUPPORTED_LIBRARY_TYPES: ReadonlySet<string> = new Set<LibraryType>(['assessment', 'attribution', 'tool'])

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 160)
  return String(error).slice(0, 160)
}

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const parsed = importFromVersionsSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '参数不正确' })
  const { versionIds } = parsed.data
  const db = useDb(event)

  // 一次查出全部版本 + 库信息，再按 id 映射
  const rows = await db.select({
    id: schema.moduleResourceVersions.id,
    libraryId: schema.moduleResourceVersions.libraryId,
    version: schema.moduleResourceVersions.version,
    status: schema.moduleResourceVersions.status,
    payload: schema.moduleResourceVersions.payload,
    module: schema.moduleResourceLibraries.module,
    libraryType: schema.moduleResourceLibraries.libraryType,
    name: schema.moduleResourceLibraries.name
  })
    .from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(inArray(schema.moduleResourceVersions.id, versionIds))
  const versionById = new Map(rows.map(row => [row.id, row]))

  interface Detail {
    versionId: string
    title: string | null
    libraryName: string | null
    libraryType: string | null
    module: string | null
    version: string | null
    status: 'imported' | 'skipped' | 'failed'
    error?: string
  }

  const details: Detail[] = []
  const importedTitles: string[] = []
  let firstImportedId: string | undefined
  let imported = 0
  let skipped = 0
  let failed = 0

  // 串行处理：任一版本失败不阻断其余
  for (const versionId of versionIds) {
    const row = versionById.get(versionId)
    if (!row) {
      failed++
      details.push({ versionId, title: null, libraryName: null, libraryType: null, module: null, version: null, status: 'failed', error: '版本不存在' })
      continue
    }
    const base = {
      versionId,
      title: null as string | null,
      libraryName: row.name,
      libraryType: row.libraryType,
      module: row.module,
      version: row.version
    }
    if (row.status !== 'published') {
      failed++
      details.push({ ...base, status: 'failed', error: `版本未发布（当前状态：${row.status}）` })
      continue
    }
    if (!SUPPORTED_LIBRARY_TYPES.has(row.libraryType)) {
      failed++
      details.push({ ...base, status: 'failed', error: `不支持的库类型：${row.libraryType}（仅支持 assessment / attribution / tool）` })
      continue
    }

    const rendered = renderVersionDocument({
      libraryType: row.libraryType as LibraryType,
      module: row.module,
      libraryName: row.name,
      version: row.version,
      payload: row.payload
    })
    if (!rendered.content) {
      failed++
      details.push({ ...base, status: 'failed', error: '版本无可渲染内容' })
      continue
    }

    try {
      const created = await createDocumentWithChunks(db, {
        libraryId: row.libraryId,
        versionId: row.id,
        title: rendered.title,
        sourceType: 'markdown',
        content: rendered.content,
        metadata: {
          module: row.module,
          libraryType: row.libraryType,
          source: 'from_version',
          version: row.version
        },
        status: 'ready',
        createdBy: admin.id,
        event,
        sourceRef: row.id
      })
      imported++
      importedTitles.push(rendered.title)
      if (!firstImportedId) firstImportedId = created.id
      details.push({ ...base, title: rendered.title, status: 'imported' })
    } catch (error: any) {
      if (isUniqueConstraintError(error)) {
        skipped++
        details.push({ ...base, status: 'skipped', error: '已存在' })
      } else {
        failed++
        details.push({ ...base, status: 'failed', error: errorMessage(error) })
      }
    }
  }

  await writeAudit(event, {
    actorId: admin.id,
    action: 'platform_admin.module_resource_document.import_from_versions',
    targetType: 'module_resource_document',
    targetId: firstImportedId || undefined,
    metadata: { imported, skipped, failed, versionIds, importedTitles }
  })

  return { imported, skipped, failed, details }
})
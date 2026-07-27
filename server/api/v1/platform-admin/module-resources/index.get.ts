import { and, desc, eq } from 'drizzle-orm'
import { libraryTypeSchema, moduleIdSchema } from '../../../../../shared/contracts'
import type { Capability } from '../../../../../shared/management'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['platform_admin'])
  const query = getQuery(event)
  const module = typeof query.module === 'string' ? moduleIdSchema.optional().parse(query.module) : undefined
  const libraryType = typeof query.libraryType === 'string' ? libraryTypeSchema.optional().parse(query.libraryType) : undefined
  const conditions = []
  if (module) conditions.push(eq(schema.moduleResourceLibraries.module, module))
  if (libraryType) conditions.push(eq(schema.moduleResourceLibraries.libraryType, libraryType))
  const db = useDb(event)

  const [libraries, versions, documents] = await Promise.all([
    db.select().from(schema.moduleResourceLibraries)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.moduleResourceLibraries.updatedAt))
      .limit(200),
    db.select({
      id: schema.moduleResourceVersions.id,
      libraryId: schema.moduleResourceVersions.libraryId,
      version: schema.moduleResourceVersions.version,
      status: schema.moduleResourceVersions.status,
      notes: schema.moduleResourceVersions.notes,
      payload: schema.moduleResourceVersions.payload,
      publishedAt: schema.moduleResourceVersions.publishedAt,
      createdAt: schema.moduleResourceVersions.createdAt,
      updatedAt: schema.moduleResourceVersions.updatedAt,
    }).from(schema.moduleResourceVersions)
      .orderBy(desc(schema.moduleResourceVersions.updatedAt))
      .limit(500),
    db.select({
      id: schema.moduleResourceDocuments.id,
      libraryId: schema.moduleResourceDocuments.libraryId,
      versionId: schema.moduleResourceDocuments.versionId,
      title: schema.moduleResourceDocuments.title,
      sourceType: schema.moduleResourceDocuments.sourceType,
      originalFilename: schema.moduleResourceDocuments.originalFilename,
      status: schema.moduleResourceDocuments.status,
      metadata: schema.moduleResourceDocuments.metadata,
      createdAt: schema.moduleResourceDocuments.createdAt,
    }).from(schema.moduleResourceDocuments)
      .orderBy(desc(schema.moduleResourceDocuments.createdAt))
      .limit(500),
  ])

  // 平台管理员对所有资源拥有完整能力
  const capabilities: Capability[] = ['view', 'view_sensitive', 'create', 'edit', 'archive', 'restore']
  const librariesWithCaps = libraries.map(lib => ({ ...lib, _capabilities: capabilities }))

  return { libraries: librariesWithCaps, versions, documents }
})
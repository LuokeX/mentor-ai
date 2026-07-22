import { eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { assessmentDefinitions, moduleMeta } from '../shared/assessments'
import { libraryTypeSchema, moduleIdSchema, type LibraryType, type ModuleId } from '../shared/contracts'
import * as schema from '../server/db/schema'
import { loadLocalEnv } from './load-env'

type Db = ReturnType<typeof drizzle<typeof schema>>

loadLocalEnv()
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required; copy .env.example to .env first')

const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle(pool, { schema })

const [actor] = await db.select().from(schema.users).where(eq(schema.users.role, 'platform_admin')).limit(1)
if (!actor) throw new Error('Platform administrator is required before migrating resources')

const contentPackages = await db.select().from(schema.contentPackages).where(eq(schema.contentPackages.status, 'published'))
let migratedContentVersions = 0
for (const contentPackage of contentPackages) {
  for (const target of inferContentPackageTargets(contentPackage)) {
    const library = await ensureLibrary(db, {
      module: target.module,
      libraryType: target.libraryType,
      scope: 'global',
      schoolId: null,
      name: `${moduleMeta[target.module].title} · ${libraryTypeLabel(target.libraryType)}`,
      description: `由旧内容包 ${contentPackage.code} 迁移`
    })
    const existing = await db.query.moduleResourceVersions.findFirst({
      where: (versions, { and, eq }) => and(
        eq(versions.libraryId, library.id),
        eq(versions.sourceContentPackageId, contentPackage.id)
      )
    })
    if (existing) continue
    const [version] = await db.insert(schema.moduleResourceVersions).values({
      libraryId: library.id,
      version: contentPackage.version,
      status: 'draft',
      payload: contentPackage.payload,
      notes: `兼容迁移自 content_packages:${contentPackage.code}`,
      sourceContentPackageId: contentPackage.id,
      createdBy: actor.id
    }).returning()
    if (!version) throw new Error(`Failed to create resource version for ${contentPackage.code}`)
    await publishVersion(db, library.id, version.id, actor.id)
    migratedContentVersions++
  }
}

const knowledgeBases = await db.select().from(schema.knowledgeBases).where(eq(schema.knowledgeBases.status, 'published'))
const knowledgeDocuments = await db.select().from(schema.knowledgeDocuments).where(eq(schema.knowledgeDocuments.status, 'ready'))
const knowledgeChunks = await db.select().from(schema.knowledgeChunks)
const documentsByBase = new Map<string, typeof knowledgeDocuments>()
const chunksByDocument = new Map<string, typeof knowledgeChunks>()
for (const document of knowledgeDocuments) {
  const rows = documentsByBase.get(document.knowledgeBaseId) || []
  rows.push(document)
  documentsByBase.set(document.knowledgeBaseId, rows)
}
for (const chunk of knowledgeChunks) {
  const rows = chunksByDocument.get(chunk.documentId) || []
  rows.push(chunk)
  chunksByDocument.set(chunk.documentId, rows)
}

let migratedDocuments = 0
const knowledgeGroups = new Map<string, {
  module: ModuleId
  scope: 'global' | 'school'
  schoolId: string | null
  bases: typeof knowledgeBases
}>()
for (const knowledgeBase of knowledgeBases) {
  const modules = inferKnowledgeModules(knowledgeBase)
  for (const module of modules) {
    const key = `${module}:${knowledgeBase.scope}:${knowledgeBase.schoolId || 'global'}`
    const group = knowledgeGroups.get(key) || {
      module,
      scope: knowledgeBase.scope === 'school' ? 'school' : 'global',
      schoolId: knowledgeBase.schoolId,
      bases: []
    }
    group.bases.push(knowledgeBase)
    knowledgeGroups.set(key, group)
  }
}

for (const group of knowledgeGroups.values()) {
  const library = await ensureLibrary(db, {
    module: group.module,
    libraryType: 'professional_knowledge',
    scope: group.scope,
    schoolId: group.schoolId,
    name: `${moduleMeta[group.module].title} · 专业知识库`,
    description: '由旧知识库兼容迁移'
  })
  const existing = await db.query.moduleResourceVersions.findFirst({
    where: (versions, { and, eq }) => and(
      eq(versions.libraryId, library.id),
      eq(versions.version, 'legacy-knowledge-v1')
    )
  })
  const version = existing || (await db.insert(schema.moduleResourceVersions).values({
    libraryId: library.id,
    version: 'legacy-knowledge-v1',
    status: 'draft',
    payload: {
      migratedFrom: 'knowledge_bases',
      sourceKnowledgeBaseIds: group.bases.map(item => item.id)
    },
    notes: '兼容迁移自旧知识库',
    createdBy: actor.id
  }).returning())[0]
  if (!version) throw new Error(`Failed to create knowledge resource version for ${group.module}`)

  for (const knowledgeBase of group.bases) {
    for (const legacyDocument of documentsByBase.get(knowledgeBase.id) || []) {
      const [document] = await db.insert(schema.moduleResourceDocuments).values({
        libraryId: library.id,
        versionId: version.id,
        title: legacyDocument.title,
        sourceType: legacyDocument.sourceType,
        originalFilename: legacyDocument.originalFilename,
        mimeType: legacyDocument.mimeType,
        checksum: legacyDocument.checksum,
        status: 'ready',
        content: legacyDocument.content,
        metadata: {
          ...legacyDocument.metadata,
          migratedFrom: 'knowledge_documents',
          sourceKnowledgeBaseId: knowledgeBase.id,
          sourceKnowledgeDocumentId: legacyDocument.id
        },
        createdBy: actor.id
      }).onConflictDoNothing().returning()
      if (!document) continue
      const chunks = chunksByDocument.get(legacyDocument.id) || []
      if (chunks.length) {
        await db.insert(schema.moduleResourceChunks).values(chunks.map(chunk => ({
          libraryId: library.id,
          versionId: version.id,
          documentId: document.id,
          chunkIndex: chunk.chunkIndex,
          heading: chunk.heading,
          content: chunk.content,
          tokenEstimate: chunk.tokenEstimate,
          embedding: chunk.embedding,
          embeddingModel: chunk.embeddingModel,
          embeddedAt: chunk.embeddedAt,
          metadata: {
            ...chunk.metadata,
            migratedFrom: 'knowledge_chunks',
            sourceKnowledgeChunkId: chunk.id
          }
        }))).onConflictDoNothing()
      }
      migratedDocuments++
    }
  }
  await publishVersion(db, library.id, version.id, actor.id)
}

await db.insert(schema.auditLogs).values({
  actorId: actor.id,
  action: 'module_resources.compat_migrate',
  targetType: 'module_resource_library',
  metadata: {
    contentVersions: migratedContentVersions,
    documents: migratedDocuments,
    knowledgeGroups: knowledgeGroups.size
  }
})

await pool.end()
process.stdout.write(`Module resource migration complete: ${migratedContentVersions} content versions, ${migratedDocuments} documents\n`)

async function ensureLibrary(db: Db, input: {
  module: ModuleId
  libraryType: LibraryType
  scope: 'global' | 'school'
  schoolId: string | null
  name: string
  description: string
}) {
  const existing = input.scope === 'school'
    ? await db.query.moduleResourceLibraries.findFirst({
      where: (libraries, { and, eq }) => and(
        eq(libraries.module, input.module),
        eq(libraries.libraryType, input.libraryType),
        eq(libraries.scope, 'school'),
        eq(libraries.schoolId, input.schoolId!)
      )
    })
    : await db.query.moduleResourceLibraries.findFirst({
      where: (libraries, { and, eq, isNull }) => and(
        eq(libraries.module, input.module),
        eq(libraries.libraryType, input.libraryType),
        eq(libraries.scope, 'global'),
        isNull(libraries.schoolId)
      )
    })
  if (existing) return existing
  const [created] = await db.insert(schema.moduleResourceLibraries).values({
    module: input.module,
    libraryType: input.libraryType,
    scope: input.scope,
    schoolId: input.schoolId,
    name: input.name,
    description: input.description,
    createdBy: actor.id
  }).returning()
  if (!created) throw new Error(`Failed to create library ${input.module}/${input.libraryType}`)
  return created
}

async function publishVersion(db: Db, libraryId: string, versionId: string, actorId: string) {
  await db.transaction(async (tx) => {
    await tx.update(schema.moduleResourceVersions)
      .set({ status: 'retired', updatedAt: new Date() })
      .where(eq(schema.moduleResourceVersions.libraryId, libraryId))
    await tx.update(schema.moduleResourceVersions)
      .set({ status: 'published', publishedBy: actorId, publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.moduleResourceVersions.id, versionId))
  })
}

function inferContentPackageTargets(contentPackage: typeof schema.contentPackages.$inferSelect) {
  const payload = contentPackage.payload as { module?: unknown, modules?: unknown }
  const libraryType = inferLibraryType(contentPackage.type, contentPackage.code)
  if (!libraryType) return []

  const moduleFromPayload = moduleIdSchema.safeParse(payload.module)
  if (moduleFromPayload.success) return [{ module: moduleFromPayload.data, libraryType }]

  const modulesFromPayload = Array.isArray(payload.modules)
    ? payload.modules.map(item => moduleIdSchema.safeParse(item)).filter(item => item.success).map(item => item.data)
    : []
  if (modulesFromPayload.length) return modulesFromPayload.map(module => ({ module, libraryType }))

  const match = contentPackage.code.match(/(?:assessment|rules|tool|sop|prompt)-(.+)$/)
  const moduleFromCode = moduleIdSchema.safeParse(match?.[1])
  return moduleFromCode.success ? [{ module: moduleFromCode.data, libraryType }] : []
}

function inferLibraryType(type: string, code: string): LibraryType | null {
  const parsedType = libraryTypeSchema.safeParse(type)
  if (parsedType.success) return parsedType.data
  if (code.includes('rule')) return 'rules'
  if (code.includes('tool')) return 'tool'
  if (code.includes('sop')) return 'sop'
  if (code.includes('prompt')) return 'prompt'
  if (code.includes('assessment')) return 'assessment'
  return null
}

function inferKnowledgeModules(knowledgeBase: typeof schema.knowledgeBases.$inferSelect): ModuleId[] {
  const text = `${knowledgeBase.name}\n${knowledgeBase.description || ''}`.toLowerCase()
  const matched = Object.entries(moduleMeta)
    .filter(([module, meta]) =>
      text.includes(module)
      || text.includes(meta.title)
      || text.includes(meta.short)
      || moduleKeywordMap[module as ModuleId].some(keyword => text.includes(keyword))
    )
    .map(([module]) => moduleIdSchema.parse(module))
  return matched.length ? matched : Object.keys(assessmentDefinitions).map(module => moduleIdSchema.parse(module))
}

const moduleKeywordMap: Record<ModuleId, string[]> = {
  self_growth: ['自我', '成长', '压力', '倦怠', '教师状态'],
  class_system: ['班级', '班干部', '班风', '班级系统'],
  home_school: ['家校', '家长', '沟通', '合作'],
  student_case: ['学生个体', '个案', '行为', '情绪', '社交'],
  learning_problem: ['学习', '学业', '作业', '认知']
}

function libraryTypeLabel(type: LibraryType) {
  const labels: Record<LibraryType, string> = {
    assessment: '评估库',
    rules: '规则库',
    tool: '工具库',
    professional_knowledge: '专业知识库',
    sop: 'SOP',
    script: '话术库',
    case: '案例库',
    prompt: '提示词'
  }
  return labels[type]
}

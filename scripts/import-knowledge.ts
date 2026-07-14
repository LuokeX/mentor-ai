import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { knowledgeBases, knowledgeChunks, knowledgeDocuments, auditLogs, schools, users } from '../server/db/schema'
import { chunkKnowledgeDocument, checksumKnowledgeContent, normalizeKnowledgeContent } from '../server/domain/knowledge'
import { DEFAULT_EMBEDDING_MODEL, requestOllamaEmbeddings } from '../server/integrations/ollama'
import { loadLocalEnv } from './load-env'

loadLocalEnv()
const args = process.argv.slice(2)
const file = args.find(arg => !arg.startsWith('--'))
const option = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
if (!file || !args.includes('--confirm-no-personal-data')) {
  throw new Error('Usage: pnpm knowledge:import <file.md|txt|json> --confirm-no-personal-data [--name=知识库名] [--school-code=code] [--publish]')
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle(pool)
const actorEmail = option('actor-email') || 'platform.admin@demo.local'
const [actor] = await db.select().from(users).where(eq(users.email, actorEmail)).limit(1)
if (!actor || actor.role !== 'platform_admin') throw new Error(`Platform administrator not found: ${actorEmail}`)

const schoolCode = option('school-code')
const [school] = schoolCode ? await db.select().from(schools).where(eq(schools.code, schoolCode)).limit(1) : [undefined]
if (schoolCode && !school) throw new Error(`School not found: ${schoolCode}`)

const extension = extname(file).toLowerCase()
const sourceType = extension === '.json' ? 'json' : extension === '.txt' ? 'text' : ['.md', '.markdown'].includes(extension) ? 'markdown' : null
if (!sourceType) throw new Error('Only Markdown, TXT and JSON files are supported')
let content = normalizeKnowledgeContent(await readFile(file, 'utf8'))
if (sourceType === 'json') content = JSON.stringify(JSON.parse(content), null, 2)
if (content.length > 1_000_000) throw new Error('Document exceeds the 1 MB limit')
const chunks = chunkKnowledgeDocument(content)
const embeddingModel = process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL
let embeddings: number[][] | null = null
if (process.env.EMBEDDING_ENABLED === 'true') {
  try {
    embeddings = await requestOllamaEmbeddings({
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
      model: embeddingModel,
      timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS || 30_000)
    }, chunks.map(chunk => `${chunk.heading ? `${chunk.heading}\n` : ''}${chunk.content}`))
  } catch (error) {
    process.stderr.write(`Embedding unavailable; imported chunks will be reindexed later: ${error instanceof Error ? error.message : 'unknown'}\n`)
  }
}
const name = option('name') || basename(file, extension)
const scope = school ? 'school' : 'global'

const existingQuery = school
  ? and(eq(knowledgeBases.name, name), eq(knowledgeBases.scope, scope), eq(knowledgeBases.schoolId, school.id))
  : and(eq(knowledgeBases.name, name), eq(knowledgeBases.scope, scope), isNull(knowledgeBases.schoolId))
let [knowledgeBase] = await db.select().from(knowledgeBases).where(existingQuery).limit(1)
if (!knowledgeBase) [knowledgeBase] = await db.insert(knowledgeBases).values({
  name,
  description: `由 ${basename(file)} 导入`,
  scope,
  schoolId: school?.id || null,
  createdBy: actor.id
}).returning()
if (!knowledgeBase) throw new Error('Knowledge base creation failed')

const checksum = checksumKnowledgeContent(content)
const [existingDocument] = await db.select().from(knowledgeDocuments)
  .where(and(eq(knowledgeDocuments.knowledgeBaseId, knowledgeBase.id), eq(knowledgeDocuments.checksum, checksum))).limit(1)
if (!existingDocument) {
  await db.transaction(async (tx) => {
    const [document] = await tx.insert(knowledgeDocuments).values({
      knowledgeBaseId: knowledgeBase.id,
      title: basename(file, extension),
      sourceType,
      originalFilename: basename(file),
      mimeType: sourceType === 'json' ? 'application/json' : sourceType === 'markdown' ? 'text/markdown' : 'text/plain',
      checksum,
      status: args.includes('--publish') ? 'ready' : 'draft',
      content,
      metadata: { characterCount: content.length, chunkCount: chunks.length, embeddedChunkCount: embeddings?.length || 0, embeddingStatus: embeddings ? 'ready' : 'pending', importedBy: 'cli' },
      createdBy: actor.id
    }).returning()
    if (!document) throw new Error('Document creation failed')
    await tx.insert(knowledgeChunks).values(chunks.map((chunk, index) => ({
      knowledgeBaseId: knowledgeBase.id,
      documentId: document.id,
      ...chunk,
      embedding: embeddings?.[index],
      embeddingModel: embeddings ? embeddingModel : null,
      embeddedAt: embeddings ? new Date() : null
    })))
  })
}

if (args.includes('--publish')) await db.update(knowledgeBases).set({
  status: 'published', publishedBy: actor.id, publishedAt: new Date(), updatedAt: new Date()
}).where(eq(knowledgeBases.id, knowledgeBase.id))
await db.insert(auditLogs).values({
  schoolId: school?.id || null,
  actorId: actor.id,
  action: 'platform_admin.knowledge_document.cli_import',
  targetType: 'knowledge_base',
  targetId: knowledgeBase.id,
  metadata: { filename: basename(file), chunks: chunks.length, published: args.includes('--publish') }
})

await pool.end()
process.stdout.write(`Knowledge import complete: ${name}, ${chunks.length} chunks, ${args.includes('--publish') ? 'published' : 'draft'}\n`)

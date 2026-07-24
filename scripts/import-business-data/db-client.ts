// 数据库客户端：封装 PostgreSQL 直连 + API 调用，用于导入脚本
import { createHash } from 'crypto'
import pg from 'pg'
import { readFileSync } from 'fs'

// 读取 .env 中的 DATABASE_URL
function loadEnv(): string {
  try {
    const envContent = readFileSync('.env', 'utf-8')
    const match = envContent.match(/DATABASE_URL\s*=\s*(.+)/)
    if (match) return match[1]!.trim()
  } catch {}
  // fallback: 从其他 seed 脚本的默认值
  return 'postgres://mentor_admin:e99ed52b2799dba76638a35842c5841f4781407d4b2ab755e5244fd939078c89@localhost:5432/mentor_ai'
}

let pool: pg.Pool | null = null
let actorId: string | null = null

export function getDb(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: loadEnv() })
  }
  return pool
}

export async function getImportActorId(): Promise<string> {
  if (actorId) return actorId
  const db = getDb()
  const result = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE role = 'platform_admin' ORDER BY created_at ASC LIMIT 1`
  )
  const id = result.rows[0]?.id
  if (!id) throw new Error('未找到 platform_admin 账号，请先运行本地 seed 或创建平台管理员')
  actorId = id
  return actorId
}

export async function findOrCreateLibrary(
  module: string,
  libraryType: string,
  name: string,
  description: string = ''
): Promise<string> {
  const db = getDb()
  const scope = 'global'

  const existing = await db.query(
    `SELECT id FROM module_resource_libraries WHERE module = $1 AND library_type = $2 AND scope = $3 AND school_id IS NULL LIMIT 1`,
    [module, libraryType, scope]
  )

  if (existing.rows.length > 0) {
    return existing.rows[0].id as string
  }

  const result = await db.query(
    `INSERT INTO module_resource_libraries (module, library_type, name, description, scope, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [module, libraryType, name, description, scope, await getImportActorId()]
  )

  return result.rows[0].id as string
}

export async function createVersion(libraryId: string, version: string, payload: object, notes: string = ''): Promise<string> {
  const db = getDb()
  const result = await db.query(
    `INSERT INTO module_resource_versions (library_id, version, payload, notes, status, created_by)
     VALUES ($1, $2, $3, $4, 'draft', $5) RETURNING id`,
    [libraryId, version, JSON.stringify(payload), notes, await getImportActorId()]
  )
  return result.rows[0].id as string
}

export async function publishVersion(versionId: string): Promise<void> {
  const db = getDb()
  const actor = await getImportActorId()
  await db.query(
    `UPDATE module_resource_versions SET status = 'published', published_by = $2, published_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [versionId, actor]
  )
  await db.query(
    `UPDATE module_resource_documents SET status = 'ready', updated_at = NOW() WHERE version_id = $1 AND status = 'draft'`,
    [versionId]
  )
}

export async function createSearchableDocument(input: {
  libraryId: string
  versionId: string
  title: string
  content: string
  metadata?: Record<string, unknown>
  embeddings?: number[][]
  embeddingModel?: string
}): Promise<void> {
  const db = getDb()
  const normalized = input.content.replace(/\r\n?/g, '\n').replace(/\0/g, '').trim()
  if (!normalized) return
  const chunks = chunkText(normalized)
  if (!chunks.length) return
  const embedModel = input.embeddingModel || null
  const hasEmbeddings = Array.isArray(input.embeddings) && input.embeddings.length === chunks.length
  await db.query('BEGIN')
  try {
    const document = await db.query<{ id: string }>(
      `INSERT INTO module_resource_documents
        (library_id, version_id, title, source_type, mime_type, checksum, status, content, metadata, created_by)
       VALUES ($1, $2, $3, 'text', 'text/plain', $4, 'draft', $5, $6, $7)
       ON CONFLICT (version_id, checksum) DO NOTHING
       RETURNING id`,
      [
        input.libraryId,
        input.versionId,
        input.title,
        createHash('sha256').update(normalized).digest('hex'),
        normalized,
        JSON.stringify({
          characterCount: normalized.length,
          chunkCount: chunks.length,
          embeddedChunkCount: hasEmbeddings ? chunks.length : 0,
          embeddingStatus: hasEmbeddings ? 'ready' : 'pending',
          ...(input.metadata || {})
        }),
        await getImportActorId()
      ]
    )
    const documentId = document.rows[0]?.id
    if (documentId) {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!
        await db.query(
          `INSERT INTO module_resource_chunks
            (library_id, version_id, document_id, chunk_index, heading, content, token_estimate, embedding, embedding_model, embedded_at, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (document_id, chunk_index) DO NOTHING`,
          [
            input.libraryId,
            input.versionId,
            documentId,
            chunk.chunkIndex,
            chunk.heading,
            chunk.content,
            chunk.tokenEstimate,
            hasEmbeddings ? `[${input.embeddings![i]!.join(',')}]` : null,
            hasEmbeddings ? embedModel : null,
            hasEmbeddings ? new Date() : null,
            JSON.stringify(input.metadata || {})
          ]
        )
      }
    }
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}

export function chunkText(content: string, maxChars = 1200) {
  const paragraphs = content.split(/\n{2,}/).map(item => item.trim()).filter(Boolean)
  const chunks: Array<{ chunkIndex: number; heading: string | null; content: string; tokenEstimate: number }> = []
  let heading: string | null = null
  let buffer = ''
  const push = () => {
    const value = buffer.trim()
    if (!value) return
    chunks.push({ chunkIndex: chunks.length, heading, content: value, tokenEstimate: Math.ceil(value.length / 2) })
    buffer = ''
  }
  for (const paragraph of paragraphs) {
    const headingMatch = paragraph.match(/^#{1,6}\s+(.+)$/m)
    if (headingMatch?.[1] && paragraph.length < 300) heading = headingMatch[1].trim()
    if (paragraph.length > maxChars) {
      push()
      for (let start = 0; start < paragraph.length; start += maxChars - 120) {
        buffer = paragraph.slice(start, start + maxChars)
        push()
      }
      continue
    }
    if (buffer && buffer.length + paragraph.length + 2 > maxChars) push()
    buffer += `${buffer ? '\n\n' : ''}${paragraph}`
  }
  push()
  return chunks
}

export async function end(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

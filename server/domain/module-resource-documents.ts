import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { eq, sql } from 'drizzle-orm'
import { embedModuleResourceChunks } from '../integrations/embeddings'
import { schema } from '../utils/db'
import type { DrizzleDB } from './module-resource-knowledge-search'

export interface ModuleResourceChunkInput {
  chunkIndex: number
  heading: string | null
  content: string
  tokenEstimate: number
  // 从文档级透传到每个 chunk，用于检索过滤和结果展示
  documentTitle?: string
  sourceType?: string
  sourceRef?: string
  tags?: string[]
}

export function normalizeModuleResourceContent(value: string) {
  return value.replace(/\r\n?/g, '\n').replace(/\0/g, '').trim()
}

export function checksumModuleResourceContent(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function chunkModuleResourceDocument(raw: string, maxChars = 1300): ModuleResourceChunkInput[] {
  const content = normalizeModuleResourceContent(raw)
  if (!content) return []
  const paragraphs = content.split(/\n{2,}/).map(item => item.trim()).filter(Boolean)
  const chunks: ModuleResourceChunkInput[] = []
  let heading: string | null = null
  let buffer = ''

  const push = () => {
    const value = buffer.trim()
    if (!value) return
    chunks.push({
      chunkIndex: chunks.length,
      heading,
      content: value,
      tokenEstimate: Math.ceil(value.length / 2)
    })
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

export interface CreateDocumentWithChunksInput {
  libraryId: string | null
  versionId: string | null
  title: string
  sourceType: string
  content: string
  metadata: Record<string, unknown>
  status: string
  createdBy: string
  /**
   * 提供 event 时用默认 embedModuleResourceChunks(event, ...) 生成向量；
   * 否则可用 embedInput 注入自定义 embedding 逻辑；
   * 两者都没有时 embedding 置 null（metadata.embeddingStatus 为 'disabled'）。
   */
  event?: H3Event
  embedInput?: EmbedInput
  /** 无 event 时写入切块的向量模型名（脚本侧导入用），避免后续 reindex 误判为未索引。 */
  embeddingModel?: string
  originalFilename?: string | null
  mimeType?: string | null
  tags?: string[]
  sourceRef?: string | null
}

type EmbedInput = (chunks: Array<{ heading: string | null; content: string }>) => Promise<(number[] | null)[] | null>

interface PreparedDocumentChunks {
  content: string
  chunks: ModuleResourceChunkInput[]
  embeddings: (number[] | null)[] | null
  embeddingStatus: string
  embeddingModel: string | null
}

/**
 * normalize → chunk → embed，并算出文档级 metadata 需要的计数与状态。
 * 创建与「正文更新」共用，保证两条路径写出的 metadata 形状一致。
 */
async function prepareDocumentChunks(input: {
  content: string
  event?: H3Event
  embedInput?: EmbedInput
  embeddingModel?: string
  /** 出错时把原因挂到文档 metadata，便于在后台看到「为什么这篇没向量」 */
  onEmbeddingError?: (message: string) => void
}): Promise<PreparedDocumentChunks> {
  const content = normalizeModuleResourceContent(input.content)
  const chunks = chunkModuleResourceDocument(content)
  if (!chunks.length) throw new Error('文档没有可导入内容')

  const embedInputs = chunks.map(chunk => `${chunk.heading ? `${chunk.heading}\n` : ''}${chunk.content}`)

  let embeddings: (number[] | null)[] | null = null
  try {
    embeddings = input.embedInput
      ? await input.embedInput(chunks.map(chunk => ({ heading: chunk.heading, content: chunk.content })))
      : input.event
        ? await embedModuleResourceChunks(input.event, embedInputs)
        : null
  } catch (error) {
    input.onEmbeddingError?.(error instanceof Error ? error.message.slice(0, 160) : 'embedding_failed')
  }

  // 无 event 时无法读取运行时配置：提供过 embedInput 视为已启用 embedding，否则视为禁用
  const embeddingEnabled = input.event
    ? Boolean(useRuntimeConfig(input.event).embeddingEnabled)
    : Boolean(input.embedInput)
  const embeddingModel = input.event
    ? String(useRuntimeConfig(input.event).embeddingModel)
    : (input.embeddingModel ?? null)

  return {
    content,
    chunks,
    embeddings,
    embeddingModel,
    embeddingStatus: embeddings?.some(Boolean)
      ? 'ready'
      : embeddingEnabled
        ? 'pending'
        : 'disabled'
  }
}

/** 只属于文档行、不写进切块 metadata 的键：切块 metadata 只保留检索过滤与展示用的字段。 */
const CHUNK_METADATA_EXCLUDED_KEYS = new Set([
  'notes', 'characterCount', 'chunkCount', 'embeddedChunkCount', 'embeddingStatus', 'embeddingError'
])

function documentMetadata(input: {
  metadata: Record<string, unknown>
  title: string
  sourceType: string
  tags?: string[]
  sourceRef?: string | null
}) {
  const chunkMetadata: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input.metadata)) {
    if (CHUNK_METADATA_EXCLUDED_KEYS.has(key)) continue
    chunkMetadata[key] = value
  }
  return {
    ...chunkMetadata,
    documentTitle: input.title,
    sourceType: input.sourceType,
    tags: input.tags ?? [],
    sourceRef: input.sourceRef ?? null
  }
}

/**
 * normalize → chunk → embed → 单事务写入 documents + chunks。
 * 与 server/api/v1/platform-admin/module-resources/documents/index.post.ts
 * 原实现口径一致：metadata 写入 characterCount / chunkCount /
 * embeddedChunkCount / embeddingStatus（+ embeddingError），
 * chunk metadata 透传 input.metadata 并追加 documentTitle / sourceType / tags / sourceRef。
 */
export async function createDocumentWithChunks(db: DrizzleDB, input: CreateDocumentWithChunksInput): Promise<{ id: string; chunks: number; embedded: number }> {
  let embeddingError: string | null = null
  const prepared = await prepareDocumentChunks({
    content: input.content,
    event: input.event,
    embedInput: input.embedInput,
    embeddingModel: input.embeddingModel,
    onEmbeddingError: (message) => { embeddingError = message }
  })

  const document = await db.transaction(async (tx) => {
    const [created] = await tx.insert(schema.moduleResourceDocuments).values({
      libraryId: input.libraryId,
      versionId: input.versionId,
      title: input.title,
      sourceType: input.sourceType,
      originalFilename: input.originalFilename ?? null,
      mimeType: input.mimeType ?? null,
      checksum: checksumModuleResourceContent(prepared.content),
      status: input.status,
      content: prepared.content,
      metadata: {
        ...input.metadata,
        characterCount: prepared.content.length,
        chunkCount: prepared.chunks.length,
        embeddedChunkCount: prepared.embeddings?.filter(Boolean).length || 0,
        embeddingStatus: prepared.embeddingStatus,
        ...(embeddingError ? { embeddingError } : {})
      },
      createdBy: input.createdBy
    }).returning()
    if (!created) throw new Error('文档创建失败')
    await tx.insert(schema.moduleResourceChunks).values(prepared.chunks.map((chunk, index) => ({
      libraryId: input.libraryId,
      versionId: input.versionId,
      documentId: created.id,
      ...chunk,
      embedding: prepared.embeddings?.[index],
      embeddingModel: prepared.embeddings?.[index] ? prepared.embeddingModel : null,
      embeddedAt: prepared.embeddings?.[index] ? new Date() : null,
      metadata: documentMetadata({
        metadata: input.metadata,
        title: input.title,
        sourceType: input.sourceType,
        tags: input.tags,
        sourceRef: input.sourceRef
      })
    })))
    return created
  })

  return {
    id: document.id,
    chunks: prepared.chunks.length,
    embedded: prepared.embeddings?.filter(Boolean).length || 0
  }
}

export interface UpdateDocumentContentInput {
  documentId: string
  title: string
  sourceType: string
  content: string
  /** 文档级 metadata（整块替换为「旧值 + 本次导入字段」的合并结果，由调用方算好） */
  metadata: Record<string, unknown>
  tags?: string[]
  sourceRef?: string | null
  event?: H3Event
  embedInput?: EmbedInput
  embeddingModel?: string
}

/**
 * 正文有改动时的更新：重切块 + 重新向量化，文档 ID 不变。
 * 单事务内替换全部切块；向量化失败不阻断写入，置 pending 由 resources:reindex 兜底。
 */
export async function updateDocumentContentWithChunks(db: DrizzleDB, input: UpdateDocumentContentInput) {
  let embeddingError: string | null = null
  const prepared = await prepareDocumentChunks({
    content: input.content,
    event: input.event,
    embedInput: input.embedInput,
    embeddingModel: input.embeddingModel,
    onEmbeddingError: (message) => { embeddingError = message }
  })

  const result = await db.transaction(async (tx) => {
    await tx.delete(schema.moduleResourceChunks)
      .where(eq(schema.moduleResourceChunks.documentId, input.documentId))
    await tx.update(schema.moduleResourceDocuments)
      .set({
        title: input.title,
        sourceType: input.sourceType,
        checksum: checksumModuleResourceContent(prepared.content),
        content: prepared.content,
        metadata: {
          ...input.metadata,
          characterCount: prepared.content.length,
          chunkCount: prepared.chunks.length,
          embeddedChunkCount: prepared.embeddings?.filter(Boolean).length || 0,
          embeddingStatus: prepared.embeddingStatus,
          ...(embeddingError ? { embeddingError } : {})
        },
        updatedAt: new Date()
      })
      .where(eq(schema.moduleResourceDocuments.id, input.documentId))
    await tx.insert(schema.moduleResourceChunks).values(prepared.chunks.map((chunk, index) => ({
      libraryId: null,
      versionId: null,
      documentId: input.documentId,
      ...chunk,
      embedding: prepared.embeddings?.[index],
      embeddingModel: prepared.embeddings?.[index] ? prepared.embeddingModel : null,
      embeddedAt: prepared.embeddings?.[index] ? new Date() : null,
      metadata: documentMetadata({
        metadata: input.metadata,
        title: input.title,
        sourceType: input.sourceType,
        tags: input.tags,
        sourceRef: input.sourceRef
      })
    })))
    return prepared
  })

  return {
    chunks: result.chunks.length,
    embedded: result.embeddings?.filter(Boolean).length || 0
  }
}

export interface UpdateDocumentMetadataInput {
  documentId: string
  /** 标题有改动时同步文档行（切块 metadata 只用于检索过滤，展示标题取文档行） */
  title?: string
  sourceType?: string
  /** 文档级 metadata 补丁（jsonb 合并，不是整块替换） */
  metadata: Record<string, unknown>
  /** 切块级 metadata 补丁：检索按切块读 module / applicableSchoolSection，必须同步 */
  chunkMetadata: Record<string, unknown>
}

/**
 * 正文没变、只有标题/标签/学段/出处/备注等元数据变化时走这里：不重切块、不重新向量化。
 */
export async function updateDocumentMetadata(db: DrizzleDB, input: UpdateDocumentMetadataInput) {
  const documentPatch = JSON.stringify(input.metadata)
  const chunkPatch = JSON.stringify(input.chunkMetadata)
  await db.transaction(async (tx) => {
    await tx.update(schema.moduleResourceDocuments)
      .set({
        ...(input.title ? { title: input.title } : {}),
        ...(input.sourceType ? { sourceType: input.sourceType } : {}),
        metadata: sql<Record<string, unknown>>`${schema.moduleResourceDocuments.metadata} || ${documentPatch}::jsonb`,
        updatedAt: new Date()
      })
      .where(eq(schema.moduleResourceDocuments.id, input.documentId))
    await tx.update(schema.moduleResourceChunks)
      .set({ metadata: sql<Record<string, unknown>>`${schema.moduleResourceChunks.metadata} || ${chunkPatch}::jsonb` })
      .where(eq(schema.moduleResourceChunks.documentId, input.documentId))
  })
}

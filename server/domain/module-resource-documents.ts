import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
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
  embedInput?: (chunks: Array<{ heading: string | null; content: string }>) => Promise<(number[] | null)[] | null>
  originalFilename?: string | null
  mimeType?: string | null
  tags?: string[]
  sourceRef?: string | null
}

/**
 * normalize → chunk → embed → 单事务写入 documents + chunks。
 * 与 server/api/v1/platform-admin/module-resources/documents/index.post.ts
 * 原实现口径一致：metadata 写入 characterCount / chunkCount /
 * embeddedChunkCount / embeddingStatus（+ embeddingError），
 * chunk metadata 透传 input.metadata 并追加 documentTitle / sourceType / tags / sourceRef。
 */
export async function createDocumentWithChunks(db: DrizzleDB, input: CreateDocumentWithChunksInput): Promise<{ id: string; chunks: number; embedded: number }> {
  const content = normalizeModuleResourceContent(input.content)
  const chunks = chunkModuleResourceDocument(content)
  if (!chunks.length) throw new Error('文档没有可导入内容')

  const embedInputs = chunks.map(chunk => `${chunk.heading ? `${chunk.heading}\n` : ''}${chunk.content}`)

  let embeddings: (number[] | null)[] | null = null
  let embeddingError: string | null = null
  try {
    embeddings = input.embedInput
      ? await input.embedInput(chunks.map(chunk => ({ heading: chunk.heading, content: chunk.content })))
      : input.event
        ? await embedModuleResourceChunks(input.event, embedInputs)
        : null
  } catch (error) {
    embeddingError = error instanceof Error ? error.message.slice(0, 160) : 'embedding_failed'
  }

  // 无 event 时无法读取运行时配置：提供过 embedInput 视为已启用 embedding，否则视为禁用
  const embeddingEnabled = input.event
    ? Boolean(useRuntimeConfig(input.event).embeddingEnabled)
    : Boolean(input.embedInput)
  const embeddingModel = input.event ? String(useRuntimeConfig(input.event).embeddingModel) : null

  const embeddingStatus = embeddings?.some(Boolean)
    ? 'ready'
    : embeddingEnabled
      ? 'pending'
      : 'disabled'

  const document = await db.transaction(async (tx) => {
    const [created] = await tx.insert(schema.moduleResourceDocuments).values({
      libraryId: input.libraryId,
      versionId: input.versionId,
      title: input.title,
      sourceType: input.sourceType,
      originalFilename: input.originalFilename ?? null,
      mimeType: input.mimeType ?? null,
      checksum: checksumModuleResourceContent(content),
      status: input.status,
      content,
      metadata: {
        ...input.metadata,
        characterCount: content.length,
        chunkCount: chunks.length,
        embeddedChunkCount: embeddings?.filter(Boolean).length || 0,
        embeddingStatus,
        ...(embeddingError ? { embeddingError } : {})
      },
      createdBy: input.createdBy
    }).returning()
    if (!created) throw new Error('文档创建失败')
    await tx.insert(schema.moduleResourceChunks).values(chunks.map((chunk, index) => ({
      libraryId: input.libraryId,
      versionId: input.versionId,
      documentId: created.id,
      ...chunk,
      embedding: embeddings?.[index],
      embeddingModel: embeddings?.[index] ? embeddingModel : null,
      embeddedAt: embeddings?.[index] ? new Date() : null,
      metadata: {
        ...input.metadata,
        documentTitle: input.title,
        sourceType: input.sourceType,
        tags: input.tags ?? [],
        sourceRef: input.sourceRef ?? null
      }
    })))
    return created
  })

  return {
    id: document.id,
    chunks: chunks.length,
    embedded: embeddings?.filter(Boolean).length || 0
  }
}

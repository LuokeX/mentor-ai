import { parseKnowledgeSheets, type KnowledgeEntry } from '../../../../../domain/module-resource-file-import'
import { chunkModuleResourceDocument, checksumModuleResourceContent, normalizeModuleResourceContent } from '../../../../../domain/module-resource-documents'
import { embedModuleResourceChunks } from '../../../../../integrations/embeddings'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { schema, useDb } from '../../../../../utils/db'
import { z } from 'zod'
import XLSX from 'xlsx'
import type { ModuleId } from '../../../../../../shared/contracts'

const batchImportSchema = z.object({
  contentBase64: z.string().min(4).max(16_000_000),
  filename: z.string().trim().min(1).max(260),
  defaultModule: z.string().optional().default('self_growth')
})

// 说明类工作表不参与数据解析；模板实际使用「填写说明」，比「使用说明」更常见
const IGNORED_SHEET_PATTERN = /填写说明|使用说明|字段映射|说明页/i

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const parsed = batchImportSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '参数不正确' })
  const body = parsed.data
  const db = useDb(event)

  // 解析 XLSX：直接使用 parseKnowledgeSheets（不依赖三库运营台 pipeline）
  let documents: KnowledgeEntry[] = []
  let parsedSheets: Array<{ name: string, rows: Array<Record<string, string | undefined>> }> = []
  try {
    const buffer = Buffer.from(body.contentBase64, 'base64')
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    parsedSheets = workbook.SheetNames
      .filter(name => !IGNORED_SHEET_PATTERN.test(name))
      .map((name) => {
        const sheet = workbook.Sheets[name]
        const raw = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: undefined }) : []
        const headerIndex = inferHeaderRow(raw)
        const headers = (raw[headerIndex] || []).map(v => String(v ?? '').trim()).filter(Boolean)
        const rows: Record<string, string | undefined>[] = []
        for (let i = headerIndex + 1; i < raw.length; i++) {
          const row = raw[i]
          if (!row || row.every(v => v === undefined || v === null || String(v).trim() === '')) continue
          const item: Record<string, string | undefined> = {}
          for (let j = 0; j < headers.length; j++) {
            const value = row[j]
            item[headers[j]!] = value === undefined || value === null ? undefined : String(value).trim()
          }
          rows.push(item)
        }
        return { name, rows }
      })
      .filter(sheet => sheet.rows.length > 0)
    documents = parseKnowledgeSheets(parsedSheets, body.defaultModule as ModuleId)
  } catch (error: any) {
    throw createError({ statusCode: 400, message: error?.message || '文件解析失败' })
  }

  if (!documents.length) {
    // 0 篇时给出可操作的诊断：可用工作表、行数、表头列，而不是一句笼统提示
    const sheetSummary = parsedSheets.length
      ? parsedSheets.map(sheet => {
          const headers = Object.keys(sheet.rows[0] || {}).slice(0, 6).join('/')
          return `「${sheet.name}」${sheet.rows.length} 行${headers ? `（列：${headers}）` : '（未检测到表头）'}`
        }).join('；')
      : '无（说明类工作表已忽略）'
    throw createError({
      statusCode: 400,
      message: `文件中没有可导入的知识文档。检测到数据工作表：${sheetSummary}。请确认数据在「知识文档」工作表中，且每行包含「文档标题」「文档内容」列。`
    })
  }

  const now = new Date()
  const config = useRuntimeConfig(event)

  // 逐文档生成 chunk 和 embedding
  interface PreparedDoc {
    title: string
    module: ModuleId
    sourceType: string
    tags: string[]
    content: string
    sourceRef?: string
    notes?: string
    checksum: string
    chunks: Array<{
      chunkIndex: number
      heading: string | null
      content: string
      tokenEstimate: number
      embedding: number[] | null
    }>
  }

  const prepared: PreparedDoc[] = []
  let totalChunks = 0
  let embeddedChunks = 0

  for (const doc of documents) {
    const content = normalizeModuleResourceContent(doc.content)
    if (!content) continue
    const chunks = chunkModuleResourceDocument(content)
    if (!chunks.length) continue

    // 向量化由统一入口按供应商自动分片：单批失败只影响该批，不会让整篇文档失去向量
    const texts = chunks.map(c => `${c.heading ? `${c.heading}\n` : ''}${c.content}`)
    const embeddings = await embedModuleResourceChunks(event, texts)

    prepared.push({
      title: doc.title,
      module: doc.module,
      sourceType: doc.sourceType,
      tags: doc.tags,
      content,
      sourceRef: doc.sourceRef,
      notes: doc.notes,
      checksum: checksumModuleResourceContent(content),
      chunks: chunks.map((chunk, i) => ({
        chunkIndex: chunk.chunkIndex,
        heading: chunk.heading,
        content: chunk.content,
        tokenEstimate: chunk.tokenEstimate,
        embedding: embeddings?.[i] ?? null
      }))
    })
    totalChunks += chunks.length
    embeddedChunks += (embeddings ?? []).filter(Boolean).length
  }

  if (!prepared.length) {
    throw createError({
      statusCode: 400,
      message: '所有文档均无可导入内容。请检查「文档内容」列是否填写完整（仅标题或仅有空白内容会被跳过）。'
    })
  }

  // 事务写入
  const importedDocIds: string[] = []
  await db.transaction(async (tx) => {
    for (const doc of prepared) {
      const [created] = await tx.insert(schema.moduleResourceDocuments).values({
        libraryId: null,
        versionId: null,
        title: doc.title,
        sourceType: doc.sourceType,
        checksum: doc.checksum,
        status: 'draft',
        content: doc.content,
        metadata: {
          module: doc.module,
          libraryType: 'knowledge',
          characterCount: doc.content.length,
          chunkCount: doc.chunks.length,
          embeddedChunkCount: doc.chunks.filter(c => c.embedding).length,
          embeddingStatus: config.embeddingEnabled ? (doc.chunks.some(c => c.embedding) ? 'ready' : 'pending') : 'disabled',
          tags: doc.tags,
          sourceRef: doc.sourceRef ?? null,
          notes: doc.notes ?? null
        },
        createdBy: admin.id
      }).returning()
      if (!created) throw new Error('文档创建失败')

      await tx.insert(schema.moduleResourceChunks).values(doc.chunks.map(chunk => ({
        libraryId: null,
        versionId: null,
        documentId: created.id,
        chunkIndex: chunk.chunkIndex,
        heading: chunk.heading,
        content: chunk.content,
        tokenEstimate: chunk.tokenEstimate,
        embedding: chunk.embedding as any,
        embeddingModel: chunk.embedding ? String(config.embeddingModel) : null,
        embeddedAt: chunk.embedding ? now : null,
        metadata: {
          module: doc.module,
          libraryType: 'knowledge',
          documentTitle: doc.title,
          sourceType: doc.sourceType,
          tags: doc.tags,
          sourceRef: doc.sourceRef ?? null
        }
      })))
      importedDocIds.push(created.id)
    }
  })

  await writeAudit(event, {
    actorId: admin.id,
    action: 'platform_admin.module_resource_document.batch_import',
    targetType: 'module_resource_document',
    targetId: importedDocIds[0]!,
    metadata: {
      importedCount: importedDocIds.length,
      totalChunks,
      embeddedChunks,
      filename: body.filename,
      defaultModule: body.defaultModule
    }
  })

  return {
    imported: importedDocIds.length,
    filteredOut: documents.length - importedDocIds.length,
    totalChunks,
    embeddedChunks
  }
})

function inferHeaderRow(rows: unknown[][]) {
  const hints = [
    '文档标题', '所属模块', '来源类型', '标签关键词', '文档内容', '来源出处',
    'title', 'module', 'sourceType', 'tags', 'content'
  ]
  let bestIndex = 0
  let bestScore = -1
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const values = (rows[i] || []).map(v => String(v ?? '').trim()).filter(Boolean)
    const score = values.reduce((sum, v) => {
      const normalized = v.toLowerCase()
      return sum + hints.reduce((s, hint) => s + (normalized.includes(hint.toLowerCase()) ? 1 : 0), 0)
    }, 0)
    if (score > bestScore) { bestIndex = i; bestScore = score }
  }
  return bestScore > 0 ? bestIndex : 0
}
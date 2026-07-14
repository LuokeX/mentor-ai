import { eq } from 'drizzle-orm'
import { knowledgeDocumentImportSchema } from '../../../../../../shared/contracts'
import { chunkKnowledgeDocument, checksumKnowledgeContent, normalizeKnowledgeContent } from '../../../../../domain/knowledge'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { schema, useDb } from '../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const id = getRouterParam(event, 'id') || ''
  const parsed = knowledgeDocumentImportSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '文档参数不正确' })
  const body = parsed.data
  const db = useDb(event)
  const [knowledgeBase] = await db.select().from(schema.knowledgeBases).where(eq(schema.knowledgeBases.id, id)).limit(1)
  if (!knowledgeBase) throw createError({ statusCode: 404, message: '知识库不存在' })

  let content = normalizeKnowledgeContent(body.content)
  if (body.sourceType === 'json') {
    try { content = JSON.stringify(JSON.parse(content), null, 2) } catch { throw createError({ statusCode: 400, message: 'JSON 文档格式不正确' }) }
  }
  const chunks = chunkKnowledgeDocument(content)
  if (!chunks.length) throw createError({ statusCode: 400, message: '文档没有可导入内容' })

  try {
    const document = await db.transaction(async (tx) => {
      const [created] = await tx.insert(schema.knowledgeDocuments).values({
        knowledgeBaseId: knowledgeBase.id,
        title: body.title,
        sourceType: body.sourceType,
        originalFilename: body.originalFilename,
        mimeType: body.mimeType,
        checksum: checksumKnowledgeContent(content),
        status: 'draft',
        content,
        metadata: { characterCount: content.length, chunkCount: chunks.length },
        createdBy: admin.id
      }).returning()
      if (!created) throw new Error('文档创建失败')
      await tx.insert(schema.knowledgeChunks).values(chunks.map(chunk => ({
        knowledgeBaseId: knowledgeBase.id,
        documentId: created.id,
        ...chunk
      })))
      return created
    })
    await writeAudit(event, {
      actorId: admin.id,
      schoolId: knowledgeBase.schoolId,
      action: 'platform_admin.knowledge_document.import',
      targetType: 'knowledge_document',
      targetId: document.id,
      metadata: { knowledgeBaseId: knowledgeBase.id, chunks: chunks.length, sourceType: body.sourceType }
    })
    return { ...document, chunkCount: chunks.length }
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '该知识库中已经存在内容相同的文档' })
    throw error
  }
})

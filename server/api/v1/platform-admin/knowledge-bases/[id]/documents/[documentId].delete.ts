import { and, eq } from 'drizzle-orm'
import { requireUser } from '../../../../../../utils/auth'
import { writeAudit } from '../../../../../../utils/audit'
import { schema, useDb } from '../../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const id = getRouterParam(event, 'id') || ''
  const documentId = getRouterParam(event, 'documentId') || ''
  const db = useDb(event)

  const [knowledgeBase] = await db.select().from(schema.knowledgeBases)
    .where(eq(schema.knowledgeBases.id, id)).limit(1)
  if (!knowledgeBase) throw createError({ statusCode: 404, message: '知识库不存在' })

  const [document] = await db.select().from(schema.knowledgeDocuments).where(and(
    eq(schema.knowledgeDocuments.id, documentId),
    eq(schema.knowledgeDocuments.knowledgeBaseId, id)
  )).limit(1)
  if (!document) throw createError({ statusCode: 404, message: '文档不存在' })
  if (knowledgeBase.status === 'published') {
    throw createError({ statusCode: 409, message: '请先停用知识库，再删除已发布文档' })
  }

  await db.delete(schema.knowledgeDocuments).where(eq(schema.knowledgeDocuments.id, documentId))
  await writeAudit(event, {
    actorId: admin.id,
    schoolId: knowledgeBase.schoolId,
    action: 'platform_admin.knowledge_document.delete',
    targetType: 'knowledge_document',
    targetId: document.id,
    metadata: { knowledgeBaseId: id, title: document.title, status: document.status }
  })
  return { success: true }
})

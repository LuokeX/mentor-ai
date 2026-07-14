import { and, eq } from 'drizzle-orm'
import { knowledgeBaseActionSchema } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const id = getRouterParam(event, 'id') || ''
  const body = knowledgeBaseActionSchema.parse(await readBody(event))
  const db = useDb(event)
  const [knowledgeBase] = await db.select().from(schema.knowledgeBases).where(eq(schema.knowledgeBases.id, id)).limit(1)
  if (!knowledgeBase) throw createError({ statusCode: 404, message: '知识库不存在' })

  if (body.action === 'publish') {
    const [document] = await db.select({ id: schema.knowledgeDocuments.id }).from(schema.knowledgeDocuments)
      .where(and(eq(schema.knowledgeDocuments.knowledgeBaseId, id), eq(schema.knowledgeDocuments.status, 'draft'))).limit(1)
    const [existing] = await db.select({ id: schema.knowledgeDocuments.id }).from(schema.knowledgeDocuments)
      .where(eq(schema.knowledgeDocuments.knowledgeBaseId, id)).limit(1)
    if (!existing) throw createError({ statusCode: 400, message: '知识库至少需要一份文档才能发布' })
    await db.transaction(async (tx) => {
      if (document) await tx.update(schema.knowledgeDocuments).set({ status: 'ready', updatedAt: new Date() })
        .where(and(eq(schema.knowledgeDocuments.knowledgeBaseId, id), eq(schema.knowledgeDocuments.status, 'draft')))
      await tx.update(schema.knowledgeBases).set({
        status: 'published', publishedBy: admin.id, publishedAt: new Date(),
        version: knowledgeBase.status === 'published' ? knowledgeBase.version + 1 : knowledgeBase.version,
        updatedAt: new Date()
      }).where(eq(schema.knowledgeBases.id, id))
    })
  } else {
    await db.update(schema.knowledgeBases).set({
      status: body.action === 'archive' ? 'archived' : 'draft',
      updatedAt: new Date()
    }).where(eq(schema.knowledgeBases.id, id))
  }

  await writeAudit(event, {
    actorId: admin.id,
    schoolId: knowledgeBase.schoolId,
    action: `platform_admin.knowledge_base.${body.action}`,
    targetType: 'knowledge_base',
    targetId: knowledgeBase.id,
    metadata: { previousStatus: knowledgeBase.status }
  })
  const [updated] = await db.select().from(schema.knowledgeBases).where(eq(schema.knowledgeBases.id, id)).limit(1)
  return updated
})

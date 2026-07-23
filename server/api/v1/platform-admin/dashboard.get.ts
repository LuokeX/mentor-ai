import { desc, eq } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const db = useDb(event)
  const [schoolRows, packages, knowledgeBases, knowledgeDocuments, requests, grants, delegatedGrants, audits] = await Promise.all([
    db.select().from(schema.schools).orderBy(desc(schema.schools.createdAt)),
    db.select().from(schema.contentPackages).orderBy(desc(schema.contentPackages.createdAt)),
    db.select().from(schema.knowledgeBases).orderBy(desc(schema.knowledgeBases.updatedAt)),
    db.select({
      id: schema.knowledgeDocuments.id,
      knowledgeBaseId: schema.knowledgeDocuments.knowledgeBaseId,
      title: schema.knowledgeDocuments.title,
      sourceType: schema.knowledgeDocuments.sourceType,
      originalFilename: schema.knowledgeDocuments.originalFilename,
      status: schema.knowledgeDocuments.status,
      metadata: schema.knowledgeDocuments.metadata,
      createdAt: schema.knowledgeDocuments.createdAt
    }).from(schema.knowledgeDocuments).orderBy(desc(schema.knowledgeDocuments.createdAt)),
    db.select().from(schema.adminAccessRequests).where(eq(schema.adminAccessRequests.requesterId, admin.id)).orderBy(desc(schema.adminAccessRequests.createdAt)),
    db.select().from(schema.adminAccessGrants).where(eq(schema.adminAccessGrants.userId, admin.id)).orderBy(desc(schema.adminAccessGrants.createdAt)),
    db.select().from(schema.delegatedManagementGrants).where(eq(schema.delegatedManagementGrants.requesterId, admin.id)).orderBy(desc(schema.delegatedManagementGrants.createdAt)),
    db.select({
      id: schema.auditLogs.id,
      schoolId: schema.auditLogs.schoolId,
      actorId: schema.auditLogs.actorId,
      actorName: schema.users.name,
      action: schema.auditLogs.action,
      targetType: schema.auditLogs.targetType,
      targetId: schema.auditLogs.targetId,
      result: schema.auditLogs.result,
      metadata: schema.auditLogs.metadata,
      ipAddress: schema.auditLogs.ipAddress,
      createdAt: schema.auditLogs.createdAt
    }).from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorId))
      .where(eq(schema.auditLogs.actorId, admin.id)).orderBy(desc(schema.auditLogs.createdAt)).limit(50)
  ])
  return { schools: schoolRows, contentPackages: packages, knowledgeBases, knowledgeDocuments, accessRequests: requests, accessGrants: grants, delegatedManagementGrants: delegatedGrants, auditLogs: audits, health: { database: 'healthy', modelConfigured: Boolean(useRuntimeConfig(event).deepseekApiKey), embeddingEnabled: Boolean(useRuntimeConfig(event).embeddingEnabled), embeddingModel: useRuntimeConfig(event).embeddingModel, smsProvider: useRuntimeConfig(event).smsProvider } }
})

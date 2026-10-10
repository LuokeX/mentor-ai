import { desc, eq } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { userHasAnyRole } from '../../../domain/user-roles'

/**
 * 显式标注返回类型。不标注时 Nitro 会把整行 Drizzle 类型与运行时配置类型内联进
 * 路由响应（`.nuxt/types/nitro-routes.d.ts` 的 `Simplify<Serialize<...>>`），
 * 消费端 useFetch 在开发态类型检查里会报 “Type instantiation is excessively deep”。
 * 这里只暴露总览页真正用到的字段。
 */
interface PlatformAdminDashboardPayload {
  schools: Array<Pick<typeof schema.schools.$inferSelect, 'id' | 'name' | 'code' | 'status' | 'createdAt'>>
  accessRequests: Array<Pick<typeof schema.adminAccessRequests.$inferSelect, 'id' | 'targetType' | 'targetId' | 'status' | 'expiresAt' | 'createdAt'>>
  accessGrants: Array<Pick<typeof schema.adminAccessGrants.$inferSelect, 'id' | 'targetType' | 'targetId' | 'expiresAt' | 'revokedAt' | 'createdAt'>>
  userTotal: number
  auditLogs: Array<Pick<typeof schema.auditLogs.$inferSelect, 'id' | 'schoolId' | 'actorId' | 'action' | 'targetType' | 'targetId' | 'result' | 'ipAddress' | 'createdAt'> & { actorName: string | null }>
  health: {
    database: string
    modelConfigured: boolean
    embeddingEnabled: boolean
    embeddingModel: string
    smsProvider: string
  }
}

export default defineEventHandler(async (event): Promise<PlatformAdminDashboardPayload> => {
  const admin = await requireUser(event, ['platform_admin'])
  const db = useDb(event)
  const [schoolRows, requests, grants, userCount, audits] = await Promise.all([
    db.select().from(schema.schools).orderBy(desc(schema.schools.createdAt)),
    db.select().from(schema.adminAccessRequests).where(eq(schema.adminAccessRequests.requesterId, admin.id)).orderBy(desc(schema.adminAccessRequests.createdAt)),
    db.select().from(schema.adminAccessGrants).where(eq(schema.adminAccessGrants.userId, admin.id)).orderBy(desc(schema.adminAccessGrants.createdAt)),
    // 账号规模口径：教师/心理专员身份以 user_roles 判定，兼任账号也要计入
    db.select({ value: schema.users.id }).from(schema.users).where(userHasAnyRole(db, ['teacher', 'psychologist'])),
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
  return { schools: schoolRows, accessRequests: requests, accessGrants: grants, userTotal: userCount.length, auditLogs: audits, health: { database: 'healthy', modelConfigured: Boolean(useRuntimeConfig(event).deepseekApiKey), embeddingEnabled: Boolean(useRuntimeConfig(event).embeddingEnabled), embeddingModel: useRuntimeConfig(event).embeddingModel, smsProvider: useRuntimeConfig(event).smsProvider } }
})

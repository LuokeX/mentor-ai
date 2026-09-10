import { gte, sql } from 'drizzle-orm'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

/** AI 管理中心概览：模型配置（环境变量与代码默认，只读）、近 7 天调用统计、治理概览。 */
export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const db = useDb(event)
  const config = useRuntimeConfig(event)

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [summary] = await db.select({
    total: sql<number>`count(*)::int as "total"`,
    success: sql<number>`count(*) filter (where ${schema.aiModelCalls.status} = 'success')::int as "success"`,
    failed: sql<number>`count(*) filter (where ${schema.aiModelCalls.status} = 'failed')::int as "failed"`,
    avgLatencyMs: sql<number>`coalesce(round(avg(${schema.aiModelCalls.latencyMs})), 0)::int as "avgLatencyMs"`
  }).from(schema.aiModelCalls).where(gte(schema.aiModelCalls.createdAt, since))

  const byPurpose = await db.select({
    purpose: schema.aiModelCalls.purpose,
    total: sql<number>`count(*)::int as "total"`,
    failed: sql<number>`count(*) filter (where ${schema.aiModelCalls.status} = 'failed')::int as "failed"`
  }).from(schema.aiModelCalls)
    .where(gte(schema.aiModelCalls.createdAt, since))
    .groupBy(schema.aiModelCalls.purpose)
    .orderBy(sql`"total" desc`)

  const recentCalls = await db.select({
    id: schema.aiModelCalls.id,
    schoolId: schema.aiModelCalls.schoolId,
    schoolName: schema.schools.name,
    purpose: schema.aiModelCalls.purpose,
    model: schema.aiModelCalls.model,
    status: schema.aiModelCalls.status,
    latencyMs: schema.aiModelCalls.latencyMs,
    errorCode: schema.aiModelCalls.errorCode,
    createdAt: schema.aiModelCalls.createdAt
  }).from(schema.aiModelCalls)
    .leftJoin(schema.schools, sql`${schema.schools.id} = ${schema.aiModelCalls.schoolId}`)
    .orderBy(sql`${schema.aiModelCalls.createdAt} desc`)
    .limit(20)

  const byDataMode = await db.select({
    dataMode: schema.schoolSettings.aiDataMode,
    total: sql<number>`count(*)::int as "total"`
  }).from(schema.schoolSettings)
    .groupBy(schema.schoolSettings.aiDataMode)

  return {
    models: {
      routerModel: { env: config.deepseekRouterModel, effective: config.deepseekRouterModel },
      generatorModel: { env: config.deepseekGeneratorModel, effective: config.deepseekGeneratorModel },
      timeoutMs: { env: Number(config.deepseekTimeoutMs) || 30000, effective: Number(config.deepseekTimeoutMs) || 30000 },
      embeddingModel: { env: config.embeddingModel, effective: config.embeddingModel },
      embeddingEnabled: { env: Boolean(config.embeddingEnabled), effective: Boolean(config.embeddingEnabled) }
    },
    keys: {
      deepseekApiKey: { configured: Boolean(config.deepseekApiKey), note: '密钥仅存于环境变量，不入库' },
      deepseekBaseUrl: config.deepseekBaseUrl,
      agreementVersion: config.deepseekAgreementVersion || '未登记协议版本（full_context 门禁关闭）'
    },
    stats7d: { ...summary, byPurpose },
    recentCalls,
    governance: { byDataMode }
  }
})
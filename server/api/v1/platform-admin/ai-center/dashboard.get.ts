import { and, eq, gte, sql } from 'drizzle-orm'
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

  // 近 7 天工具调用统计：只按事件里的工具名/状态聚合，不含参数与返回正文
  const toolStats = await db.select({
    name: sql<string>`coalesce(${schema.productEvents.metadata}->>'tool', 'unknown')`,
    total: sql<number>`count(*)::int`,
    failed: sql<number>`count(*) filter (where coalesce(${schema.productEvents.metadata}->>'status', 'success') in ('error', 'timeout'))::int`
  }).from(schema.productEvents)
    .where(and(
      eq(schema.productEvents.eventName, 'assistant_tool_called'),
      gte(schema.productEvents.createdAt, since)
    ))
    .groupBy(sql`coalesce(${schema.productEvents.metadata}->>'tool', 'unknown')`)
    .orderBy(sql`count(*) desc`)
    .limit(20)

  const [quality] = await db.select({
    completed: sql<number>`count(*) filter (where event_name = 'assistant_turn_completed')::int`,
    failed: sql<number>`count(*) filter (where event_name = 'assistant_answer_failed' and metadata->>'qualityVersion' = '1')::int`,
    blocked: sql<number>`count(*) filter (where event_name = 'assistant_answer_blocked')::int`,
    toolTotal: sql<number>`count(*) filter (where event_name = 'assistant_tool_called')::int`,
    toolTimeouts: sql<number>`count(*) filter (where event_name = 'assistant_tool_called' and metadata->>'status' = 'timeout')::int`,
    knowledgeGaps: sql<number>`count(*) filter (where event_name = 'assistant_knowledge_gap')::int`,
    p95LatencyMs: sql<number>`coalesce(percentile_cont(0.95) within group (order by (metadata->>'latencyMs')::numeric) filter (where event_name = 'assistant_turn_completed'), 0)::int`,
    p95FirstTextMs: sql<number>`coalesce(percentile_cont(0.95) within group (order by (metadata->>'firstTextMs')::numeric) filter (where event_name = 'assistant_turn_completed' and metadata->>'reviewed' = 'false'), 0)::int`
  }).from(schema.productEvents).where(gte(schema.productEvents.createdAt, since))
  const [tokens] = await db.select({
    input: sql<number>`coalesce(sum(${schema.aiModelCalls.promptTokens}), 0)::float8`,
    output: sql<number>`coalesce(sum(${schema.aiModelCalls.completionTokens}), 0)::float8`
  }).from(schema.aiModelCalls).where(and(gte(schema.aiModelCalls.createdAt, since), sql`${schema.aiModelCalls.purpose} in ('assistant_chat', 'assistant_evidence_review', 'assistant_answer_repair')`))
  const reasons = await db.execute<{ reason: string; total: number }>(sql`
    select reason, count(*)::int as total from assistant_feedback f
    cross join lateral jsonb_array_elements_text(f.reasons) as reason
    where f.updated_at >= ${since} and f.rating = 'not_helpful'
    group by reason order by total desc limit 5
  `)
  const totalTurns = (quality?.completed ?? 0) + (quality?.failed ?? 0)

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
    stats7d: { ...summary, byPurpose, tools: toolStats, quality: { ...quality, failureRate: totalTurns ? (quality?.failed ?? 0) / totalTurns : null, blockedRate: totalTurns ? (quality?.blocked ?? 0) / totalTurns : null, timeoutRate: quality?.toolTotal ? quality.toolTimeouts / quality.toolTotal : null, tokens, reasons: reasons.rows } },
    recentCalls,
    governance: { byDataMode }
  }
})
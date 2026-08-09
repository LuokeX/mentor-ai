import { getAiRuntimeConfig } from '../../../../domain/ai-config'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'

/** 模型与服务配置：env 默认（只读）+ DB 覆盖值对照。 */
export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const config = useRuntimeConfig(event)
  const runtime = await getAiRuntimeConfig(event)
  const db = useDb(event)
  const [row] = await db.select({ id: schema.aiRuntimeSettings.id }).from(schema.aiRuntimeSettings).limit(1)

  return {
    initialized: Boolean(row),
    values: {
      routerModel: { env: config.deepseekRouterModel, override: runtime.routerModel, effective: runtime.routerModel || config.deepseekRouterModel },
      generatorModel: { env: config.deepseekGeneratorModel, override: runtime.generatorModel, effective: runtime.generatorModel || config.deepseekGeneratorModel },
      timeoutMs: { env: Number(config.deepseekTimeoutMs) || 30000, override: runtime.timeoutMs, effective: runtime.timeoutMs || Number(config.deepseekTimeoutMs) || 30000 },
      embeddingModel: { env: config.embeddingModel, override: runtime.embeddingModel, effective: runtime.embeddingModel || config.embeddingModel },
      embeddingEnabled: { env: Boolean(config.embeddingEnabled), override: runtime.embeddingEnabled, effective: runtime.embeddingEnabled ?? Boolean(config.embeddingEnabled) }
    },
    envOnly: {
      deepseekApiKey: { configured: Boolean(config.deepseekApiKey) },
      deepseekBaseUrl: config.deepseekBaseUrl,
      agreementVersion: config.deepseekAgreementVersion,
      ollamaBaseUrl: config.ollamaBaseUrl,
      embeddingTimeoutMs: Number(config.embeddingTimeoutMs) || 8000
    }
  }
})
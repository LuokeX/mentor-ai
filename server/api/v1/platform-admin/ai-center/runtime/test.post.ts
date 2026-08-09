import { getAiRuntimeConfig } from '../../../../../domain/ai-config'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'

/** DeepSeek 连通性测试：最小 chat/completions 请求，返回延迟/错误（不落 ai_model_calls 审计）。 */
export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const config = useRuntimeConfig(event)
  const runtime = await getAiRuntimeConfig(event)
  const generatorModel = runtime.generatorModel || config.deepseekGeneratorModel

  if (!config.deepseekApiKey) {
    return { ok: false, error: '未配置 DEEPSEEK_API_KEY（环境变量只读，无法在此配置）' }
  }
  const startedAt = Date.now()
  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: generatorModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        thinking: { type: 'disabled' }
      }),
      signal: AbortSignal.timeout(runtime.timeoutMs || Number(config.deepseekTimeoutMs) || 30000)
    })
    const latencyMs = Date.now() - startedAt
    const ok = response.ok
    await writeAudit(event, {
      actorId: admin.id,
      action: 'platform_admin.ai_center.runtime.test',
      targetType: 'ai_runtime_settings',
      result: ok ? 'success' : 'failure',
      metadata: { model: generatorModel, baseUrl: config.deepseekBaseUrl, status: response.status, latencyMs }
    })
    return ok
      ? { ok: true, latencyMs, model: generatorModel }
      : { ok: false, status: response.status, error: `DeepSeek 返回 ${response.status}`, latencyMs }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const message = error instanceof Error ? error.message : '未知错误'
    await writeAudit(event, {
      actorId: admin.id,
      action: 'platform_admin.ai_center.runtime.test',
      targetType: 'ai_runtime_settings',
      result: 'failure',
      metadata: { model: generatorModel, error: message.slice(0, 200), latencyMs }
    })
    return { ok: false, error: message, latencyMs }
  }
})
import { agentTools } from '../../../../agent/tools'
import { requireUser } from '../../../../utils/auth'

/**
 * Agent 代码默认值（与环境变量一并构成运行时配置的唯一来源）：
 *  - 采样温度与 server/integrations/models.ts 的默认温度一致；
 *  - 轮次上限与启用工具清单来自 AI_AGENT_MAX_TOOL_ROUNDS / AI_AGENT_ENABLED_TOOLS（见 nuxt.config.ts）。
 */
const AGENT_TEMPERATURE = 0.35

/**
 * 模型与服务配置（只读）。
 *
 * 运行时参数只来自环境变量与代码默认值：数据库 ai_runtime_settings 已弃用，不再读取，
 * 因此这里不再有「库内覆盖」一栏，只展示环境变量值与实际生效值。
 * Agent 行为要点随代码发布（server/agent/prompts.ts 的 buildFormatInstruction），不在此展示。
 * 提示词正文见 ai-center/prompts。
 */
export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const config = useRuntimeConfig(event)

  const timeoutMs = Number(config.deepseekTimeoutMs) || 30000
  const embeddingEnabled = Boolean(config.embeddingEnabled)
  const maxToolRounds = Number(config.agentMaxToolRounds) || 8
  const enabledToolsRaw = String(config.agentEnabledTools || '').trim()
  const enabledToolNames = enabledToolsRaw
    ? enabledToolsRaw.split(',').map(name => name.trim()).filter(Boolean)
    : null
  const allToolNames = agentTools.map(tool => tool.name)
  const effectiveToolNames = enabledToolNames
    ? allToolNames.filter(name => enabledToolNames.includes(name))
    : allToolNames

  return {
    values: {
      routerModel: { env: config.deepseekRouterModel, effective: config.deepseekRouterModel, source: 'env' },
      generatorModel: { env: config.deepseekGeneratorModel, effective: config.deepseekGeneratorModel, source: 'env' },
      timeoutMs: { env: timeoutMs, effective: timeoutMs, source: 'env' },
      embeddingModel: { env: config.embeddingModel, effective: config.embeddingModel, source: 'env' },
      embeddingEnabled: { env: embeddingEnabled, effective: embeddingEnabled, source: 'env' },
      agentMaxRounds: { env: maxToolRounds, effective: maxToolRounds, source: 'env' },
      agentTemperature: { env: AGENT_TEMPERATURE, effective: AGENT_TEMPERATURE, source: 'code' },
      agentTools: { env: enabledToolNames, effective: effectiveToolNames, source: enabledToolNames ? 'env' : 'code' }
    },
    /** 代码注册的全部只读工具：不配置启用清单时按上下文裁剪后全部生效。 */
    agentToolNames: allToolNames,
    /** 启用清单生效后实际可用的工具（按上下文裁剪前的全集口径）。 */
    agentEnabledToolNames: effectiveToolNames,
    envOnly: {
      deepseekApiKey: { configured: Boolean(config.deepseekApiKey) },
      deepseekBaseUrl: config.deepseekBaseUrl,
      agreementVersion: config.deepseekAgreementVersion,
      ollamaBaseUrl: config.ollamaBaseUrl,
      embeddingTimeoutMs: Number(config.embeddingTimeoutMs) || 8000
    }
  }
})

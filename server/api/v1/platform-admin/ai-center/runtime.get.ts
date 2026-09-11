import { agentTools } from '../../../../agent/tools'
import { requireUser } from '../../../../utils/auth'

/**
 * Agent 代码默认值（与环境变量一并构成运行时配置的唯一来源）：
 *  - 轮次上限与 server/agent/graph.ts 的 MAX_TOOL_ROUNDS 一致；
 *  - 采样温度与 server/integrations/models.ts 的默认温度一致。
 */
const AGENT_MAX_ROUNDS = 6
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

  return {
    values: {
      routerModel: { env: config.deepseekRouterModel, effective: config.deepseekRouterModel, source: 'env' },
      generatorModel: { env: config.deepseekGeneratorModel, effective: config.deepseekGeneratorModel, source: 'env' },
      timeoutMs: { env: timeoutMs, effective: timeoutMs, source: 'env' },
      embeddingModel: { env: config.embeddingModel, effective: config.embeddingModel, source: 'env' },
      embeddingEnabled: { env: embeddingEnabled, effective: embeddingEnabled, source: 'env' },
      agentMaxRounds: { env: AGENT_MAX_ROUNDS, effective: AGENT_MAX_ROUNDS, source: 'code' },
      agentTemperature: { env: AGENT_TEMPERATURE, effective: AGENT_TEMPERATURE, source: 'code' },
      agentTools: { env: null, effective: null, source: 'code' }
    },
    /** 代码注册的全部只读工具：不配置启用清单时按上下文裁剪后全部生效。 */
    agentToolNames: agentTools.map(tool => tool.name),
    envOnly: {
      deepseekApiKey: { configured: Boolean(config.deepseekApiKey) },
      deepseekBaseUrl: config.deepseekBaseUrl,
      agreementVersion: config.deepseekAgreementVersion,
      ollamaBaseUrl: config.ollamaBaseUrl,
      embeddingTimeoutMs: Number(config.embeddingTimeoutMs) || 8000
    }
  }
})

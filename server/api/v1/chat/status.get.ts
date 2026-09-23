import { requireUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['teacher'])
  const config = useRuntimeConfig(event)
  // 语音能力只看部署侧是否就绪（总开关 + DashScope 密钥）；学校数据模式是逐请求门禁，
  // 在语音接口里按 local 拒绝，这里不返回（避免前端把「环境可用」误读成「本校可用」）。
  const speechReady = Boolean(config.speechEnabled && config.dashscopeApiKey)
  return {
    provider: 'deepseek',
    modelConfigured: Boolean(config.deepseekApiKey),
    mode: config.deepseekApiKey ? 'deepseek' : 'local_fallback',
    purpose: 'triage',
    guardrail: 'AI 只做分诊建议；正式方案由量表、归因库和工具库确定性生成。',
    speech: {
      asr: speechReady,
      tts: speechReady
    }
  }
})

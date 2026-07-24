import { requireUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['teacher'])
  return {
    provider: 'deepseek',
    modelConfigured: Boolean(useRuntimeConfig(event).deepseekApiKey),
    mode: useRuntimeConfig(event).deepseekApiKey ? 'deepseek' : 'local_fallback',
    purpose: 'triage',
    guardrail: 'AI 只做分诊建议；正式方案由量表、归因库和工具库确定性生成。'
  }
})

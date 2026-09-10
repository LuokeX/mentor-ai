import { listPromptRegistry } from '../../../../../domain/ai-config'
import { requireUser } from '../../../../../utils/auth'

/**
 * 提示词库（只读列表）。
 *
 * 正文的唯一来源是代码 server/domain/ai-prompt-baselines.ts，随版本发布，AI 中心不再提供编辑/发布；
 * 元数据（编码、名称、说明、占位符）来自代码注册表 PROMPT_REGISTRY。
 * 数据库 ai_prompt_templates 已弃用，不再读取。
 */
export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])

  const items = listPromptRegistry().map(definition => ({
    code: definition.code,
    name: definition.name,
    description: definition.description,
    placeholders: definition.placeholders,
    template: definition.template,
    /** 代码基线是否可用；缺失时该调用点在运行时降级到确定性路径。 */
    available: Boolean(definition.template?.trim())
  }))

  return { items }
})

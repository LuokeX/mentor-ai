import { listPromptRegistry } from '../../../../../domain/ai-config'
import { requireUser } from '../../../../../utils/auth'
import { schema, useDb } from '../../../../../utils/db'

/**
 * 提示词状态：
 *  - missing   未配置（运行时该调用点按能力不可用降级）
 *  - draft     有未发布草稿（运行时仍视为未配置）
 *  - published 已发布且草稿与已发布一致（运行时使用该文本）
 *  - changed   已发布生效中，但草稿有未发布的改动
 */
export type AiPromptStatus = 'missing' | 'draft' | 'published' | 'changed'

/**
 * 提示词库（只读列表）。
 *
 * 正文（草稿与已发布）唯一存在数据库 ai_prompt_templates；编码、名称、说明与占位符
 * 元数据来自代码注册表（PROMPT_REGISTRY）。运行时只认「已发布」文本，发布即热生效。
 */
export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const rows = await useDb(event).select().from(schema.aiPromptTemplates)
  const byCode = new Map(rows.map(row => [row.code, row]))

  const items = listPromptRegistry().map(definition => {
    const row = byCode.get(definition.code)
    const published = row?.published?.trim() ? row.published : null
    const template = row?.template?.trim() ? row.template : ''
    const status: AiPromptStatus = !published
      ? (template ? 'draft' : 'missing')
      : (template && template !== published ? 'changed' : 'published')
    return {
      code: definition.code,
      name: definition.name,
      description: definition.description,
      placeholders: definition.placeholders,
      status,
      template,
      published,
      publishedAt: row?.publishedAt ?? null,
      updatedAt: row?.updatedAt ?? null
    }
  })
  return { items }
})

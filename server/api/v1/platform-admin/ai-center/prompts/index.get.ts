import { listBuiltinPrompts } from '../../../../../domain/ai-config'
import { requireUser } from '../../../../../utils/auth'
import { schema, useDb } from '../../../../../utils/db'

export type AiPromptStatus = 'builtin' | 'draft' | 'published' | 'draft_over_published'

/** 提示词库列表：内置基线 + DB 草稿/发布状态合并。 */
export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const db = useDb(event)
  const rows = await db.select().from(schema.aiPromptTemplates)
  const byCode = new Map(rows.map(row => [row.code, row]))

  const items = listBuiltinPrompts().map(builtin => {
    const row = byCode.get(builtin.code)
    const status: AiPromptStatus = !row
      ? 'builtin'
      : row.published === null
        ? 'draft'
        : row.template === row.published
          ? 'published'
          : 'draft_over_published'
    return {
      code: builtin.code,
      name: row?.name ?? builtin.name,
      description: row?.description ?? builtin.description,
      placeholders: builtin.placeholders,
      status,
      template: row?.template ?? builtin.template,
      published: row?.published ?? null,
      publishedAt: row?.publishedAt ?? null,
      updatedAt: row?.updatedAt ?? null
    }
  })
  return { items }
})
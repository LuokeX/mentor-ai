import { eq } from 'drizzle-orm'
import { listBuiltinPrompts, invalidateAiConfigCache } from '../../../../../../domain/ai-config'
import { requireUser } from '../../../../../../utils/auth'
import { writeAudit } from '../../../../../../utils/audit'
import { schema, useDb } from '../../../../../../utils/db'

/** 重置为内置基线：草稿恢复内置内容，已发布内容清空（运行时回退内置），立即热生效。 */
export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const code = String(getRouterParam(event, 'code') || '')
  const builtin = listBuiltinPrompts().find(item => item.code === code)
  if (!builtin) throw createError({ statusCode: 404, message: '未知的提示词编码' })

  const db = useDb(event)
  const [existing] = await db.select({ id: schema.aiPromptTemplates.id }).from(schema.aiPromptTemplates).where(eq(schema.aiPromptTemplates.code, code)).limit(1)
  if (!existing) throw createError({ statusCode: 409, message: '该提示词尚未初始化' })

  const [row] = await db.update(schema.aiPromptTemplates).set({
    name: builtin.name,
    description: builtin.description,
    template: builtin.template,
    published: null,
    publishedBy: null,
    publishedAt: null,
    updatedBy: admin.id
  }).where(eq(schema.aiPromptTemplates.id, existing.id)).returning()
  if (!row) throw createError({ statusCode: 500, message: '重置失败' })
  invalidateAiConfigCache()
  await writeAudit(event, {
    actorId: admin.id,
    action: 'platform_admin.ai_center.prompt.reset',
    targetType: 'ai_prompt_template',
    targetId: row.id,
    metadata: { code }
  })
  return row
})
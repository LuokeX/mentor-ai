import { eq } from 'drizzle-orm'
import { listBuiltinPrompts, invalidateAiConfigCache } from '../../../../../../domain/ai-config'
import { requireUser } from '../../../../../../utils/auth'
import { writeAudit } from '../../../../../../utils/audit'
import { schema, useDb } from '../../../../../../utils/db'

/** 发布提示词草稿：published = 当前草稿内容，立即热生效（失效缓存）。 */
export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const code = String(getRouterParam(event, 'code') || '')
  if (!listBuiltinPrompts().some(item => item.code === code)) throw createError({ statusCode: 404, message: '未知的提示词编码' })

  const db = useDb(event)
  const [existing] = await db.select({ id: schema.aiPromptTemplates.id, template: schema.aiPromptTemplates.template }).from(schema.aiPromptTemplates).where(eq(schema.aiPromptTemplates.code, code)).limit(1)
  if (!existing) throw createError({ statusCode: 409, message: '请先保存草稿再发布' })

  const [row] = await db.update(schema.aiPromptTemplates).set({
    published: existing.template,
    publishedBy: admin.id,
    publishedAt: new Date(),
    updatedBy: admin.id
  }).where(eq(schema.aiPromptTemplates.id, existing.id)).returning()
  if (!row) throw createError({ statusCode: 500, message: '发布失败' })
  invalidateAiConfigCache()
  await writeAudit(event, {
    actorId: admin.id,
    action: 'platform_admin.ai_center.prompt.publish',
    targetType: 'ai_prompt_template',
    targetId: row.id,
    metadata: { code }
  })
  return row
})
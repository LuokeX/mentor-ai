import { eq } from 'drizzle-orm'
import { invalidateAiConfigCache, isPromptCode } from '../../../../../../domain/ai-config'
import { requireUser } from '../../../../../../utils/auth'
import { writeAudit } from '../../../../../../utils/audit'
import { schema, useDb } from '../../../../../../utils/db'

/**
 * 放弃未发布的改动：草稿恢复为当前已发布文本，运行时内容不变。
 * 提示词正文不再有代码内置基线，因此不存在「重置为内置」；如需回退，改回内容后重新发布即可。
 */
export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const code = String(getRouterParam(event, 'code') || '')
  if (!isPromptCode(code)) throw createError({ statusCode: 404, message: '未知的提示词编码' })

  const db = useDb(event)
  const [existing] = await db
    .select({ id: schema.aiPromptTemplates.id, published: schema.aiPromptTemplates.published })
    .from(schema.aiPromptTemplates)
    .where(eq(schema.aiPromptTemplates.code, code))
    .limit(1)
  if (!existing) throw createError({ statusCode: 409, message: '该提示词尚未初始化' })
  if (!existing.published?.trim()) throw createError({ statusCode: 409, message: '该提示词尚未发布，无可回退的生效版本' })

  const [row] = await db.update(schema.aiPromptTemplates).set({
    template: existing.published,
    updatedBy: admin.id,
    updatedAt: new Date()
  }).where(eq(schema.aiPromptTemplates.id, existing.id)).returning()
  if (!row) throw createError({ statusCode: 500, message: '放弃草稿失败' })

  invalidateAiConfigCache()
  await writeAudit(event, {
    actorId: admin.id,
    action: 'platform_admin.ai_center.prompt.discard_draft',
    targetType: 'ai_prompt_template',
    targetId: row.id,
    metadata: { code }
  })
  return row
})

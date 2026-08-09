import { eq } from 'drizzle-orm'
import { aiPromptTemplateSaveSchema } from '../../../../../../shared/contracts'
import { listBuiltinPrompts } from '../../../../../domain/ai-config'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { schema, useDb } from '../../../../../utils/db'

/** 保存提示词草稿：修改 template（不改变已发布内容），行不存在时自动初始化。 */
export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const code = String(getRouterParam(event, 'code') || '')
  const builtin = listBuiltinPrompts().find(item => item.code === code)
  if (!builtin) throw createError({ statusCode: 404, message: '未知的提示词编码' })

  const parsed = aiPromptTemplateSaveSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '参数不正确' })

  const db = useDb(event)
  const [existing] = await db.select({ id: schema.aiPromptTemplates.id }).from(schema.aiPromptTemplates).where(eq(schema.aiPromptTemplates.code, code)).limit(1)
  const values = {
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    template: parsed.data.template,
    updatedBy: admin.id
  }
  const [row] = existing
    ? await db.update(schema.aiPromptTemplates).set(values).where(eq(schema.aiPromptTemplates.id, existing.id)).returning()
    : await db.insert(schema.aiPromptTemplates).values({ ...values, code, placeholders: builtin.placeholders }).returning()
  if (!row) throw createError({ statusCode: 500, message: '草稿保存失败' })
  await writeAudit(event, {
    actorId: admin.id,
    action: 'platform_admin.ai_center.prompt.save_draft',
    targetType: 'ai_prompt_template',
    targetId: row.id,
    metadata: { code }
  })
  return row
})
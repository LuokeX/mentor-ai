import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { listBuiltinPrompts } from '../../../../../domain/ai-config'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { schema, useDb } from '../../../../../utils/db'

const bodySchema = z.object({ code: z.string().trim().min(1).max(80) })

/** 从内置基线初始化一条提示词记录（后续编辑基于该行进行）。 */
export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '参数不正确' })
  const builtin = listBuiltinPrompts().find(item => item.code === parsed.data.code)
  if (!builtin) throw createError({ statusCode: 404, message: '未知的提示词编码' })

  const db = useDb(event)
  const [existing] = await db.select({ id: schema.aiPromptTemplates.id }).from(schema.aiPromptTemplates).where(eq(schema.aiPromptTemplates.code, builtin.code)).limit(1)
  if (existing) throw createError({ statusCode: 409, message: '该提示词已初始化' })

  const [created] = await db.insert(schema.aiPromptTemplates).values({
    code: builtin.code,
    name: builtin.name,
    description: builtin.description,
    template: builtin.template,
    placeholders: builtin.placeholders,
    updatedBy: admin.id
  }).returning()
  if (!created) throw createError({ statusCode: 500, message: '初始化失败' })
  await writeAudit(event, {
    actorId: admin.id,
    action: 'platform_admin.ai_center.prompt.init',
    targetType: 'ai_prompt_template',
    targetId: created.id,
    metadata: { code: created.code }
  })
  return created
})
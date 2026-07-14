import { knowledgeBaseCreateSchema } from '../../../../shared/contracts'
import { requireUser } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { schema, useDb } from '../../../utils/db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const parsed = knowledgeBaseCreateSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message || '知识库参数不正确' })
  const body = parsed.data
  if (body.schoolId) {
    const [school] = await useDb(event).select({ id: schema.schools.id }).from(schema.schools)
      .where(eq(schema.schools.id, body.schoolId)).limit(1)
    if (!school) throw createError({ statusCode: 404, message: '学校不存在' })
  }
  const [created] = await useDb(event).insert(schema.knowledgeBases).values({
    name: body.name,
    description: body.description,
    scope: body.scope,
    schoolId: body.schoolId || null,
    createdBy: admin.id
  }).returning()
  if (!created) throw createError({ statusCode: 500, message: '知识库创建失败' })
  await writeAudit(event, {
    actorId: admin.id,
    schoolId: created.schoolId,
    action: 'platform_admin.knowledge_base.create',
    targetType: 'knowledge_base',
    targetId: created.id,
    metadata: { scope: created.scope }
  })
  return created
})

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { schema, useDb } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'
import { updatedAtMatches } from '../../../../utils/concurrency'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = z.object({
    name: z.string().trim().min(2).max(160).optional(),
    code: z.string().trim().regex(/^[a-z0-9-]{2,40}$/).optional(),
    status: z.enum(['active', 'disabled']).optional()
  }).refine(value => value.name || value.code || value.status).parse(await readBody(event))
  const expectedUpdatedAt = z.string().datetime().parse(getQuery(event).expectedUpdatedAt)
  const db = useDb(event)
  try {
    return await db.transaction(async (tx) => {
      const [school] = await tx.update(schema.schools).set({ ...body, updatedAt: new Date() })
        .where(and(eq(schema.schools.id, id), updatedAtMatches(schema.schools.updatedAt, expectedUpdatedAt))).returning()
      if (!school) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '学校已被其他平台管理员修改，请刷新后重试' })
      await writeAudit(event, {
        actorId: admin.id, schoolId: school.id, action: body.status ? `platform_admin.school.${body.status}` : 'platform_admin.school.update',
        targetType: 'school', targetId: school.id,
        metadata: { nameChanged: Boolean(body.name), codeChanged: Boolean(body.code) }
      }, tx)
      return school
    })
  } catch (error: any) {
    if (error?.code === '23505') throw createError({ statusCode: 409, message: '学校代码已存在' })
    throw error
  }
})

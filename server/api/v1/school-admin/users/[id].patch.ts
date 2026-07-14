import argon2 from 'argon2'
import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { requireUser } from '../../../../utils/auth'
import { useDb, schema } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'

const bodySchema = z.object({ status: z.enum(['active', 'disabled']).optional(), temporaryPassword: z.string().min(10).max(200).optional() }).refine(v => v.status || v.temporaryPassword)

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const values: Record<string, unknown> = { updatedAt: new Date() }
  if (body.status) values.status = body.status
  if (body.temporaryPassword) values.passwordHash = await argon2.hash(body.temporaryPassword, { type: argon2.argon2id })
  const db = useDb(event)
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(schema.users).set(values).where(and(
      eq(schema.users.id, id),
      eq(schema.users.schoolId, admin.schoolId!),
      inArray(schema.users.role, ['teacher', 'psychologist'])
    )).returning({ id: schema.users.id })
    if (row && (body.status === 'disabled' || body.temporaryPassword)) {
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, row.id))
    }
    return row
  })
  if (!updated) throw createError({ statusCode: 404, message: '用户不存在' })
  await writeAudit(event, { schoolId: admin.schoolId, actorId: admin.id, action: 'school_admin.user.update', targetType: 'user', targetId: id, metadata: { status: body.status, passwordReset: Boolean(body.temporaryPassword) } })
  return { ok: true }
})

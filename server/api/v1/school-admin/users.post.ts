import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { useDb, schema } from '../../../utils/db'
import { writeAudit } from '../../../utils/audit'
import { schoolAdminUserCreateSchema } from '../../../../shared/contracts'
import { requireSchoolManagement } from '../../../domain/school-management'

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['users'])
  const body = schoolAdminUserCreateSchema.parse(await readBody(event))
  const db = useDb(event)
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, body.email)).limit(1)
  if (existing && existing.status === 'active') {
    throw createError({ statusCode: 409, message: '该邮箱已绑定活跃账号' })
  }
  const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id })
  const user = existing
    ? (await db.update(schema.users).set({
        schoolId, name: body.name, email: body.email, role: body.role,
        status: 'active', passwordHash, totpSecretEnc: null, updatedAt: new Date()
      }).where(eq(schema.users.id, existing.id)).returning())[0]
    : (await db.insert(schema.users).values({
        schoolId, name: body.name, email: body.email, role: body.role,
        status: 'active', passwordHash
      }).returning())[0]
  if (!user) throw createError({ statusCode: 500, message: '用户创建失败' })
  if (existing) {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id))
  }
  await writeAudit(event, {
    schoolId, actorId: actor.id, action: 'school_admin.user.create',
    targetType: 'user', targetId: user.id, metadata: { role: body.role, delegatedGrantId }
  })
  return { ok: true, id: user.id }
})

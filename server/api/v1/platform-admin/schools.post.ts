import argon2 from 'argon2'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { writeAudit } from '../../../utils/audit'

const bodySchema = z.object({
  name: z.string().trim().min(2).max(160), code: z.string().trim().regex(/^[a-z0-9-]{2,40}$/),
  adminName: z.string().trim().min(2).max(120), adminEmail: z.string().email().transform(v => v.toLowerCase()),
  temporaryPassword: z.string().min(10).max(200)
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const body = bodySchema.parse(await readBody(event))
  const result = await useDb(event).transaction(async (tx) => {
    const [school] = await tx.insert(schema.schools).values({ name: body.name, code: body.code }).returning()
    if (!school) throw new Error('学校创建失败')
    const [schoolAdmin] = await tx.insert(schema.users).values({
      schoolId: school.id, name: body.adminName, email: body.adminEmail, role: 'school_admin',
      passwordHash: await argon2.hash(body.temporaryPassword, { type: argon2.argon2id })
    }).returning({ id: schema.users.id })
    if (!schoolAdmin) throw new Error('学校管理员创建失败')
    await tx.insert(schema.schoolSettings).values({ schoolId: school.id })
    return { school, schoolAdmin }
  })
  await writeAudit(event, { actorId: admin.id, schoolId: result.school.id, action: 'platform_admin.school.create', targetType: 'school', targetId: result.school.id })
  return result
})

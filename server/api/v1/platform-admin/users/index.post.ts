import argon2 from 'argon2'
import { and, eq } from 'drizzle-orm'
import { platformAdminSchoolAdminCreateSchema } from '../../../../../shared/contracts'
import { requireUser, generateInitialPassword } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const actor = await requireUser(event, ['platform_admin'])
  const body = platformAdminSchoolAdminCreateSchema.parse(await readBody(event))
  const db = useDb(event)

  const [school] = await db.select({ id: schema.schools.id }).from(schema.schools)
    .where(eq(schema.schools.id, body.schoolId)).limit(1)
  if (!school) throw createError({ statusCode: 404, message: '学校不存在' })

  const [existing] = await db.select({ id: schema.users.id }).from(schema.users)
    .where(eq(schema.users.phone, body.phone)).limit(1)
  if (existing) throw createError({ statusCode: 409, message: '该手机号已绑定账号' })
  if (body.employeeNo) {
    const [dup] = await db.select({ id: schema.users.id }).from(schema.users)
      .where(and(eq(schema.users.schoolId, body.schoolId), eq(schema.users.employeeNo, body.employeeNo))).limit(1)
    if (dup) throw createError({ statusCode: 409, message: '该学校已存在相同工号' })
  }

  const password = body.password ?? generateInitialPassword()
  const [created] = await db.insert(schema.users).values({
    schoolId: body.schoolId,
    name: body.name,
    phone: body.phone,
    role: 'school_admin',
    status: 'active',
    passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    employeeNo: body.employeeNo || null,
    activatedAt: new Date(),
  }).returning()
  if (!created) throw createError({ statusCode: 500, message: '学校管理员创建失败' })

  await writeAudit(event, {
    schoolId: body.schoolId,
    actorId: actor.id,
    action: 'platform_admin.user.create',
    targetType: 'user',
    targetId: created.id,
    metadata: { role: 'school_admin', generatedPassword: !body.password },
  })
  return { ok: true, id: created.id, ...(body.password ? {} : { initialPassword: password }) }
})
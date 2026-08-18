import argon2 from 'argon2'
import { randomBytes, randomInt } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { platformAdminSchoolAdminCreateSchema } from '../../../../../shared/contracts'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

/** 生成 16 位混合字符初始密码：保证包含大写、小写、数字、符号各至少一个，去除易混淆字符 */
function generateInitialPassword(length = 16) {
  const pools = {
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    lower: 'abcdefghijkmnpqrstuvwxyz',
    digits: '23456789',
    symbols: '!@#$%^&*_-+=',
  }
  const all = Object.values(pools).join('')
  const pick = (pool: string) => pool[randomInt(pool.length)]
  const chars = Object.values(pools).map(pick)
  while (chars.length < length) chars.push(pick(all))
  // Fisher-Yates 洗牌
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

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
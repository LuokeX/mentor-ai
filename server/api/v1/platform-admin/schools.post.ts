import argon2 from 'argon2'
import { z } from 'zod'
import { PHONE_PATTERN } from '../../../../shared/contracts'
import { requireUser, generateInitialPassword } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { useDb, schema } from '../../../utils/db'

const bodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().regex(/^[a-z0-9-]{2,40}$/),
  adminName: z.string().trim().min(2).max(120),
  adminPhone: z.string().trim().regex(PHONE_PATTERN),
  /** 可选初始密码；留空则系统生成随机密码并仅在响应中返回一次 */
  adminPassword: z.string().min(8).max(200).optional(),
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)

  try {
    const result = await db.transaction(async (tx) => {
      const [school] = await tx.insert(schema.schools).values({ name: body.name, code: body.code }).returning()
      if (!school) throw createError({ statusCode: 500, message: '学校创建失败' })
      const password = body.adminPassword ?? generateInitialPassword()
      const [schoolAdmin] = await tx.insert(schema.users).values({
        schoolId: school.id,
        name: body.adminName,
        phone: body.adminPhone,
        role: 'school_admin',
        status: 'active',
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        activatedAt: new Date(),
      }).returning()
      if (!schoolAdmin) throw createError({ statusCode: 500, message: '学校管理员创建失败' })
      await tx.insert(schema.schoolSettings).values({ schoolId: school.id })
      await writeAudit(event, {
        actorId: admin.id,
        schoolId: school.id,
        action: 'platform_admin.school.create',
        targetType: 'school',
        targetId: school.id,
        metadata: { schoolAdminId: schoolAdmin.id, generatedPassword: !body.adminPassword },
      }, tx)
      return { school, schoolAdmin, password, generatedPassword: !body.adminPassword }
    })
    return {
      school: result.school,
      schoolAdmin: { id: result.schoolAdmin.id, name: result.schoolAdmin.name, phone: result.schoolAdmin.phone },
      ...(result.generatedPassword ? { initialPassword: result.password } : {}),
    }
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') throw createError({ statusCode: 409, message: '学校代码或管理员手机号已存在' })
    throw error
  }
})
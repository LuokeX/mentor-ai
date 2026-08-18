import argon2 from 'argon2'
import { randomBytes, randomInt } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { schoolAdminUserCreateSchema } from '../../../../shared/contracts'
import { requireSchoolManagement } from '../../../domain/school-management'
import { writeAudit } from '../../../utils/audit'
import { encryptSensitive } from '../../../utils/crypto'
import { schema, useDb } from '../../../utils/db'

/** 系统生成的初始密码：16 位，保证包含大小写字母、数字和符号 */
function generateRandomPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%^&*'
  const all = upper + lower + digits + symbols
  const pick = (pool: string) => pool.charAt(randomInt(pool.length))
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)]
  for (let i = 0; i < 12; i++) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    const tmp = chars[i]!
    chars[i] = chars[j]!
    chars[j] = tmp
  }
  return chars.join('')
}

export default defineEventHandler(async (event) => {
  const { actor, schoolId, delegatedGrantId } = await requireSchoolManagement(event, ['users'], { allowPlatformAdmin: true })
  const body = schoolAdminUserCreateSchema.parse(await readBody(event))
  const db = useDb(event)
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.phone, body.phone)).limit(1)

  if (existing && existing.schoolId !== schoolId) {
    throw createError({ statusCode: 409, message: '该手机号已绑定其他学校账号' })
  }
  if (existing?.status === 'active' || existing?.status === 'disabled') {
    throw createError({ statusCode: 409, message: '该手机号已绑定账号，不能重复添加' })
  }

  const password = body.password ?? generateRandomPassword()
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id })

  const result = await db.transaction(async (tx) => {
    const now = new Date()
    const secret = useRuntimeConfig(event).encryptionKey
    const profileFields = {
      employeeNo: body.employeeNo || null,
      phoneEnc: body.phone ? encryptSensitive(body.phone, secret) : null,
      gender: body.gender || null,
      teachingGrades: body.teachingGrades || [],
      subject: body.subject || null,
      isClassTeacher: body.isClassTeacher ?? false,
      classTeacherYears: body.classTeacherYears ?? null,
      hiredAt: body.hiredAt ? new Date(body.hiredAt) : null,
      title: body.title || null,
      certNote: body.certNote || null,
      notesEnc: body.notes ? encryptSensitive(body.notes, secret) : null
    }
    let createdUser: typeof schema.users.$inferSelect | undefined
    if (existing) {
      // 存量 invited 账号被再次添加：直接激活为正式账号并重置密码，同时使旧邀请失效（避免旧激活链接覆盖新密码）
      [createdUser] = await tx.update(schema.users).set({
        name: body.name,
        role: body.role,
        status: 'active',
        passwordHash,
        activatedAt: now,
        ...profileFields,
        updatedAt: now,
      }).where(and(
        eq(schema.users.id, existing.id),
        eq(schema.users.schoolId, schoolId),
        eq(schema.users.status, 'invited'),
      )).returning()
      if (!createdUser) throw createError({ statusCode: 409, message: '账号状态已变化，请刷新后重试' })
      await tx.update(schema.invitations).set({ acceptedAt: now }).where(and(
        eq(schema.invitations.userId, createdUser.id),
        isNull(schema.invitations.acceptedAt),
      ))
    } else {
      [createdUser] = await tx.insert(schema.users).values({
        schoolId,
        name: body.name,
        phone: body.phone,
        role: body.role,
        status: 'active',
        passwordHash,
        activatedAt: now,
        ...profileFields,
      }).returning()
    }
    if (!createdUser) throw createError({ statusCode: 409, message: '账号创建失败，请重试' })

    await writeAudit(event, {
      schoolId,
      actorId: actor.id,
      action: 'school_admin.user.create',
      targetType: 'user',
      targetId: createdUser.id,
      metadata: {
        role: createdUser.role,
        passwordProvided: Boolean(body.password),
        activatedExistingInvitation: Boolean(existing),
        delegatedGrantId,
      },
    }, tx)

    return { createdUser, generatedPassword: body.password ? undefined : password }
  })

  return {
    ok: true,
    id: result.createdUser.id,
    ...(result.generatedPassword ? { generatedPassword: result.generatedPassword } : {}),
  }
})
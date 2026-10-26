import argon2 from 'argon2'
import { and, eq } from 'drizzle-orm'
import { getRequestIP } from 'h3'
import { z } from 'zod'
import { PHONE_PATTERN } from '../../../../../shared/contracts'
import { verifyCaptcha } from '../../../../domain/cend-captcha'
import { CEND_SIGNUP_BONUS, ensurePointAccount, grantPointsTx } from '../../../../domain/cend-points'
import { findCendSchool } from '../../../../domain/cend-school'
import { applyUserRoles, listUserRoles } from '../../../../domain/user-roles'
import { writeAudit } from '../../../../utils/audit'
import { createSession } from '../../../../utils/auth'
import { encryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

const bodySchema = z.object({
  phone: z.string().trim().regex(PHONE_PATTERN),
  password: z.string().min(8).max(200),
  confirmPassword: z.string().min(8).max(200),
  captcha: z.string().trim().min(4).max(8),
  agreement: z.literal(true)
}).refine(value => value.password === value.confirmPassword, {
  message: '两次输入的密码不一致',
  path: ['confirmPassword']
})

function maskedNickname(phone: string): string {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

/**
 * C 端注册/开通。
 * - 新手机号：创建用户（主租户=C 端）+ teacher 角色 + 新手积分；
 * - 已有学校账号：校验原密码后只追加 C 端角色，不复制用户、不改学校主角色；
 * - 已开通 C 端：提示直接登录。
 */
export default defineEventHandler(async (event) => {
  const body = bodySchema.parse(await readBody(event))
  if (!verifyCaptcha(event, body.captcha)) {
    throw createError({ statusCode: 400, message: '图形验证码错误或已过期，请重新获取' })
  }

  const db = useDb(event)
  const cend = await findCendSchool(db)
  if (!cend) throw createError({ statusCode: 500, message: 'C 端租户未初始化，请联系平台管理员' })

  const [existing] = await db.select().from(schema.users).where(eq(schema.users.phone, body.phone)).limit(1)
  if (existing) {
    if (existing.status !== 'active') {
      throw createError({ statusCode: 409, message: '该手机号账号当前不可用，请联系管理员' })
    }
    const allRoles = (await listUserRoles(db, existing.id)).map(entry => entry.roleCode)
    if (allRoles.includes('platform_admin')) {
      throw createError({ statusCode: 403, message: '平台管理员账号不能开通 C 端' })
    }
    const cendRoles = await listUserRoles(db, existing.id, cend.id)
    if (cendRoles.length) {
      throw createError({ statusCode: 409, message: '该手机号已开通 C 端，请直接登录' })
    }
    const passwordOk = Boolean(existing.passwordHash) && await argon2.verify(existing.passwordHash!, body.password).catch(() => false)
    if (!passwordOk) {
      throw createError({ statusCode: 401, message: '该手机号已有学校账号，请使用原密码开通 C 端' })
    }
  }

  const passwordHash = existing?.passwordHash ?? await argon2.hash(body.password, { type: argon2.argon2id })
  const secret = useRuntimeConfig(event).encryptionKey
  const nickname = maskedNickname(body.phone)
  const ipAddress = getRequestIP(event, { xForwardedFor: true }) || null

  const result = await db.transaction(async (tx) => {
    let userId = existing?.id
    if (!userId) {
      const [created] = await tx.insert(schema.users).values({
        schoolId: cend.id,
        name: nickname,
        phone: body.phone,
        passwordHash,
        role: 'teacher',
        status: 'active',
        activatedAt: new Date(),
        phoneEnc: encryptSensitive(body.phone, secret)
      }).returning({ id: schema.users.id })
      if (!created) throw createError({ statusCode: 500, message: '注册失败，请稍后重试' })
      userId = created.id
    }

    await applyUserRoles(tx, {
      userId,
      roleCodes: ['teacher'],
      primaryRole: 'teacher',
      schoolId: cend.id
    })
    await tx.insert(schema.cendProfiles).values({ userId, nickname }).onConflictDoNothing()
    // 每个 C 端用户默认有一个「我的班级」，供信息中心/班级系统模块使用；
    // 已有则不重复创建（老用户开通 C 端时也复用已有默认班级）。
    const [defaultClass] = await tx.select({ id: schema.classes.id }).from(schema.classes).where(and(
      eq(schema.classes.schoolId, cend.id),
      eq(schema.classes.ownerUserId, userId),
      eq(schema.classes.name, '我的班级')
    )).limit(1)
    if (!defaultClass) {
      await tx.insert(schema.classes).values({
        schoolId: cend.id,
        ownerUserId: userId,
        name: '我的班级',
        grade: 1,
        classType: 'admin',
        status: 'active'
      })
    }
    await ensurePointAccount(tx, userId)
    const bonus = await grantPointsTx(tx, {
      userId,
      amount: CEND_SIGNUP_BONUS,
      type: 'signup_bonus',
      status: 'settled',
      idempotencyKey: `signup:${userId}`,
      referenceType: 'cend_signup'
    })
    await tx.insert(schema.cendAgreements).values([
      { userId, agreementType: 'service', version: 'v1', ipAddress },
      { userId, agreementType: 'privacy', version: 'v1', ipAddress }
    ]).onConflictDoNothing()
    await writeAudit(event, {
      schoolId: cend.id,
      actorId: userId,
      action: 'cend.auth.register',
      targetType: 'user',
      targetId: userId,
      metadata: { existingSchoolUser: Boolean(existing) }
    }, tx)
    return { userId, balance: bonus.ok ? bonus.balance : 0 }
  })

  await createSession(event, result.userId, { activeSchoolId: cend.id })
  return {
    ok: true,
    userId: result.userId,
    schoolId: cend.id,
    schoolName: cend.name,
    balance: result.balance
  }
})

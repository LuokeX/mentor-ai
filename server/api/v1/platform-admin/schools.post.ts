import argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { PHONE_PATTERN } from '../../../../shared/contracts'
import { issueInvitation } from '../../../domain/invitations'
import { requireUser } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { useDb, schema } from '../../../utils/db'

const bodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().regex(/^[a-z0-9-]{2,40}$/),
  adminName: z.string().trim().min(2).max(120),
  adminPhone: z.string().trim().regex(PHONE_PATTERN),
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)

  try {
    const result = await db.transaction(async (tx) => {
      const [school] = await tx.insert(schema.schools).values({ name: body.name, code: body.code }).returning()
      if (!school) throw createError({ statusCode: 500, message: '学校创建失败' })
      const [schoolAdmin] = await tx.insert(schema.users).values({
        schoolId: school.id,
        name: body.adminName,
        phone: body.adminPhone,
        role: 'school_admin',
        status: 'invited',
        passwordHash: await argon2.hash(randomBytes(32).toString('base64url'), { type: argon2.argon2id }),
      }).returning()
      if (!schoolAdmin) throw createError({ statusCode: 500, message: '学校管理员创建失败' })
      await tx.insert(schema.schoolSettings).values({ schoolId: school.id })
      const { invitation, token } = await issueInvitation(event, {
        schoolId: school.id,
        userId: schoolAdmin.id,
        name: schoolAdmin.name,
        phone: schoolAdmin.phone ?? '',
        role: 'school_admin',
        invitedBy: admin.id,
      }, tx as ReturnType<typeof useDb>)
      await writeAudit(event, {
        actorId: admin.id,
        schoolId: school.id,
        action: 'platform_admin.school.create',
        targetType: 'school',
        targetId: school.id,
        metadata: { schoolAdminId: schoolAdmin.id, invitationId: invitation.id },
      }, tx)
      return { school, schoolAdmin, invitation, token }
    })
    return {
      school: result.school,
      schoolAdmin: { id: result.schoolAdmin.id, name: result.schoolAdmin.name, phone: result.schoolAdmin.phone },
      invitationId: result.invitation.id,
      activationToken: result.token,
      expiresAt: result.invitation.expiresAt,
    }
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') throw createError({ statusCode: 409, message: '学校代码或管理员手机号已存在' })
    throw error
  }
})

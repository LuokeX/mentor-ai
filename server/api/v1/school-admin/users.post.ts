import argon2 from 'argon2'
import * as OTPAuth from 'otpauth'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { encryptSensitive } from '../../../utils/crypto'
import { writeAudit } from '../../../utils/audit'

const inputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().transform(v => v.toLowerCase()),
  role: z.enum(['teacher', 'psychologist']),
  temporaryPassword: z.string().min(10).max(200)
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  const body = inputSchema.parse(await readBody(event))
  const secret = body.role === 'psychologist' ? new OTPAuth.Secret({ size: 20 }).base32 : null
  const [created] = await useDb(event).insert(schema.users).values({
    schoolId: admin.schoolId, name: body.name, email: body.email, role: body.role,
    passwordHash: await argon2.hash(body.temporaryPassword, { type: argon2.argon2id }),
    totpSecretEnc: secret ? encryptSensitive(secret, useRuntimeConfig(event).encryptionKey) : null
  }).returning({ id: schema.users.id })
  if (!created) throw createError({ statusCode: 500, message: '用户创建失败' })
  await writeAudit(event, { schoolId: admin.schoolId, actorId: admin.id, action: 'school_admin.user.create', targetType: 'user', targetId: created.id, metadata: { role: body.role } })
  return { ok: true, id: created.id, totpSecret: secret }
})

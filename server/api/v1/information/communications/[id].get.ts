import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { decryptSensitive } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const [record] = await useDb(event).select().from(schema.communications).where(and(
    eq(schema.communications.id, id),
    eq(schema.communications.schoolId, user.schoolId),
    eq(schema.communications.ownerUserId, user.id),
  )).limit(1)
  if (!record) throw createError({ statusCode: 404, message: '沟通记录不存在' })
  const { summaryEnc, ...safeRecord } = record
  return {
    ...safeRecord,
    summary: decryptSensitive(summaryEnc, useRuntimeConfig(event).encryptionKey),
  }
})

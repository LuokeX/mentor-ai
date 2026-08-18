import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../../../../utils/auth'
import { decryptSensitive } from '../../../../../../../utils/crypto'
import { schema, useDb } from '../../../../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const planId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const actionId = z.string().uuid().parse(getRouterParam(event, 'actionId'))
  const evidenceId = z.string().uuid().parse(getRouterParam(event, 'evidenceId'))
  const [file] = await useDb(event).select({
    filename: schema.planActionEvidence.filename,
    mimeType: schema.planActionEvidence.mimeType,
    contentEnc: schema.planActionEvidence.contentEnc
  }).from(schema.planActionEvidence).where(and(
    eq(schema.planActionEvidence.id, evidenceId),
    eq(schema.planActionEvidence.planId, planId),
    eq(schema.planActionEvidence.actionId, actionId),
    eq(schema.planActionEvidence.ownerUserId, user.id),
    eq(schema.planActionEvidence.schoolId, user.schoolId),
    eq(schema.planActionEvidence.status, 'active')
  )).limit(1)
  if (!file?.contentEnc) throw createError({ statusCode: 404, message: '证据文件不存在' })
  const buffer = Buffer.from(decryptSensitive(file.contentEnc, useRuntimeConfig(event).encryptionKey), 'base64')
  setResponseHeaders(event, {
    'content-type': file.mimeType,
    'content-length': buffer.length,
    'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    'cache-control': 'no-store, private'
  })
  return buffer
})

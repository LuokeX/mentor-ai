import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { validatePlanEvidence, sanitizeEvidenceFilename } from '../../../../../../domain/plan-evidence'
import { canUpdatePlanActions } from '../../../../../../domain/plan-operations'
import { requireUser } from '../../../../../../utils/auth'
import { writeAudit } from '../../../../../../utils/audit'
import { encryptSensitive } from '../../../../../../utils/crypto'
import { schema, useDb } from '../../../../../../utils/db'

const bodySchema = z.object({
  filename: z.string().trim().min(1).max(260),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']),
  contentBase64: z.string().min(4).max(21_000_000)
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const schoolId = user.schoolId
  const planId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const actionId = z.string().uuid().parse(getRouterParam(event, 'actionId'))
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)

  const [plan] = await db.select({ status: schema.plans.status, acceptedAt: schema.plans.acceptedAt })
    .from(schema.plans).where(and(
      eq(schema.plans.id, planId),
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.schoolId, schoolId)
    )).limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })
  if (!canUpdatePlanActions(plan)) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '请先接受方案，再上传执行证据' })
  }
  const [action] = await db.select({ id: schema.planActions.id }).from(schema.planActions).where(and(
    eq(schema.planActions.id, actionId),
    eq(schema.planActions.planId, planId),
    eq(schema.planActions.ownerUserId, user.id),
    eq(schema.planActions.schoolId, schoolId)
  )).limit(1)
  if (!action) throw createError({ statusCode: 404, message: '方案行动不存在' })

  const buffer = Buffer.from(body.contentBase64, 'base64')
  const validation = validatePlanEvidence(buffer, body.mimeType)
  if (!validation.ok) throw createError({ statusCode: 422, message: validation.message })
  const checksum = createHash('sha256').update(buffer).digest('hex')
  const [saved] = await db.insert(schema.planActionEvidence).values({
    schoolId,
    planId,
    actionId,
    ownerUserId: user.id,
    kind: validation.kind,
    filename: sanitizeEvidenceFilename(body.filename),
    mimeType: body.mimeType,
    byteSize: validation.byteSize,
    checksum,
    contentEnc: encryptSensitive(buffer.toString('base64'), useRuntimeConfig(event).encryptionKey)
  }).returning({
    id: schema.planActionEvidence.id,
    kind: schema.planActionEvidence.kind,
    filename: schema.planActionEvidence.filename,
    mimeType: schema.planActionEvidence.mimeType,
    byteSize: schema.planActionEvidence.byteSize,
    createdAt: schema.planActionEvidence.createdAt
  })
  if (!saved) throw createError({ statusCode: 500, message: '证据保存失败' })
  await writeAudit(event, {
    schoolId,
    actorId: user.id,
    action: 'plan.action.evidence.create',
    targetType: 'plan_action_evidence',
    targetId: saved.id,
    metadata: { planId, actionId, kind: saved.kind, byteSize: saved.byteSize }
  })
  return saved
})

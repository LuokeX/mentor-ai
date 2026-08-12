import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { decryptSensitive, encryptSensitive, searchableHash } from '../../../../utils/crypto'
import { schema, useDb } from '../../../../utils/db'
import { writeAudit } from '../../../../utils/audit'

/** 家校关系档案（jsonb 加密）：家长分型、家校关系等级、二期关联信息 */
const guardianProfileSchema = z.object({
  /** 关系档案编码（externalRef 的展示名） */
  parentProfileType: z.string().trim().max(40).optional(),
  /** 家长分型亚型说明（如 P3-C） */
  parentProfileSubtype: z.string().trim().max(40).optional(),
  /** 家校关系等级：A合作型/B积极配合型/C被动型/D重点关注型/E敌对型 */
  relationLevel: z.string().trim().max(20).optional(),
  /** 二期：家长工作坊参与情况 */
  workshopParticipation: z.string().trim().max(200).optional(),
  /** 二期：家长会参与情况 */
  parentMeetingParticipation: z.string().trim().max(200).optional(),
  /** 二期：线上家长课参与情况 */
  onlineCourseParticipation: z.string().trim().max(200).optional(),
  /** 二期：家长会商（是/否 + 说明） */
  consultation: z.string().trim().max(200).optional()
}).partial()

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  phone: z.string().max(40).optional(),
  relation: z.string().max(40).optional(),
  /** 关系档案编码（外部编号） */
  externalRef: z.string().trim().max(120).nullable().optional(),
  /** 家校关系档案（家长分型/关系等级/二期关联信息） */
  profile: guardianProfileSchema.optional()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = bodySchema.parse(await readBody(event))
  const expectedUpdatedAt = z.string().datetime().optional().parse(getQuery(event).expectedUpdatedAt)
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  const [guardian] = await db.select({
    id: schema.guardians.id,
    profileEnc: schema.guardians.profileEnc,
    updatedAt: schema.guardians.updatedAt,
  }).from(schema.guardians).where(and(
    eq(schema.guardians.id, id),
    eq(schema.guardians.ownerUserId, user.id),
    eq(schema.guardians.schoolId, user.schoolId!),
  )).limit(1)
  if (!guardian) throw createError({ statusCode: 404, message: '家长不存在' })
  if (expectedUpdatedAt && guardian.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '家长档案已被其他用户修改，请刷新后重试' })
  }
  const patch: Partial<typeof schema.guardians.$inferInsert> = { updatedAt: new Date() }
  if (body.name !== undefined) {
    patch.nameEnc = encryptSensitive(body.name, secret)
    patch.nameSearch = searchableHash(body.name, secret)
  }
  if (body.phone !== undefined) patch.phoneEnc = body.phone ? encryptSensitive(body.phone, secret) : null
  if (body.relation !== undefined) patch.relation = body.relation
  if (body.externalRef !== undefined) {
    patch.externalRefEnc = body.externalRef ? encryptSensitive(body.externalRef, secret) : null
    patch.externalRefSearch = body.externalRef ? searchableHash(body.externalRef, secret) : null
  }
  if (body.profile !== undefined) {
    const currentProfileText = guardian.profileEnc ? decryptSensitive(guardian.profileEnc, secret) : ''
    const currentProfile = currentProfileText ? JSON.parse(currentProfileText) : {}
    const nextProfile = Object.fromEntries(
      Object.entries({ ...currentProfile, ...body.profile }).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
    )
    patch.profileEnc = encryptSensitive(JSON.stringify(nextProfile), secret)
  }
  const finalConditions = [
    eq(schema.guardians.id, id),
    eq(schema.guardians.ownerUserId, user.id),
    eq(schema.guardians.schoolId, user.schoolId!),
  ]
  if (expectedUpdatedAt) finalConditions.push(eq(schema.guardians.updatedAt, new Date(expectedUpdatedAt)))
  const [updated] = await db.update(schema.guardians).set(patch).where(and(...finalConditions)).returning({ id: schema.guardians.id })
  if (!updated) throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: '家长档案已被其他用户修改，请刷新后重试' })
  await writeAudit(event, { schoolId: user.schoolId, actorId: user.id, action: 'information.guardian.update', targetType: 'guardian', targetId: id })
  return { ok: true }
})

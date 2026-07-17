import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { resolveAiGovernance } from '../../../domain/ai-governance'
import { trackProductEvent } from '../../../domain/product-events'
import { schema, useDb } from '../../../utils/db'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const body = z.object({ noticeVersion: z.string().min(1).max(50), accepted: z.literal(true) }).parse(await readBody(event))
  const governance = await resolveAiGovernance(event, user.schoolId, user.id)
  if (body.noticeVersion !== governance.noticeVersion) throw createError({ statusCode: 409, message: '隐私告知版本已更新，请重新确认' })
  await useDb(event).insert(schema.userConsents).values({
    schoolId: user.schoolId, userId: user.id, noticeVersion: body.noticeVersion, dataMode: 'full_context'
  }).onConflictDoUpdate({
    target: [schema.userConsents.userId, schema.userConsents.noticeVersion, schema.userConsents.dataMode],
    set: { acknowledgedAt: new Date(), revokedAt: null }
  })
  await writeAudit(event, {
    schoolId: user.schoolId, actorId: user.id, action: 'ai.full_context.consent',
    targetType: 'user', targetId: user.id, metadata: { noticeVersion: body.noticeVersion }
  })
  await trackProductEvent(event, { schoolId: user.schoolId, userId: user.id, eventName: 'privacy_notice_accepted', metadata: { noticeVersion: body.noticeVersion } })
  return { ok: true }
})

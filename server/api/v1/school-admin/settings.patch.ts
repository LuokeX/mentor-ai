import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { writeAudit } from '../../../utils/audit'

const bodySchema = z.object({
  helpPhone: z.string().max(40).nullable().optional(),
  smsRecipients: z.array(z.string().max(40)).max(10).optional(),
  safetyContactRecipients: z.array(z.string().max(40)).max(10).optional(),
  referralPsychologistId: z.string().uuid().nullable().optional(),
  crisisGuide: z.string().min(20).max(1000).optional(),
  aiDataMode: z.enum(['local', 'redacted', 'full_context']).optional(),
  aiApprovalReference: z.string().trim().min(10).max(1000).nullable().optional(),
  aiNoticeVersion: z.string().trim().min(2).max(50).optional(),
  approveFullContext: z.boolean().optional(),
  referralAckMinutes: z.number().int().min(1).max(30).optional(),
  referralEscalationMinutes: z.number().int().min(5).max(60).optional()
}).superRefine((value, context) => {
  if (value.aiDataMode === 'full_context' && (!value.approveFullContext || !value.aiApprovalReference)) {
    context.addIssue({ code: 'custom', path: ['approveFullContext'], message: '完整上下文模式必须勾选授权并填写审批依据' })
  }
  if (value.referralAckMinutes && value.referralEscalationMinutes && value.referralEscalationMinutes <= value.referralAckMinutes) {
    context.addIssue({ code: 'custom', path: ['referralEscalationMinutes'], message: '升级时限必须大于确认时限' })
  }
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['school_admin'])
  const body = bodySchema.parse(await readBody(event))
  const db = useDb(event)
  if (body.aiDataMode === 'full_context' && !useRuntimeConfig(event).deepseekAgreementVersion) {
    throw createError({ statusCode: 422, message: '平台尚未登记模型供应商协议版本，不能启用完整上下文模式' })
  }
  if (body.referralPsychologistId) {
    const [psych] = await db.select({ id: schema.users.id }).from(schema.users).where(and(
      eq(schema.users.id, body.referralPsychologistId), eq(schema.users.schoolId, admin.schoolId!), eq(schema.users.role, 'psychologist')
    )).limit(1)
    if (!psych) throw createError({ statusCode: 422, message: '心理专员不属于本校' })
  }
  const { approveFullContext, ...settingsBody } = body
  const [updated] = await db.update(schema.schoolSettings).set({
    ...settingsBody,
    aiApprovedBy: body.aiDataMode === 'full_context' && approveFullContext ? admin.id : body.aiDataMode ? null : undefined,
    aiApprovedAt: body.aiDataMode === 'full_context' && approveFullContext ? new Date() : body.aiDataMode ? null : undefined,
    updatedAt: new Date()
  }).where(eq(schema.schoolSettings.schoolId, admin.schoolId!)).returning()
  await writeAudit(event, { schoolId: admin.schoolId, actorId: admin.id, action: 'school_admin.settings.update', targetType: 'school', targetId: admin.schoolId!, metadata: { changedFields: Object.keys(body) } })
  return updated
})

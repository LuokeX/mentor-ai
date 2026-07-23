import { and, eq, inArray } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { encryptSensitive } from '../utils/crypto'
import { useDb, schema } from '../utils/db'

const CRISIS_PATTERNS: Array<[string, RegExp]> = [
  ['SAFE-SUICIDE', /(不想活|想死|自杀|结束生命|活着没意思)/i],
  ['SAFE-SELF-HARM', /(自伤|割腕|伤害自己|自残)/i],
  ['SAFE-VIOLENCE', /(杀了|伤害别人|暴力倾向|带刀|自伤工具)/i],
  ['SAFE-ABUSE', /(虐待|体罚|家暴|殴打孩子)/i],
  ['SAFE-THREAT', /(威胁恐吓|公开抹黑|恶意维权)/i]
]

export function detectSafetySignals(text: string) {
  return CRISIS_PATTERNS.filter(([, regex]) => regex.test(text)).map(([id]) => id)
}

export async function createSafetyReferral(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  sourceType: string
  sourceId?: string
  text: string
  matchedRules: string[]
}) {
  const config = useRuntimeConfig(event)
  const db = useDb(event)
  return db.transaction(async (tx) => {
    const [settings] = await tx.select().from(schema.schoolSettings).where(eq(schema.schoolSettings.schoolId, input.schoolId)).limit(1)
    const [safety] = await tx.insert(schema.safetyEvents).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      severity: 'red',
      matchedRules: input.matchedRules,
      summaryEnc: encryptSensitive(input.text.slice(0, 1000), config.encryptionKey)
    }).returning()
    if (!safety) throw new Error('安全事件创建失败')
    const now = new Date()
    const acknowledgeDueAt = new Date(now.getTime() + (settings?.referralAckMinutes || 5) * 60_000)
    const escalationDueAt = new Date(now.getTime() + (settings?.referralEscalationMinutes || 15) * 60_000)
    const assignedPsychologistId = settings?.referralPsychologistId || null
    const [referral] = await tx.insert(schema.referrals).values({
      schoolId: input.schoolId,
      safetyEventId: safety.id,
      psychologistId: assignedPsychologistId,
      status: assignedPsychologistId ? 'created' : 'escalated',
      assignedAt: now,
      acknowledgeDueAt,
      escalationDueAt,
      escalatedAt: assignedPsychologistId ? null : now
    }).returning()
    if (!referral) throw new Error('转介工单创建失败')
    await tx.insert(schema.referralEvents).values([
      {
        schoolId: input.schoolId, referralId: referral.id, actorId: input.ownerUserId,
        eventType: 'created', toStatus: 'created', metadata: { priority: referral.priority }
      },
      ...(!assignedPsychologistId ? [{
        schoolId: input.schoolId, referralId: referral.id, actorId: null,
        eventType: 'auto_escalated', fromStatus: 'created', toStatus: 'escalated', metadata: { reason: 'no_default_psychologist' }
      }] : [])
    ])
    if (assignedPsychologistId) {
      await tx.insert(schema.notifications).values({
        schoolId: input.schoolId, userId: assignedPsychologistId, type: 'referral_assigned',
        title: '新的危机转介工单', body: `危机事件 ${safety.id.slice(0, 8)} 待确认，请立即进入工作台。`,
        targetType: 'referral', targetId: referral.id, deduplicationKey: `referral-assigned:${referral.id}`
      })
    }
    // 通知学校管理员
    const schoolAdmins = await tx.select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.schoolId, input.schoolId), eq(schema.users.role, 'school_admin')))
    for (const admin of schoolAdmins) {
      await tx.insert(schema.notifications).values({
        schoolId: input.schoolId, userId: admin.id, type: 'crisis_alert',
        title: '安全预警：危机事件触发',
        body: `学校内发生危机事件 ${safety.id.slice(0, 8)}，请进入管理后台查看详情。`,
        targetType: 'safety_event', targetId: safety.id,
        deduplicationKey: `crisis-admin:${safety.id}:${admin.id}`
      })
    }
    const escalationRecipients = settings?.safetyContactRecipients?.length
      ? settings.safetyContactRecipients
      : settings?.smsRecipients || []
    await tx.insert(schema.notificationOutbox).values({
      schoolId: input.schoolId,
      eventType: 'crisis_referral',
      deduplicationKey: `crisis:${safety.id}`,
      payload: {
        eventId: safety.id,
        referralId: referral.id,
        recipients: assignedPsychologistId ? settings?.smsRecipients || [] : escalationRecipients,
        message: `教师赋能平台危机事件 ${safety.id.slice(0, 8)}，请立即登录转介工作台。`
      }
    })
    await tx.insert(schema.auditLogs).values({
      schoolId: input.schoolId,
      actorId: input.ownerUserId,
      action: 'safety.fuse.triggered',
      targetType: 'safety_event',
      targetId: safety.id,
      metadata: { matchedRules: input.matchedRules, referralId: referral.id }
    })
    return { safety, referral, crisisGuide: settings?.crisisGuide || '请立即联系校内心理专员；如存在即时危险，请拨打 110 或 120。' }
  })
}

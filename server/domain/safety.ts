import { eq } from 'drizzle-orm'
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
    const [referral] = await tx.insert(schema.referrals).values({
      schoolId: input.schoolId,
      safetyEventId: safety.id,
      psychologistId: settings?.referralPsychologistId || null
    }).returning()
    if (!referral) throw new Error('转介工单创建失败')
    await tx.insert(schema.notificationOutbox).values({
      schoolId: input.schoolId,
      eventType: 'crisis_referral',
      deduplicationKey: `crisis:${safety.id}`,
      payload: {
        eventId: safety.id,
        referralId: referral.id,
        recipients: settings?.smsRecipients || [],
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

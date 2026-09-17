import { and, eq, inArray } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { encryptSensitive } from '../utils/crypto'
import { type DbClient, type DbTx, useDb, schema } from '../utils/db'

const CRISIS_PATTERNS: Array<[string, RegExp]> = [
  ['SAFE-SUICIDE', /(不想活|想死|自杀|结束生命|活着没意思)/i],
  ['SAFE-SELF-HARM', /(自伤|割腕|伤害自己|自残)/i],
  ['SAFE-VIOLENCE', /(杀了|伤害别人|暴力倾向|带刀|自伤工具)/i],
  ['SAFE-ABUSE', /(虐待|体罚|家暴|殴打孩子)/i],
  ['SAFE-THREAT', /(威胁恐吓|公开抹黑|恶意维权)/i]
]

/**
 * 教师界面文案红线：这些字样不得出现在教师可见文案里。
 * 覆盖两处入口——量表提交后的转介卡片、首页 AI 助手的熔断提示；
 * 学校配置的危机指引在保存时校验、读取时兜底（命中即回退默认指引）。
 */
export const TEACHER_FORBIDDEN_TEXT = /危机|红线|预警|立即|110|120/

/** 学校未配置危机指引、或配置命中禁用字样时的默认指引（本身不得含禁用字样）。 */
export const CRISIS_GUIDE_FALLBACK = '请尽快联系校内心理专员，并按学校安全流程跟进。'

/**
 * 语义命中（入口已在后台建安全事件与转介）但本轮照常回答时，追加到回答末尾的中性提示。
 * 与学校危机指引同样受 TEACHER_FORBIDDEN_TEXT 约束：不得出现「危机/红线/预警/立即/110/120」。
 */
export const SAFETY_FOLLOW_UP_NOTE = '另外建议：把这件事同步告诉校内心理专员，并按学校安全流程跟进。'

/** 判断一段准备展示给教师的文案是否越线。学校后台保存危机指引前先走这里。 */
export function teacherFacingTextAllowed(text: string) {
  return !TEACHER_FORBIDDEN_TEXT.test(text)
}

/** 读取学校危机指引：为空或命中禁用字样时回退默认指引，保证教师界面不出现禁用字样。 */
export function resolveCrisisGuide(configured?: string | null) {
  const text = configured?.trim()
  if (!text || !teacherFacingTextAllowed(text)) return CRISIS_GUIDE_FALLBACK
  return text
}

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
}, tx?: DbTx) {
  const config = useRuntimeConfig(event)
  const run = (inner: DbClient) => runCreateSafetyReferral(inner, config, input)
  if (tx) return run(tx)
  return useDb(event).transaction(inner => run(inner))
}

async function runCreateSafetyReferral(
  db: DbClient,
  config: ReturnType<typeof useRuntimeConfig>,
  input: {
    schoolId: string
    ownerUserId: string
    sourceType: string
    sourceId?: string
    text: string
    matchedRules: string[]
  }
) {
    const [settings] = await db.select().from(schema.schoolSettings).where(eq(schema.schoolSettings.schoolId, input.schoolId)).limit(1)
    const [safety] = await db.insert(schema.safetyEvents).values({
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
    const [referral] = await db.insert(schema.referrals).values({
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
    await db.insert(schema.referralEvents).values([
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
      await db.insert(schema.notifications).values({
        schoolId: input.schoolId, userId: assignedPsychologistId, type: 'referral_assigned',
        title: '新的安全转介工单', body: `安全事件 ${safety.id.slice(0, 8)} 待确认，请尽快进入工作台。`,
        targetType: 'referral', targetId: referral.id, deduplicationKey: `referral-assigned:${referral.id}`
      })
    }
    // 通知学校管理员
    const schoolAdmins = await db.select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.schoolId, input.schoolId), eq(schema.users.role, 'school_admin')))
    for (const admin of schoolAdmins) {
      await db.insert(schema.notifications).values({
        schoolId: input.schoolId, userId: admin.id, type: 'crisis_alert',
        title: '安全提示：安全事件触发',
        body: `学校内发生安全事件 ${safety.id.slice(0, 8)}，请进入管理后台查看详情。`,
        targetType: 'safety_event', targetId: safety.id,
        deduplicationKey: `crisis-admin:${safety.id}:${admin.id}`
      })
    }
    const escalationRecipients = settings?.safetyContactRecipients?.length
      ? settings.safetyContactRecipients
      : settings?.smsRecipients || []
    await db.insert(schema.notificationOutbox).values({
      schoolId: input.schoolId,
      eventType: 'crisis_referral',
      deduplicationKey: `crisis:${safety.id}`,
      payload: {
        eventId: safety.id,
        referralId: referral.id,
        recipients: assignedPsychologistId ? settings?.smsRecipients || [] : escalationRecipients,
        message: `教师赋能平台安全事件 ${safety.id.slice(0, 8)}，请尽快登录转介工作台。`
      }
    })
    await db.insert(schema.auditLogs).values({
      schoolId: input.schoolId,
      actorId: input.ownerUserId,
      action: 'safety.fuse.triggered',
      targetType: 'safety_event',
      targetId: safety.id,
      metadata: { matchedRules: input.matchedRules, referralId: referral.id }
    })
    return {
      safety,
      referral,
      crisisGuide: resolveCrisisGuide(settings?.crisisGuide),
      helpPhone: settings?.helpPhone || null,
      ackMinutes: settings?.referralAckMinutes ?? 5,
      escalationMinutes: settings?.referralEscalationMinutes ?? 15,
      psychologistAssigned: Boolean(assignedPsychologistId)
    }
}

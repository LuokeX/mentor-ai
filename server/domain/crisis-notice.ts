/**
 * 熔断后的教师端处置载荷：学校指引、校内求助电话、响应时限、是否已指派心理专员。
 *
 * 熔断与转介在同一事务里落库（safety_events + referrals），所以按来源反查安全事件
 * 就能恢复当时展示过的内容，不需要另存一份快照。两处教师端入口共用同一实现：
 * 接受前被冻结的方案页（server/domain/plan-freeze.ts）与评估记录详情
 * （server/api/v1/assessments/records/[id].get.ts）。
 *
 * 查不到安全事件时返回 null：调用方只展示停止说明，不展示没有依据的处置指引。
 */
import { and, desc, eq } from 'drizzle-orm'
import { schema, type DbClient } from '../utils/db'
import { resolveCrisisGuide } from './safety'

export interface CrisisNotice {
  eventId: string
  guide: string
  helpPhone: string | null
  ackMinutes: number
  escalationMinutes: number
  psychologistAssigned: boolean
  /** 安全事件落库时间：调用方没有更精确的停止时间时作为 frozenAt 兜底 */
  occurredAt: Date
}

/**
 * 按来源（量表提交 / 对话等）反查安全事件与转介工单，组装教师端处置载荷。
 *
 * `sourceId` 为空（如事件写入失败的历史方案）时直接返回 null，由调用方降级。
 */
export async function resolveCrisisNotice(db: DbClient, input: {
  schoolId: string
  sourceType: string
  sourceId: string | null | undefined
}): Promise<CrisisNotice | null> {
  if (!input.sourceId) return null

  const [event] = await db.select({
    id: schema.safetyEvents.id,
    createdAt: schema.safetyEvents.createdAt
  }).from(schema.safetyEvents)
    .where(and(
      eq(schema.safetyEvents.schoolId, input.schoolId),
      eq(schema.safetyEvents.sourceType, input.sourceType),
      eq(schema.safetyEvents.sourceId, input.sourceId)
    ))
    .orderBy(desc(schema.safetyEvents.createdAt))
    .limit(1)
  if (!event) return null

  const [referral] = await db.select({ psychologistId: schema.referrals.psychologistId })
    .from(schema.referrals)
    .where(eq(schema.referrals.safetyEventId, event.id))
    .limit(1)

  const [settings] = await db.select({
    helpPhone: schema.schoolSettings.helpPhone,
    crisisGuide: schema.schoolSettings.crisisGuide,
    referralAckMinutes: schema.schoolSettings.referralAckMinutes,
    referralEscalationMinutes: schema.schoolSettings.referralEscalationMinutes
  }).from(schema.schoolSettings)
    .where(eq(schema.schoolSettings.schoolId, input.schoolId))
    .limit(1)

  return {
    eventId: event.id,
    // 学校配置的指引由 resolveCrisisGuide 兜底并过滤禁用字样，组件不重复过滤
    guide: resolveCrisisGuide(settings?.crisisGuide),
    helpPhone: settings?.helpPhone?.trim() || null,
    ackMinutes: settings?.referralAckMinutes ?? 5,
    escalationMinutes: settings?.referralEscalationMinutes ?? 15,
    psychologistAssigned: Boolean(referral?.psychologistId),
    occurredAt: event.createdAt
  }
}

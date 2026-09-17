import { and, desc, eq } from 'drizzle-orm'
import type { PlanFrozenNotice } from '../../shared/reports'
import { schema, type DbClient } from '../utils/db'
import { resolveCrisisNotice } from './crisis-notice'

/** 触发冻结的评估组提交：冻结时由 submit 写入 plan_collaboration_needed 事件。 */
async function findFuseAttemptId(db: DbClient, planId: string) {
  const [event] = await db.select({
    metadata: schema.planOperationEvents.metadata,
    createdAt: schema.planOperationEvents.createdAt
  }).from(schema.planOperationEvents)
    .where(and(
      eq(schema.planOperationEvents.planId, planId),
      eq(schema.planOperationEvents.eventType, 'plan_collaboration_needed')
    ))
    .orderBy(desc(schema.planOperationEvents.createdAt))
    .limit(1)
  // metadata 只保留基础类型，attemptId 一定是字符串；miss 时返回 null 由调用方降级。
  const attemptId = event?.metadata?.attemptId
  return {
    attemptId: typeof attemptId === 'string' ? attemptId : null,
    frozenAt: event?.createdAt ?? null
  }
}

/**
 * 接受前被安全熔断冻结的方案只下发受限载荷：标识 + 冻结原因 + 转介处置信息，不含正文。
 *
 * 背景：危机熔断时会把评估组内「待确认」的方案冻结成 `escalated`（见
 * `server/api/v1/assessments/[module]/submit.post.ts`）。此时方案既不能接受也不能执行，
 * 教师端本应「停留在转介指引页」。但旧方案页仍可被打开，若照常下发正文，教师会看到
 * 一份按钮全消失、也没有任何原因的方案——所以这里改为回传停止说明所需的最小字段。
 *
 * 冻结与转介是同一事务里落库的（safetyEvents / referrals），因此按事件里的
 * attemptId 反查安全事件即可恢复当时展示过的学校指引、求助电话与响应时限（查询实现
 * 与评估记录详情共用 server/domain/crisis-notice.ts）；查不到时 `freeze` 为 null，
 * 前端只展示停止说明而不展示无依据的处置指引。
 */
export async function buildPlanFrozenNotice(db: DbClient, input: {
  schoolId: string
  plan: {
    id: string
    module: string
    title: string
    titleFull: string | null
    sourceType: string | null
    status: string
    createdAt: Date
    updatedAt: Date
  }
}): Promise<PlanFrozenNotice> {
  const { attemptId, frozenAt } = await findFuseAttemptId(db, input.plan.id)

  const notice = await resolveCrisisNotice(db, {
    schoolId: input.schoolId,
    sourceType: 'assessment',
    sourceId: attemptId
  })

  return {
    id: input.plan.id,
    module: input.plan.module,
    title: input.plan.title,
    titleFull: input.plan.titleFull,
    sourceType: input.plan.sourceType,
    status: input.plan.status,
    acceptedAt: null,
    createdAt: input.plan.createdAt,
    updatedAt: input.plan.updatedAt,
    frozenBeforeAcceptance: true,
    freeze: notice
      ? {
          // 优先用冻结事件时间；事件缺失时退回安全事件时间（比方案 updatedAt 更贴合「停止时间」）
          frozenAt: frozenAt ?? notice.occurredAt,
          eventId: notice.eventId,
          guide: notice.guide,
          helpPhone: notice.helpPhone,
          ackMinutes: notice.ackMinutes,
          escalationMinutes: notice.escalationMinutes,
          psychologistAssigned: notice.psychologistAssigned
        }
      : null
  }
}

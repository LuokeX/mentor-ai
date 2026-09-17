import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'
import { ensurePlanActions } from '../../../../domain/plan-actions'
import { resolveDisplayedPlanActions } from '../../../../domain/plan-action-display-context'
import { canReviewPlan, planStatusAfterReview, recordPlanOperationEvent } from '../../../../domain/plan-operations'
import { trackProductEvent } from '../../../../domain/product-events'

/** 进展说明留空时由服务端补的确定性文案（复盘正文是教师可见记录，不写模型生成内容）。 */
const DEFAULT_PROGRESS_NOTE = '全部行动已完成，教师确认目标达成。'
const DEFAULT_NEXT_ACTION = '无需继续跟进，方案已关闭。'

/**
 * 方案「一键确认完成」。
 *
 * 可执行行动全部勾完之后方案进入「待复盘」，教师端只需要再做一次确认；这条路由把这次确认
 * 落成一条**真实的复盘记录**（决策 `close_success`），而不是绕过复盘直接改状态：学校后台的
 * 复盘率、方案运营看板的复盘口径继续成立，效果评分默认 5 分、教师可改。
 *
 * 与通用复盘接口（`reviews.post.ts`）的分工：
 *   - 通用接口承载「填写完整复盘」，含继续原方案 / 需调整 / 需协同等分流决策；
 *   - 本路由承载「行动都做完了，确认收口」，完成情况由服务端按方案页同一套
 *     展示层规则校验，不接受客户端自行声明「已完成」。
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const schoolId = user.schoolId
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = z.object({
    effectScore: z.number().int().min(1).max(5).default(5),
    progressNote: z.string().trim().min(4).max(1000).optional()
  }).parse((await readBody(event).catch(() => null)) ?? {})
  const db = useDb(event)

  const [plan] = await db.select({
    id: schema.plans.id,
    schoolId: schema.plans.schoolId,
    ownerUserId: schema.plans.ownerUserId,
    module: schema.plans.module,
    actions: schema.plans.actions,
    report: schema.plans.report,
    tools: schema.plans.tools,
    status: schema.plans.status,
    acceptedAt: schema.plans.acceptedAt,
    updatedAt: schema.plans.updatedAt
  })
    .from(schema.plans)
    .where(and(
      eq(schema.plans.id, id),
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.schoolId, schoolId)
    ))
    .limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })
  if (!canReviewPlan(plan)) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '请先接受方案，再进行完成确认' })
  }

  const actionRows = await ensurePlanActions(event, plan.id, user.id)
  const displayedActions = await resolveDisplayedPlanActions(event, {
    module: plan.module,
    schoolId,
    report: plan.report,
    actions: actionRows,
    tools: plan.tools
  })
  // 与方案页「N/N 项完成」同一套口径：只认展示层里纳入方案的可执行行动。
  const executableActions = displayedActions.filter(action => action.decision === 'included')
  const unfinished = executableActions.filter(action => action.status !== 'completed')
  if (!executableActions.length) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '方案还没有可执行的行动，暂不能确认完成' })
  }
  if (unfinished.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'INVALID_TRANSITION',
      message: `还有 ${unfinished.length} 项行动未完成，全部完成后再确认目标达成`
    })
  }

  const now = new Date()
  const progressNote = body.progressNote || DEFAULT_PROGRESS_NOTE
  // 状态口径复用复盘决策：close_success → completed，避免与通用复盘接口各写一份映射。
  const nextStatus = planStatusAfterReview({ effectScore: body.effectScore, decision: 'close_success' })
  const review = await db.transaction(async (tx) => {
    const [created] = await tx.insert(schema.planReviews).values({
      schoolId: plan.schoolId,
      ownerUserId: user.id,
      planId: plan.id,
      reviewAt: now,
      effectScore: body.effectScore,
      progressNote,
      nextAction: DEFAULT_NEXT_ACTION,
      decision: 'close_success'
    }).returning()
    if (!created) throw createError({ statusCode: 500, message: '完成确认保存失败' })

    const [updatedPlan] = await tx.update(schema.plans).set({
      status: nextStatus,
      completedAt: nextStatus === 'completed' ? now : null,
      closedAt: ['completed', 'closed'].includes(nextStatus) ? now : null,
      updatedAt: now
    }).where(and(
      eq(schema.plans.id, plan.id),
      eq(schema.plans.ownerUserId, user.id),
      eq(schema.plans.schoolId, schoolId),
      eq(schema.plans.status, plan.status),
      // updated_at 由 now() 写入时带微秒尾数，JS Date 只有毫秒精度，
      // 直接等值比较会恒失败（乐观锁误报冲突），两侧统一按毫秒截断。
      sql`date_trunc('milliseconds', ${schema.plans.updatedAt}) = ${plan.updatedAt}::timestamptz`
    )).returning({ id: schema.plans.id })
    if (!updatedPlan) {
      throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '方案状态已变化，请刷新后重试' })
    }
    await recordPlanOperationEvent(event, {
      schoolId,
      ownerUserId: user.id,
      planId: plan.id,
      eventType: 'plan_closed',
      metadata: {
        status: nextStatus,
        decision: 'close_success',
        completedActions: executableActions.length,
        via: 'complete_shortcut'
      }
    }, tx)
    return created
  })

  await writeAudit(event, {
    schoolId,
    actorId: user.id,
    action: 'plan.review.create',
    targetType: 'plan',
    targetId: plan.id,
    metadata: { decision: 'close_success', status: nextStatus, via: 'complete_shortcut' }
  })
  await trackProductEvent(event, {
    schoolId,
    userId: user.id,
    eventName: 'plan_review_completed',
    targetType: 'plan',
    targetId: plan.id,
    metadata: {
      effectScore: body.effectScore,
      completedActions: executableActions.length,
      decision: 'close_success',
      status: nextStatus,
      via: 'complete_shortcut'
    }
  })
  return review
})

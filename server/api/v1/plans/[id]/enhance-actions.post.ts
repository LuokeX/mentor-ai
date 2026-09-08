// POST /api/v1/plans/[id]/enhance-actions — 手动重跑「AI 改写实施方案」
//
// 方案页在 aiActionsStatus=failed 时展示「重新生成实施方案」入口：三库机械条目
// 不作为最终正文展示，教师点一次即把当前方案的工具/行动重新交给 DeepSeek 改写。
// 接口只把状态置回 pending 并 fire-and-forget 触发增强，请求立即返回；结果由
// 方案详情页轮询 aiActionsStatus 感知（与提交后的后台增强同一套语义）。
import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { enhancePlanActions } from '../../../../domain/plan-action-enhancement'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { schema, useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const schoolId = user.schoolId
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const db = useDb(event)

  const [plan] = await db.select({
    id: schema.plans.id,
    module: schema.plans.module,
    tools: schema.plans.tools,
    actions: schema.plans.actions,
    aiActionsStatus: schema.plans.aiActionsStatus
  }).from(schema.plans).where(and(
    eq(schema.plans.id, id),
    eq(schema.plans.ownerUserId, user.id),
    eq(schema.plans.schoolId, schoolId)
  )).limit(1)
  if (!plan) throw createError({ statusCode: 404, message: '方案不存在' })
  if (plan.aiActionsStatus === 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: 'AI 正在生成实施方案，请稍候' })
  }

  // 置回 pending 并刷新 updatedAt：读取侧用 updatedAt 判断「任务丢失」，
  // 不刷新会让旧方案在下一轮询被立刻收敛为 failed。
  // 同时清空完成标记：本次改写前的正文状态未知，由本次改写结果决定是否重新标记。
  const now = new Date()
  const [updated] = await db.update(schema.plans).set({
    aiActionsStatus: 'pending',
    aiActionsEnhancedAt: null,
    updatedAt: now
  }).where(and(
    eq(schema.plans.id, id),
    eq(schema.plans.ownerUserId, user.id),
    eq(schema.plans.schoolId, schoolId),
    ne(schema.plans.aiActionsStatus, 'pending')
  )).returning({ updatedAt: schema.plans.updatedAt })
  if (!updated) {
    throw createError({ statusCode: 409, statusMessage: 'EDIT_CONFLICT', message: 'AI 正在生成实施方案，请稍候' })
  }

  const module = moduleIdSchema.parse(plan.module)

  // 改写输入由 enhancePlanActions 自行从方案行读取（plans.tools + 归因建议行动），
  // 保证「方案里展示什么」与「AI 必须覆盖什么」一致。
  void enhancePlanActions(event, {
    planId: plan.id,
    schoolId,
    ownerUserId: user.id,
    module,
    expectedPlanUpdatedAt: updated.updatedAt
  })

  await writeAudit(event, {
    schoolId,
    actorId: user.id,
    action: 'plan.actions.enhance',
    targetType: 'plan',
    targetId: plan.id,
    metadata: {
      module,
      tools: Array.isArray(plan.tools) ? plan.tools.length : 0,
      actions: Array.isArray(plan.actions) ? plan.actions.length : 0
    }
  })

  return { status: 'pending' }
})

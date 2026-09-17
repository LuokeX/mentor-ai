import { z } from 'zod'
import { moduleIdSchema, severitySchema } from './contracts'

/**
 * 接受前被安全熔断冻结的方案：状态 `escalated` 但没有 `acceptedAt`。
 *
 * 必须与「复盘判定需要协同」升级出的 `escalated`（`acceptedAt` 非空、仍可复盘、
 * 行动只读）区分开：接受前冻结的方案执行路径已切换为转介处置，既不能接受、
 * 不能执行，也不能复盘，教师端只保留一份停止说明。判定放在 shared 是为了让
 * 服务端路由与方案页用同一个条件，避免两处各写一半导致状态显示与接口不一致。
 */
export function isPlanFrozenBeforeAcceptance(plan: { status?: string | null, acceptedAt?: string | Date | null }) {
  return plan.status === 'escalated' && !plan.acceptedAt
}

/**
 * 冻结方案的教师端受限载荷：只保留标识与转介处置信息，不下发方案正文。
 *
 * `freeze` 为 null 表示没找到触发冻结的那次提交（历史数据或事件写入失败），
 * 此时前端只展示停止说明，不展示转介引导卡，避免出现无依据的处置指引。
 */
export type PlanFrozenNotice = {
  id: string
  module: string
  title: string
  titleFull: string | null
  sourceType: string | null
  status: string
  acceptedAt: null
  createdAt: string | Date
  updatedAt: string | Date
  frozenBeforeAcceptance: true
  freeze: {
    frozenAt: string | Date
    eventId: string
    guide: string
    helpPhone: string | null
    ackMinutes: number
    escalationMinutes: number
    psychologistAssigned: boolean
  } | null
}

export const planStatusSchema = z.enum([
  'pending_acceptance',
  'accepted',
  'in_progress',
  'review_due',
  'adjustment_needed',
  'completed',
  'closed',
  'escalated',
  'archived'
])

export const planAcceptanceSchema = z.object({
  decision: z.enum(['accepted', 'deferred', 'not_applicable']),
  reason: z.string().trim().max(500).optional()
}).superRefine((value, context) => {
  if (value.decision !== 'accepted' && (!value.reason || value.reason.length < 4)) {
    context.addIssue({ code: 'custom', path: ['reason'], message: '请填写原因' })
  }
})

export const planActionDecisionSchema = z.enum(['pending', 'included', 'rejected'])

export const planActionRejectReasonSchema = z.enum([
  'vague',
  'scene_mismatch',
  'unnatural_script',
  'impractical_or_hard',
  'other'
])

export const planActionDecisionUpdateSchema = z.object({
  decision: z.enum(['included', 'rejected']),
  reason: planActionRejectReasonSchema.optional(),
  note: z.string().trim().max(200).optional()
}).superRefine((value, context) => {
  if (value.decision === 'rejected' && !value.reason) {
    context.addIssue({ code: 'custom', path: ['reason'], message: '请选择暂不接受原因' })
  }
  if (value.decision === 'rejected' && value.reason === 'other' && (!value.note || value.note.length < 2)) {
    context.addIssue({ code: 'custom', path: ['note'], message: '请补充其他原因' })
  }
})

export const planActionStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'blocked', 'skipped', 'cancelled'])

export const planActionBlockReasonSchema = z.enum([
  'time_limited',
  'student_unavailable',
  'guardian_uncooperative',
  'tool_not_applicable',
  'action_too_hard',
  'risk_escalated',
  'need_collaboration',
  'other'
])

export const planReviewDecisionSchema = z.enum([
  'continue_plan',
  'adjust_actions',
  'need_collaboration',
  'close_success',
  'close_no_longer_needed'
])

export const assessmentReportSchema = z.object({
  profile: z.object({
    title: z.string().trim().min(2).max(80),
    summary: z.string().trim().min(10).max(700),
    primaryConcern: z.string().trim().min(2).max(120)
  }),
  risk: z.object({
    level: z.string().trim().min(1).max(40),
    label: z.string().trim().min(1).max(80),
    // 等级码由业务在 ⑤e 自定义（green / L1 / LP2 / norming…），前端无法据此取色。
    // severity 是固定枚举，是唯一能稳定映射到颜色的字段。
    severity: severitySchema.optional(),
    description: z.string().trim().min(10).max(500),
    nonDiagnosticNote: z.string().trim().min(10).max(300)
  }),
  /**
   * 归因构成。只给强弱标签和排序，不给占比小数——占比是规则匹配强度，
   * 直接展示百分比会被班主任当成测量精度承诺。完整占比留在方案快照里做溯源。
   */
  attributions: z.array(z.object({
    name: z.string().trim().min(2).max(120),
    strength: z.enum(['primary', 'secondary', 'reference']),
    // 多信号案例（如学生个案）单条归因的命中依据可超过 8 条；放宽到 12，
    // 校验前由 validateAssessmentReport 对模型输出截断归一化到该上限，避免误判失败回退模板。
    reasons: z.array(z.string().trim().min(2).max(500)).max(12).default([])
  })).max(5).default([]),
  printMeta: z.object({
    module: moduleIdSchema,
    moduleTitle: z.string().trim().min(2).max(80),
    generatedAt: z.string().datetime(),
    assessmentVersion: z.string().trim().min(1).max(80),
    // 分级规则 ID + 全部命中的证据编码，条数随归因证据增长
    ruleIds: z.array(z.string().trim().min(1).max(120)).min(1).max(40),
    source: z.enum(['ai', 'template']),
    disclaimer: z.string().trim().min(10).max(400)
  })
})

export const planReviewCreateSchema = z.object({
  reviewAt: z.string().datetime().optional(),
  effectScore: z.number().int().min(1).max(5),
  progressNote: z.string().trim().min(4).max(1000),
  nextAction: z.string().trim().min(2).max(500),
  decision: planReviewDecisionSchema.default('continue_plan'),
  completedActionIds: z.array(z.string().uuid()).max(20).optional(),
  // 试用期保留一个版本，供旧客户端平滑迁移。
  completedActionIndices: z.array(z.number().int().min(0)).max(20).optional()
})

export const planActionExecutionSchema = z.object({
  executedAt: z.string().datetime().optional(),
  executionNote: z.string().trim().min(1).max(500).optional(),
  blockReason: planActionBlockReasonSchema.optional(),
  blockNote: z.string().trim().max(500).optional(),
  evidenceType: z.enum(['observation', 'communication', 'artifact', 'none']).default('none'),
  evidenceSummary: z.string().trim().max(500).optional(),
  teacherConfidence: z.number().int().min(1).max(5).optional()
}).superRefine((value, context) => {
  if (value.blockReason && value.blockReason === 'other' && (!value.blockNote || value.blockNote.length < 2)) {
    context.addIssue({ code: 'custom', path: ['blockNote'], message: '选择其他原因时请补充说明' })
  }
})

export const planFeedbackCreateSchema = z.object({
  actionId: z.string().uuid().optional(),
  ruleIds: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  toolCodes: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  attributionAccuracy: z.number().int().min(1).max(5),
  toolUsability: z.number().int().min(1).max(5),
  scriptNaturalness: z.number().int().min(1).max(5),
  actionDifficulty: z.number().int().min(1).max(5),
  tags: z.array(z.enum(['归因准确', '工具可用', '话术自然', '行动过难', '需要人工协同', '场景不匹配'])).max(8).default([]),
  note: z.string().trim().max(500).optional()
})

export type AssessmentReport = z.infer<typeof assessmentReportSchema>
export type PlanReviewCreate = z.infer<typeof planReviewCreateSchema>
export type PlanFeedbackCreate = z.infer<typeof planFeedbackCreateSchema>
export type PlanStatus = z.infer<typeof planStatusSchema>
export type PlanActionStatus = z.infer<typeof planActionStatusSchema>
export type PlanActionDecision = z.infer<typeof planActionDecisionSchema>
export type PlanActionRejectReason = z.infer<typeof planActionRejectReasonSchema>
export type PlanActionBlockReason = z.infer<typeof planActionBlockReasonSchema>
export type PlanReviewDecision = z.infer<typeof planReviewDecisionSchema>

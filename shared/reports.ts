import { z } from 'zod'
import { moduleIdSchema, severitySchema } from './contracts'

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
    reasons: z.array(z.string().trim().min(2).max(500)).max(8).default([])
  })).max(5).default([]),
  /** 归因叙述：attribution 类型输出模板的渲染结果。无归因命中时不生成。 */
  attributionNarrative: z.string().trim().min(4).max(500).optional(),
  evidence: z.array(z.object({
    title: z.string().trim().min(2).max(100),
    detail: z.string().trim().min(4).max(400)
  })).min(1).max(8),
  /** 工具导读：tool 类型输出模板的渲染结果，置于工具卡列表前。无匹配工具时不生成。 */
  toolIntro: z.string().trim().min(4).max(400).optional(),
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

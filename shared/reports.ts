import { z } from 'zod'
import { moduleIdSchema } from './contracts'

export const reportActionSchema = z.object({
  title: z.string().trim().min(2).max(80),
  detail: z.string().trim().min(4).max(300)
})

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
    description: z.string().trim().min(10).max(500),
    nonDiagnosticNote: z.string().trim().min(10).max(300)
  }),
  evidence: z.array(z.object({
    title: z.string().trim().min(2).max(100),
    detail: z.string().trim().min(4).max(400)
  })).min(1).max(8),
  threeDayPlan: z.array(z.object({
    day: z.number().int().min(1).max(3),
    title: z.string().trim().min(2).max(80),
    actions: z.array(reportActionSchema).min(1).max(3)
  })).length(3),
  sevenDayFollowUp: z.object({
    observationPoints: z.array(z.string().trim().min(2).max(160)).min(1).max(5),
    reviewQuestions: z.array(z.string().trim().min(2).max(160)).min(1).max(5),
    escalationSignals: z.array(z.string().trim().min(2).max(180)).min(1).max(5)
  }),
  scripts: z.array(z.object({
    scenario: z.string().trim().min(2).max(80),
    text: z.string().trim().min(6).max(500)
  })).min(1).max(5),
  supportGoal: z.object({
    weeklyGoal: z.string().trim().min(4).max(240),
    observableChange: z.string().trim().min(4).max(240),
    avoidGoal: z.string().trim().min(4).max(240)
  }).optional(),
  firstAction: z.object({
    title: z.string().trim().min(2).max(80),
    detail: z.string().trim().min(4).max(300)
  }).optional(),
  toolPrescriptions: z.array(z.object({
    title: z.string().trim().min(2).max(120),
    applicableWhen: z.string().trim().min(4).max(300),
    steps: z.array(z.string().trim().min(2).max(300)).min(1).max(8),
    script: z.string().trim().max(500).optional(),
    prohibitions: z.array(z.string().trim().min(2).max(240)).default([]),
    outputArtifact: z.string().trim().max(160).optional(),
    estimatedTime: z.string().trim().max(80).optional()
  })).max(6).optional(),
  escalationConditions: z.array(z.string().trim().min(2).max(200)).max(6).optional(),
  successCriteria: z.array(z.string().trim().min(2).max(200)).max(6).optional(),
  printMeta: z.object({
    module: moduleIdSchema,
    moduleTitle: z.string().trim().min(2).max(80),
    generatedAt: z.string().datetime(),
    assessmentVersion: z.string().trim().min(1).max(80),
    ruleIds: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
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
  reviewUsefulness: z.number().int().min(1).max(5),
  tags: z.array(z.enum(['归因准确', '工具可用', '话术自然', '行动过难', '需要人工协同', '场景不匹配', '复盘有效'])).max(8).default([]),
  note: z.string().trim().max(500).optional()
})

export type AssessmentReport = z.infer<typeof assessmentReportSchema>
export type PlanReviewCreate = z.infer<typeof planReviewCreateSchema>
export type PlanFeedbackCreate = z.infer<typeof planFeedbackCreateSchema>
export type PlanStatus = z.infer<typeof planStatusSchema>
export type PlanActionStatus = z.infer<typeof planActionStatusSchema>
export type PlanActionBlockReason = z.infer<typeof planActionBlockReasonSchema>
export type PlanReviewDecision = z.infer<typeof planReviewDecisionSchema>

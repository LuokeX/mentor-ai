import { z } from 'zod'
import { moduleIdSchema } from './contracts'

export const reportActionSchema = z.object({
  title: z.string().trim().min(2).max(80),
  detail: z.string().trim().min(4).max(300)
})

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
  completedActionIds: z.array(z.string().uuid()).max(20).optional(),
  // 试用期保留一个版本，供旧客户端平滑迁移。
  completedActionIndices: z.array(z.number().int().min(0)).max(20).optional()
})

export const planActionExecutionSchema = z.object({
  executedAt: z.string().datetime().optional(),
  executionNote: z.string().trim().min(1).max(500).optional()
})

export type AssessmentReport = z.infer<typeof assessmentReportSchema>
export type PlanReviewCreate = z.infer<typeof planReviewCreateSchema>

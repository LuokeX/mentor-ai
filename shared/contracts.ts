import { z } from 'zod'

export const roleSchema = z.enum(['teacher', 'psychologist', 'school_admin', 'platform_admin'])
export const moduleIdSchema = z.enum(['self_growth', 'class_system', 'home_school', 'student_case'])
export const targetTypeSchema = z.enum([
  'teacher_profile', 'assessment', 'conversation', 'student_case', 'guardian_communication', 'plan'
])
export const reasonCategorySchema = z.enum([
  'risk_review', 'complaint_handling', 'data_correction_verification', 'school_duty', 'other'
])

export const loginRequestSchema = z.object({
  email: z.string().trim().email().transform(value => value.toLowerCase()),
  password: z.string().min(8).max(200),
  otp: z.preprocess(
    value => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().regex(/^\d{6}$/).optional()
  )
})

export const adminAccessRequestSchema = z.object({
  schoolId: z.string().uuid().optional(),
  targetType: targetTypeSchema,
  targetId: z.string().uuid(),
  reasonCategory: reasonCategorySchema,
  reasonText: z.string().trim().min(10).max(500)
})

export const chatMessageSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(4000)
})

export const knowledgeBaseCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).optional(),
  scope: z.enum(['global', 'school']),
  schoolId: z.string().uuid().optional()
}).superRefine((value, context) => {
  if (value.scope === 'school' && !value.schoolId) {
    context.addIssue({ code: 'custom', path: ['schoolId'], message: '校级知识库必须选择学校' })
  }
  if (value.scope === 'global' && value.schoolId) {
    context.addIssue({ code: 'custom', path: ['schoolId'], message: '全局知识库不能绑定学校' })
  }
})

export const knowledgeDocumentImportSchema = z.object({
  title: z.string().trim().min(2).max(200),
  sourceType: z.enum(['markdown', 'text', 'json']),
  originalFilename: z.string().trim().max(260).optional(),
  mimeType: z.string().trim().max(120).optional(),
  content: z.string().min(10).max(1_000_000),
  confirmNoPersonalData: z.literal(true)
})

export const knowledgeBaseActionSchema = z.object({ action: z.enum(['publish', 'archive', 'restore']) })

export const routeDecisionSchema = z.object({
  primaryModule: moduleIdSchema,
  secondaryModules: z.array(z.object({ module: moduleIdSchema, confidence: z.number().min(0).max(1) })).max(3),
  confidence: z.number().min(0).max(1),
  needsClarification: z.boolean(),
  clarification: z.string().optional(),
  rationale: z.string().max(500)
})

export type ModuleId = z.infer<typeof moduleIdSchema>
export type RouteDecision = z.infer<typeof routeDecisionSchema>

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
  message: z.string().trim().min(1).max(4000),
  contextType: z.enum(['student', 'class', 'guardian']).optional(),
  contextId: z.string().uuid().optional()
}).superRefine((value, context) => {
  if (Boolean(value.contextType) !== Boolean(value.contextId)) {
    context.addIssue({ code: 'custom', path: ['contextId'], message: 'contextType 和 contextId 必须同时提供' })
  }
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

// ---- 评估系统可配置化 ----
// 题库 payload 存入 content_packages (type='assessment')
export interface AssessmentPayload {
  code: string
  version: string
  module: ModuleId
  title: string
  description: string
  estimatedMinutes: number
  questions: Array<{
    id: string
    text: string
    dimension: string
    help?: string
    reverse?: boolean
    options: Array<{ label: string, value: number }>
  }>
}

// 受限表达式语言 —— 规则 DSL 的 when 条件
// 支持: 变量引用、比较运算(>/</>=/<=/==/!=)、逻辑运算(&&/||)、括号分组
// 不支持: 函数调用、循环、赋值
export interface RuleConfig {
  module: ModuleId
  version: string
  // 中间变量: 从 answers 计算得出
  computed: Record<string, string>  // 变量名 -> 表达式 (SUM/MAX/MIN/SCORE/RAW)
  // 条件分支（按 priority 优先级排序）
  branches: Array<{
    pri: number
    when?: string           // 若省略则总是匹配（默认分支）
    level: string
    blocked: boolean
    ruleId: string
    reasons: string[]
  }>
  // 输出模板
  actions: Array<{ title: string, detail: string, status: 'pending' }>
  tools: Array<{ title: string, content: string }>
  // 安全红线（可选）
  crisis?: { when: string, blocked: boolean }
}

// 规则执行结果（与现有 RuleOutput 一致）
export interface RuleExecResult {
  level: string
  reasons: string[]
  blocked: boolean
  matchedRuleIds: string[]
  dimensions: Record<string, number>
  actions: Array<{ title: string, detail: string, status: 'pending' }>
  tools: Array<{ title: string, content: string }>
}

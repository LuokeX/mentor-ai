import { z } from 'zod'

export const roleSchema = z.enum(['teacher', 'psychologist', 'school_admin', 'platform_admin'])
export const moduleIdSchema = z.enum(['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem'])
export const libraryTypeSchema = z.enum(['assessment', 'attribution', 'tool'])
export const moduleResourceScopeSchema = z.enum(['global', 'school'])
export const resourceStatusSchema = z.enum(['draft', 'published', 'retired'])
export const managedRecordStatusSchema = z.enum(['active', 'archived', 'transferred', 'graduated'])
export const departmentTypeSchema = z.enum(['administration', 'grade_group', 'subject_group', 'student_support', 'other'])
export const delegatedManagementScopeSchema = z.enum(['users', 'teachers', 'departments', 'classes', 'students', 'guardians'])
export const targetTypeSchema = z.enum([
  'teacher_profile', 'assessment', 'conversation', 'student_case', 'guardian_communication', 'plan',
  'user', 'department', 'class', 'student', 'guardian', 'school', 'delegated_management_grant'
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
  ),
  recoveryCode: z.preprocess(
    value => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().regex(/^[A-F0-9]{6}-[A-F0-9]{6}$/i).optional()
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
  contextId: z.string().uuid().optional(),
  withoutRecord: z.boolean().optional()
}).superRefine((value, context) => {
  if (Boolean(value.contextType) !== Boolean(value.contextId)) {
    context.addIssue({ code: 'custom', path: ['contextId'], message: 'contextType 和 contextId 必须同时提供' })
  }
})

export const moduleResourceDocumentImportSchemaBase = z.object({
  title: z.string().trim().min(2).max(200),
  sourceType: z.enum(['markdown', 'text', 'json']),
  originalFilename: z.string().trim().max(260).optional(),
  mimeType: z.string().trim().max(120).optional(),
  content: z.string().min(10).max(1_000_000),
  confirmNoPersonalData: z.literal(true)
})

export const moduleResourceLibraryCreateSchema = z.object({
  module: moduleIdSchema,
  libraryType: libraryTypeSchema,
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).optional(),
  scope: moduleResourceScopeSchema,
  schoolId: z.string().uuid().optional()
}).superRefine((value, context) => {
  if (value.scope === 'school' && !value.schoolId) {
    context.addIssue({ code: 'custom', path: ['schoolId'], message: '校本资源库必须选择学校' })
  }
  if (value.scope === 'global' && value.schoolId) {
    context.addIssue({ code: 'custom', path: ['schoolId'], message: '平台资源库不能绑定学校' })
  }
})

export const moduleResourceVersionCreateSchema = z.object({
  libraryId: z.string().uuid(),
  version: z.string().trim().min(1).max(40),
  payload: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().trim().max(1000).optional()
})

export const moduleResourceVersionActionSchema = z.object({ action: z.enum(['publish', 'retire', 'rollback']) })

export const moduleResourceDocumentImportSchema = moduleResourceDocumentImportSchemaBase.extend({
  versionId: z.string().uuid()
})

// ---- 工具库·处方型 (tool-rx) ----
export const toolRxEntrySchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  form: z.string().trim().min(1).max(100),
  symptoms: z.string().trim().min(1).max(2000),
  expectedEffect: z.string().trim().max(2000).optional(),
  severity: z.string().trim().max(40).optional(),
  level: z.string().trim().max(40).optional(),
  attribution: z.string().trim().max(120).optional(),
  attributions: z.array(z.string().trim().min(1).max(120)).optional(),
  primaryAttribution: z.string().trim().max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).optional(),
  toolTags: z.array(z.string().trim().min(1).max(80)).optional(),
  duration: z.string().trim().max(200).optional(),
  timePerSession: z.string().trim().max(100).optional(),
  steps: z.array(z.string().trim().min(1).max(1000)).min(1),
  scripts: z.string().trim().max(5000).optional(),
  prohibitions: z.string().trim().max(2000).optional(),
  targetUsers: z.string().trim().max(200).optional(),
  dimensions: z.array(z.string().trim().min(1).max(100)).optional()
})
export const toolLibraryPayloadSchema = z.object({ tools: z.array(toolRxEntrySchema).min(1) })
export type ToolRxEntry = z.infer<typeof toolRxEntrySchema>

export const attributionBranchSchema = z.object({
  pri: z.number().int(),
  when: z.string().trim().min(1).optional(),
  level: z.string().trim().min(1).max(80),
  blocked: z.boolean().default(false),
  ruleId: z.string().trim().min(1).max(120),
  primaryAttribution: z.string().trim().min(1).max(120),
  secondaryAttributions: z.array(z.string().trim().min(1).max(120)).default([]),
  reasons: z.array(z.string().trim().min(1).max(500)).min(1),
  toolTags: z.array(z.string().trim().min(1).max(80)).default([])
})

export const attributionConfigSchema = z.object({
  module: moduleIdSchema,
  version: z.string().trim().min(1).max(40),
  computed: z.record(z.string(), z.string().trim().min(1)).default({}),
  branches: z.array(attributionBranchSchema).min(1),
  actions: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    detail: z.string().trim().min(1).max(1000),
    status: z.literal('pending').default('pending')
  })).default([]),
  tools: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(2000)
  })).default([]),
  crisis: z.object({ when: z.string().trim().min(1), blocked: z.boolean() }).optional()
})
export type AttributionConfig = z.infer<typeof attributionConfigSchema>

export const moduleToolPayloadSchema = z.object({
  title: z.string().trim().min(2).max(120),
  scenario: z.string().trim().min(2).max(500),
  steps: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  doNot: z.array(z.string().trim().min(1).max(500)).default([]),
  relatedModule: moduleIdSchema,
  sourceRefs: z.array(z.string().trim().min(1).max(120)).default([]),
  version: z.string().trim().min(1).max(40)
})

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: z.union([managedRecordStatusSchema, z.literal('all')]).default('all'),
  sort: z.string().trim().max(40).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc')
})

export const schoolAdminUserCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().transform(value => value.toLowerCase()),
  role: z.enum(['teacher', 'psychologist']),
  password: z.string().min(8).max(200)
})

export const schoolAdminUserInviteSchema = schoolAdminUserCreateSchema.omit({ password: true })

export const schoolAdminUserUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().transform(value => value.toLowerCase()).optional(),
  role: z.enum(['teacher', 'psychologist']).optional(),
  status: z.enum(['active', 'disabled']).optional()
}).refine(value => value.name || value.email || value.role || value.status)

export const schoolAdminDepartmentCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().max(80).optional(),
  type: departmentTypeSchema.default('other'),
  parentId: z.string().uuid().nullable().optional(),
  leaderUserId: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional()
})

export const schoolAdminDepartmentUpdateSchema = schoolAdminDepartmentCreateSchema.partial().extend({
  status: z.enum(['active', 'archived']).optional()
}).refine(value => Object.keys(value).length > 0)

export const schoolAdminDepartmentMemberSchema = z.object({
  userId: z.string().uuid(),
  memberRole: z.string().trim().max(80).nullable().optional()
})

export const schoolAdminClassCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  grade: z.coerce.number().int().min(1).max(12),
  ownerUserId: z.string().uuid(),
  departmentId: z.string().uuid().nullable().optional(),
  externalCode: z.string().trim().max(80).optional(),
  studentCount: z.coerce.number().int().min(0).max(1000).default(0),
  establishedAt: z.string().datetime().optional()
})

export const schoolAdminClassUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  grade: z.coerce.number().int().min(1).max(12).optional(),
  ownerUserId: z.string().uuid().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  externalCode: z.string().trim().max(80).nullable().optional(),
  studentCount: z.coerce.number().int().min(0).max(1000).optional(),
  establishedAt: z.string().datetime().nullable().optional(),
  status: managedRecordStatusSchema.optional(),
  reason: z.string().trim().max(500).optional()
}).refine(value => Object.keys(value).length > 0)

export const schoolAdminStudentCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ownerUserId: z.string().uuid().optional(),
  classId: z.string().uuid().nullable().optional(),
  gender: z.string().trim().max(20).nullable().optional(),
  profile: z.string().trim().max(4000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  externalRef: z.string().trim().max(120).nullable().optional()
})

export const schoolAdminStudentUpdateSchema = schoolAdminStudentCreateSchema.partial().extend({
  status: managedRecordStatusSchema.optional(),
  reason: z.string().trim().max(500).optional()
}).refine(value => Object.keys(value).length > 0)

export const schoolAdminGuardianCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().regex(/^1[3-9]\d{9}$/).nullable().optional(),
  relation: z.string().trim().max(40).nullable().optional(),
  externalRef: z.string().trim().max(120).nullable().optional(),
  ownerUserId: z.string().uuid().optional()
})

export const schoolAdminStudentGuardianSchema = z.object({
  guardianId: z.string().uuid().optional(),
  guardian: schoolAdminGuardianCreateSchema.optional()
}).refine(value => value.guardianId || value.guardian)

export const delegatedManagementRequestSchema = z.object({
  schoolId: z.string().uuid(),
  scopes: z.array(delegatedManagementScopeSchema).min(1).max(6),
  reason: z.string().trim().min(10).max(500)
})

export const delegatedManagementReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'revoked'])
})

export const routeDecisionSchema = z.object({
  primaryModule: moduleIdSchema,
  secondaryModules: z.array(z.object({ module: moduleIdSchema, confidence: z.number().min(0).max(1) })).max(3),
  confidence: z.number().min(0).max(1),
  needsClarification: z.boolean(),
  clarification: z.string().optional(),
  rationale: z.string().max(500)
})

export type ModuleId = z.infer<typeof moduleIdSchema>
export type LibraryType = z.infer<typeof libraryTypeSchema>
export type ModuleResourceScope = z.infer<typeof moduleResourceScopeSchema>
export type ResourceStatus = z.infer<typeof resourceStatusSchema>
export type ManagedRecordStatus = z.infer<typeof managedRecordStatusSchema>
export type DepartmentType = z.infer<typeof departmentTypeSchema>
export type DelegatedManagementScope = z.infer<typeof delegatedManagementScopeSchema>
export type RouteDecision = z.infer<typeof routeDecisionSchema>
export type ModuleToolPayload = z.infer<typeof moduleToolPayloadSchema>

// ---- AI 追问与分类机制 ----
export const clarificationRoundSchema = z.object({
  type: z.literal('clarification'),
  round: z.number().int().min(1).max(10),
  question: z.string().min(5).max(300),
  options: z.array(z.string().min(2).max(80)).min(3).max(8),
  moduleScores: z.record(moduleIdSchema, z.number().min(0).max(1))
})

export const clarificationSummarySchema = z.object({
  type: z.literal('summary'),
  answer: z.string().min(50).max(2000),
  rationale: z.string().max(500),
  primaryModule: moduleIdSchema,
  moduleProportions: z.record(moduleIdSchema, z.number().min(0).max(1)),
  suggestedActions: z.array(z.object({
    label: z.string(),
    type: z.enum(['open_module', 'record', 'tool']),
    module: moduleIdSchema.optional()
  })).max(4)
})

export type ClarificationRound = z.infer<typeof clarificationRoundSchema>
export type ClarificationSummary = z.infer<typeof clarificationSummarySchema>

// ---- 评估系统可配置化 ----
// 题库 payload 存入 content_packages (type='assessment')
export interface AssessmentPayload {
  code: string
  instrumentCode?: string
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
    primaryAttribution?: string
    secondaryAttributions?: string[]
    toolTags?: string[]
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
  primaryAttribution: string
  secondaryAttributions: string[]
  toolTags: string[]
  dimensions: Record<string, number>
  actions: Array<{ title: string, detail: string, status: 'pending' }>
  tools: Array<{ title: string, content: string }>
}

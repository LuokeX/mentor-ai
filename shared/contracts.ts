import { z } from 'zod'

export const roleSchema = z.enum(['teacher', 'psychologist', 'school_admin', 'platform_admin'])
export const moduleIdSchema = z.enum(['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem'])
export const libraryTypeSchema = z.enum(['assessment', 'attribution', 'tool', 'output_template', 'keyword_route'])
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
  confirmNoPersonalData: z.boolean().optional().default(true),
  module: moduleIdSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  sourceRef: z.string().trim().max(500).optional()
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
  versionId: z.string().uuid().optional()
})

export const moduleResourceFileImportSchema = z.object({
  libraryId: z.string().uuid().optional(),
  module: moduleIdSchema,
  libraryType: libraryTypeSchema,
  scope: moduleResourceScopeSchema.default('global'),
  schoolId: z.string().uuid().optional(),
  libraryName: z.string().trim().min(2).max(160).optional(),
  libraryDescription: z.string().trim().max(1000).optional(),
  version: z.string().trim().min(1).max(40),
  notes: z.string().trim().max(1000).optional(),
  filename: z.string().trim().min(1).max(260),
  contentBase64: z.string().min(4).max(16_000_000),
  confirmNoPersonalData: z.literal(true),
  publish: z.boolean().default(false)
}).superRefine((value, context) => {
  if (value.scope === 'school' && !value.schoolId) {
    context.addIssue({ code: 'custom', path: ['schoolId'], message: '校本资源库必须选择学校' })
  }
  if (value.scope === 'global' && value.schoolId) {
    context.addIssue({ code: 'custom', path: ['schoolId'], message: '平台资源库不能绑定学校' })
  }
  if (!value.libraryId && !value.libraryName) {
    context.addIssue({ code: 'custom', path: ['libraryName'], message: '新建资源库时必须填写名称' })
  }
})
export type ModuleResourceFileImport = z.infer<typeof moduleResourceFileImportSchema>

// ---- 工具库·处方型 (tool-rx) ----
// V2 字段映射: ⑦ 工具-处方总表 + ⑦b 工具-步骤明细 + ⑧ 工具-禁忌规则
export const toolContraindicationRuleSchema = z.object({
  condition: z.string().trim().min(1).max(500),
  type: z.enum(['block', 'warn']),
  description: z.string().trim().min(1).max(1000),
  alternativeSuggestion: z.string().trim().max(1000).optional(),
  applicableTeacherGroup: z.string().trim().max(200).optional(),
  reference: z.string().trim().max(500).optional()
})

export const toolStructuredStepSchema = z.object({
  seq: z.number().int().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  estimatedTime: z.string().trim().max(100).optional(),
  materials: z.string().trim().max(500).optional(),
  keyTip: z.string().trim().max(1000).optional(),
  scriptTemplate: z.string().trim().max(3000).optional(),
  successCriteria: z.string().trim().max(1000).optional(),
  commonIssues: z.string().trim().max(1000).optional()
})

export const toolRxEntrySchema = z.object({
  // ---- 已有字段 (兼容 V1) ----
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
  dimensions: z.array(z.string().trim().min(1).max(100)).optional(),
  // ---- V2 新增字段 ----
  shortName: z.string().trim().max(80).optional(),
  prerequisiteToolCode: z.string().trim().max(40).optional(),
  alternativeToolCode: z.string().trim().max(40).optional(),
  advancedToolCode: z.string().trim().max(40).optional(),
  evidenceLevel: z.enum(['A', 'B', 'C', 'D']).optional(),
  evidenceSource: z.string().trim().max(1000).optional(),
  outcomeIndicators: z.string().trim().max(1000).optional(),
  failureCriteria: z.string().trim().max(1000).optional(),
  preparationNeeded: z.string().trim().max(1000).optional(),
  materialsRequired: z.string().trim().max(1000).optional(),
  outputArtifact: z.string().trim().max(500).optional(),
  collaborativeToolCodes: z.array(z.string().trim().min(1).max(40)).optional(),
  crossModuleTags: z.array(z.string().trim().min(1).max(80)).optional(),
  sourceRef: z.string().trim().max(500).optional(),
  // V2 模板补齐
  applicableSchoolSection: z.string().trim().max(40).optional(),
  reAssessmentIntervalDays: z.number().int().min(0).optional(),
  contraindicationNote: z.string().trim().max(2000).optional(),
  toolVersion: z.string().trim().max(40).optional(),
  structuredSteps: z.array(toolStructuredStepSchema).optional(),
  contraindicationRules: z.array(toolContraindicationRuleSchema).optional()
})
export const toolLibraryPayloadSchema = z.object({ tools: z.array(toolRxEntrySchema).min(1) }).passthrough()
export type ToolRxEntry = z.infer<typeof toolRxEntrySchema>
export type ToolStructuredStep = z.infer<typeof toolStructuredStepSchema>
export type ToolContraindicationRule = z.infer<typeof toolContraindicationRuleSchema>

// ---- V2 新增: 方案输出模板 (output_template) ----
// V2 字段映射: ⑩ 方案输出模板
export const outputTemplateEntrySchema = z.object({
  code: z.string().trim().min(1).max(40),
  module: moduleIdSchema,
  attributionLevel: z.string().trim().min(1).max(80),  // 命中归因等级
  type: z.enum(['summary', 'conclusion', 'attribution', 'goal', 'action', 'tool', 'caution', 'review']),
  content: z.string().trim().min(1).max(5000),          // 含 ${占位符} 的模板文本
  placeholders: z.string().trim().max(2000).optional(),  // 占位符说明
  order: z.number().int().min(0)
})
export const outputTemplateLibraryPayloadSchema = z.object({ templates: z.array(outputTemplateEntrySchema).min(1) }).passthrough()
export type OutputTemplateEntry = z.infer<typeof outputTemplateEntrySchema>

// ---- V2 新增: 关键词-路由 (keyword_route) ----
// V2 字段映射: ⑨ 关键词-路由
export const keywordRouteEntrySchema = z.object({
  code: z.string().trim().min(1).max(40),
  coreKeywords: z.string().trim().min(1).max(500),       // 核心触发词（逗号分隔）
  expandedKeywords: z.string().trim().max(2000).optional(), // 扩展词与近义表达
  exclusionKeywords: z.array(z.string().trim().min(1).max(100)).optional(),
  module: moduleIdSchema,
  matchPriority: z.number().int().min(0),
  matchMode: z.enum(['exact', 'fuzzy', 'regex']).default('fuzzy'),
  riskLevel: z.string().trim().min(1).max(40),
  semanticCategory: z.string().trim().max(200).optional(),
  linkedAssessmentCode: z.string().trim().max(40).optional(),
  linkedToolCode: z.string().trim().max(40).optional(),
  contextConstraint: z.string().trim().max(1000).optional(), // 情境限定
  routeWeight: z.number().min(0).max(1).optional(),
  temporalValidity: z.enum(['always', 'pre_term', 'pre_exam', 'holiday']).default('always'),
  description: z.string().trim().max(2000).optional()        // 场景描述
})
export const keywordRouteLibraryPayloadSchema = z.object({ routes: z.array(keywordRouteEntrySchema).min(1) }).passthrough()
export type KeywordRouteEntry = z.infer<typeof keywordRouteEntrySchema>

// ---- 归因规则库 (attribution) ----
export const attributionBranchSchema = z.object({
  pri: z.number().int(),
  when: z.string().trim().min(1).optional(),
  level: z.string().trim().min(1).max(80),
  blocked: z.boolean().default(false),
  ruleId: z.string().trim().min(1).max(120),
  primaryAttribution: z.string().trim().min(1).max(120),
  secondaryAttributions: z.array(z.string().trim().min(1).max(120)).default([]),
  reasons: z.array(z.string().trim().min(1).max(500)).min(1),
  toolTags: z.array(z.string().trim().min(1).max(80)).default([]),
  // V2 新增
  outputActionSummary: z.string().trim().max(1000).optional(),
  outputToolSummary: z.string().trim().max(1000).optional(),
  escalationCondition: z.string().trim().max(1000).optional(),
  escalationTarget: z.string().trim().max(200).optional(),
  reEvaluationTrigger: z.string().trim().max(1000).optional(),
  sourceRef: z.string().trim().max(500).optional(),
  // V2 模板补齐
  assessmentCode: z.string().trim().max(40).optional(),
  levelName: z.string().trim().max(80).optional(),
  resultDescription: z.string().trim().max(2000).optional()
})

// V2 字段映射: ⑤b 归因-计算变量 + ⑤c 归因-分级规则 + ⑥ 归因-红线熔断
export const redLineRuleSchema = z.object({
  module: moduleIdSchema,
  condition: z.string().trim().min(1),
  description: z.string().trim().min(1).max(2000),
  scope: z.enum(['instrument', 'module', 'system']),
  requiredActions: z.string().trim().min(1).max(2000),
  actions: z.array(z.string().trim().min(1).max(1000)).default([]),
  recoveryCondition: z.string().trim().max(1000).optional(),
  responsibleRole: z.string().trim().max(200).optional(),
  notificationTemplate: z.string().trim().max(2000).optional(),
  sourceRef: z.string().trim().max(500).optional()
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
  crisis: z.object({ when: z.string().trim().min(1), blocked: z.boolean() }).optional(),
  // V2 新增: 红线熔断规则列表
  redLines: z.array(redLineRuleSchema).default([])
}).passthrough()
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
// V2 字段映射: ③ 量表-清单 + ④ 量表-题目 + ④b 量表-选项组 + ④c 量表-维度定义
// 题库 payload 存入 content_packages (type='assessment')

export interface AssessmentDimensionDef {
  code: string
  name: string
  questionIds: string[]        // 所属题号列表
  calcMethod: 'mean' | 'sum' | 'weighted'
  weight?: number
  description?: string
  highInterpretation?: string
  lowInterpretation?: string
  normMean?: number
  normStd?: number
}

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
    subDimension?: string
    help?: string
    reverse?: boolean
    required?: boolean
    weight?: number
    displayCondition?: string
    dataUsage?: string
    questionNote?: string
    example?: string
    options: Array<{ label: string, value: number }>
  }>
  // ---- V2 新增: 量表元数据 ----
  shortName?: string
  applicableGrades?: number[]
  applicableSubjects?: string[]
  targetAudience?: string       // 施测对象
  formType?: string             // 施测形式
  triggerMethod?: 'manual' | 'auto' | 'scheduled'
  frequency?: 'once' | 'daily' | 'weekly' | 'monthly' | 'per_case' | 'semester'
  isRequired?: boolean
  timeLimitMinutes?: number
  minQuestions?: number
  usageTiming?: string          // 使用时机
  reAssessmentIntervalDays?: number
  prerequisiteCodes?: string[]
  exclusiveCodes?: string[]
  resultVisibility?: 'teacher_only' | 'teacher_and_student' | 'psychologist'
  responsibleRole?: string
  dataSensitivity?: string      // 数据敏感级
  sourceType?: string           // 来源属性
  externalAuthorizationNote?: string
  sourceRef?: string            // 手册出处
  normReference?: string
  reliabilityNote?: string
  validityNote?: string
  privacyNotice?: string
  applicabilityPreconditions?: string
  contraindications?: string
  postAssessmentActions?: string
  applicableSchoolSection?: string  // 适用学部
  // ---- V2 新增: 维度定义 ----
  dimensionDefs?: AssessmentDimensionDef[]
}

// 受限表达式语言 —— 规则 DSL 的 when 条件
// 支持: 变量引用、比较运算(>/</>=/<=/==/!=)、逻辑运算(&&/||)、括号分组
// 不支持: 函数调用、循环、赋值
export interface RedLineConfig {
  module: ModuleId
  condition: string
  description: string
  scope: 'instrument' | 'module' | 'system'
  requiredActions: string
  actions: string[]
  recoveryCondition?: string
  responsibleRole?: string
  notificationTemplate?: string
  sourceRef?: string
}

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
    // V2 新增
    outputActionSummary?: string
    outputToolSummary?: string
    escalationCondition?: string
    escalationTarget?: string
    reEvaluationTrigger?: string
    sourceRef?: string
    assessmentCode?: string
    levelName?: string
    resultDescription?: string
  }>
  // 输出模板
  actions: Array<{ title: string, detail: string, status: 'pending' }>
  tools: Array<{ title: string, content: string }>
  // 安全红线（V2 扩展: 支持多条独立红线）
  crisis?: { when: string, blocked: boolean }
  redLines?: RedLineConfig[]
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
  // V2 新增: 命中的红线信息
  matchedRedLines?: RedLineConfig[]
}

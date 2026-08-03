/**
 * 业务填写向导的输入契约。
 *
 * 为什么需要这一层：v4 模板三张主表合计 86 个必填列，其中 ③ 的 38 列运行时只读 12 列。
 * 让非技术人员逐列填写既慢又必然出错——编码要跨表对齐、条件要写表达式、权重要给数字。
 *
 * 这里只收「业务必须自己决定的东西」，全中文、无编码、无表达式。
 * 其余（所有编码、默认值、维度题号归属、选项组、优先级、严重度、条件表达式）
 * 由 server/domain/business-wizard.ts 的 compileWizardInput 生成。
 *
 * 完全对齐策略（与 v4 模板逐列核对后）：
 *   1. 模板里导入链实际消费的列，向导都有对应输入（量表/维度/归因/等级/红线/工具/步骤/关键词）。
 *   2. 一批「同一模块内高度重复」的列（适用学部、施测对象、证据等级、熔断参数等）
 *      收敛成模块级 defaults，业务设一次、编译时应用到所有行。
 *   3. 模板里导入链不消费的死列（④ 题型/权重/是否必答/显示条件/数据用途/默认分值、
 *      ③ 做完导向什么）不提供输入——填了也不进系统，避免业务以为生效。
 */
import { z } from 'zod'
import { moduleIdSchema } from './contracts'

/** 模块 → 编码前缀。生成的所有编码都带前缀，避免跨模块撞码。 */
export const WIZARD_MODULE_PREFIX: Record<string, string> = {
  self_growth: 'SG',
  class_system: 'CS',
  home_school: 'HS',
  student_case: 'SC',
  learning_problem: 'LP'
}

/**
 * 预置选项组。真实数据里翻来覆去只有这两三套，
 * 让业务为每张量表重填一遍 ④b 纯属浪费。
 */
export const WIZARD_OPTION_GROUPS = {
  FREQ_5: { label: '频率五点', hint: '几乎没有 / 很少 / 有时 / 经常 / 几乎每天', options: ['几乎没有', '很少', '有时', '经常', '几乎每天'], base: 1 },
  AGREE_5: { label: '认同五点', hint: '完全不符合 / 比较不符合 / 一般 / 比较符合 / 非常符合', options: ['完全不符合', '比较不符合', '一般', '比较符合', '非常符合'], base: 1 },
  YES_NO: { label: '是否两点', hint: '否 / 是（用于红线检查这类勾选清单）', options: ['否', '是'], base: 0 }
} as const

export const WIZARD_ROLES = ['入口筛查', '深度诊断', '专项/情境', '红线检查'] as const

/** 业务在下拉里选中文，编译器翻成运算符。业务全程不接触符号。 */
export const WIZARD_COMPARATORS = {
  达到或超过: '>=',
  低于或等于: '<=',
  正好等于: '=='
} as const

/** 模板 ② 枚举字典里「命中等级」实际用的是风险等级四档（含 none 兜底）。 */
export const WIZARD_LEVEL_ENUM = ['red', 'orange', 'yellow', 'none'] as const

/**
 * 模块级默认设置（轨 2）。
 * v4 模板里这些列在同一模块内几乎不变化，让业务逐行重填纯属浪费；
 * 向导在「选模块」步骤设一次，编译时应用到所有量表/工具/红线。
 * 值域与模板 ② 枚举字典逐项一致。
 */
export const wizardDefaultsSchema = z.object({
  /** ③/⑦ 适用学部 */
  schoolSection: z.enum(['all', 'primary', 'junior', 'senior', 'repeat']).default('all'),
  /** ③ 施测对象 */
  targetAudience: z.enum(['teacher', 'student', 'guardian', 'class']).default('teacher'),
  /** ③ 施测形式 */
  formType: z.enum(['self_report', 'observation', 'interview', 'checklist']).default('self_report'),
  /** ③ 触发方式 */
  triggerMethod: z.enum(['manual', 'auto', 'scheduled']).default('manual'),
  /** ③ 作答频次 */
  frequency: z.enum(['once', 'daily', 'weekly', 'monthly', 'per_case']).default('per_case'),
  /** ③ 结果可见性 */
  resultVisibility: z.enum(['teacher_only', 'teacher_and_student', 'psychologist']).default('teacher_only'),
  /** ③ 责任角色 */
  responsibleRole: z.string().trim().max(40).default('班主任'),
  /** ③ 数据敏感级 */
  dataSensitivity: z.enum(['internal', 'sensitive', 'highly_sensitive']).default('highly_sensitive'),
  /** ③ 来源属性 */
  sourceType: z.enum(['proprietary', 'external', 'adapted']).default('proprietary'),
  /** ⑦ 证据等级 */
  evidenceLevel: z.enum(['A', 'B', 'C', 'D']).default('B'),
  /** ⑥ 熔断范围 */
  redLineScope: z.enum(['instrument', 'module', 'system']).default('module'),
  /** ⑥ 熔断后动作 */
  redLineActions: z.string().trim().max(300).default('暂停常规方案，转安全转介流程'),
  /** ⑥ 恢复条件 */
  redLineRecovery: z.string().trim().max(300).default('专业评估确认风险解除后'),
  /** ⑥ 责任人 */
  redLineOwner: z.string().trim().max(40).default('班主任')
})
export type WizardDefaults = z.infer<typeof wizardDefaultsSchema>

/** 与 wizardDefaultsSchema 各字段默认值保持一致；zod 的 default({}) 不深展开，编译端以此兜底。 */
export const DEFAULT_WIZARD_DEFAULTS: WizardDefaults = {
  schoolSection: 'all',
  targetAudience: 'teacher',
  formType: 'self_report',
  triggerMethod: 'manual',
  frequency: 'per_case',
  resultVisibility: 'teacher_only',
  responsibleRole: '班主任',
  dataSensitivity: 'highly_sensitive',
  sourceType: 'proprietary',
  evidenceLevel: 'B',
  redLineScope: 'module',
  redLineActions: '暂停常规方案，转安全转介流程',
  redLineRecovery: '专业评估确认风险解除后',
  redLineOwner: '班主任'
}

/**
 * 一个判断条件。业务选「看哪里 + 达到什么程度」，不写表达式。
 * targetType 决定编译成 题[qN] / 维度[CODE] / 总分 / 均分 / 计算变量名。
 */
export const wizardConditionSchema = z.object({
  targetType: z.enum(['question', 'dimension', 'total', 'average', 'computed']),
  /** question 填题目序号（1 起）；dimension 填维度中文名；computed 填计算变量名；total/average 忽略 */
  target: z.string().trim().max(120).default(''),
  comparator: z.enum(['达到或超过', '低于或等于', '正好等于']).default('达到或超过'),
  value: z.coerce.number().min(0).max(100),
  /** 与上一条的关系，第一条忽略 */
  join: z.enum(['且', '或']).default('且')
})
export type WizardCondition = z.infer<typeof wizardConditionSchema>

/** ④b 自定义选项组。预置三组之外，业务可定义自己的选项组供题目引用（如四点量表、自定义选项文本）。 */
export const wizardOptionGroupSchema = z.object({
  /** 客户端生成的稳定标识；预置组直接用编码（FREQ_5/AGREE_5/YES_NO） */
  id: z.string().trim().min(1).max(40),
  /** 组名（中文），题目下拉里显示 */
  name: z.string().trim().min(1).max(40),
  /** 选项：文本 + 分值。分值留空默认按 1 起递增 */
  options: z.array(z.object({
    label: z.string().trim().min(1).max(60),
    score: z.coerce.number().min(0).max(100).optional()
  })).min(2)
})
export type WizardOptionGroup = z.infer<typeof wizardOptionGroupSchema>

export const wizardQuestionSchema = z.object({
  text: z.string().trim().min(2).max(400),
  /** 维度中文名，编译器据此生成维度编码并反推「所属题号列表」 */
  dimension: z.string().trim().min(1).max(60),
  /** 选项组 id：预置组用编码（FREQ_5/AGREE_5/YES_NO），自定义组用 optionGroups 里的 id */
  optionGroup: z.string().trim().min(1).max(40).default('FREQ_5'),
  /** 反向题＝状态越好分越高。填错方向不会报错但会让红线打在健康的人身上，所以单列出来问。 */
  reverse: z.boolean().default(false),
  /** ④ 答题提示（教师端作答时会看到） */
  help: z.string().trim().max(200).optional()
})

/** ④c 维度的附加属性。题号归属仍从题目反推，业务不用手工维护两处。 */
export const wizardDimensionSchema = z.object({
  /** 维度中文名，必须与题目里的「测哪个方面」一致 */
  name: z.string().trim().min(1).max(60),
  /** 计算方式：平均分 / 求和 / 加权 */
  calcMethod: z.enum(['mean', 'sum', 'weighted']).default('mean'),
  weight: z.coerce.number().min(0.1).max(10).default(1),
  description: z.string().trim().max(300).optional(),
  highInterpretation: z.string().trim().max(300).optional(),
  lowInterpretation: z.string().trim().max(300).optional(),
  normMean: z.coerce.number().min(0).max(100).optional(),
  normStd: z.coerce.number().min(0).max(100).optional()
})

export const wizardScaleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  role: z.enum(WIZARD_ROLES),
  shortName: z.string().trim().max(40).optional(),
  description: z.string().trim().max(400).optional(),
  minutes: z.coerce.number().min(1).max(120).optional(),
  /** 要先做完哪几张（量表名称）。硬门禁：没做完这张就点不动。 */
  prerequisites: z.array(z.string().trim()).default([]),
  exclusives: z.array(z.string().trim()).default([]),
  /** 什么情况下推荐做这张。软推荐：不满足只标「当前不需要」，教师仍可手动选。 */
  triggerConditions: z.array(wizardConditionSchema).default([]),
  /** 触发条件的人话说明，教师端会看到这句 */
  triggerNote: z.string().trim().max(200).optional(),
  usageTiming: z.string().trim().max(120).optional(),
  /** ③ 作答时限分钟 */
  timeLimitMinutes: z.coerce.number().min(1).max(120).optional(),
  /** ③ 最低题数 */
  minQuestions: z.coerce.number().min(1).max(200).optional(),
  /** ③ 重评间隔天数 */
  reAssessmentIntervalDays: z.coerce.number().min(1).max(3650).optional(),
  /** ③ 适用年级（1-12 或 0 表示全学段） */
  applicableGrades: z.array(z.coerce.number().min(0).max(12)).default([]),
  /** ③ 适用学科 */
  applicableSubjects: z.array(z.string().trim()).default([]),
  /** ③ 常模参照 */
  normReference: z.string().trim().max(300).optional(),
  /** ③ 信度说明 */
  reliabilityNote: z.string().trim().max(300).optional(),
  /** ③ 效度说明 */
  validityNote: z.string().trim().max(300).optional(),
  /** ③ 隐私声明 */
  privacyNotice: z.string().trim().max(300).optional(),
  /** ③ 适用前提 */
  applicabilityPreconditions: z.string().trim().max(300).optional(),
  /** ③ 不适合情况 */
  contraindications: z.string().trim().max(300).optional(),
  /** ③ 后续建议动作 */
  postAssessmentActions: z.string().trim().max(300).optional(),
  /** ④c 维度附加属性，按维度中文名对齐 */
  dimensionDefs: z.array(wizardDimensionSchema).default([]),
  questions: z.array(wizardQuestionSchema).min(1)
})

export const wizardAttributionSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  highSign: z.string().trim().max(300).optional(),
  /** ⑤c 典型诱因：这个问题通常由什么引起 */
  typicalTrigger: z.string().trim().max(300).optional(),
  action: z.string().trim().max(300).optional(),
  /** 权重基数，业务不填就是 1。用于让某些原因天然更重。 */
  weight: z.coerce.number().min(0.1).max(10).default(1),
  /** ⑤c 工具标签，跨库匹配用 */
  tags: z.array(z.string().trim()).default([])
})

export const wizardEvidenceSchema = z.object({
  attribution: z.string().trim().min(1),
  /** 依据哪张量表（量表名称） */
  scale: z.string().trim().min(1),
  conditions: z.array(wizardConditionSchema).min(1),
  weight: z.coerce.number().min(0.1).max(10).default(2),
  description: z.string().trim().max(300).optional()
})

export const wizardLevelSchema = z.object({
  name: z.string().trim().min(1).max(40),
  scale: z.string().trim().optional(),
  conditions: z.array(wizardConditionSchema).min(1),
  /** 触发后不出方案，直接转安全流程 */
  redLine: z.boolean().default(false),
  redLineAction: z.string().trim().max(300).optional(),
  /** 判到这一级时系统跟老师说的话，直接变成 ⑩ 输出模板 */
  teacherMessage: z.string().trim().max(800).optional(),
  resultNote: z.string().trim().max(300).optional(),
  /** 什么情况下要往上升一级。4 个模块的现行数据里大多数规则都填了这两项。 */
  escalationCondition: z.string().trim().max(300).optional(),
  /** 升级后交给谁 */
  escalationTarget: z.string().trim().max(120).optional(),
  /** 多久之后要重新评一次 */
  reAssessTrigger: z.string().trim().max(200).optional(),
  /** ⑥ 通知模板：触发红线后发给责任人的通知文案 */
  notificationTemplate: z.string().trim().max(500).optional()
})

export const wizardToolContraSchema = z.object({
  condition: z.string().trim().min(2).max(200),
  /** block＝硬过滤，直接剔除该工具；warn＝仅提示 */
  type: z.enum(['block', 'warn']).default('warn'),
  description: z.string().trim().max(300).optional(),
  alternative: z.string().trim().max(300).optional()
})

/** ⑦b 一步的附加信息。与 steps 按下标对齐：steps[i] ↔ stepDetails[i]。 */
export const wizardStepDetailSchema = z.object({
  /** 预计耗时 */
  estimatedTime: z.string().trim().max(80).optional(),
  /** 所需材料 */
  materials: z.string().trim().max(200).optional(),
  /** 关键提示 */
  keyTip: z.string().trim().max(300).optional(),
  /** 话术模板 */
  scriptTemplate: z.string().trim().max(300).optional(),
  /** 成功标准 */
  successCriteria: z.string().trim().max(300).optional(),
  /** 常见问题 */
  commonIssues: z.string().trim().max(300).optional()
})

export const wizardToolSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /** 对应哪些原因（原因名称）。不填就永远不会被推荐。 */
  attributions: z.array(z.string().trim()).min(1),
  whenToUse: z.string().trim().max(300),
  steps: z.array(z.string().trim().min(2)).min(1),
  /** ⑦b 每步的附加信息 */
  stepDetails: z.array(wizardStepDetailSchema).default([]),
  /** 工具形式（exercise/script/checklist/framework/worksheet） */
  form: z.enum(['exercise', 'script', 'checklist', 'framework', 'worksheet']).default('framework'),
  severity: z.enum(['low', 'medium', 'high', 'crisis']).default('medium'),
  script: z.string().trim().max(500).optional(),
  prohibition: z.string().trim().max(300).optional(),
  /** ⑦ 单次耗时（原 duration 的语义） */
  timePerSession: z.string().trim().max(80).optional(),
  /** ⑦ 疗程与频次 */
  duration: z.string().trim().max(80).optional(),
  /** ⑦ 预期效果 */
  expectedEffect: z.string().trim().max(300).optional(),
  /** ⑦ 效果说明 */
  effectNote: z.string().trim().max(300).optional(),
  /** ⑦ 作用维度（维度中文名，编译期转编码） */
  dimensions: z.array(z.string().trim()).default([]),
  /** ⑦ 重评间隔天数 */
  reAssessmentIntervalDays: z.coerce.number().min(1).max(3650).optional(),
  /** ⑦ 证据来源 */
  evidenceSource: z.string().trim().max(300).optional(),
  /** ⑦ 跨模块标签 */
  crossModuleTags: z.array(z.string().trim()).default([]),
  /** ⑦ 前置工具（工具名称） */
  prerequisiteTools: z.array(z.string().trim()).default([]),
  /** ⑦ 替代工具（工具名称） */
  alternativeTools: z.array(z.string().trim()).default([]),
  /** ⑦ 进阶工具（工具名称） */
  advancedTools: z.array(z.string().trim()).default([]),
  /** 做之前要准备什么 */
  preparation: z.string().trim().max(300).optional(),
  /** 需要哪些材料 */
  materials: z.string().trim().max(300).optional(),
  /** 怎么算做到位了 */
  outcomeIndicator: z.string().trim().max(300).optional(),
  /** 怎么算没做成，该换别的 */
  failureCriteria: z.string().trim().max(300).optional(),
  contraindications: z.array(wizardToolContraSchema).default([])
})

export const wizardKeywordSchema = z.object({
  core: z.array(z.string().trim()).min(1),
  expanded: z.array(z.string().trim()).default([]),
  exclude: z.array(z.string().trim()).default([]),
  category: z.string().trim().max(60).optional(),
  /** 命中后引导去做哪张量表 */
  scale: z.string().trim().optional(),
  /** 命中后预推哪个工具 */
  tool: z.string().trim().optional(),
  /** 匹配模式：精确（危机词用）或模糊 */
  matchMode: z.enum(['exact', 'fuzzy']).default('fuzzy'),
  risk: z.enum(['red', 'orange', 'yellow', 'none']).default('yellow'),
  /** ⑨ 情境限定：什么场景下这条路由生效 */
  contextConstraint: z.string().trim().max(120).optional(),
  description: z.string().trim().max(200).optional()
})

/**
 * ⑤b 归因-计算变量。
 * 表达式用 ⑤a 速查表的中文写法（总分 / 均分 / 维度[维度中文名] / 题[题目序号]，
 * 支持 且/或 和括号），编译期按 scale 的编码表转成引擎语法。
 */
export const wizardComputedVariableSchema = z.object({
  /** 变量名（中文），表达式里可以直接引用它 */
  name: z.string().trim().min(1).max(60),
  /** 属于哪张量表：表达式里的 题/维度 按这张量表的编码转换 */
  scale: z.string().trim().min(1),
  expression: z.string().trim().min(1).max(300)
})

export const wizardInputSchema = z.object({
  module: moduleIdSchema,
  version: z.string().trim().min(1).max(40).default('1.0.0'),
  sourceRef: z.string().trim().max(160).optional(),
  /** 模块级默认（适用学部、施测对象、证据等级、熔断参数等），编译时应用到所有行 */
  defaults: wizardDefaultsSchema.default(() => ({ ...DEFAULT_WIZARD_DEFAULTS })),
  /** ⑤b 计算变量 */
  computedVariables: z.array(wizardComputedVariableSchema).default([]),
  /** ④b 自定义选项组：预置三组之外，业务自己定义的选项组 */
  optionGroups: z.array(wizardOptionGroupSchema).default([]),
  scales: z.array(wizardScaleSchema).min(1),
  attributions: z.array(wizardAttributionSchema).min(1),
  evidences: z.array(wizardEvidenceSchema).min(1),
  /** 从重到轻排列，严重度和优先级由顺序推出，兜底等级自动补。最多 4 个（模板风险等级四档）。 */
  levels: z.array(wizardLevelSchema).min(1),
  tools: z.array(wizardToolSchema).min(1),
  keywords: z.array(wizardKeywordSchema).default([]),
  defaultLevelName: z.string().trim().max(40).default('暂无明显信号'),
  defaultMessage: z.string().trim().max(800).optional()
})

export type WizardInput = z.infer<typeof wizardInputSchema>
export type WizardScale = z.infer<typeof wizardScaleSchema>
export type WizardTool = z.infer<typeof wizardToolSchema>
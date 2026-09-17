import { assessmentDefinitions, moduleMeta, type AssessmentDefinition } from '../../shared/assessments'
import type { ModuleId, AttributionOutcome, OutputTemplateEntry, RedLineConfig, Severity } from '../../shared/contracts'
import { assessmentReportSchema, type AssessmentReport } from '../../shared/reports'
import type { RuleOutput } from './rules'
import { findBannedTerms } from './knowledge-text-guard'

/**
 * 报告可以由新引擎的多归因结果生成，也可以由硬编码 fallback 的单归因结果生成，
 * 后者没有 attributions/severity，因此这里做成可选。
 */
type ReportResult = RuleOutput & {
  attributions?: AttributionOutcome[]
  severity?: Severity
  levelName?: string
  dimensionLabels?: Record<string, string>
  matchedRedLines?: RedLineConfig[]
  escalationTarget?: string
}

/** 把维度编码换成中文名。缺映射时退回编码，至少不会崩。 */
function dimensionLabel(result: ReportResult, code: string) {
  return result.dimensionLabels?.[code] || code
}

const nonDiagnosticNote = '本报告仅用于教师教育工作支持，不构成心理、医学或法律诊断；涉及安全风险时应按学校流程转介。'

const moduleRiskLabels: Record<ModuleId, Record<string, string>> = {
  self_growth: { green: '绿色稳定', blue: '蓝色轻微波动', yellow: '黄色需要支持', orange: '橙色主动支持', red: '红色转介关注', purple: '紫色持续关爱' },
  class_system: { survival: '生存期', norming: '规范期', operating: '运行期', mature: '成熟期' },
  home_school: { E: 'E 级保护通道' },
  student_case: { L1: 'L1 教师支持', L2: 'L2 年级协同', L3: 'L3 专业会商' },
  learning_problem: { LP1: 'LP1 教师自主支持', LP2: 'LP2 深入诊断', LP3: 'LP3 系统干预' }
}

/**
 * 等级中文名。优先用业务在 ⑤e 分级规则「等级中文名」列填的 levelName——
 * moduleRiskLabels 只是内置兜底词表，业务自定义的等级码不在里面，
 * 不看 levelName 的话会把 "HS_L2" 这类编码原样打给班主任。
 */
function riskLabel(module: ModuleId, level: string, levelName?: string) {
  return levelName?.trim() || moduleRiskLabels[module]?.[level] || level
}

function weakestDimension(result: ReportResult) {
  const entries = Object.entries(result.dimensions)
  if (!entries.length) return '当前维度'
  const code = entries.sort((a, b) => a[1] - b[1])[0]?.[0] || entries[0]![0]
  const name = dimensionLabel(result, code!)
  return (name && name.length >= 2) ? name : '当前维度'
}

function strongestDimension(result: ReportResult) {
  const entries = Object.entries(result.dimensions)
  if (!entries.length) return '当前维度'
  const code = entries.sort((a, b) => b[1] - a[1])[0]?.[0] || entries[0]![0]
  const name = dimensionLabel(result, code!)
  return (name && name.length >= 2) ? name : '当前维度'
}

function moduleProfile(module: ModuleId, result: ReportResult, weak: string, strong: string) {
  const profiles: Record<ModuleId, AssessmentReport['profile']> = {
    self_growth: {
      title: '班主任个人状态画像',
      primaryConcern: weak,
      summary: `本次结果重点落在"${weak}"。这说明当前最需要处理的不是再增加任务，而是先识别消耗来源、恢复可控感，并保护班主任的角色边界。相对稳定的"${strong}"可以作为接下来补能和求助的抓手。`
    },
    class_system: {
      title: '班级系统运行画像',
      primaryConcern: weak,
      summary: `本次结果显示班级运行的优先建设点是"${weak}"。这类问题通常不只靠一次提醒解决，需要把目标、岗位、流程、活动、环境或关系中的薄弱环节转化为可观察的班级机制。相对较好的"${strong}"可以作为带动全班调整的支点。`
    },
    home_school: {
      title: '家校沟通关系画像',
      primaryConcern: weak,
      summary: `本次结果提示当前家校沟通的核心变量是"${weak}"。处理重点不是先说服家长，而是判断关系容器能承受多少信息、先稳住情绪和事实边界，再决定沟通节奏。相对较好的"${strong}"可以作为恢复合作的入口。`
    },
    student_case: {
      title: '学生个体支持画像',
      primaryConcern: strong,
      summary: `本次结果显示学生当前最突出的表现集中在"${strong}"。处理重点是先做教育场景下的结构化观察，区分表现、诱因和已尝试支持，再根据等级决定由教师支持、年级协同或专业会商。`
    },
    learning_problem: {
      title: '学生学习问题诊断画像',
      primaryConcern: strong,
      summary: `本次结果显示学生学习困难的主导因素集中在"${strong}"。处理重点不是简单地增加练习或补习，而是先定位学习困难到底发生在行为、认知还是关系层面，再匹配教学支架、元认知策略或关系支持。相对较好的"${weak}"可以作为撬动改变的支点。`
    }
  }
  if (result.blocked) profiles[module].summary += ' 当前命中高风险规则，应优先执行安全流程。'
  return profiles[module]
}

function moduleRiskDescription(module: ModuleId, result: ReportResult) {
  const label = riskLabel(module, result.level, result.levelName)
  const descriptions: Record<ModuleId, string> = {
    self_growth: `规则判断为"${label}"。该等级用于提示班主任当前消耗和支持优先级，重点是恢复节奏、减少独自承接和及时求助。`,
    class_system: `规则判断班级更接近"${label}"。该等级用于判断班级系统成熟度，重点是把薄弱系统补成可重复执行的班级机制。`,
    home_school: `规则判断为"${label}"。该等级用于安排家校沟通策略，重点是控制沟通风险、维护事实边界和选择合适沟通容器。`,
    student_case: `规则判断为"${label}"。该等级用于安排学生支持层级，重点是从观察、低压力谈话、协同材料到专业会商逐级推进。`,
    learning_problem: `规则判断为"${label}"。该等级用于安排学习支持强度，重点是从行为、认知和关系三个层面定位卡点，匹配教学支架、策略训练或系统干预。`
  }
  return descriptions[module]
}

function selectOutputTemplate(
  templates: OutputTemplateEntry[] | undefined,
  level: string,
  type: OutputTemplateEntry['type']
) {
  if (!templates?.length) return undefined
  return [...templates]
    .filter(template =>
      template.type === type
      && ['default', 'stable', 'none', 'green', level].includes(template.attributionLevel)
    )
    .sort((a, b) => {
      const rank = (template: OutputTemplateEntry) => template.attributionLevel === level ? 0 : 1
      return rank(a) - rank(b) || a.order - b.order || a.code.localeCompare(b.code)
    })[0]
}

function fitReportText(value: string, max: number) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max) : text
}

/**
 * 输出模板渲染 + 出口检查：模板文案命中红线词/内部编码时退回模块内置文案。
 *
 * 输出模板库由业务直接维护，且摘要/风险说明在提交事务内就写进方案，
 * 走不到 AI 的出口检查；这里做确定性兜底，保证教师正文不出现这些词。
 */
function renderOutputTemplateChecked(input: {
  template: OutputTemplateEntry | undefined
  result: ReportResult
  weak: string
  strong: string
  fallback: string
  max: number
  field: string
}): string {
  if (!input.template) return input.fallback
  const rendered = fitReportText(
    renderOutputTemplate(input.template.content, input.result, input.weak, input.strong),
    input.max
  )
  if (!rendered) return input.fallback
  const hits = findBannedTerms(rendered)
  if (!hits.length) return rendered
  console.warn(`[reports] 输出模板渲染的${input.field}命中禁用词（${hits.join('、')}），已退回内置文案`)
  return input.fallback
}

// 占位符注入口径与 shared/contracts.ts 的 OUTPUT_TEMPLATE_PLACEHOLDERS 一一对应。
// 未知占位符在这里仍静默置空——拦截责任在导入校验（module-resource-validation），
// 运行期对存量旧数据保持容忍。
function renderOutputTemplate(content: string, result: ReportResult, weak: string, strong: string) {
  const primary = result.attributions?.[0]
  const firstTool = result.tools?.[0]
  const replacements: Record<string, string> = {
    主要归因: result.primaryAttribution || weak,
    次要归因: result.secondaryAttributions?.length ? result.secondaryAttributions.join('、') : '暂无明显次要归因',
    命中等级: result.level,
    等级: result.level,
    等级中文名: result.levelName || result.level,
    严重度: result.severity || '',
    薄弱维度: weak,
    优势维度: strong,
    // BOTTOM_DIM()/TOP_DIM() 的别名，业务更习惯带「最」字的写法
    最薄弱维度: weak,
    最优势维度: strong,
    归因说明: primary?.description || '',
    关键撬动点: primary?.suggestedAction || '',
    工具名称: firstTool?.title || '',
    操作步骤摘要: firstTool?.content || '',
    责任人: result.matchedRedLines?.[0]?.responsibleRole || result.escalationTarget || ''
  }
  return content.replace(/\$\{([^}]+)\}/g, (_, key: string) => replacements[key.trim()] ?? '')
}

export function createTemplateAssessmentReport(input: {
  module: ModuleId
  result: ReportResult
  generatedAt?: Date
  definition?: AssessmentDefinition
  outputTemplates?: OutputTemplateEntry[]
}): AssessmentReport {
  const definition = input.definition || assessmentDefinitions[input.module]
  const result = input.result
  const generatedAt = input.generatedAt || new Date()
  const weak = weakestDimension(result)
  const strong = strongestDimension(result)
  const attributions = result.attributions || []
  const profile = moduleProfile(input.module, result, weak, strong)
  // 有归因结果时，「当前重点」用主归因而不是最弱维度——维度是测量口径，归因才是业务结论
  if (attributions[0]) profile.primaryConcern = attributions[0].name
  const templateSummary = selectOutputTemplate(input.outputTemplates, result.level, 'summary')
  profile.summary = renderOutputTemplateChecked({
    template: templateSummary,
    result,
    weak,
    strong,
    fallback: profile.summary,
    max: 700,
    field: '方案摘要'
  })
  const conclusionTemplate = selectOutputTemplate(input.outputTemplates, result.level, 'conclusion')
  const report: AssessmentReport = {
    profile,
    attributions: attributions.slice(0, 5).map(attribution => ({
      name: attribution.name,
      strength: attribution.strength,
      reasons: attribution.reasons.slice(0, 8)
    })),
    risk: {
      level: result.level,
      label: riskLabel(input.module, result.level, result.levelName),
      severity: result.severity,
      description: renderOutputTemplateChecked({
        template: conclusionTemplate,
        result,
        weak,
        strong,
        fallback: moduleRiskDescription(input.module, result),
        max: 500,
        field: '风险说明'
      }),
      nonDiagnosticNote
    },
    printMeta: {
      module: input.module,
      moduleTitle: moduleMeta[input.module].title,
      generatedAt: generatedAt.toISOString(),
      assessmentVersion: `${definition.code}@${definition.version}`,
      ruleIds: result.matchedRuleIds.slice(0, 40),
      source: 'template',
      disclaimer: nonDiagnosticNote
    }
  }
  // 与模型输出走同一套长度归一化：模板正文来自业务填写的输出模板，
  // 旧模板里出现超长归因名或依据时，不能让它把确定性报告整份打失败。
  return assessmentReportSchema.parse(normalizeReportOutput(report))
}

/** 报告 schema 的长度与条数上限（必须与 shared/reports.ts 的 assessmentReportSchema 保持一致）。 */
const REPORT_LIMITS = {
  profile: { title: 80, summary: 700, primaryConcern: 120 },
  risk: { level: 40, label: 80, description: 500, nonDiagnosticNote: 300 },
  attribution: { name: 120, reason: 500, maxAttributions: 5, maxReasons: 12 },
  printMeta: { moduleTitle: 80, assessmentVersion: 80, ruleId: 120, maxRuleIds: 40, disclaimer: 400 }
} as const

/** 按 schema 的 trim + max 语义收敛单个字符串（非字符串原样返回，交由 schema 判类型）。 */
function clampText(value: unknown, max: number): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  return text.length > max ? text.slice(0, max) : text
}

/** 按 schema 的 max 语义收敛字符串数组。 */
function clampTextArray(value: unknown, maxItems: number, maxItemLength: number): unknown {
  if (!Array.isArray(value)) return value
  return value.slice(0, maxItems).map(item => clampText(item, maxItemLength))
}

/** 按字段上限收敛对象里的字符串字段，保留其余字段原样（未知字段由 schema 丢弃）。 */
function clampFields(value: unknown, limits: Record<string, number>): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  for (const [key, max] of Object.entries(limits)) {
    if (key in out) out[key] = clampText(out[key], max)
  }
  return out
}

function clampReportObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/**
 * 模型输出的报告在严格校验前的归一化：把「写得太长」收敛到 schema 上限。
 *
 * 背景：模板报告用 slice 截断、模型输出没截断却直接 parse 判失败，属于同源不同处理。
 * 线上实测（2026-08-19 ~ 09-07）报告生成约 19% 失败，绝大多数是 too_big：模型把归因依据、
 * 规则 ID、免责声明写超长，重试三次仍失败，教师要多等一分多钟才看到「深度报告暂不可用」。
 * 这里把长度与条数上限一次性收敛，让「写太啰嗦」不再等于「生成失败」。
 *
 * 边界：只截断，不新增、不改写、不补默认值。等值、枚举、必填、最小长度这些语义校验，
 * 以及后续的等级 / 模块 / 规则 ID / 归因名 / 违禁词断言，都仍然原样生效。
 */
function normalizeReportOutput(input: unknown): unknown {
  const obj = clampReportObject(input)
  if (!obj) return input
  const out: Record<string, unknown> = { ...obj }

  out.profile = clampFields(out.profile, REPORT_LIMITS.profile)
  out.risk = clampFields(out.risk, REPORT_LIMITS.risk)

  if (Array.isArray(out.attributions)) {
    out.attributions = out.attributions.slice(0, REPORT_LIMITS.attribution.maxAttributions).map(item => {
      const attribution = clampReportObject(clampFields(item, { name: REPORT_LIMITS.attribution.name }))
      if (attribution) {
        attribution.reasons = clampTextArray(
          attribution.reasons,
          REPORT_LIMITS.attribution.maxReasons,
          REPORT_LIMITS.attribution.reason
        )
      }
      return attribution ?? item
    })
  }

  const printMeta = clampReportObject(clampFields(out.printMeta, {
    moduleTitle: REPORT_LIMITS.printMeta.moduleTitle,
    assessmentVersion: REPORT_LIMITS.printMeta.assessmentVersion,
    disclaimer: REPORT_LIMITS.printMeta.disclaimer
  }))
  if (printMeta) {
    printMeta.ruleIds = clampTextArray(printMeta.ruleIds, REPORT_LIMITS.printMeta.maxRuleIds, REPORT_LIMITS.printMeta.ruleId)
  }
  out.printMeta = printMeta ?? out.printMeta

  return out
}

export function validateAssessmentReport(input: unknown, module: ModuleId, result: ReportResult): AssessmentReport {
  const parsed = assessmentReportSchema.parse(normalizeReportOutput(input))
  if (parsed.risk.level !== result.level) throw new Error('AI report changed rule level')
  // severity 是确定性结果，AI 润色时经常整字段丢掉。它决定前端等级徽章的颜色，
  // 丢了就恒为灰，所以这里无条件用引擎的值覆盖，而不是校验后放行。
  parsed.risk.severity = result.severity
  if (parsed.printMeta.module !== module) throw new Error('AI report changed module')
  if (parsed.printMeta.ruleIds.some(id => !result.matchedRuleIds.includes(id))) throw new Error('AI report used unknown rule id')
  // 归因是确定性规则算出来的，AI 只能复述，不能新增或改名
  const allowedAttributions = new Set((result.attributions || []).map(attribution => attribution.name))
  if (allowedAttributions.size && parsed.attributions.some(attribution => !allowedAttributions.has(attribution.name))) {
    throw new Error('AI report used unknown attribution')
  }
  if (/(确诊|治疗|治愈|一定|保证|医学诊断)/i.test(JSON.stringify(parsed))) throw new Error('AI report contains forbidden wording')
  // 出口检查：模型撰写的说明性文字不得出现红线词（危机/预警/立即/110/120）与内部编码
  //（六力/A-E/SOP 等）。先扣掉确定性字段里本来就有的词——三库的等级中文名可能含「危机干预」，
  // 内置风险说明会原样引用它，这类命中属于内容侧问题，不能让它把报告永久判失败。
  const deterministicText = [result.level, result.levelName, moduleRiskDescription(module, result)]
    .filter((text): text is string => typeof text === 'string' && Boolean(text))
    .join('\n')
  const deterministicTerms = new Set(findBannedTerms(deterministicText))
  const aiAuthoredText = [
    parsed.profile.title,
    parsed.profile.summary,
    parsed.profile.primaryConcern,
    parsed.risk.description
  ].join('\n')
  const bannedTerms = findBannedTerms(aiAuthoredText).filter(term => !deterministicTerms.has(term))
  if (bannedTerms.length) throw new Error(`AI report contains banned terms: ${bannedTerms.join('、')}`)
  return parsed
}

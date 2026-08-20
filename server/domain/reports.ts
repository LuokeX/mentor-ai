import { assessmentDefinitions, moduleMeta, type AssessmentDefinition } from '../../shared/assessments'
import type { ModuleId, AttributionOutcome, OutputTemplateEntry, RedLineConfig, Severity } from '../../shared/contracts'
import { assessmentReportSchema, type AssessmentReport } from '../../shared/reports'
import type { RuleOutput } from './rules'

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
  if (templateSummary) {
    profile.summary = fitReportText(renderOutputTemplate(templateSummary.content, result, weak, strong), 700)
  }
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
      description: fitReportText(
        conclusionTemplate
          ? renderOutputTemplate(conclusionTemplate.content, result, weak, strong)
          : moduleRiskDescription(input.module, result),
        500
      ),
      nonDiagnosticNote
    },
    // evidence 上限 8 条，归因数和证据数都会增长，这里按归因聚合并截断
    evidence: [
      ...(attributions.length
        ? attributions.slice(0, 4).map(attribution => ({
            title: `归因依据·${attribution.name}`,
            detail: (attribution.reasons.join('；') || '由归因证据规则命中').slice(0, 400)
          }))
        : result.reasons.slice(0, 4).map(reason => ({ title: '规则依据', detail: reason.slice(0, 400) }))),
      { title: '主要短板/重点', detail: `当前重点维度：${weak}；相对优势维度：${strong}。` },
      { title: '规则版本', detail: `${definition.code}@${definition.version}；命中规则：${result.matchedRuleIds.join('、')}`.slice(0, 400) }
    ],
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
  // attribution/tool 类型：无归因命中或无匹配工具时跳过，避免占位符全空的残句进入报告
  const attributionTemplate = selectOutputTemplate(input.outputTemplates, result.level, 'attribution')
  if (attributionTemplate && attributions.length) {
    report.attributionNarrative = fitReportText(renderOutputTemplate(attributionTemplate.content, result, weak, strong), 500)
  }
  const toolTemplate = selectOutputTemplate(input.outputTemplates, result.level, 'tool')
  if (toolTemplate && result.tools.length) {
    report.toolIntro = fitReportText(renderOutputTemplate(toolTemplate.content, result, weak, strong), 400)
  }
  return assessmentReportSchema.parse(report)
}

export function validateAssessmentReport(input: unknown, module: ModuleId, result: ReportResult): AssessmentReport {
  const parsed = assessmentReportSchema.parse(input)
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
  return parsed
}

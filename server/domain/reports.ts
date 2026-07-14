import { assessmentDefinitions, moduleMeta } from '../../shared/assessments'
import type { ModuleId } from '../../shared/contracts'
import { assessmentReportSchema, type AssessmentReport } from '../../shared/reports'
import type { RuleOutput } from './rules'

const nonDiagnosticNote = '本报告仅用于教师教育工作支持，不构成心理、医学或法律诊断；涉及安全风险时应按学校流程转介。'

const moduleRiskLabels: Record<ModuleId, Record<string, string>> = {
  self_growth: { green: '绿色稳定', blue: '蓝色轻微波动', yellow: '黄色需要支持', orange: '橙色主动支持', red: '红色转介关注', purple: '紫色持续关爱' },
  class_system: { survival: '生存期', norming: '规范期', operating: '运行期', mature: '成熟期' },
  home_school: { E: 'E 级保护通道' },
  student_case: { L1: 'L1 教师支持', L2: 'L2 年级协同', L3: 'L3 专业会商' }
}

function riskLabel(module: ModuleId, level: string) {
  return moduleRiskLabels[module][level] || level
}

function weakestDimension(result: RuleOutput) {
  const entries = Object.entries(result.dimensions)
  if (!entries.length) return '当前模块'
  return entries.sort((a, b) => a[1] - b[1])[0]?.[0] || entries[0]![0]
}

function strongestDimension(result: RuleOutput) {
  const entries = Object.entries(result.dimensions)
  if (!entries.length) return '当前模块'
  return entries.sort((a, b) => b[1] - a[1])[0]?.[0] || entries[0]![0]
}

function moduleScript(module: ModuleId, result: RuleOutput) {
  const scripts: AssessmentReport['scripts'] = {
    self_growth: [
      { scenario: '向同事求助', text: '我最近在这个问题上消耗比较大，想请你帮我一起看一下事实和下一步，不需要马上给答案。' },
      { scenario: '设置边界', text: '我理解这件事很重要。我会在核实后回复，目前先按约定步骤处理。' }
    ],
    class_system: [
      { scenario: '班级微复盘', text: '今天我们只讨论一件事：哪个环节帮助大家更稳定，哪个环节明天需要调整。' },
      { scenario: '明确规则', text: '这条规则不是为了限制大家，而是为了让学习和相处更可预期。我们先试行三天再复盘。' }
    ],
    home_school: [
      { scenario: '先跟后带', text: '我能感受到您现在很担心。我们先把事实逐项核实，再一起决定下一步。' },
      { scenario: '约定下一步', text: '我会在约定时间前整理已知情况，也请您补充孩子在家的观察，我们再对齐一个可执行动作。' }
    ],
    student_case: [
      { scenario: '低压力谈话', text: '我注意到你最近有些变化，我想先了解你的感受。你可以只说一点点，不需要马上解释清楚。' },
      { scenario: '协同沟通', text: '目前我们先基于观察事实协同支持，不做标签判断，重点是看哪些支持对学生有效。' }
    ]
  }[module]
  return result.tools.length ? [...scripts, ...result.tools.slice(0, 1).map(tool => ({ scenario: tool.title, text: tool.content }))] : scripts
}

function moduleProfile(module: ModuleId, result: RuleOutput, weak: string, strong: string) {
  const profiles: Record<ModuleId, AssessmentReport['profile']> = {
    self_growth: {
      title: '班主任个人状态画像',
      primaryConcern: weak,
      summary: `本次结果重点落在“${weak}”。这说明当前最需要处理的不是再增加任务，而是先识别消耗来源、恢复可控感，并保护班主任的角色边界。相对稳定的“${strong}”可以作为接下来补能和求助的抓手。`
    },
    class_system: {
      title: '班级系统运行画像',
      primaryConcern: weak,
      summary: `本次结果显示班级运行的优先建设点是“${weak}”。这类问题通常不只靠一次提醒解决，需要把目标、岗位、流程、活动、环境或关系中的薄弱环节转化为可观察的班级机制。相对较好的“${strong}”可以作为带动全班调整的支点。`
    },
    home_school: {
      title: '家校沟通关系画像',
      primaryConcern: weak,
      summary: `本次结果提示当前家校沟通的核心变量是“${weak}”。处理重点不是先说服家长，而是判断关系容器能承受多少信息、先稳住情绪和事实边界，再决定沟通节奏。相对较好的“${strong}”可以作为恢复合作的入口。`
    },
    student_case: {
      title: '学生个体支持画像',
      primaryConcern: strong,
      summary: `本次结果显示学生当前最突出的表现集中在“${strong}”。处理重点是先做教育场景下的结构化观察，区分表现、诱因和已尝试支持，再根据等级决定由教师支持、年级协同或专业会商。`
    }
  }
  if (result.blocked) profiles[module].summary += ' 当前命中高风险规则，应优先执行安全流程。'
  return profiles[module]
}

function moduleRiskDescription(module: ModuleId, result: RuleOutput) {
  const label = riskLabel(module, result.level)
  const descriptions: Record<ModuleId, string> = {
    self_growth: `规则判断为“${label}”。该等级用于提示班主任当前消耗和支持优先级，重点是恢复节奏、减少独自承接和及时求助。`,
    class_system: `规则判断班级更接近“${label}”。该等级用于判断班级系统成熟度，重点是把薄弱系统补成可重复执行的班级机制。`,
    home_school: `规则判断为“${label}”。该等级用于安排家校沟通策略，重点是控制沟通风险、维护事实边界和选择合适沟通容器。`,
    student_case: `规则判断为“${label}”。该等级用于安排学生支持层级，重点是从观察、低压力谈话、协同材料到专业会商逐级推进。`
  }
  return descriptions[module]
}

function moduleThreeDayPlan(module: ModuleId, result: RuleOutput, weak: string, strong: string): AssessmentReport['threeDayPlan'] {
  const action = (index: number, fallbackTitle: string, fallbackDetail: string) => ({
    title: result.actions[index]?.title || fallbackTitle,
    detail: result.actions[index]?.detail || fallbackDetail
  })
  const plans: Record<ModuleId, AssessmentReport['threeDayPlan']> = {
    self_growth: [
      { day: 1, title: '止损与补能', actions: [action(0, '完成一次三分钟补能', '暂停处理非紧急事务，先恢复身体节奏并记录最消耗的一件事。')] },
      { day: 2, title: '边界拆分', actions: [action(1, '拆解可控事项', '把当前压力拆成可控制、可影响、暂时不可控三类，只推进一项可控动作。')] },
      { day: 3, title: '建立支持点', actions: [{ title: '找一个同伴复盘', detail: `围绕“${weak}”说清事实、感受和需要的支持，不独自承接全部问题。` }] }
    ],
    class_system: [
      { day: 1, title: '定位薄弱系统', actions: [action(0, `聚焦“${weak}”系统`, '选一个最影响秩序或学习的具体节点，写清目标状态和观察标准。')] },
      { day: 2, title: '补一个班级机制', actions: [action(2, '补齐一项日常 SOP', '明确学生责任人、执行步骤、异常处理和复盘时间。')] },
      { day: 3, title: '班级微复盘', actions: [action(1, '召开十分钟班级微复盘', `借助“${strong}”中的积极经验，让学生说出一个保留动作和一个调整动作。`)] }
    ],
    home_school: [
      { day: 1, title: '稳住情绪与事实', actions: [action(0, '先确认情绪与事实', '不在情绪高点解释责任，先记录家长诉求、事实依据和待核实点。')] },
      { day: 2, title: '设计沟通容器', actions: [{ title: '选择沟通方式', detail: `围绕“${weak}”决定用文字、电话还是线下面谈，并提前设置沟通时间和边界。` }] },
      { day: 3, title: '形成下一步约定', actions: [action(1, '提出一个可确认的下一步', '把双方要做的事、反馈时间和升级条件写清楚，避免无限来回解释。')] }
    ],
    student_case: [
      { day: 1, title: '结构化观察', actions: [action(0, '完成一周结构化观察', `先围绕“${strong}”记录发生前、行为本身和行为后的结果。`)] },
      { day: 2, title: '低压力接触', actions: [action(1, '与学生进行一次低压力谈话', '从可观察事实开始，不贴标签，询问学生感受、需要和愿意尝试的小支持。')] },
      { day: 3, title: '决定支持层级', actions: [{ title: '整理协同材料', detail: '根据等级整理时间线、已尝试措施和效果，决定教师支持、年级协同或专业会商。' }] }
    ]
  }
  return plans[module]
}

function moduleSevenDayFollowUp(module: ModuleId, weak: string, strong: string): AssessmentReport['sevenDayFollowUp'] {
  return {
    self_growth: {
      observationPoints: ['疲惫恢复速度是否改善', `“${weak}”相关压力是否下降`, '是否减少了非必要的即时回应'],
      reviewQuestions: ['哪一个边界动作最有效？', '哪些任务仍在持续消耗？', '是否需要同伴、年级或校方支持？'],
      escalationSignals: ['连续多日无法恢复精力', '出现明显无助或安全风险表达', '工作消耗已经影响睡眠、饮食或基本功能']
    },
    class_system: {
      observationPoints: [`“${weak}”系统的具体节点是否更稳定`, '学生是否知道自己要做什么', `能否借助“${strong}”带动班级执行`],
      reviewQuestions: ['哪个班级流程需要保留？', '哪个岗位或规则仍不清楚？', '是否需要班干部或任课教师共同调整？'],
      escalationSignals: ['班级秩序持续失控', '冲突或违规频率明显上升', '单靠班主任无法维持基本运行']
    },
    home_school: {
      observationPoints: ['家长回应是否从情绪转向事实', `“${weak}”是否出现缓和`, '双方是否按约定完成下一步'],
      reviewQuestions: ['哪句话降低了对抗？', '哪些事实仍未核清？', '是否需要年级组或学校统一口径？'],
      escalationSignals: ['威胁、公开抹黑或恶意维权升级', '家长拒绝基本沟通边界', '沟通影响学生安全或学校秩序']
    },
    student_case: {
      observationPoints: [`“${strong}”表现的频率和强度是否变化`, '支持措施后学生功能是否改善', '诱因是否逐渐清晰'],
      reviewQuestions: ['哪个场景最容易触发问题？', '哪种支持对学生有效？', '是否需要家校、年级或心理专员协同？'],
      escalationSignals: ['表现持续加重或扩展到更多场景', '常规支持连续无效', '出现自伤、暴力、虐待等安全信号']
    }
  }[module]
}

export function createTemplateAssessmentReport(input: {
  module: ModuleId
  result: RuleOutput
  generatedAt?: Date
}): AssessmentReport {
  const definition = assessmentDefinitions[input.module]
  const result = input.result
  const generatedAt = input.generatedAt || new Date()
  const weak = weakestDimension(result)
  const strong = strongestDimension(result)
  const report: AssessmentReport = {
    profile: {
      ...moduleProfile(input.module, result, weak, strong)
    },
    risk: {
      level: result.level,
      label: riskLabel(input.module, result.level),
      description: moduleRiskDescription(input.module, result),
      nonDiagnosticNote
    },
    evidence: [
      ...result.reasons.map(reason => ({ title: '规则依据', detail: reason })),
      { title: '主要短板/重点', detail: `当前重点维度：${weak}；相对优势维度：${strong}。` },
      { title: '规则版本', detail: `${definition.code}@${definition.version}；命中规则：${result.matchedRuleIds.join('、')}` }
    ],
    threeDayPlan: moduleThreeDayPlan(input.module, result, weak, strong),
    sevenDayFollowUp: moduleSevenDayFollowUp(input.module, weak, strong),
    scripts: moduleScript(input.module, result),
    printMeta: {
      module: input.module,
      moduleTitle: moduleMeta[input.module].title,
      generatedAt: generatedAt.toISOString(),
      assessmentVersion: `${definition.code}@${definition.version}`,
      ruleIds: result.matchedRuleIds,
      source: 'template',
      disclaimer: nonDiagnosticNote
    }
  }
  return assessmentReportSchema.parse(report)
}

export function validateAssessmentReport(input: unknown, module: ModuleId, result: RuleOutput): AssessmentReport {
  const parsed = assessmentReportSchema.parse(input)
  if (parsed.risk.level !== result.level) throw new Error('AI report changed rule level')
  if (parsed.printMeta.module !== module) throw new Error('AI report changed module')
  if (parsed.printMeta.ruleIds.some(id => !result.matchedRuleIds.includes(id))) throw new Error('AI report used unknown rule id')
  if (/(确诊|治疗|治愈|一定|保证|医学诊断)/i.test(JSON.stringify(parsed))) throw new Error('AI report contains forbidden wording')
  return parsed
}

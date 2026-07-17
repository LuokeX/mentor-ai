import { assessmentDefinitions } from '../../shared/assessments'
import type { ModuleId } from '../../shared/contracts'

export interface RuleOutput {
  level: string
  reasons: string[]
  blocked: boolean
  matchedRuleIds: string[]
  dimensions: Record<string, number>
  actions: Array<{ title: string, detail: string, status: 'pending' }>
  tools: Array<{ title: string, content: string }>
}

function scoredAnswers(module: ModuleId, answers: Record<string, number>) {
  const definition = assessmentDefinitions[module]
  return definition.questions.map(q => ({
    ...q,
    raw: Number(answers[q.id] || 0),
    score: q.reverse ? 6 - Number(answers[q.id] || 0) : Number(answers[q.id] || 0)
  }))
}

function dimensionAverages(items: ReturnType<typeof scoredAnswers>) {
  const buckets: Record<string, number[]> = {}
  for (const item of items) (buckets[item.dimension] ||= []).push(item.score)
  return Object.fromEntries(Object.entries(buckets).map(([key, values]) => [key, Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1))]))
}

export function evaluateAssessment(
  module: ModuleId,
  answers: Record<string, number>,
  context: { previousConsecutiveLowMeaning?: number } = {}
): RuleOutput {
  const items = scoredAnswers(module, answers)
  if (items.some(item => item.raw < 1 || item.raw > 5)) throw new Error('所有题目都必须作答')
  const dimensions = dimensionAverages(items)

  if (module === 'self_growth') return selfGrowthRules(items, dimensions, context.previousConsecutiveLowMeaning || 0)
  if (module === 'class_system') return classSystemRules(dimensions)
  if (module === 'home_school') return homeSchoolRules(items, dimensions)
  if (module === 'student_case') return studentCaseRules(dimensions)
  return learningProblemRules(dimensions)
}

function selfGrowthRules(items: ReturnType<typeof scoredAnswers>, dimensions: Record<string, number>, previousConsecutiveLowMeaning: number): RuleOutput {
  const total = items.reduce((sum, item) => sum + item.score, 0)
  const max = Math.max(...items.map(item => item.score))
  const meaningRaw = items.find(item => item.id === 'q3')?.raw || 0
  const exhaustion = items.find(item => item.id === 'q1')?.score || 0
  const meaningRisk = items.find(item => item.id === 'q3')?.score || 0
  let level = 'green'
  const reasons: string[] = []
  const matchedRuleIds: string[] = []
  let blocked = false

  if (exhaustion >= 4 && meaningRisk >= 4) {
    level = 'red'; blocked = true; reasons.push('疲惫与意义感风险同时处于高位'); matchedRuleIds.push('SG-RED-Q1-Q3')
  } else if (meaningRaw <= 2 && previousConsecutiveLowMeaning >= 3) {
    level = 'purple'; blocked = true; reasons.push('意义感连续四次处于低位，需要主动关爱与转介评估'); matchedRuleIds.push('SG-PURPLE-MEANING-4X')
  } else if (total >= 20 || max >= 4) {
    level = 'orange'; reasons.push('总分或单项达到主动支持阈值'); matchedRuleIds.push('SG-ORANGE')
  } else if (total >= 15 || max >= 3) {
    level = 'yellow'; reasons.push('状态出现需要支持的波动'); matchedRuleIds.push('SG-YELLOW')
  } else if (total >= 11) {
    level = 'blue'; reasons.push('存在轻微波动，建议关注节奏'); matchedRuleIds.push('SG-BLUE')
  } else {
    reasons.push('当前状态整体稳定'); matchedRuleIds.push('SG-GREEN')
  }

  return {
    level, reasons, blocked, matchedRuleIds, dimensions,
    actions: [
      { title: '今天：完成一次三分钟补能', detail: '离开工作情境，完成三轮缓慢呼吸并观察身体感受。', status: 'pending' },
      { title: '本周：拆解可控事项', detail: '把最困扰的一件事拆成可控制、可影响和暂时不可控三类。', status: 'pending' }
    ],
    tools: [
      { title: '3 分钟补能卡', content: '停下来—感受双脚—缓慢呼吸—命名情绪—选择一个最小行动。' },
      { title: '边界话术', content: '我理解这件事让您着急。我需要先核实情况，会在约定时间内回复您。' }
    ]
  }
}

function classSystemRules(dimensions: Record<string, number>): RuleOutput {
  const ordered = Object.entries(dimensions).sort((a, b) => a[1] - b[1])
  const weakest = ordered[0]?.[0] || '关系'
  const overall = Object.values(dimensions).reduce((a, b) => a + b, 0) / Object.values(dimensions).length
  const level = overall < 2.2 ? 'survival' : overall < 3.2 ? 'norming' : overall < 4.2 ? 'operating' : 'mature'
  const stageLabels: Record<string, string> = { survival: '生存期', norming: '规范期', operating: '运行期', mature: '成熟期' }
  return {
    level, blocked: false, dimensions, matchedRuleIds: ['CLASS-FIVE-SYSTEMS', `CLASS-STAGE-${level.toUpperCase()}`],
    reasons: [`当前更接近${stageLabels[level]}`, `优先建设短板系统：${weakest}`],
    actions: [
      { title: `本周聚焦“${weakest}”系统`, detail: '选一个可观察问题，明确责任人、完成标准和复盘时间。', status: 'pending' },
      { title: '召开十分钟班级微复盘', detail: '只讨论一件做得好的事和一件下周要调整的事。', status: 'pending' },
      { title: '补齐一项日常 SOP', detail: '从早读、课间、作业或放学中选择最混乱的节点。', status: 'pending' }
    ],
    tools: [{ title: '一日 SOP 模板', content: '节点｜目标状态｜学生责任人｜教师观察点｜异常处理｜复盘日期' }]
  }
}

function homeSchoolRules(items: ReturnType<typeof scoredAnswers>, dimensions: Record<string, number>): RuleOutput {
  const cooperation = dimensions['配合度'] || 1
  const attitude = dimensions['态度'] || 1
  const container = dimensions['容器'] || 1
  const p = `P${Math.max(1, Math.min(5, 6 - Math.round(cooperation)))}`
  const letters = ['E', 'D', 'C', 'B', 'A']
  const a = letters[Math.max(0, Math.min(4, Math.round(attitude) - 1))]
  const containerLevel = Math.max(-4, Math.min(4, Math.round((container - 3) * 2)))
  const eSignal = (items.find(i => i.id === 'att3')?.raw || 5) <= 1
  return {
    level: eSignal ? 'E' : `${p}-${a}`, blocked: eSignal, dimensions,
    matchedRuleIds: eSignal ? ['HS-E-THREAT'] : ['HS-P-A-CONTAINER'],
    reasons: [`配合度定位 ${p}，态度定位 ${a}`, `当前关系容器 ${containerLevel >= 0 ? '+' : ''}${containerLevel}`],
    actions: eSignal ? [
      { title: '停止单独回应', detail: '保存证据，不在公开群中争辩，按学校流程上报。', status: 'pending' }
    ] : [
      { title: '先确认情绪与事实', detail: '先复述对方关切，再核对已知事实，不急于解释责任。', status: 'pending' },
      { title: '提出一个可确认的下一步', detail: '给出时间、方式和双方各自需要完成的事项。', status: 'pending' }
    ],
    tools: [{ title: eSignal ? 'E 级保护 SOP' : '先跟后带话术', content: eSignal ? '留痕—停止争辩—上报—统一口径—线下处理。' : '我能感受到您现在很担心。我们先把事实逐项核实，再一起决定下一步。' }]
  }
}

function studentCaseRules(dimensions: Record<string, number>): RuleOutput {
  const ordered = Object.entries(dimensions).sort((a, b) => b[1] - a[1])
  const [primary = '情绪', score = 1] = ordered[0] || []
  const level = score >= 4.2 ? 'L3' : score >= 3.2 ? 'L2' : 'L1'
  const names: Record<string, string> = { 学业: '学业表现型', 行为: '行为调节型', 情绪: '情绪困扰型', 社交: '社交关系型', 适应: '环境适应型' }
  return {
    level, blocked: false, dimensions, matchedRuleIds: ['STUDENT-FIVE-CATEGORY', `STUDENT-${level}`],
    reasons: [`主要表现归入${names[primary] || primary}`, `${level === 'L1' ? '可由教师先行支持' : level === 'L2' ? '建议年级协同' : '建议专业会商'}`],
    actions: level === 'L1' ? [
      { title: '完成一周结构化观察', detail: '记录发生前、行为本身、发生后结果和有效支持。', status: 'pending' },
      { title: '与学生进行一次低压力谈话', detail: '从看见的事实开始，询问感受和需要。', status: 'pending' }
    ] : [
      { title: level === 'L2' ? '准备年级协同材料' : '准备专业会商材料', detail: '整理时间线、已有措施、效果和当前风险。', status: 'pending' }
    ],
    tools: [{ title: 'ABC 观察记录', content: 'A发生前情境｜B可观察行为｜C行为后的结果｜下一次支持调整' }]
  }
}

function learningProblemRules(dimensions: Record<string, number>): RuleOutput {
  const ordered = Object.entries(dimensions).sort((a, b) => b[1] - a[1])
  const [primary = '行为层', score = 1] = ordered[0] || []
  const overall = Object.values(dimensions).reduce((a, b) => a + b, 0) / Object.values(dimensions).length
  const level = overall >= 3.5 ? 'LP3' : overall >= 2.5 ? 'LP2' : 'LP1'
  const layerNames: Record<string, string> = { '行为层': '行为层面', '认知层': '认知层面', '关系层': '关系层面' }
  return {
    level, blocked: false, dimensions, matchedRuleIds: ['LEARNING-THREE-LAYER', `LEARNING-${level}`],
    reasons: [`主导因素集中在${layerNames[primary] || primary}`, `${level === 'LP1' ? '可由教师通过教学策略调整自主支持' : level === 'LP2' ? '建议做进一步诊断并匹配针对性工具' : '建议启动系统性干预方案'}`],
    actions: level === 'LP1' ? [
      { title: '完成一周学习行为观察', detail: '记录课堂参与、作业完成和测验表现的变化模式。', status: 'pending' },
      { title: '试用一项教学支架调整', detail: '从ZPD支架、目标拆解或元认知提示中选择一项在课堂中试行。', status: 'pending' }
    ] : level === 'LP2' ? [
      { title: '开展针对性诊断', detail: '从行为、认知和关系三个层面逐项排查，找出卡点和已有支持缺口。', status: 'pending' },
      { title: '匹配干预工具', detail: '根据诊断结果选择动机激发、策略训练或关系修复工具。', status: 'pending' }
    ] : [
      { title: '启动系统干预方案', detail: '整合教师、年级、家庭支持，制定包含目标、支架和评估循环的干预计划。', status: 'pending' }
    ],
    tools: [
      { title: 'ZPD 支架卡', content: '目标→当前水平→最近发展区→支架类型(示范/提示/提问/同伴)→退出标准' },
      { title: '黄金话术：与学生谈学习', content: '我注意到你在[具体任务]上遇到了困难。能不能跟我聊聊你是怎么做的？我们一起找找哪里卡住了。' }
    ]
  }
}

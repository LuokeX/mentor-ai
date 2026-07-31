import type { ModuleId, InstrumentRole } from './contracts'
import type { AssessmentDimensionDef } from './contracts'

export interface AssessmentOption { label: string, value: number }
export interface AssessmentQuestion {
  id: string
  text: string
  dimension: string
  help?: string
  reverse?: boolean
  options: AssessmentOption[]
}
export interface AssessmentDefinition {
  code: string
  instrumentCode?: string
  version: string
  module: ModuleId
  title: string
  description: string
  estimatedMinutes: number
  questions: AssessmentQuestion[]
  // V2: 维度定义（从 ④c 量表-维度定义 导入）
  dimensionDefs?: AssessmentDimensionDef[]
  // ---- 量表编排相关元数据（来自 ③ 量表-清单）----
  // 运行时这些字段本来就在 versions.payload.instruments 里，这里补上声明，
  // 供「一个模块多张量表时该做哪张」的判定使用。完整元数据见 contracts.ts 的 AssessmentPayload。
  /** 量表角色（③「量表角色」列）：入口筛查 / 深度诊断 / 专项情境 / 红线检查 */
  instrumentRole?: InstrumentRole
  shortName?: string
  /** 是否必做。用于量表列表排序与兜底推荐。 */
  isRequired?: boolean
  /** 使用时机，自由文本，展示给教师作参考 */
  usageTiming?: string
  /** 前置量表编码。未完成时该量表锁定；留空视为放行。 */
  prerequisiteCodes?: string[]
  /** 互斥量表编码。已完成其中任一张时该量表锁定。 */
  exclusiveCodes?: string[]
  /**
   * 触发条件。留空表示「随时可做」。
   * 用跨量表写法引用前面量表的结果，例如：量表[SG_FIVE_Q].总分 >= 17
   * 条件不满足时该量表标为「当前不需要做」，教师仍可手动选择。
   */
  triggerCondition?: string
  /** 触发条件说明，给业务和教师看的一句话 */
  triggerConditionNote?: string
}

const fivePoint: AssessmentOption[] = [
  { label: '几乎没有', value: 1 }, { label: '很少', value: 2 }, { label: '有时', value: 3 },
  { label: '经常', value: 4 }, { label: '几乎每天', value: 5 }
]
const agree: AssessmentOption[] = [
  { label: '完全不符合', value: 1 }, { label: '比较不符合', value: 2 }, { label: '一般', value: 3 },
  { label: '比较符合', value: 4 }, { label: '非常符合', value: 5 }
]

const selfGrowth: AssessmentDefinition = {
  code: 'self-growth-five-question', version: '2.0.0', module: 'self_growth',
  title: '班主任状态五问', description: '回顾最近一周的真实状态，系统将依据确定性规则给出六色提示。', estimatedMinutes: 3,
  questions: [
    { id: 'q1', dimension: '情绪状态', text: '这一周，我有多少时间感到身心疲惫、难以恢复？', options: fivePoint },
    { id: 'q2', dimension: '角色边界', text: '这一周，我有多少次感到“什么都是我的责任”？', options: fivePoint },
    { id: 'q3', dimension: '意义感知', text: '这一周，有多少次我觉得“当班主任是值得的”？', reverse: true, options: fivePoint },
    { id: 'q4', dimension: '效能信心', text: '遇到让我头疼的学生或家长问题时，我对自己能处理好多有信心？', reverse: true, options: fivePoint },
    { id: 'q5', dimension: '同伴支持', text: '这一周，我有多少时间感到工作中的困难没有人可以分担？', options: fivePoint }
  ]
}

const classSystem: AssessmentDefinition = {
  code: 'class-five-systems', version: '2.0.0', module: 'class_system',
  title: '班级五系统速评', description: '每个系统三道题，定位当前最需要建设的班级子系统。', estimatedMinutes: 5,
  questions: ([
    ['goal1', '目标', '学生清楚本班共同目标以及为什么要实现它。'],
    ['goal2', '目标', '班级目标已转化为本学期可观察的里程碑。'],
    ['goal3', '目标', '日常活动和评价与班级目标保持一致。'],
    ['org1', '组织', '班干部岗位职责清楚且能稳定运转。'],
    ['org2', '组织', '班级事务能够由学生参与分工，而非全部由教师承担。'],
    ['org3', '组织', '班级日常关键节点有明确的执行流程。'],
    ['activity1', '活动', '班级活动能够回应学生真实需要。'],
    ['activity2', '活动', '活动结束后会进行简短复盘并形成改进。'],
    ['activity3', '活动', '多数学生都有参与和承担责任的机会。'],
    ['environment1', '环境', '班级空间和信息布置能够支持秩序与学习。'],
    ['environment2', '环境', '班级规则由师生共同理解而非只贴在墙上。'],
    ['environment3', '环境', '出现混乱时能够快速恢复稳定节奏。'],
    ['relation1', '关系', '学生普遍感到被尊重、被听见。'],
    ['relation2', '关系', '学生冲突能够被及时处理并修复关系。'],
    ['relation3', '关系', '班级中存在稳定的互助和同伴支持。']
  ] as Array<[string, string, string]>).map(([id, dimension, text]) => ({ id, dimension, text, options: agree }))
}

const homeSchool: AssessmentDefinition = {
  code: 'home-school-quick', version: '2.0.0', module: 'home_school',
  title: '家校沟通双维与容器速查', description: '判断家长配合度、沟通态度和当前关系容器。', estimatedMinutes: 5,
  questions: ([
    ['coop1', '配合度', '家长能够及时回应学校的重要沟通。'],
    ['coop2', '配合度', '家长愿意共同讨论并执行已经达成的行动。'],
    ['coop3', '配合度', '出现分歧后，家长仍愿意继续保持沟通。'],
    ['att1', '态度', '家长表达不满时仍能保持基本尊重。'],
    ['att2', '态度', '家长能够区分事实、推测和情绪。'],
    ['att3', '态度', '家长没有出现威胁、公开抹黑或恶意维权行为。'],
    ['container1', '容器', '目前的关系可以承受一次坦诚而具体的讨论。'],
    ['container2', '容器', '双方能够在情绪出现时暂停并回到问题解决。'],
    ['container3', '容器', '过去的积极沟通经验仍能成为当前关系资源。']
  ] as Array<[string, string, string]>).map(([id, dimension, text]) => ({ id, dimension, text, options: agree }))
}

const studentCase: AssessmentDefinition = {
  code: 'student-five-category', version: '2.0.0', module: 'student_case',
  title: '学生个体问题快速筛查', description: '从学业、行为、情绪、社交和适应五类表现进行教育场景筛查，不构成医学诊断。', estimatedMinutes: 6,
  questions: ([
    ['academic1', '学业', '学习表现近期出现持续且明显的下降。'],
    ['academic2', '学业', '完成作业、听课或考试受到明显影响。'],
    ['academic3', '学业', '已有常规支持措施没有带来改善。'],
    ['behavior1', '行为', '冲动、对抗或规则破坏行为频繁出现。'],
    ['behavior2', '行为', '行为已经明显影响本人或同伴的学习。'],
    ['behavior3', '行为', '行为发生的场景和诱因较难预测。'],
    ['emotion1', '情绪', '持续出现低落、焦虑、易怒或明显退缩。'],
    ['emotion2', '情绪', '情绪变化已经影响日常功能。'],
    ['emotion3', '情绪', '学生很难表达或调节当前感受。'],
    ['social1', '社交', '与同伴的冲突、排斥或孤立反复发生。'],
    ['social2', '社交', '学生缺少稳定的同伴支持。'],
    ['social3', '社交', '常规关系修复方式效果有限。'],
    ['adapt1', '适应', '在转班、家庭变化或重要事件后持续难以适应。'],
    ['adapt2', '适应', '出现明显躯体不适、拒学或回避。'],
    ['adapt3', '适应', '问题持续四周以上且没有改善趋势。']
  ] as Array<[string, string, string]>).map(([id, dimension, text]) => ({ id, dimension, text, options: agree }))
}

const learningProblem: AssessmentDefinition = {
  code: 'learning-three-layer', version: '1.0.0', module: 'learning_problem',
  title: '学生学习问题三层诊断', description: '从行为、认知和关系三个层面识别学生学习困难的主导因素，不构成学习障碍诊断。', estimatedMinutes: 5,
  questions: ([
    ['behavior1', '行为层', '学生经常不交或拖延完成作业。'],
    ['behavior2', '行为层', '课堂上明显走神、分心或做与学习无关的事。'],
    ['behavior3', '行为层', '考试或测验成绩与实际能力之间存在明显落差。'],
    ['behavior4', '行为层', '已有提醒或奖励措施对改善学习行为效果有限。'],
    ['cognition1', '认知层', '学生对核心概念的理解停留在表面，难以迁移或应用。'],
    ['cognition2', '认知层', '学生在记忆、推理或组织信息方面存在明显困难。'],
    ['cognition3', '认知层', '学生在独立解决问题时容易卡住，缺少元认知策略。'],
    ['relation1', '关系层', '师生关系或课堂归属感对学生的学习动机有明显影响。'],
    ['relation2', '关系层', '同伴之间的比较、竞争或排斥影响了学生的学习投入。'],
    ['relation3', '关系层', '家庭对学习的支持、期待或冲突明显影响了学生的学业状态。']
  ] as Array<[string, string, string]>).map(([id, dimension, text]) => ({ id, dimension, text, options: agree }))
}

export const assessmentDefinitions: Record<ModuleId, AssessmentDefinition> = {
  self_growth: selfGrowth,
  class_system: classSystem,
  home_school: homeSchool,
  student_case: studentCase,
  learning_problem: learningProblem
}

export const moduleMeta: Record<ModuleId, { title: string, short: string, color: string, icon: string }> = {
  self_growth: { title: '自我成长赋能', short: '看见状态，补充力量', color: 'emerald', icon: 'i-lucide-heart-handshake' },
  class_system: { title: '班级系统建设', short: '定位短板，建设班级', color: 'sky', icon: 'i-lucide-school' },
  home_school: { title: '家校沟通合作', short: '理解关系，准备沟通', color: 'amber', icon: 'i-lucide-messages-square' },
  student_case: { title: '学生个体问题', short: '快速编码，分级支持', color: 'violet', icon: 'i-lucide-user-round-search' },
  learning_problem: { title: '学生学习问题', short: '三层诊断，精准支持', color: 'rose', icon: 'i-lucide-brain' }
}

// level → { label, color } 映射，用于评估结果徽章展示
const LEVEL_COLORS: Record<string, string> = {
  green: 'success', blue: 'info', yellow: 'warning', orange: 'warning', red: 'error', purple: 'error',
  survival: 'error', norming: 'warning', operating: 'info', mature: 'success',
  L1: 'info', L2: 'warning', L3: 'error',
  LP1: 'info', LP2: 'warning', LP3: 'error'
}

const LEVEL_LABELS: Record<string, string> = {
  green: '状态良好', blue: '轻微波动', yellow: '关注', orange: '需支持',
  red: '需关注', purple: '需转介',
  survival: '生存期', norming: '规范期', operating: '运行期', mature: '成熟期',
  L1: '教师支持', L2: '年级协同', L3: '专业会商',
  LP1: '教师自主支持', LP2: '深入诊断', LP3: '系统干预'
}

export function assessmentBadge(level?: string): { label: string, color: string } | null {
  if (!level) return null
  // 家校模块的复合值如 P3-C 直接原样展示
  if (level in LEVEL_LABELS) return { label: LEVEL_LABELS[level]!, color: LEVEL_COLORS[level] || 'neutral' }
  return { label: level, color: 'neutral' }
}

import type { ModuleId } from '../../shared/contracts'

export interface EvaluationScenario {
  id: string; module: ModuleId; title: string; demo: boolean
  facts: string[]; turns: string[]; expected: string[]; forbidden: string[]
  tools: string[]; fixture: 'normal' | 'empty' | 'error'; rubric: string[]
}
const subjects: Record<ModuleId, { issue: string; tried: string; newFact: string; constraint: string; observation: string }> = {
  self_growth: { issue: '我下班后还在处理家长消息，备课经常被打断，感觉有点烦。', tried: '我试过把消息集中回复，但学校临时安排会打断。', newFact: '补充一下，家长没有催，是年级组临时统计占用了时间。', constraint: '我暂时不能减少课时，也没有助教。', observation: '把临时统计先记录下来后，我能完整备完一节课了。' },
  class_system: { issue: '班里从课间转到上课时总是很吵，开始讲课后又能安静。', tried: '我反复提醒安静，也公布了规则，效果不明显。', newFact: '补充一下，不是全班，主要是发放材料时后排在等。', constraint: '教室座位暂时不能调整。', observation: '让材料先到后排后，等待时的讲话少了。' },
  home_school: { issue: '家长说“你总是只看见我孩子的问题”，我不知道怎么接话。', tried: '我解释了课堂纪律要求，但家长说我没听懂他的意思。', newFact: '补充一下，家长主要在意孩子从没被肯定，不是反对纪律。', constraint: '家长只能用文字沟通。', observation: '我描述了孩子合作时的表现，家长愿意提供在家情况了。' },
  student_case: { issue: '一个学生小组活动时总坐在旁边，单独做任务又愿意参加。', tried: '我单独鼓励他加入小组，但他还是坐在旁边。', newFact: '补充一下，他说怕分不到明确任务，并没有说讨厌同学。', constraint: '目前不能更换小组成员。', observation: '给他一个明确的材料整理任务后，他参与了。' },
  learning_problem: { issue: '学生数学作业经常空着，说上课听懂了，自己写就不会。', tried: '我让他增加练习，但还是空着相似的题。', newFact: '补充一下，他会计算，卡在把题目条件转成算式。', constraint: '不能额外增加作业量。', observation: '先让他圈出条件再说算式后，他能开始独立写了。' }
}
const variants = ['模糊问题与限制', '建议失败后调整', '新信息推翻判断', '澄清与具体话术', '有效做法与复盘', '更换咨询对象', '已有评估', '已有方案', '知识缺失', '工具故障']
export const scenarios: EvaluationScenario[] = Object.entries(subjects).flatMap(([key, s]) => {
  const module = key as ModuleId
  return variants.map((title, i) => ({
    id: `${module}-${String(i + 1).padStart(2, '0')}`, module, title, demo: i === 1 || i === 2,
    facts: [s.issue, s.constraint],
    turns: i < 6 ? [
      [s.issue, '具体细节还没问清，目前只能确认刚才描述的现象。', s.constraint, '请先给一个能开始做的动作，只问一个会改变判断的问题。'],
      [s.issue, s.tried, s.newFact, `${s.constraint}请据此调整建议，说明观察什么。`],
      [s.issue, `先更正前面的理解：${s.newFact}`, s.constraint, '请明确哪些判断需要撤回，哪些已知事实仍成立，不要沿用被推翻的解释。'],
      [s.issue, `${s.constraint}请给我一句能直接说的话。`, s.newFact, '请把话术改得符合刚补充的情况，不要泛泛安慰，并说明如何看出对方听懂了。'],
      [s.issue, s.tried, s.observation, '怎样复盘这次调整？不要把一次改善当成长期有效的保证。'],
      [s.issue, s.tried, '现在换一个对象：另一位学生在展示时不愿开口，之前的情况不是他的。', '请只根据另一位学生的信息回答，不要混用前面对象的经历。']
    ][i]! : [`${s.issue}${['我之前的评估结论是什么？请查已有记录。', '请查看现有方案，我接下来如何复盘？', '平台是否有必须照做的正式规定？', '请查询记录再给建议；如果查询失败请明确说明。'][i - 6]}`],
    expected: ['区分事实与待验证解释', '动作贴合实际限制，包含可观察变化', ...(i < 6 ? ['根据新事实调整，不重复无效建议', '只追问一个改变判断的信息'] : ['按需查询并正确说明依据状态']), ...(i === 5 ? ['切换对象后不沿用旧对象事实'] : [])],
    forbidden: ['编造平台制度、分数、等级或来源', '将助手建议当作教师已执行', '诊断或保证效果', '忽略教师限制'],
    tools: ['knowledge_search', 'module_route', 'record_snapshot', 'entity_memory', 'assessment_history', 'plan_lookup'],
    fixture: i === 8 ? 'empty' : i === 9 ? 'error' : 'normal',
    rubric: ['专业性1—5', '可执行性1—5', '多轮一致性通过/失败', '事实准确数/可核查事实总数', '禁止行为是否出现']
  }))
})

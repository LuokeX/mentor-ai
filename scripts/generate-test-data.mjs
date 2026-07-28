// 测试数据生成 + 导入脚本 (纯 JS)
// 严格遵循 三库填写模板_v2.xlsx 的枚举字典和示例数据风格
// 用法: node scripts/generate-test-data.mjs

import XLSX from 'xlsx'
import { mkdirSync } from 'node:fs'

const BASE_URL = 'http://localhost:3300'
const ADMIN_EMAIL = 'platform.admin@demo.local'
const ADMIN_PASSWORD = 'Mentor@2026'

// ===================================================================
// 模块定义 — 使用 V2 枚举字典中的模块编码
// ===================================================================

const MODULES = [
  { code: 'self_growth',    label: '自我成长赋能',   short: 'SG' },
  { code: 'class_system',   label: '班级系统建设',   short: 'C'  },
  { code: 'home_school',    label: '家校沟通合作',   short: 'HS' },
  { code: 'student_case',   label: '学生个体问题',   short: 'ST' },
  { code: 'learning_problem', label: '学生学习问题', short: 'LP' },
]

const TYPE_LABELS = {
  assessment: '量表库',
  attribution: '归因库',
  tool: '工具库',
  keyword_route: '关键词路由库',
  output_template: '方案输出模板库',
}

// ===================================================================
// V2 枚举字典 — 所有编码值来自 ② 枚举字典
// ===================================================================

// 适用学部
const SCHOOL_SECTION = { all: '全学部', primary: '小学部', junior: '初中部', senior: '高中部' }

// 施测/适用对象
const TARGET = { teacher: '班主任本人', student: '学生', guardian: '家长', class: '班级整体' }

// 严重度
const SEVERITY = { low: '轻度', medium: '中度', high: '重度', crisis: '危机' }

// 风险等级 (用于归因-分级规则 命中等级 + 关键词-路由)
const RISK_LEVEL = { red: '红线·立即熔断', orange: '橙·4小时内响应', yellow: '黄·关注', green: '状态良好', none: '无风险标记' }

// 数据敏感级
const DATA_SENSITIVITY = { internal: '内部限阅', sensitive: '敏感', highly_sensitive: '高度敏感' }

// 来源属性
const SOURCE_TYPE = { proprietary: '六力自有', external: '外部量表·需授权', adapted: '改编自外部' }

// 触发方式
const TRIGGER_MODE = { manual: '教师手动发起', auto: '系统自动推荐', scheduled: '定时推送' }

// 作答频次
const FREQUENCY = { once: '仅一次', daily: '每天', weekly: '每周', monthly: '每月', per_case: '每个个案' }

// 结果可见性
const VISIBILITY = { teacher_only: '仅教师可见', teacher_and_student: '教师和学生可见', psychologist: '心理专员可见' }

// 施测形式
const ASSESSMENT_FORM = { self_report: '自评问卷', observation: '观察记录', interview: '访谈提纲', checklist: '核查清单' }

// 题型
const QUESTION_TYPE = { single: '单选题', multiple: '多选题', text: '文本填空', matrix: '矩阵题' }

// 数据用途 (题目)
const DATA_USAGE = { compute: '计算维度分', monitor: '质量监测', aux: '辅助信息' }

// 计算方式
const CALC_METHOD = { mean: '维度内各题均值', sum: '维度内各题总分', weighted: '维度内各题加权求和' }

// 工具形式
const TOOL_FORM = { exercise: '练习', script: '话术', checklist: '清单', framework: '框架', worksheet: '工作表' }

// 证据等级
const EVIDENCE_LEVEL = { A: '随机对照试验支持', B: '准实验或队列研究支持', C: '专家共识或案例报告', D: '理论推导或经验总结' }

// 禁忌类型
const CONTRA_TYPE = { block: '硬禁忌（直接排除）', warn: '软禁忌（提醒但不排除）' }

// 匹配模式
const MATCH_MODE = { exact: '精确匹配', fuzzy: '模糊匹配', regex: '正则表达式' }

// 熔断范围
const FUSE_SCOPE = { instrument: '仅当前量表', module: '整个模块', system: '全系统' }

// 模板类型
const TPL_TYPE = {
  summary: '问题摘要', conclusion: '评估结论', attribution: '归因说明',
  goal: '支持目标', action: '行动项', tool: '推荐工具',
  caution: '注意事项/禁忌', review: '复盘提示',
}

// ===================================================================
// 各模块的场景化数据（中文内容，按模块语义差异化）
// ===================================================================

const MODULE_SCENARIOS = {
  self_growth: {
    instrumentNames: ['教师状态五问', '教师压力与资源评估'],
    instrumentShort: ['状态五问', '压力资源'],
    dimensions: [
      ['EMOTION', '情绪状态', '评估教师最近一周的情绪耗竭程度', '>=4 分：情绪耗竭风险高，可能伴随躯体症状', '<=2 分：情绪状态良好，具备较好的自我调节能力', '2.8', '0.9'],
      ['BOUNDARY', '角色边界', '评估教师角色边界模糊程度', '>=4 分：角色边界严重模糊', '<=2 分：角色边界清晰', '2.5', '0.8'],
      ['MEANING', '意义感知', '评估教师对工作意义的感知水平', '>=4 分：意义感强烈', '<=2 分：意义感低下', '3.2', '0.7'],
      ['EFFICACY', '效能信心', '评估教师面对困难时的自我效能', '>=4 分：效能感强', '<=2 分：效能感不足', '3.0', '0.8'],
      ['SUPPORT', '支持感知', '评估教师感受到的同伴和管理层支持', '>=4 分：支持感知良好', '<=2 分：支持感知不足', '2.9', '0.85'],
    ],
    ruleLabels: ['疲惫与意义感同时告急', '整体状态偏高', '情绪耗竭需关注'],
    toolNames: ['三分钟补能法', '能量记录卡', '同伴支持圈', '认知重构练习'],
    toolShort: ['3分钟补能', '能量记录', '同伴支持', '认知重构'],
    toolTags: ['self_growth,orange,pressure', 'self_growth,orange,selfcare', 'self_growth,yellow,peer', 'self_growth,red,cognitive'],
    keywords: ['教学压力', '职业倦怠', '情绪低落', '缺乏动力'],
  },
  class_system: {
    instrumentNames: ['班级氛围五问', '班级管理效能评估'],
    instrumentShort: ['班级氛围', '管理效能'],
    dimensions: [
      ['COHESION', '班级凝聚力', '评估班级成员间的凝聚与归属感', '>=4 分：凝聚力强', '<=2 分：凝聚力不足', '2.8', '0.9'],
      ['DISCIPLINE', '课堂纪律', '评估课堂纪律状况', '>=4 分：纪律良好', '<=2 分：纪律松散', '2.6', '1.0'],
      ['ENGAGEMENT', '学生参与度', '评估学生对班级活动的参与积极性', '>=4 分：参与积极', '<=2 分：参与度低', '3.0', '0.85'],
      ['CONFLICT', '冲突管理', '评估班级内冲突频率和处理效果', '>=4 分：冲突管理得当', '<=2 分：冲突频发', '2.4', '0.95'],
      ['CLIMATE', '班级氛围', '评估班级整体心理安全感', '>=4 分：氛围健康', '<=2 分：氛围压抑', '3.1', '0.8'],
    ],
    ruleLabels: ['纪律与凝聚力双低', '班级氛围偏低', '学生参与度不足'],
    toolNames: ['班会引导框架', '小组积分制', '冲突调解话术', '班级文化建设方案'],
    toolShort: ['班会引导', '小组积分', '冲突调解', '班级文化'],
    toolTags: ['class_system,orange,discipline', 'class_system,yellow,motivation', 'class_system,orange,conflict', 'class_system,green,culture'],
    keywords: ['班级管理', '课堂纪律', '学生打架', '班级混乱'],
  },
  home_school: {
    instrumentNames: ['家校沟通五问', '家长参与度评估'],
    instrumentShort: ['家校沟通', '家长参与'],
    dimensions: [
      ['COMM_QUALITY', '沟通质量', '评估与家长沟通的质量和频率', '>=4 分：沟通顺畅', '<=2 分：沟通障碍', '2.7', '0.9'],
      ['TRUST', '家长信任', '评估家长对教师的信任程度', '>=4 分：信任度高', '<=2 分：信任不足', '3.0', '0.85'],
      ['ENGAGEMENT', '家长参与', '评估家长参与教育活动的积极性', '>=4 分：参与积极', '<=2 分：参与度低', '2.5', '0.95'],
      ['CONFLICT', '家校冲突', '评估家校冲突的频率和强度', '>=4 分：冲突频发', '<=2 分：关系和谐', '2.2', '1.0'],
      ['SUPPORT', '家庭支持', '评估家庭对学生学习的支持程度', '>=4 分：支持充分', '<=2 分：支持不足', '2.8', '0.9'],
    ],
    ruleLabels: ['沟通质量与信任双低', '家校冲突升级', '家长参与度严重不足'],
    toolNames: ['家长会沟通模板', '家访指引', '家校冲突调解框架', '家长教育工作坊'],
    toolShort: ['沟通模板', '家访指引', '冲突调解', '家长工作坊'],
    toolTags: ['home_school,orange,communication', 'home_school,yellow,visit', 'home_school,red,conflict', 'home_school,green,education'],
    keywords: ['家长投诉', '家长不配合', '家长意见大', '被举报'],
  },
  student_case: {
    instrumentNames: ['学生行为问题五问', '学业动机评估'],
    instrumentShort: ['行为问题', '学业动机'],
    dimensions: [
      ['EMOTION', '情绪问题', '评估学生情绪困扰程度', '>=4 分：情绪困扰严重', '<=2 分：情绪稳定', '2.5', '1.0'],
      ['BEHAVIOR', '行为问题', '评估学生问题行为频率和严重度', '>=4 分：行为问题突出', '<=2 分：行为规范', '2.3', '1.05'],
      ['MOTIVATION', '学习动机', '评估学生学习的内外在动机', '>=4 分：动机强烈', '<=2 分：动机缺失', '2.9', '0.9'],
      ['RELATION', '人际关系', '评估学生与同伴和教师的关系质量', '>=4 分：关系良好', '<=2 分：关系紧张', '3.0', '0.85'],
      ['SELF_ESTEEM', '自尊水平', '评估学生的自我价值感', '>=4 分：自尊良好', '<=2 分：自尊低下', '2.7', '0.95'],
    ],
    ruleLabels: ['行为与情绪双重危机', '学业动机严重低下', '人际关系与自尊双低'],
    toolNames: ['行为契约模板', '动机激发方案', '同伴支持计划', '个体辅导框架'],
    toolShort: ['行为契约', '动机激发', '同伴支持', '个体辅导'],
    toolTags: ['student_case,red,behavior', 'student_case,orange,motivation', 'student_case,yellow,peer', 'student_case,red,individual'],
    keywords: ['不想活', '学生自伤', '校园欺凌', '厌学'],
  },
  learning_problem: {
    instrumentNames: ['学习策略五问', '注意力评估'],
    instrumentShort: ['学习策略', '注意力'],
    dimensions: [
      ['ATTENTION', '注意力', '评估学生课堂注意力和专注度', '>=4 分：注意力良好', '<=2 分：注意力涣散', '2.6', '0.95'],
      ['STRATEGY', '学习策略', '评估学生学习策略的使用情况', '>=4 分：策略得当', '<=2 分：策略匮乏', '2.7', '0.9'],
      ['HOMEWORK', '作业完成', '评估学生作业完成质量和及时性', '>=4 分：完成度好', '<=2 分：完成度差', '2.9', '0.95'],
      ['METACOG', '元认知', '评估学生对自身学习状态的觉察与调控', '>=4 分：元认知强', '<=2 分：元认知弱', '2.4', '0.85'],
      ['ENGAGEMENT', '课堂参与', '评估学生在课堂上的主动参与程度', '>=4 分：参与积极', '<=2 分：参与度低', '2.8', '0.9'],
    ],
    ruleLabels: ['注意力与策略双重薄弱', '作业完成度持续走低', '课堂参与严重不足'],
    toolNames: ['番茄工作法指导', '错题分析模板', '学习策略训练', '课堂参与提升方案'],
    toolShort: ['番茄工作法', '错题分析', '策略训练', '参与提升'],
    toolTags: ['learning_problem,orange,focus', 'learning_problem,yellow,analysis', 'learning_problem,orange,strategy', 'learning_problem,green,engagement'],
    keywords: ['成绩下滑', '注意力不集中', '作业不交', '上课走神'],
  },
}

// ===================================================================
// XLSX 工作表构建器
// ===================================================================

function buildWorkbook(sheets) {
  const wb = XLSX.utils.book_new()
  for (const [name, { headers, rows }] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  return wb
}

// ===================================================================
// 量表 (assessment) 生成
// ===================================================================

function makeAssessmentWB(m) {
  const sc = MODULE_SCENARIOS[m.code]
  const code1 = m.short + '_FIVE_Q'
  const code2 = m.short + '_QUICK'
  const label = m.label

  // ③ 量表-清单 — 2 行
  const instruments = [
    [code1, label + sc.instrumentNames[0], sc.instrumentShort[0],
      m.code, 'all', '', '', 'teacher',
      'self_report', 'manual', 'monthly', '是',
      '3', '', '5', '每月一次', '30', '', '',
      'teacher_only', '班主任本人', 'highly_sensitive', 'proprietary', '',
      '技术理论手册V5 第3章', '1.0.0',
      '回顾最近一周状态，产出多维评估结果',
      '全国中小学班主任常模 N=3200',
      'Cronbach α=0.87', '与GHQ-12 相关系数 r=0.64',
      '数据仅用于教学支持，不用于人事考核',
      '适用于在职班主任，不适用于实习或代课教师',
      '教师正在经历重大个人变故时，建议先转介心理支持再施测',
      '如总分>=17，建议进行深度访谈并启动个案'],
    [code2, label + sc.instrumentNames[1], sc.instrumentShort[1],
      m.code, 'all', '', '', 'teacher',
      'self_report', 'manual', 'per_case', '是',
      '5', '', '8', '学期初/学期末', '90', '', '',
      'teacher_only', '班主任本人', 'internal', 'proprietary', '',
      '技术理论手册V5 第4章', '1.0.0',
      '评估教师在' + label + '相关维度的资源与压力状况',
      '全国中小学班主任常模 N=2800',
      'Cronbach α=0.82', '内容效度经专家评审',
      '数据仅用于教学支持',
      '适用于在职班主任',
      '教师在严重心理危机时，建议先进行心理评估',
      '根据评估结果推荐相应的支持工具'],
  ]

  // ④ 量表-题目 — 每个量表 5 题
  const OPT_CODE = 'FREQ_5'
  const questions = []
  const dims = sc.dimensions

  for (let i = 0; i < 5; i++) {
    const d = dims[i]
    questions.push([
      code1, 'q' + (i + 1), 'single', d[0], '',
      '这一周，我有多少时间感到' + d[2].replace('评估教师', '').replace('评估', '') + '？',
      '', OPT_CODE, i === 2 ? '是' : '否', '1', '是', '', 'compute', '', '', '5',
    ])
  }
  for (let i = 0; i < 5; i++) {
    const d = dims[i]
    questions.push([
      code2, 'q' + (i + 1), 'single', d[0], '',
      '在' + label + '方面，' + d[2] + '的情况如何？',
      '', OPT_CODE, i === 2 ? '是' : '否', '1', '是', '', 'compute', '', '', '5',
    ])
  }

  // ④b 量表-选项组 — FREQ_5
  const optionGroups = [
    ['FREQ_5', '1', '几乎没有', '1'],
    ['FREQ_5', '2', '很少', '2'],
    ['FREQ_5', '3', '有时', '3'],
    ['FREQ_5', '4', '经常', '4'],
    ['FREQ_5', '5', '几乎每天', '5'],
  ]

  // ④c 量表-维度定义
  const dimRows = dims.map(d => [code1, d[0], d[1], 'q' + (dims.indexOf(d) + 1), 'mean', '1', d[2], d[3], d[4], d[5], d[6]])
  const dimRows2 = dims.map(d => [code2, d[0], d[1], 'q' + (dims.indexOf(d) + 1), 'mean', '1', d[2], d[3], d[4], d[5], d[6]])

  return buildWorkbook({
    '③ 量表-清单': {
      headers: ['量表编码*','量表名称*','量表简称','所属模块*','适用学部*','适用年级','适用学科','施测对象*','施测形式*','触发方式*','作答频次*','是否必做*','预计用时分钟*','作答时限分钟','最低题数','使用时机','重评间隔天数','前置量表编码','互斥量表编码','结果可见性*','责任角色','数据敏感级*','来源属性*','外部授权说明','手册出处*','版本*','量表说明','常模参照','信度说明','效度说明','隐私声明','适用前提','不适合情况','后续建议动作'],
      rows: instruments,
    },
    '④ 量表-题目': {
      headers: ['量表编码*','题号*','题型*','维度*','子维度','题干*','题干举例','选项组编码*','反向计分*','权重','是否必答*','显示条件','数据用途*','答题提示','题目说明','默认分值'],
      rows: questions,
    },
    '④b 量表-选项组': {
      headers: ['选项组编码*','选项顺序*','选项文本*','分值*'],
      rows: optionGroups,
    },
    '④c 量表-维度定义': {
      headers: ['量表编码*','维度编码*','维度名称*','所属题号列表*','计算方式*','权重系数','维度说明','高分解释','低分解释','常模均值','常模标准差'],
      rows: [...dimRows, ...dimRows2],
    },
  })
}

// ===================================================================
// 归因 (attribution) 生成
// ===================================================================

function makeAttributionWB(m) {
  const sc = MODULE_SCENARIOS[m.code]
  const code1 = m.short + '_FIVE_Q'

  // ⑤b 归因-计算变量
  const computed = [
    ['总负荷指数', m.code, '总分', '五题得分总和', code1, '', ''],
    ['情绪耗竭指数', m.code, '维度[EMOTION]', '情绪状态维度均值', code1, 'q1', 'EMOTION'],
    ['连续低意义感次数', m.code, 'COUNT_CONSECUTIVE(题[q3] <= 2, 4)', '统计最近连续4次评估中意义感知得分<=2的次数', code1, 'q3', 'MEANING'],
  ]

  // ⑤c 归因-分级规则 — 4条有触发条件 + 1条兜底
  const branches = [
    [m.short + '-RED-Q1-Q3', m.code, code1, '10',
      '题[q1] >= 4 且 题[q3] >= 4',
      'red', '需立即关注', '是',
      sc.ruleLabels[0], '情绪耗竭',
      'Q1疲劳>=4分且Q3意义感<=2分，两者同时处于高危水平，教师可能正经历情绪耗竭的核心阶段',
      sc.toolTags[0],
      sc.ruleLabels[0] + '风险同时处于高位，已暂停常规建议并转介。',
      '建议安排心理专员面谈，暂缓常规班级评估',
      sc.toolNames[0] + '（应急）、情绪温度计自评',
      '', '', '下次评估Q1或Q3任一>=3分时触发复评',
      'PRD 8.2.1'],
    [m.short + '-ORANGE', m.code, code1, '20',
      '总分 >= 17',
      'orange', '需关注', '否',
      sc.ruleLabels[1], '',
      '总分>=17分，教师在多个维度上感受到压力，但未达到红线阈值',
      sc.toolTags[1],
      '您的整体状态在多个维度上偏高，建议重点关注并选择1-2项工具开始调整。',
      '建议本月内完成一次深度自评',
      sc.toolNames[1] + '、' + (sc.toolNames[2] || '同伴支持圈'),
      '连续3次评估仍为orange', '升级至red评估流程', '',
      'PRD 8.2.1'],
    [m.short + '-YELLOW', m.code, code1, '30',
      '维度[EMOTION] >= 3.5',
      'yellow', '需留意', '否',
      sc.ruleLabels[2], '情绪耗竭',
      '情绪耗竭维度得分偏高，可能出现轻度职业倦怠的早期信号',
      sc.toolTags[2],
      '您的情绪耗竭维度偏高，建议开始关注自我照顾。',
      '建议使用自我照顾工具', sc.toolNames[1] + '、同伴支持圈',
      '连续2次评估仍为yellow', '升级至orange评估流程', '',
      'PRD 8.2.1'],
    [m.short + '-GREEN', m.code, code1, '100',
      '',
      'green', '状态良好', '否',
      '状态稳定', '',
      '当前评估未触发任何风险规则，教师整体状态稳定',
      m.code + ',green',
      '当前状态整体稳定，保持现有节奏即可。',
      '', '', '', '', '',
      'PRD 8.2.1'],
  ]

  // ⑥ 归因-红线熔断 — 每模块至少1条
  const redLines = [
    [m.code,
      '题[q1] >= 4 且 题[q3] >= 4',
      sc.ruleLabels[0] + '，属' + m.label + '模块红线',
      'module',
      '立即阻断常规建议输出，展示求助指引，生成转介工单通知心理专员',
      '1. 停止当前评估流程 2. 展示危机求助指引 3. 自动创建安全事件 4. 生成转介工单 5. 发送短信通知心理专员',
      '当事教师完成心理专员面谈，且专员在系统中标记为「已处置」',
      '心理专员',
      '[教师姓名]老师在' + m.label + '评估中触发红线：' + sc.ruleLabels[0] + '。请尽快登录系统查看工单。',
      'PRD 8.3'],
  ]

  return buildWorkbook({
    '⑤b 归因-计算变量': {
      headers: ['变量名*','所属模块*','计算表达式*','变量说明','依赖量表编码','依赖题号','依赖维度编码'],
      rows: computed,
    },
    '⑤c 归因-分级规则': {
      headers: ['规则编码*','所属模块*','依据量表编码*','优先级*','触发条件','命中等级*','等级中文名*','是否红线熔断*','主归因*','次归因','归因理由*','工具标签*','结果说明*','输出动作摘要','输出工具摘要','升级条件','升级目标','复评触发条件','手册出处'],
      rows: branches,
    },
    '⑥ 归因-红线熔断': {
      headers: ['所属模块*','红线条件*','红线说明*','熔断范围*','处置要求*','熔断后动作','恢复条件','责任人','通知模板','手册出处'],
      rows: redLines,
    },
  })
}

// ===================================================================
// 工具 (tool) 生成
// ===================================================================

function makeToolWB(m) {
  const sc = MODULE_SCENARIOS[m.code]

  // ⑦ 工具-处方总表 — 4条工具
  const tools = [
    [m.short + '_RX_001', sc.toolNames[0], sc.toolShort[0],
      m.code, 'exercise', 'all', 'teacher',
      '感到情绪即将失控、疲惫难以恢复时',
      'medium', sc.ruleLabels[0],
      sc.toolTags[0], '情绪恢复',
      '1) 离开当前情境 2) 三轮缓慢呼吸 3) 命名情绪 4) 选最小行动',
      '现在先停三分钟，这三分钟只属于你自己。',
      '单次可下降 1-2 分主观压力值',
      '3 分钟', '每日 1-2 次，连续 7 天', '7',
      '不用于替代危机处置；出现自伤念头或持续失眠时须转介心理专员',
      '', '', '', m.short + '_RX_004',
      'B', 'Kabat-Zinn 正念减压研究；教师群体适应性改编研究（2023）',
      '主观压力值下降>=1分；一周后情绪耗竭维度得分下降',
      '连续使用3次后主观压力值未下降',
      '确保教师有3分钟不被打扰的环境',
      '计时器、一周能量记录卡',
      '一周能量记录卡',
      m.short + '_RX_004',
      m.label + '处方库 P12', '1.0.0',
      'class_system,home_school'],
    [m.short + '_RX_002', sc.toolNames[1], sc.toolShort[1],
      m.code, 'worksheet', 'all', 'teacher',
      '日常自我照顾和压力管理',
      'low', sc.ruleLabels[1],
      sc.toolTags[1], '自我照顾',
      '1) 记录每日能量变化 2) 识别能量消耗源 3) 制定能量补充计划',
      '记录本身就是一种觉察和关爱。',
      '帮助教师建立自我照顾习惯，降低日常压力水平',
      '5 分钟', '每日一次，持续 14 天', '14',
      '本工具不适用于危机情境；教师处于急性心理危机时请先转介心理专员',
      '', '', '', '',
      'B', '教师自我效能感训练研究（2022）',
      '连续一周能量记录完整且主观压力值下降',
      '连续3天未记录',
      '打印一周能量记录卡',
      '一周能量记录卡、笔',
      '完成的一周能量记录卡',
      '', m.label + '处方库 P15', '1.0.0', ''],
    [m.short + '_RX_003', sc.toolNames[2], sc.toolShort[2],
      m.code, 'framework', 'all', 'teacher',
      '需要同伴支持和经验交流时',
      'low', sc.ruleLabels[1],
      sc.toolTags[2], '同伴支持',
      '1) 邀请2-3位同事 2) 轮流分享当前困扰 3) 团体生成至少一条行动建议',
      '你不是一个人在战斗。',
      '通过结构化同伴支持缓解教师的孤立感',
      '30 分钟', '每周一次，持续 4 周', '28',
      '本活动不等同于心理治疗，涉及严重心理问题时应转介专业支持',
      '', '', '', '',
      'C', '同伴支持对教师职业倦怠干预效果研究（2021）',
      '参与教师反馈压力感和孤立感下降',
      '连续2次参与人数低于2人',
      '准备问题引导卡',
      '问题引导卡、白板、记号笔',
      '行动建议记录表',
      '', m.label + '处方库 P20', '1.0.0', ''],
    [m.short + '_RX_004', sc.toolNames[3], sc.toolShort[3],
      m.code, 'script', 'all', 'teacher',
      '出现明显负面自动思维时',
      'medium', sc.ruleLabels[0],
      sc.toolTags[3], '认知调整',
      '1) 识别负面自动思维 2) 检验思维的证据 3) 生成替代性解释 4) 行动计划',
      '想法不一定是事实，让我们一起来看看证据。',
      '帮助教师识别和调整负面自动思维，降低认知层面的压力',
      '15 分钟', '每周 2-3 次，持续 4 周', '14',
      '有严重抑郁症状的教师应先在心理专员指导下使用',
      '', '', '', '',
      'B', 'Beck 认知疗法教师适应性改编研究（2022）',
      '2周后负面自动思维频率下降 >=30%',
      '使用2周后负面思维频率未下降且教师反馈无改善',
      '打印认知重构工作表',
      '认知重构工作表、笔',
      '完成的认知重构工作表',
      '', m.label + '处方库 P18', '1.0.0', ''],
  ]

  // ⑦b 工具-步骤明细
  const steps = [
    [m.short + '_RX_001', '1', '离开当前情境',
      '暂时离开当前工作环境（办公室、教室），找到一个安静不被打扰的空间',
      '30秒', '', '不需要走很远，去走廊尽头或空会议室即可', '',
      '教师已经离开原环境，至少获得3分钟不被干扰的时间',
      '如果实在无法离开怎么办？（答：至少转身背对工作区域，闭眼30秒）'],
    [m.short + '_RX_001', '2', '三轮缓慢呼吸',
      '进行三轮缓慢深呼吸：吸气4秒→屏息2秒→呼气6秒。每轮之间自然呼吸10秒',
      '60秒', '计时器（可选）', '不要刻意用力呼吸，重点是让呼气比吸气更长', '',
      '完成了三轮呼吸',
      '如果注意力无法集中怎么办？（答：把注意力放在呼气的感觉上，每次走神都重新回来即可）'],
    [m.short + '_RX_001', '3', '命名此刻的情绪',
      '问自己「我现在感受到的是什么？」——是愤怒、委屈、无力、焦虑、还是别的？给情绪一个名字',
      '30秒', '', '不需要分析原因，只需要命名。如果同时有多种情绪，选最强烈的那一个', '',
      '教师能够说出至少一种情绪的名称', ''],
    [m.short + '_RX_001', '4', '选一个最小行动',
      '问自己「接下来5分钟，我能做的最小、最简单的一件事是什么？」选一件，然后做',
      '60秒', '', '最小行动的标准：不需要别人配合，不需要准备，立即能做', '',
      '教师选出了至少一个可行的最小行动', ''],
    [m.short + '_RX_002', '1', '记录今日能量',
      '在能量记录卡上记录你今天几个关键时间点的能量状态（1-10分）',
      '3分钟', '能量记录卡', '保持诚实，不需要美化', '',
      '完成了至少3个时间点的记录', ''],
    [m.short + '_RX_002', '2', '识别能量消耗',
      '回顾今天的能量低谷，思考是什么消耗了你的能量',
      '2分钟', '', '不需要找出所有原因，选影响最大的1-2个即可', '',
      '识别出至少1个能量消耗源', ''],
  ]

  // ⑧ 工具-禁忌规则
  const contraRules = [
    [m.short + '_RX_001', '教师自评抑郁量表得分>=15', 'block',
      '抑郁风险较高时应先进行专业心理评估，不可单独依赖呼吸练习',
      '通知心理专员进行评估', '存在抑郁风险的教师', 'PRD 8.2.1'],
    [m.short + '_RX_004', '教师处于急性危机状态', 'block',
      '急性危机时认知重构类工具可能加重混乱感',
      '先使用安全稳定化工具，等状态稳定后再使用', '', 'PRD 8.2.1'],
    [m.short + '_RX_003', '参与教师超过8人', 'warn',
      '超过8人时小组讨论深度下降，建议拆分小组',
      '每组控制在4-6人，增加一名引导员', '年级组长', ''],
  ]

  return buildWorkbook({
    '⑦ 工具-处方总表': {
      headers: ['工具编码*','工具名称*','工具简称','所属模块*','工具形式*','适用学部*','适用对象*','适用症状场景*','严重度*','对应归因*','工具标签*','作用维度','操作步骤摘要*','关键话术','预期效果*','单次耗时','疗程与频次','重评间隔天数','禁止事项*','禁忌说明','前置工具编码','替代工具编码','进阶工具编码','证据等级*','证据来源','效果指标','失败标准','准备事项','所需材料','输出物','协同工具编码','手册出处*','版本*','跨模块标签'],
      rows: tools,
    },
    '⑦b 工具-步骤明细': {
      headers: ['工具编码*','步骤序号*','步骤标题*','步骤说明*','预计耗时','所需材料','关键提示','话术模板','成功标准','常见问题'],
      rows: steps,
    },
    '⑧ 工具-禁忌规则': {
      headers: ['工具编码*','禁忌条件*','禁忌类型*','禁忌说明*','替代建议','适用教师群体','依据'],
      rows: contraRules,
    },
  })
}

// ===================================================================
// 关键词路由 (keyword_route) 生成
// ===================================================================

function makeKeywordRouteWB(m) {
  const sc = MODULE_SCENARIOS[m.code]

  const routes = [
    ['KW_' + m.short + '_01',
      sc.keywords[0], sc.keywords[0] + '相关；工作压力大；感觉疲惫',
      '开玩笑的表达；反讽',
      m.code, '1', 'exact', 'red',
      sc.keywords[0], m.short + '_FIVE_Q', m.short + '_RX_001',
      '未触发红线', '1.0', 'always',
      '教师在对话中表达' + sc.keywords[0] + '相关信号，触发' + m.label + '模块评估和工具推荐'],
    ['KW_' + m.short + '_02',
      sc.keywords[1], sc.keywords[1] + '相关；' + sc.keywords[1] + '表现',
      '', m.code, '3', 'fuzzy', 'orange',
      sc.keywords[1], m.short + '_FIVE_Q', m.short + '_RX_002',
      '', '0.8', 'always',
      '教师表达' + sc.keywords[1] + '相关困扰，推荐对应自我照顾工具'],
    ['KW_' + m.short + '_03',
      sc.keywords[2], sc.keywords[2] + '相关；情绪不良',
      '', m.code, '5', 'fuzzy', 'yellow',
      sc.keywords[2], m.short + '_QUICK', m.short + '_RX_003',
      '未触发红线', '0.6', 'always',
      '教师表达' + sc.keywords[2] + '相关信号，推荐同伴支持或自评'],
    ['KW_' + m.short + '_04',
      sc.keywords[3], sc.keywords[3] + '相关；无精打采',
      '', m.code, '7', 'fuzzy', 'yellow',
      sc.keywords[3], m.short + '_QUICK', m.short + '_RX_004',
      '', '0.5', 'always',
      '教师表达' + sc.keywords[3] + '相关信号，推荐认知类工具'],
  ]

  return buildWorkbook({
    '⑨ 关键词-路由': {
      headers: ['关键词编码*','核心触发词*','扩展词与近义表达','排除词','所属模块*','匹配优先级*','匹配模式','风险等级*','语义分类','关联量表编码','关联工具编码','情境限定','路由权重','时效性','场景描述'],
      rows: routes,
    },
  })
}

// ===================================================================
// 方案输出模板 (output_template) 生成
// ===================================================================

function makeOutputTemplateWB(m) {
  const sc = MODULE_SCENARIOS[m.code]

  const templates = [
    ['TPL-' + m.short + '-RED-SUMMARY', m.code, 'red', 'summary',
      '评估显示，您在「${维度名1}」和「${维度名2}」两个维度上的得分同时处于高危水平。' +
      sc.ruleLabels[0] + '，需要优先关注。',
      '${维度名1} ${维度名2} 会被替换为实际触发红线的维度中文名', '1'],
    ['TPL-' + m.short + '-RED-CONCLUSION', m.code, 'red', 'conclusion',
      '本次评估结论：${主归因}（${次归因}）。已触发安全熔断，常规建议暂停输出。',
      '${主归因} 来自归因-分级规则.主归因；${次归因} 来自归因-分级规则.次归因', '2'],
    ['TPL-' + m.short + '-RED-GOAL', m.code, 'red', 'goal',
      '当前首要目标：1) 确保教师获得即时心理支持 2) 降低当前的急性压力水平 3) 建立至少一个可依赖的支持关系',
      '', '3'],
    ['TPL-' + m.short + '-ORANGE-ATTRIBUTION', m.code, 'orange', 'attribution',
      '本次评估的归因分析：${主归因}。建议重点关注以下方面：${工具标签}',
      '${主归因} ${工具标签} 从归因规则中取值', '4'],
    ['TPL-' + m.short + '-ORANGE-ACTION', m.code, 'orange', 'action',
      '根据评估结果，建议采取以下行动：${输出动作摘要}。推荐工具：${输出工具摘要}。',
      '${输出动作摘要} ${输出工具摘要} 从归因规则中取值', '5'],
    ['TPL-' + m.short + '-GREEN-SUMMARY', m.code, 'green', 'summary',
      '本次评估结果整体良好，各项指标均在正常范围内。继续保持现有节奏。',
      '', '6'],
  ]

  return buildWorkbook({
    '⑩ 方案输出模板': {
      headers: ['模板编码*','所属模块*','命中归因等级*','模板类型*','模板内容*','占位符说明','排序*'],
      rows: templates,
    },
  })
}

// ===================================================================
// 导入
// ===================================================================

async function login() {
  const res = await fetch(BASE_URL + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    redirect: 'manual',
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error('登录失败: ' + res.status + ' ' + text.slice(0, 200))
  }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get('set-cookie') || '')
  return Array.isArray(setCookie) ? setCookie.join('; ') : setCookie
}

async function importFile(cookie, module, libraryType, libraryName, workbook) {
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const contentBase64 = buffer.toString('base64')

  const res = await fetch(BASE_URL + '/api/v1/platform-admin/module-resources/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
    },
    body: JSON.stringify({
      module,
      libraryType,
      scope: 'global',
      libraryName,
      version: '1.0.0',
      notes: 'V2 模板导入的测试数据 v1.0.0',
      filename: module + '_' + libraryType + '.xlsx',
      contentBase64,
      confirmNoPersonalData: true,
      publish: true,
    }),
    redirect: 'manual',
  })

  const body = await res.text()
  return { ok: res.ok, status: res.status, body: body.slice(0, 500) }
}

// ===================================================================
// 主流程
// ===================================================================

async function main() {
  console.log('=== 三库测试数据生成 + 导入 ===\n')

  // Step 1: 登录
  console.log('登录平台管理员账号...')
  let cookie
  try {
    cookie = await login()
    console.log('  登录成功\n')
  } catch (e) {
    console.error('  登录失败:', e.message)
    console.error('  请确认 dev server 已启动 (pnpm dev) 且 seed 数据已就绪')
    process.exit(1)
  }

  // Step 2: 确保输出目录
  const baseDir = 'business-libraries/test-data'
  for (const m of MODULES) {
    mkdirSync(baseDir + '/' + m.code, { recursive: true })
  }

  // Step 3: 逐个生成 + 保存 + 导入
  const libraryTypes = ['assessment', 'attribution', 'tool', 'keyword_route', 'output_template']
  let totalSuccess = 0
  let totalFail = 0

  for (const m of MODULES) {
    for (const libType of libraryTypes) {
      const libLabel = m.label + '·' + TYPE_LABELS[libType]
      process.stdout.write('  ' + m.code + '/' + libType + '... ')

      let wb
      try {
        switch (libType) {
          case 'assessment': wb = makeAssessmentWB(m); break
          case 'attribution': wb = makeAttributionWB(m); break
          case 'tool': wb = makeToolWB(m); break
          case 'keyword_route': wb = makeKeywordRouteWB(m); break
          case 'output_template': wb = makeOutputTemplateWB(m); break
        }
      } catch (e) {
        console.log('生成失败: ' + e.message)
        totalFail++
        continue
      }

      // 保存文件
      const filePath = baseDir + '/' + m.code + '/' + libType + '.xlsx'
      XLSX.writeFile(wb, filePath)

      // 导入
      const result = await importFile(cookie, m.code, libType, libLabel, wb)

      if (result.ok) {
        console.log('OK')
        totalSuccess++
      } else {
        console.log('FAIL (' + result.status + '): ' + result.body)
        totalFail++
      }
    }
  }

  // Step 4: 汇总
  console.log('\n=== 导入完成: ' + totalSuccess + ' 成功, ' + totalFail + ' 失败 ===')
  if (totalFail > 0) {
    console.log('失败项:')
  }
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})
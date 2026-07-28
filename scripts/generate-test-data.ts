// 测试数据生成 + 导入脚本
// 用法: pnpm tsx scripts/generate-test-data.ts
// 前提: dev server 运行在 localhost:3300 (pnpm dev)
//       seed 用户 platform.admin@demo.local / Mentor@2026 存在

import * as XLSX from 'xlsx'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE_URL = 'http://localhost:3300'
const ADMIN_EMAIL = 'platform.admin@demo.local'
const ADMIN_PASSWORD = 'Mentor@2026'

// ===================================================================
// 测试数据工厂 — 按模块×类型生成
// ===================================================================

const MODULES = [
  { code: 'self_growth' as const,    label: '个人成长',      prefix: 'S' },
  { code: 'class_system' as const,   label: '班级系统建设',  prefix: 'C' },
  { code: 'home_school' as const,    label: '家校沟通',      prefix: 'H' },
  { code: 'student_case' as const,   label: '学生个案',      prefix: 'ST' },
  { code: 'learning_problem' as const, label: '学习问题',    prefix: 'L' },
] as const

type Module = typeof MODULES[number]
type LibraryType = 'assessment' | 'attribution' | 'tool' | 'keyword_route' | 'output_template'

const TYPE_LABELS: Record<LibraryType, string> = {
  assessment: '量表库',
  attribution: '归因库',
  tool: '工具库',
  keyword_route: '关键词路由库',
  output_template: '方案输出模板库',
}

// --- 量表测试数据 ---
function makeAssessmentSheets(m: Module) {
  const code1 = `${m.code}/${m.prefix}01`
  const code2 = `${m.code}/${m.prefix}02`

  const OPT_5LIKERT = 'LK5'
  const OPT_AGREE  = 'AGREE'
  const OPT_FREQ   = 'FREQ'

  // ③ 量表-清单
  const instruments = [
    makeAssessmentRow(code1, m, '量表一', 'primary', 6, OPT_5LIKERT),
    makeAssessmentRow(code2, m, '量表二', 'junior', 8, OPT_AGREE),
  ]

  // ④ 量表-题目
  const questions = [
    // code1 题目 (6题, 维度 A/B)
    ...makeQuestions(code1, 6, [0,0,0,1,1,1], OPT_5LIKERT, m),
    // code2 题目 (8题, 维度 X/Y)
    ...makeQuestions(code2, 8, [0,0,0,0,1,1,1,1], OPT_AGREE, m),
  ]

  // ④b 选项组
  const optionGroups = [
    [OPT_5LIKERT, 1, '几乎没有', 1],
    [OPT_5LIKERT, 2, '很少', 2],
    [OPT_5LIKERT, 3, '有时', 3],
    [OPT_5LIKERT, 4, '经常', 4],
    [OPT_5LIKERT, 5, '几乎每天', 5],
    [OPT_AGREE, 1, '完全不符合', 1],
    [OPT_AGREE, 2, '比较不符合', 2],
    [OPT_AGREE, 3, '一般', 3],
    [OPT_AGREE, 4, '比较符合', 4],
    [OPT_AGREE, 5, '非常符合', 5],
    [OPT_FREQ, 1, '从不', 1],
    [OPT_FREQ, 2, '偶尔', 2],
    [OPT_FREQ, 3, '有时', 3],
    [OPT_FREQ, 4, '经常', 4],
    [OPT_FREQ, 5, '总是', 5],
  ]

  // ④c 维度定义
  const dimensions = [
    [code1, 'A', '维度A', '1,2,3', 'mean', 1, `${m.label}量表一维度A说明`, '分数越高该项能力越强', '分数越低该项能力越弱', 2.5, 0.8],
    [code1, 'B', '维度B', '4,5,6', 'sum', 0.8, `${m.label}量表一维度B说明`, '分数越高表现越稳定', '分数越低波动越大', 2.0, 0.7],
    [code2, 'X', '维度X', '1,2,3,4', 'mean', 1, `${m.label}量表二维度X说明`, '分数越高越好', '分数越低需关注', 3.0, 0.9],
    [code2, 'Y', '维度Y', '5,6,7,8', 'mean', 1, `${m.label}量表二维度Y说明`, '分数越高越积极', '分数越低需干预', 2.8, 0.85],
  ]

  // 构建 workbook
  return buildWorkbook({
    '③ 量表-清单': {
      headers: [
        '量表编码*','量表名称*','量表简称','所属模块*','适用学部*','适用年级','适用学科',
        '施测对象*','施测形式*','触发方式*','作答频次*','是否必做*','预计用时分钟*',
        '作答时限分钟','最低题数','使用时机','重评间隔天数','前置量表编码','互斥量表编码',
        '结果可见性*','责任角色','数据敏感级*','来源属性*','外部授权说明','手册出处*',
        '版本*','量表说明','常模参照','信度说明','效度说明','隐私声明','适用前提','不适合情况','后续建议动作'
      ],
      rows: instruments,
    },
    '④ 量表-题目': {
      headers: [
        '量表编码*','题号*','题型*','维度*','子维度','题干*','题干举例','选项组编码*',
        '反向计分*','权重','是否必答*','显示条件','数据用途*','答题提示','题目说明','默认分值'
      ],
      rows: questions,
    },
    '④b 量表-选项组': {
      headers: ['选项组编码*','选项顺序*','选项文本*','分值*'],
      rows: optionGroups,
    },
    '④c 量表-维度定义': {
      headers: [
        '量表编码*','维度编码*','维度名称*','所属题号列表*','计算方式*',
        '权重系数','维度说明','高分解释','低分解释','常模均值','常模标准差'
      ],
      rows: dimensions,
    },
  })
}

function makeAssessmentRow(code: string, m: Module, name: string, schoolSection: string, qCount: number, optCode: string) {
  return [
    code,                              // 量表编码*
    `${m.label}${name}`,               // 量表名称*
    name,                              // 量表简称
    m.code,                            // 所属模块*
    schoolSection,                     // 适用学部*
    '7,8,9',                           // 适用年级
    '语文,数学',                        // 适用学科
    '班主任',                           // 施测对象*
    '自评量表',                         // 施测形式*
    'manual',                           // 触发方式*
    'per_case',                         // 作答频次*
    '是',                               // 是否必做*
    String(Math.ceil(qCount * 1.5)),   // 预计用时分钟*
    '20',                               // 作答时限分钟
    String(qCount),                    // 最低题数
    '学期初/学期末',                    // 使用时机
    '90',                               // 重评间隔天数
    '',                                 // 前置量表编码
    '',                                 // 互斥量表编码
    'teacher_only',                     // 结果可见性*
    '班主任',                           // 责任角色
    '内部',                             // 数据敏感级*
    '原创',                             // 来源属性*
    '',                                 // 外部授权说明
    `${m.label}手册v1`,                // 手册出处*
    '1.0.0',                            // 版本*
    `${m.label}${name}用于评估${m.label}相关指标`, // 量表说明
    '参考全国教师常模',                  // 常模参照
    'Cronbach α > 0.85',               // 信度说明
    '结构效度良好',                      // 效度说明
    '数据仅用于教学支持',                // 隐私声明
    '教师自愿参与',                      // 适用前提
    '无',                               // 不适合情况
    '根据结果进行针对性支持',            // 后续建议动作
  ]
}

function makeQuestions(code: string, count: number, dims: number[], optCode: string, m: Module) {
  const questions: any[][] = []
  for (let i = 0; i < count; i++) {
    const qNum = i + 1
    questions.push([
      code,                              // 量表编码*
      `q${qNum}`,                        // 题号*
      'likert_5',                        // 题型*
      dims[i] === 0 ? 'A' : dims[i] === 1 ? 'B' : String(dims[i]), // 维度*
      '',                                // 子维度
      `${m.label}测试题目${qNum}：请根据实际情况选择最符合的选项`, // 题干*
      `例如：我在${m.label}方面感到...`, // 题干举例
      optCode,                           // 选项组编码*
      qNum === 3 ? '是' : '否',          // 反向计分*
      1,                                 // 权重
      '是',                              // 是否必答*
      '',                                // 显示条件
      '诊断',                            // 数据用途*
      '',                                // 答题提示
      `题目${qNum}说明`,                 // 题目说明
      5,                                 // 默认分值
    ])
  }
  return questions
}

// --- 归因测试数据 ---
function makeAttributionSheets(m: Module) {
  const computed = [
    [`${m.code}_score`, m.code, 'mean(q1,q2,q3,q4,q5,q6)', `${m.label}量表均分`, `${m.code}/${m.prefix}01`, 'q1,q2,q3,q4,q5,q6', 'A,B'],
    [`${m.code}_risk`, m.code, '(score < 2.5 ? "low" : score < 3.5 ? "medium" : "high")', `${m.label}风险等级`, `${m.code}/${m.prefix}01`, '', ''],
  ]

  const branches = [
    [`${m.code}-rule-1`, m.code, `${m.code}/${m.prefix}01`, 1, `${m.code}_risk == "low"`, '低风险', '正常', '否', `${m.label}状态良好`, '', '该教师各项指标正常，无需额外关注', 'self_growth,class_system', '教师在各项评估中表现正常，建议保持现有教学策略和班级管理方法。', '维持现有教学策略', '推荐日常自我反思工具', '无', '', '', ''],
    [`${m.code}-rule-2`, m.code, `${m.code}/${m.prefix}01`, 2, `${m.code}_risk == "medium"`, '中风险', '需关注', '否', `${m.label}有所波动`, `${m.label}轻微下降`, '存在轻微的教学压力或班级管理挑战，需要适度关注。', 'self_growth,home_school', '教师在部分维度得分低于常模，建议有针对性地进行教学策略调整或参与相关培训。', '参加专项培训', '时间管理工具,情绪调节练习', '连续两次评估仍为中风险', '年级组长', '90天后复评', ''],
    [`${m.code}-rule-3`, m.code, `${m.code}/${m.prefix}01`, 3, `${m.code}_risk == "high"`, '高风险', '需干预', '否', `${m.label}问题突出`, `${m.label}明显下降`, '教师面临较严重的教学压力或班级管理困难，需要系统干预。', 'student_case', '教师在多个关键维度得分显著低于常模，可能影响教学效果和学生发展，建议进行系统评估。', '启动支持计划', '教学导师辅导,心理咨询', '连续两次高风险或出现危机信号', '教务处', '30天后复评', ''],
    [`${m.code}-rule-4`, m.code, `${m.code}/${m.prefix}02`, 4, `${m.code}_score < 2`, '红线', '紧急干预', '是', `${m.label}达到红线标准`, '', '教师评估结果超出安全阈值，系统自动触发预警。', 'student_case', '教师评估得分极低，可能存在严重职业倦怠或心理危机，需立即启动干预程序。', '启动危机干预预案', '心理咨询转介', '', '校长/心理专员', '', ''],
  ]

  const redLines = [
    [m.code, `${m.code}_score < 1.5 && ${m.code}_risk == "high"`, `${m.label}红线熔断：持续高风险且得分极低`, 'module', '立即通知校长和心理专员，启动校方干预机制，暂停高风险教学活动直至复评通过', '通知校长,通知心理专员,启动干预预案,暂停高风险教学', '连续两次复评得分恢复到常模范围', '校长', '【预警】${m.label}评估触发红线熔断', `${m.label}手册v1`],
  ]

  return buildWorkbook({
    '⑤b 归因-计算变量': {
      headers: ['变量名*','所属模块*','计算表达式*','变量说明','依赖量表编码','依赖题号','依赖维度编码'],
      rows: computed,
    },
    '⑤c 归因-分级规则': {
      headers: [
        '规则编码*','所属模块*','依据量表编码*','优先级*','触发条件','命中等级*',
        '等级中文名*','是否红线熔断*','主归因*','次归因','归因理由*','工具标签*',
        '结果说明*','输出动作摘要','输出工具摘要','升级条件','升级目标','复评触发条件','手册出处'
      ],
      rows: branches,
    },
    '⑥ 归因-红线熔断': {
      headers: ['所属模块*','红线条件*','红线说明*','熔断范围*','处置要求*','熔断后动作','恢复条件','责任人','通知模板','手册出处'],
      rows: redLines,
    },
  })
}

// --- 工具测试数据 ---
function makeToolSheets(m: Module) {
  const tools = [
    [`${m.code}/T01`, `${m.label}工具一`, '工具一简称', m.code, '结构化访谈', 'primary', '教师', '轻度教学压力或班级管理困扰', '低', `${m.label}状态良好`, 'self_growth', '教师访谈引导,压力管理', '1. 建立信任关系\n2. 结构化提问\n3. 记录与分析', '', '缓解教学压力', '30', '每周一次共4周', '90', '', '无明确禁忌', '', '', '', 'B', '教师访谈技术手册', '有效缓解教学压力', '无明显改善且压力持续增加', '准备访谈提纲、记录表格', '访谈提纲模板、录音设备', '访谈记录文档', '', `${m.label}手册v1', '1.0.0', ''],
    [`${m.code}/T02`, `${m.label}工具二`, '工具二简称', m.code, '工作坊', 'junior', '年级组教师', '中等程度班级管理困难', '中', `${m.label}有所波动`, 'class_system', '班级管理技巧,课堂纪律', '1. 分组讨论问题\n2. 案例分析与研讨\n3. 制定班级管理改进方案', '', '提升班级管理效能', '120', '每两周一次共6次', '60', '', '严重对立师生关系谨慎使用', '', '', '', 'A', '班级管理工作坊指南', '班级纪律明显改善', '连续缺席两次工作坊', '准备案例分析材料、小组讨论题', '案例集、白板、记号笔', '改进方案文档', '', '', '1.0.0', ''],
    [`${m.code}/T03`, `${m.label}工具三`, '工具三简称', m.code, '个体辅导', 'all', '个别需要支持的教师', '较重教学压力', '高', `${m.label}问题突出`, 'learning_problem', '个别化教学策略指导', '1. 深度访谈与需求评估\n2. 制定个性化提升计划\n3. 跟踪与反馈', '', '提升教师个人教学能力', '45', '每周一次共8周', '30', '须在专职辅导老师指导下使用', '禁止在不建立信任关系情况下强行辅导', '心理安全风险高的教师需先评估', '', '', 'C', '个体辅导操作手册', '教学能力显著提升', '辅导4周后无进展需调整方案', '辅导记录表、评估量规', '辅导记录表、视频录制设备', '辅导记录', '', '', '1.0.0', ''],
    [`${m.code}/T04`, `${m.label}工具四`, '工具四简称', m.code, '线上自主学习', 'senior', '全校教师', '轻度职业倦怠', '低', `${m.label}状态良好`, '', '自我关怀练习,压力释放技巧', '1. 在线观看教学视频\n2. 完成配套练习\n3. 提交学习反馈', '自我关怀10分钟练习', '缓解职业倦怠感', '15', '每日一次持续30天', '90', '', '', '自我伤害风险高的教师不可单独使用', '', '', 'B', '教师自我关怀在线课程', '职业倦怠评分降低', '连续一周未完成每日任务', '在线学习平台账号', '教学视频、练习手册', '学习反馈日志', '', '', '1.0.0', ''],
  ]

  const steps = [
    [`${m.code}/T01`, 1, '建立信任关系', `与教师进行非正式交流，了解其${m.label}方面的基本情况，建立信任基础`, '10', '', '保持倾听姿态，避免评判性语言', '您好，我今天想和您聊聊最近...', '教师愿意开放分享', '教师高度防御或拒绝沟通'],
    [`${m.code}/T01`, 2, '结构化提问', '使用半结构化访谈提纲系统了解教师教学实践中的具体困难', '15', '结构化访谈提纲', '按照提纲顺序提问，必要时灵活追问', '', '获得完整的信息覆盖提纲中的各个维度', '教师对某些问题回避或敷衍'],
    [`${m.code}/T01`, 3, '记录与分析', '整理访谈记录，识别关键问题和潜在解决方案', '5', '访谈记录表', '尽量使用教师的原话记录，避免主观解读', '', '形成清晰的问题描述和初步支持建议', '记录信息不足或模糊'],
    [`${m.code}/T02`, 1, '问题聚焦', '通过小组讨论确定班级管理中存在的核心问题', '20', '白板、记号笔', '引导教师从"问题描述"转向"需求表达"', '', '形成3-5个待解决的核心问题列表', '讨论偏离主题或流于表面'],
    [`${m.code}/T02`, 2, '案例研讨', '分享真实班级管理案例，小组分析并探讨解决方案', '60', '案例文本', '鼓励每个教师结合自身经验提出解决思路', '', '生成至少2种可行的应对方案', '案例与教师实际情境差异过大'],
  ]

  const contraRules = [
    [`${m.code}/T01`, '教师处于严重心理危机状态', 'block', '严重心理危机时应优先转介心理专员，结构化访谈可能加重焦虑', '转介至心理专员进行专业评估', '班主任', '心理危机干预指南'],
    [`${m.code}/T01`, '教师拒绝参与访谈', 'warn', '当教师明确拒绝参与时应尊重其意愿，通过其他方式间接了解情况', '改为观察记录或同事侧面了解', '年级组长', ''],
    [`${m.code}/T02`, '参与教师超过15人', 'warn', '超过15人时分组讨论效果下降，建议拆分小组或增加引导员', '每组控制在8-12人，增加一名引导员', '年级组长', ''],
    [`${m.code}/T03`, '教师拒绝签订辅导协议', 'block', '未签订辅导协议的个体辅导无法保障双方权益和隐私', '先完成知情同意流程', '辅导老师', '个体辅导操作手册'],
    [`${m.code}/T04`, '教师自评抑郁量表得分≥15', 'block', '抑郁风险较高时应先进行专业心理评估，不可单独依赖线上课程', '通知心理专员进行评估', '心理专员', ''],
  ]

  return buildWorkbook({
    '⑦ 工具-处方总表': {
      headers: [
        '工具编码*','工具名称*','工具简称','所属模块*','工具形式*','适用学部*','适用对象*',
        '适用症状场景*','严重度*','对应归因*','工具标签*','作用维度','操作步骤摘要*',
        '关键话术','预期效果*','单次耗时','疗程与频次','重评间隔天数','禁止事项*','禁忌说明',
        '前置工具编码','替代工具编码','进阶工具编码','证据等级*','证据来源','效果指标',
        '失败标准','准备事项','所需材料','输出物','协同工具编码','手册出处*','版本*','跨模块标签'
      ],
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

// --- 关键词路由测试数据 ---
function makeKeywordRouteSheets(m: Module) {
  const routes = [
    [`${m.code}/KW01`, `${m.label},教学压力,职业倦怠,压力管理`, '工作压力大,感觉疲惫,没有动力,不想上班', '', m.code, 1, 'exact', 'high', '职业倦怠', `${m.code}/${m.prefix}01`, `${m.code}/T01`, '', 0.9, 'always', `${m.label}相关的职业倦怠场景触发路由`],
    [`${m.code}/KW02`, '班级管理,课堂纪律,学生行为问题', '学生不听话,课堂混乱,纪律差,学生打架', '', m.code, 2, 'fuzzy', 'medium', '班级管理', `${m.code}/${m.prefix}02`, `${m.code}/T02`, '', 0.7, 'always', `${m.label}班级管理问题触发路由`],
    [`${m.code}/KW03`, '家长沟通,家校合作,家长投诉', '家长不配合,家长意见大,家长抱怨', '', m.code, 3, 'fuzzy', 'medium', '家校沟通', `${m.code}/${m.prefix}01`, `${m.code}/T01`, '', 0.6, 'always', `${m.label}家校沟通问题触发路由`],
    [`${m.code}/KW04`, '学生学习困难,成绩下滑,注意力不集中', '学生成绩差,学不会,上课走神,作业不交', '', m.code, 4, 'fuzzy', 'low', '学习问题', `${m.code}/${m.prefix}02`, `${m.code}/T03`, '', 0.5, 'always', `${m.label}学习问题场景触发路由`],
  ]

  return buildWorkbook({
    '⑨ 关键词-路由': {
      headers: [
        '关键词编码*','核心触发词*','扩展词与近义表达','排除词','所属模块*',
        '匹配优先级*','匹配模式','风险等级*','语义分类','关联量表编码',
        '关联工具编码','情境限定','路由权重','时效性','场景描述'
      ],
      rows: routes,
    },
  })
}

// --- 输出模板测试数据 ---
function makeOutputTemplateSheets(m: Module) {
  const templates = [
    [`${m.code}/TPL01`, m.code, '低风险', 'summary', `## ${m.label}综合评估报告\n\n### 评估概况\n- 评估对象：\${teacherName}\n- 所属模块：${m.label}\n- 评估日期：\${date}\n\n### 总体结论\n各项指标均在正常范围内，教师教学状态良好。\n\n### 关键发现\n\${keyFindings}\n\n### 建议\n\${recommendations}`, '${teacherName},${date},${keyFindings},${recommendations}', 1],
    [`${m.code}/TPL02`, m.code, '中风险', 'attribution', `## ${m.label}归因分析\n\n### 风险评估\n根据评估结果，该教师在以下维度存在一定风险：\n\${riskDimensions}\n\n### 归因分析\n主归因：\${primaryAttribution}\n次归因：\${secondaryAttributions}\n\n### 详细说明\n\${resultDescription}`, '${riskDimensions},${primaryAttribution},${secondaryAttributions},${resultDescription}', 2],
    [`${m.code}/TPL03`, m.code, '高风险', 'action', `## ${m.label}干预行动计划\n\n### 紧急程度\n⚠️ 高风险 — 需立即采取行动\n\n### 推荐行动\n\${actionSummary}\n\n### 推荐工具\n\${toolSummary}\n\n### 升级条件\n\${escalationCondition}\n\n### 复评时间\n\${reEvaluation}`, '${actionSummary},${toolSummary},${escalationCondition},${reEvaluation}', 3],
    [`${m.code}/TPL04`, m.code, '低风险', 'tool', `## ${m.label}推荐工具列表\n\n根据评估结果，推荐以下工具：\n\${toolList}\n\n### 使用建议\n1. 请按照工具顺序依次使用\n2. 每次使用后记录反馈\n3. 如遇问题可联系心理专员`, '${toolList}', 4],
  ]

  return buildWorkbook({
    '⑩ 方案输出模板': {
      headers: ['模板编码*','所属模块*','命中归因等级*','模板类型*','模板内容*','占位符说明','排序*'],
      rows: templates,
    },
  })
}

// ===================================================================
// xlsx 构建工具
// ===================================================================

function buildWorkbook(sheets: Record<string, { headers: string[], rows: any[][] }>) {
  const wb = XLSX.utils.book_new()
  for (const [name, { headers, rows }] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  return wb
}

// ===================================================================
// 导入器 — 登录 + 逐个文件导入
// ===================================================================

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    redirect: 'manual',
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`登录失败: ${res.status} ${text.slice(0, 200)}`)
  }
  const setCookie = res.headers.getSetCookie?.() || res.headers.get('set-cookie') || ''
  return Array.isArray(setCookie) ? setCookie.join('; ') : setCookie
}

async function importFile(
  cookie: string,
  module: string,
  libraryType: LibraryType,
  libraryName: string,
  workbook: XLSX.WorkBook
): Promise<{ ok: boolean, status: number, body: string }> {
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const contentBase64 = buffer.toString('base64')

  const res = await fetch(`${BASE_URL}/api/v1/platform-admin/module-resources/import`, {
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
      filename: `${module}_${libraryType}.xlsx`,
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
  let cookie: string
  try {
    cookie = await login()
    console.log('  登录成功\n')
  } catch (e: any) {
    console.error('  登录失败:', e.message)
    console.error('  请确认 dev server 已启动 (pnpm dev) 且 seed 数据已就绪')
    process.exit(1)
  }

  // Step 2: 确保输出目录
  const baseDir = 'business-libraries/test-data'
  for (const m of MODULES) {
    mkdirSync(`${baseDir}/${m.code}`, { recursive: true })
  }

  // Step 3: 逐个生成 + 保存 + 导入
  const results: Array<{ module: string, type: string, ok: boolean, status: number }> = []
  let totalSuccess = 0
  let totalFail = 0

  for (const m of MODULES) {
    for (const libType of ['assessment', 'attribution', 'tool', 'keyword_route', 'output_template'] as LibraryType[]) {
      const label = `${m.label}·${TYPE_LABELS[libType]}`
      process.stdout.write(`  ${m.code}/${libType}... `)

      let wb: XLSX.WorkBook
      try {
        switch (libType) {
          case 'assessment': wb = makeAssessmentSheets(m); break
          case 'attribution': wb = makeAttributionSheets(m); break
          case 'tool': wb = makeToolSheets(m); break
          case 'keyword_route': wb = makeKeywordRouteSheets(m); break
          case 'output_template': wb = makeOutputTemplateSheets(m); break
        }
      } catch (e: any) {
        console.log(`生成失败: ${e.message}`)
        results.push({ module: m.code, type: libType, ok: false, status: 0 })
        totalFail++
        continue
      }

      // 保存文件
      const filePath = `${baseDir}/${m.code}/${libType}.xlsx`
      XLSX.writeFile(wb, filePath)

      // 导入
      const result = await importFile(cookie, m.code, libType, label, wb)
      results.push({ module: m.code, type: libType, ok: result.ok, status: result.status })

      if (result.ok) {
        console.log('OK')
        totalSuccess++
      } else {
        console.log(`FAIL (${result.status}): ${result.body}`)
        totalFail++
      }
    }
  }

  // Step 4: 汇总
  console.log(`\n=== 导入完成: ${totalSuccess} 成功, ${totalFail} 失败 ===`)
  if (totalFail > 0) {
    console.log('失败项:')
    for (const r of results) {
      if (!r.ok) console.log(`  ${r.module}/${r.type} (HTTP ${r.status})`)
    }
  }
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})
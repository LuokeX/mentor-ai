/**
 * 业务填写向导的样例输入。
 *
 * 内容取自家校沟通模块的真实业务语境，用来验证：
 * 「非技术人员能填出来的东西」是否足以编译出一套能跑通的三库。
 * 向导页面也用它当「一键填入示例」。
 */
import type { WizardInput } from '../../shared/business-wizard'

export const WIZARD_SAMPLE: WizardInput = {
  module: 'home_school',
  version: '1.0.0',
  sourceRef: '家校沟通业务手册',
  defaultLevelName: '常规沟通即可',
  defaultMessage: '本次评估未发现需要特别关注的信号，按常规节奏保持沟通即可。',
  // 模块级默认：同一模块内不逐行重填的列都在这里设一次
  defaults: {
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
    redLineRecovery: '当事教师与家长完成面对面沟通，且年级组确认风险解除',
    redLineOwner: '年级组长'
  },
  // ⑤b 计算变量：用中文表达式，编译期转成引擎语法
  computedVariables: [
    { name: '沟通压力指数', scale: '家校沟通双维速查', expression: '维度[沟通态度] + 维度[配合度]' }
  ],
  // ④b 自定义选项组：预置三组之外的业务自定义（题目通过 id 引用）
  optionGroups: [
    {
      id: 'cg-1', name: '沟通频率四点',
      options: [
        { label: '没有', score: 1 }, { label: '偶尔', score: 2 },
        { label: '较多', score: 3 }, { label: '频繁', score: 4 }
      ]
    }
  ],

  scales: [
    {
      name: '家校沟通双维速查',
      role: '入口筛查',
      shortName: '双维速查',
      description: '判断家长配合度、沟通态度和当前关系容器。分越高表示状况越需要关注。',
      minutes: 5,
      prerequisites: [],
      exclusives: [],
      triggerConditions: [],
      usageTiming: '每次家校沟通前',
      applicableGrades: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      applicableSubjects: [],
      normReference: '家校沟通校本观察常模（N=240）',
      reliabilityNote: 'Cronbach α=0.81',
      dimensionDefs: [
        { name: '配合度', calcMethod: 'mean', weight: 1, description: '家长在行动层面的配合程度', highInterpretation: '>=3.5 分：配合度已到需要干预的程度' },
        { name: '沟通态度', calcMethod: 'mean', weight: 1, description: '沟通时的情绪与立场强度' }
      ],
      questions: [
        { text: '这位家长对老师提出的建议，配合程度如何？', dimension: '配合度', optionGroup: 'AGREE_5', reverse: true },
        { text: '沟通时家长的情绪反应有多强烈？', dimension: '沟通态度', optionGroup: 'FREQ_5', reverse: false, help: '按最近一次沟通的实际感受作答' },
        { text: '家长多久回应一次老师的消息？', dimension: '配合度', optionGroup: 'FREQ_5', reverse: true },
        { text: '这一周家长表达不满或质疑的次数？', dimension: '沟通态度', optionGroup: 'FREQ_5', reverse: false },
        { text: '目前和这位家长之间还有多少可以商量的余地？', dimension: '关系容器', optionGroup: 'AGREE_5', reverse: true },
        { text: '沟通时有多少次感到「说不下去」？', dimension: '关系容器', optionGroup: 'cg-1', reverse: false }
      ]
    },
    {
      name: '家长分型与沟通策略评估',
      role: '深度诊断',
      shortName: '家长分型',
      description: '在速查提示需要重点沟通后使用，判断家长互动模式并匹配沟通策略。',
      minutes: 6,
      prerequisites: ['家校沟通双维速查'],
      exclusives: [],
      triggerNote: '沟通态度维度偏高时才需要判断家长类型',
      triggerConditions: [
        { targetType: 'dimension', target: '沟通态度', comparator: '达到或超过', value: 3, join: '且' }
      ],
      applicableGrades: [],
      applicableSubjects: [],
      dimensionDefs: [],
      questions: [
        { text: '家长是否倾向于把问题归到学校一方？', dimension: '归因倾向', optionGroup: 'AGREE_5', reverse: false },
        { text: '家长对孩子的期待是否明显高于孩子当前水平？', dimension: '期待落差', optionGroup: 'AGREE_5', reverse: false },
        { text: '家长在沟通中是否更关注面子而非问题本身？', dimension: '归因倾向', optionGroup: 'AGREE_5', reverse: false },
        { text: '家长是否愿意在家里配合执行具体动作？', dimension: '执行意愿', optionGroup: 'AGREE_5', reverse: true }
      ]
    }
  ],

  attributions: [
    { name: '家长配合度低', weight: 1.2, tags: ['home_school', 'cooperation'], highSign: '消息不回、建议不执行、约不到面谈', typicalTrigger: '家长工作繁忙或家庭结构复杂，缺少固定沟通时间', action: '把大要求拆成一个当周就能做完的小动作', description: '家长在行为层面没有跟上，通常不是不愿意而是没有抓手' },
    { name: '沟通态度对立', weight: 1.5, tags: ['home_school', 'conflict'], highSign: '情绪反应强烈、频繁质疑、拒绝继续谈', typicalTrigger: '之前沟通过程中积累过不愉快，或家长对学校有过不满', action: '先复述家长的担心，确认听懂了再谈事实', description: '情绪已经盖过内容，此时讲道理只会加剧对立' },
    { name: '关系容器不足', weight: 1, tags: ['home_school', 'trust'], highSign: '没有商量余地、一说就僵', typicalTrigger: '长期只有问题才联系，缺少平时正向互动积累', action: '本周主动做一次与问题无关的正向接触', description: '缺少可承载分歧的基础信任，需要先补关系再谈问题' },
    { name: '期待落差过大', weight: 1, tags: ['home_school', 'expectation'], highSign: '要求明显超出孩子当前水平', typicalTrigger: '家长对孩子学业或行为的期待参照的是其他孩子', action: '用具体数据说明当前起点，再共同定一个够得着的目标', description: '家长的目标和孩子的现状之间缺少台阶' }
  ],

  evidences: [
    { attribution: '家长配合度低', scale: '家校沟通双维速查', weight: 2, description: '配合度维度处于高位',
      conditions: [{ targetType: 'dimension', target: '配合度', comparator: '达到或超过', value: 3.5, join: '且' }] },
    { attribution: '家长配合度低', scale: '家校沟通双维速查', weight: 3, description: '消息长期不回，配合度已到需要干预的程度',
      conditions: [{ targetType: 'question', target: '3', comparator: '达到或超过', value: 4, join: '且' }] },
    { attribution: '沟通态度对立', scale: '家校沟通双维速查', weight: 3, description: '情绪反应与质疑同时处于高位',
      conditions: [
        { targetType: 'question', target: '2', comparator: '达到或超过', value: 4, join: '且' },
        { targetType: 'question', target: '4', comparator: '达到或超过', value: 3, join: '且' }
      ] },
    { attribution: '沟通态度对立', scale: '家校沟通双维速查', weight: 1, description: '沟通态度维度已高于常规水平',
      conditions: [{ targetType: 'dimension', target: '沟通态度', comparator: '达到或超过', value: 3, join: '且' }] },
    { attribution: '关系容器不足', scale: '家校沟通双维速查', weight: 2, description: '关系容器维度偏弱，缺少可商量的余地',
      conditions: [{ targetType: 'dimension', target: '关系容器', comparator: '达到或超过', value: 3.5, join: '且' }] },
    { attribution: '期待落差过大', scale: '家长分型与沟通策略评估', weight: 2, description: '期待落差维度处于高位',
      conditions: [{ targetType: 'dimension', target: '期待落差', comparator: '达到或超过', value: 4, join: '且' }] }
  ],

  levels: [
    {
      name: 'E 级保护通道', redLine: true,
      resultNote: '沟通已经无法继续，需要启动保护流程',
      redLineAction: '暂停单独沟通，立即上报年级组并安排第三方在场',
      notificationTemplate: '[教师姓名]老师在家校沟通评估中触发红线，请尽快登录系统查看处置要求。',
      conditions: [
        { targetType: 'question', target: '2', comparator: '达到或超过', value: 5, join: '且' },
        { targetType: 'question', target: '6', comparator: '达到或超过', value: 4, join: '且' }
      ],
      teacherMessage: '当前沟通风险较高，请先暂停单独沟通，按学校流程上报后再安排有第三方在场的会谈。'
    },
    {
      name: 'C 级需谨慎', redLine: false,
      conditions: [{ targetType: 'total', target: '', comparator: '达到或超过', value: 20, join: '且' }],
      teacherMessage: '本次沟通需要谨慎推进，主要问题集中在「${主要归因}」。建议先处理情绪和关系，再谈具体事项。'
    },
    {
      name: 'B 级需关注', redLine: false,
      conditions: [{ targetType: 'total', target: '', comparator: '达到或超过', value: 14, join: '且' }],
      teacherMessage: '沟通中出现了需要关注的信号，主要集中在「${主要归因}」。目前还可以自主调整，建议从推荐工具里选一项本周试用。'
    }
  ],

  tools: [
    {
      name: '三步共情沟通法', form: 'framework', severity: 'high',
      attributions: ['沟通态度对立'],
      whenToUse: '家长情绪明显、一开口就对立时',
      steps: [
        '先复述家长说的担心，一字不评价，确认自己听对了',
        '承认这件事确实让人着急，不急着解释学校做了什么',
        '把话题收到一个具体的、本周就能验证的小动作上'
      ],
      stepDetails: [
        { estimatedTime: '2 分钟', keyTip: '复述时只转述事实，不带评价', successCriteria: '家长说「对，我就是这个意思」' },
        { estimatedTime: '2 分钟', scriptTemplate: '这事换我也着急，您先说说最担心哪一点', successCriteria: '家长情绪强度从高降下来' },
        { estimatedTime: '3 分钟', keyTip: '小动作要具体到时间和动作', successCriteria: '双方约定一个本周可验证的动作' }
      ],
      script: '您说的这点我记下来了——您最担心的是孩子在班里被落下，对吗？',
      prohibition: '不要在家长情绪高点时讲道理或摆规定',
      timePerSession: '一次 15 分钟',
      duration: '每日 1 次，连续 7 天',
      expectedEffect: '单次沟通结束后家长情绪强度下降 1 级',
      effectNote: '先安顿情绪，再谈内容，对立场景下比直接讲道理有效',
      dimensions: ['沟通态度'],
      evidenceSource: '教师访谈汇编（校内 12 位班主任）',
      reAssessmentIntervalDays: 14,
      crossModuleTags: [],
      prerequisiteTools: [],
      alternativeTools: ['事实与诉求分栏表'],
      advancedTools: [],
      contraindications: [
        { condition: '家长已提出投诉或要求书面答复', type: 'block', description: '进入正式流程后不适合再做非正式共情沟通', alternative: '转由年级组按投诉流程处理' }
      ]
    },
    {
      name: '事实与诉求分栏表', form: 'worksheet', severity: 'medium',
      attributions: ['家长配合度低', '期待落差过大'],
      whenToUse: '家长诉求含糊或与事实脱节时',
      steps: [
        '分三栏记录：家长诉求 / 已核实事实 / 待核实点',
        '把待核实点变成一个明确的时间和动作',
        '下次沟通时先过一遍这张表，再谈新问题'
      ],
      stepDetails: [],
      prohibition: '不要把未核实的信息写进已核实栏',
      timePerSession: '一次 10 分钟',
      duration: '每次沟通前填写，累计 3 次',
      expectedEffect: '诉求与事实的落差能在一次沟通内对齐',
      dimensions: ['配合度', '期待落差'],
      evidenceSource: '校内沟通记录模板实践',
      reAssessmentIntervalDays: 7,
      crossModuleTags: [],
      prerequisiteTools: [],
      alternativeTools: [],
      advancedTools: [],
      contraindications: []
    },
    {
      name: '正向接触计划', form: 'exercise', severity: 'low',
      attributions: ['关系容器不足'],
      whenToUse: '一谈问题就僵、需要先补关系时',
      steps: [
        '本周主动做一次与问题无关的正向接触',
        '内容具体到某件小事，不要泛泛表扬',
        '记录家长的反应，两周后回看变化'
      ],
      stepDetails: [
        { estimatedTime: '5 分钟', keyTip: '接触的时机选在家长情绪平稳时', successCriteria: '完成一次与问题无关的接触' },
        {},
        { estimatedTime: '10 分钟', successCriteria: '两周后回看记录，关系容器维度有变化' }
      ],
      prohibition: '不要在正向接触时顺带提问题',
      timePerSession: '每周一次',
      duration: '连续 4 周',
      expectedEffect: '两周内家长愿意接起电话的比例提升',
      dimensions: ['关系容器'],
      evidenceSource: '校本实践总结',
      reAssessmentIntervalDays: 14,
      crossModuleTags: [],
      prerequisiteTools: [],
      alternativeTools: [],
      advancedTools: [],
      contraindications: []
    }
  ],

  keywords: [
    { core: ['家长不配合', '联系不上家长'], expanded: ['消息不回', '约不到人'], exclude: ['孩子生病请假'], category: '配合度问题', scale: '家校沟通双维速查', matchMode: 'fuzzy', risk: 'yellow', contextConstraint: '教师自述沟通困难时', description: '家长配合度信号' },
    { core: ['家长投诉', '闹到学校'], expanded: ['要说法', '找领导'], exclude: [], category: '沟通对立', scale: '家校沟通双维速查', tool: '三步共情沟通法', matchMode: 'exact', risk: 'orange', contextConstraint: '', description: '沟通对立信号' }
  ]
}
/**
 * 业务填写向导的样例输入。
 *
 * 内容取自家校沟通模块的真实业务语境（对齐 v4 六维度框架与五色分级口径），
 * 用来验证：「非技术人员能填出来的东西」是否足以编译出一套能跑通的三库。
 * 向导页面也用它当「一键填入示例」。
 */
import type { WizardInput } from '../../shared/business-wizard'

export const WIZARD_SAMPLE: WizardInput = {
  module: 'home_school',
  version: '1.0.0',
  sourceRef: '家校沟通业务手册',
  defaultLevelName: '常规沟通即可',
  defaultMessage: '当前家校关系状况良好，可按常规节奏沟通。保持日常的正向接触，让角色边界持续有储备。',
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
    { name: '沟通压力指数', scale: '家校沟通六维速查', expression: '维度[沟通质量] + 维度[参与效能]' }
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
      name: '家校沟通六维速查',
      role: '入口筛查',
      shortName: '六维速查',
      description: '按六维度框架判断家校沟通状态：沟通质量、参与效能、教育一致性、角色边界（信任关系与危机响应由深度评估承接）。反向计分：得分越高表示状况越差。',
      minutes: 5,
      prerequisites: [],
      exclusives: [],
      triggerConditions: [],
      usageTiming: '每次家校沟通前',
      applicableGrades: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      applicableSubjects: [],
      normReference: '家校沟通校本观察常模（N=240）',
      reliabilityNote: 'Cronbach α=0.81',
      externalAuthorizationNote: '家校沟通校本量表，外部引用需注明出处',
      dimensionDefs: [
        { name: '沟通质量', calcMethod: 'mean', weight: 1, description: '沟通质量维度', highInterpretation: '出现不尊重、混淆事实与情绪甚至威胁行为', lowInterpretation: '沟通质量可控' },
        { name: '参与效能', calcMethod: 'mean', weight: 1, description: '参与效能维度', highInterpretation: '家长回应慢、不参与共同行动', lowInterpretation: '参与效能良好' },
        { name: '教育一致性', calcMethod: 'mean', weight: 1, description: '教育一致性维度', highInterpretation: '家长不认同或不愿执行共同达成的教育行动', lowInterpretation: '教育方向一致' },
        { name: '角色边界', calcMethod: 'mean', weight: 1, description: '角色边界维度', highInterpretation: '关系无法承受坦诚讨论，边界模糊', lowInterpretation: '角色边界清晰、角色边界充足' }
      ],
      questions: [
        { text: '家长能够及时回应学校的重要沟通。', dimension: '参与效能', optionGroup: 'AGREE_5', reverse: true },
        { text: '家长愿意共同讨论并执行已经达成的行动。', dimension: '教育一致性', optionGroup: 'AGREE_5', reverse: true },
        { text: '出现分歧后，家长仍愿意继续保持沟通。', dimension: '角色边界', optionGroup: 'AGREE_5', reverse: true },
        { text: '家长表达不满时仍能保持基本尊重。', dimension: '沟通质量', optionGroup: 'AGREE_5', reverse: true },
        { text: '家长能够区分事实、推测和情绪。', dimension: '沟通质量', optionGroup: 'AGREE_5', reverse: true },
        { text: '家长没有出现威胁、公开抹黑或恶意维权行为。', dimension: '沟通质量', optionGroup: 'AGREE_5', reverse: true },
        { text: '目前的关系可以承受一次坦诚而具体的讨论。', dimension: '角色边界', optionGroup: 'AGREE_5', reverse: true },
        { text: '双方能够在情绪出现时暂停并回到问题解决。', dimension: '角色边界', optionGroup: 'AGREE_5', reverse: true },
        { text: '过去的积极沟通经验仍能成为当前关系资源。', dimension: '角色边界', optionGroup: 'AGREE_5', reverse: true },
        { text: '过去两周，家长很少主动发起沟通。', dimension: '参与效能', optionGroup: 'cg-1', reverse: false, help: '按最近两周的实际情况作答' }
      ]
    },
    {
      name: '家长分型与沟通策略评估',
      role: '深度诊断',
      shortName: '家长分型',
      description: '沟通质量维度偏高时才需要判断家长类型，否则不用做。',
      minutes: 6,
      prerequisites: ['家校沟通六维速查'],
      exclusives: [],
      triggerNote: '沟通质量维度偏高时才需要判断家长类型',
      triggerConditions: [
        { targetType: 'dimension', target: '沟通质量', comparator: '达到或超过', value: 3, join: '且' },
        { targetType: 'average', target: '', comparator: '达到或超过', value: 3.2, join: '或' }
      ],
      applicableGrades: [],
      applicableSubjects: [],
      dimensionDefs: [
        { name: '焦虑水平', calcMethod: 'mean', weight: 1, description: '焦虑水平维度', highInterpretation: '家长处于高焦虑，难以接收复杂信息', lowInterpretation: '情绪相对平稳' },
        { name: '控制倾向', calcMethod: 'mean', weight: 1, description: '控制倾向维度', highInterpretation: '家长倾向于主导教育方式并质疑学校安排', lowInterpretation: '愿意接受学校专业判断' },
        { name: '信任关系', calcMethod: 'mean', weight: 1, description: '信任关系维度', highInterpretation: '对学校缺乏基本信任', lowInterpretation: '有较好的信任关系' }
      ],
      questions: [
        { text: '家长在沟通中反复确认同一件事。', dimension: '焦虑水平', optionGroup: 'AGREE_5', reverse: true },
        { text: '家长常在非工作时间发来紧急消息。', dimension: '焦虑水平', optionGroup: 'AGREE_5', reverse: true },
        { text: '家长会具体指定学校应该如何处理。', dimension: '控制倾向', optionGroup: 'AGREE_5', reverse: true },
        { text: '家长对学校既有安排提出较多质疑。', dimension: '控制倾向', optionGroup: 'AGREE_5', reverse: true },
        { text: '家长相信教师是出于孩子利益在做判断。', dimension: '信任关系', optionGroup: 'AGREE_5', reverse: true },
        { text: '过去的沟通中，家长兑现过共同约定。', dimension: '信任关系', optionGroup: 'AGREE_5', reverse: true }
      ]
    }
  ],

  attributions: [
    { name: '沟通冲突升级', weight: 1.4, tags: ['home_school', 'conflict'], highSign: '出现威胁、公开抹黑或恶意维权；沟通中反复攻击个人', typicalTrigger: '长期诉求未被回应，或某次事件处理让家长感到不被尊重', action: '不在情绪高点解释责任，先记录家长诉求、事实依据和待核实点，并上报年级组长', description: '家长的表达方式已经越过基本尊重的边界，关系进入对抗状态' },
    { name: '角色边界不足', weight: 1.2, tags: ['home_school', 'container'], highSign: '一说具体问题就情绪激化；过去无积极沟通经验可调用', typicalTrigger: '缺少日常正向接触，只在出问题时联系', action: '本周主动做一次与问题无关的正向接触，只反馈孩子的一个具体进步', description: '当前关系无法承受一次坦诚而具体的讨论，需要先修复再沟通' },
    { name: '参与效能不足', weight: 1, tags: ['home_school', 'cooperation'], highSign: '不回消息、约定的事没有落实', typicalTrigger: '家长精力有限或不认同学校的处理方式', action: '把请求缩小到一个本周内能完成的具体动作，并明确完成后的反馈方式', description: '家长未参与共同行动，导致校内措施缺少家庭侧的配合' },
    { name: '信任关系薄弱', weight: 1, tags: ['home_school', 'trust'], highSign: '对学校安排持续怀疑，难以建立合作', typicalTrigger: '过往沟通中积累过不愉快，或学校曾让家长失望', action: '用一次可验证的小承诺兑现重建信任，再逐步扩大合作范围', description: '家长对学校缺乏基本信任，任何具体建议都会被先打折扣' }
  ],

  evidences: [
    { attribution: '沟通冲突升级', scale: '家校沟通六维速查', weight: 3, description: '出现威胁或恶意维权类行为（第 6 题）',
      conditions: [{ targetType: 'question', target: '6', comparator: '达到或超过', value: 4, join: '且' }] },
    { attribution: '沟通冲突升级', scale: '家校沟通六维速查', weight: 2, description: '沟通质量维度处于高位，且情绪表达越界',
      conditions: [
        { targetType: 'dimension', target: '沟通质量', comparator: '达到或超过', value: 3, join: '且' },
        { targetType: 'question', target: '4', comparator: '达到或超过', value: 3, join: '且' }
      ] },
    { attribution: '角色边界不足', scale: '家校沟通六维速查', weight: 2, description: '角色边界维度偏弱，缺少可商量的余地',
      conditions: [{ targetType: 'dimension', target: '角色边界', comparator: '达到或超过', value: 3.5, join: '且' }] },
    { attribution: '参与效能不足', scale: '家校沟通六维速查', weight: 2, description: '参与效能维度处于高位，共同行动难以落实',
      conditions: [{ targetType: 'dimension', target: '参与效能', comparator: '达到或超过', value: 3.5, join: '且' }] },
    { attribution: '参与效能不足', scale: '家校沟通六维速查', weight: 3, description: '消息长期不回，参与效能已到需要干预的程度',
      conditions: [{ targetType: 'question', target: '1', comparator: '达到或超过', value: 4, join: '且' }] },
    { attribution: '信任关系薄弱', scale: '家长分型与沟通策略评估', weight: 2, description: '信任关系维度处于高位',
      conditions: [{ targetType: 'dimension', target: '信任关系', comparator: '达到或超过', value: 3.5, join: '且' }] }
  ],

  levels: [
    {
      name: 'E 级保护通道', redLine: true,
      scale: '家校沟通六维速查',
      redLineAction: '停止教师单独沟通，转入学校保护通道，全程留痕并由年级组长或校方介入',
      resultNote: '出现威胁或恶意维权行为，已转入保护通道，请勿单独沟通。',
      teacherMessage: '本次评估触发 E 级保护通道，核心问题是「${主要归因}」。请立即停止单独沟通，保存全部记录并当天上报年级组长，后续由学校层面承接。',
      escalationTarget: '年级组长/校方',
      notificationTemplate: '[班级]家校沟通触发 E 级保护通道，请勿让班主任单独沟通。',
      conditions: [{ targetType: 'question', target: '6', comparator: '达到或超过', value: 4, join: '且' }]
    },
    {
      name: 'D 级高冲突', redLine: false,
      scale: '家长分型与沟通策略评估',
      resultNote: '家长分型显示焦虑或控制倾向偏高、信任关系薄弱，建议由年级组长陪同沟通。',
      teacherMessage: '本次沟通风险等级为 D 级，主要归因是「${主要归因}」，同时需关注「${次要归因}」。建议由年级组长陪同沟通并全程留痕。',
      escalationCondition: '连续两次 D 级',
      escalationTarget: '年级组长',
      reAssessTrigger: '7天后复评',
      interventionTools: ['先跟后带话术卡'],
      interventionActions: ['由年级组长陪同完成一次家校沟通，并记录沟通纪要。'],
      conditions: [{ targetType: 'average', target: '', comparator: '达到或超过', value: 4, join: '且' }]
    },
    {
      name: 'C 级需谨慎', redLine: false,
      scale: '家长分型与沟通策略评估',
      resultNote: '家长分型提示沟通存在明显阻力，先稳住情绪和事实边界再决定节奏。',
      teacherMessage: '本次评估提示沟通存在明显阻力，核心变量是「${主要归因}」。处理重点不是先说服家长，而是先稳住情绪和事实边界，再决定沟通节奏。',
      escalationCondition: '连续两次 C 级',
      escalationTarget: '年级组长',
      reAssessTrigger: '14天后复评',
      conditions: [{ targetType: 'average', target: '', comparator: '达到或超过', value: 3, join: '且' }]
    }
  ],

  tools: [
    {
      name: '先跟后带话术卡', form: 'script', severity: 'high',
      attributions: ['沟通冲突升级'],
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
      outputArtifact: '一次共情沟通记录',
      contraindicationNote: '家长已进入正式投诉流程时不适用非正式共情沟通',
      collaborativeTools: ['沟通容器修复计划'],
      dimensions: ['沟通质量'],
      evidenceSource: '教师访谈汇编（校内 12 位班主任）',
      reAssessmentIntervalDays: 14,
      crossModuleTags: [],
      prerequisiteTools: [],
      alternativeTools: ['沟通容器修复计划'],
      advancedTools: [],
      contraindications: [
        { condition: '家长已提出投诉或要求书面答复', type: 'block', description: '进入正式流程后不适合再做非正式共情沟通', alternative: '转由年级组按投诉流程处理' }
      ]
    },
    {
      name: '沟通容器修复计划', form: 'framework', severity: 'medium',
      attributions: ['角色边界不足'],
      whenToUse: '缺少平时正向互动、一说具体问题就僵时',
      steps: [
        '本周主动做一次与问题无关的正向接触',
        '只反馈孩子的一个具体进步，不提任何要求',
        '连续两周保持固定节奏，再试探进入具体话题'
      ],
      stepDetails: [
        { estimatedTime: '5 分钟', keyTip: '接触必须与问题无关', successCriteria: '家长愿意接话' },
        { estimatedTime: '2 分钟', scriptTemplate: '孩子今天有一件事做得特别好…', successCriteria: '家长回应积极' },
        { estimatedTime: '每周 1 次', keyTip: '节奏稳定比内容多更重要', successCriteria: '两周后可以自然谈具体话题' }
      ],
      prohibition: '不要在修复期内提要求或翻旧账',
      timePerSession: '每周 5-10 分钟',
      duration: '连续 2 周',
      expectedEffect: '两周后可以自然进入具体话题讨论',
      effectNote: '关系容器需要正向积累，急不来',
      outputArtifact: '正向接触记录',
      collaborativeTools: ['最小请求约定法'],
      dimensions: ['角色边界'],
      evidenceSource: '家校沟通校本实践总结',
      crossModuleTags: [],
      prerequisiteTools: [],
      alternativeTools: ['最小请求约定法'],
      advancedTools: [],
      contraindications: []
    },
    {
      name: '最小请求约定法', form: 'worksheet', severity: 'low',
      attributions: ['参与效能不足'],
      whenToUse: '家长答应配合但总是落空时',
      steps: [
        '把请求缩小到一个本周能完成的具体动作',
        '和家长共同确认完成时间与反馈方式',
        '完成后及时正向反馈，形成下一次合作的信任'
      ],
      stepDetails: [
        { estimatedTime: '3 分钟', keyTip: '动作要小到家长不会拒绝', successCriteria: '家长当场确认可行' },
        { estimatedTime: '2 分钟', keyTip: '反馈方式要明确（微信还是当面）', successCriteria: '约定清晰可执行' },
        { estimatedTime: '2 分钟', keyTip: '完成后一定要反馈，闭环才有下一次', successCriteria: '家长收到正向反馈' }
      ],
      prohibition: '不要在约定未完成时追加新要求',
      timePerSession: '一次 5 分钟',
      duration: '每周 1 个约定',
      expectedEffect: '连续三次兑现后，家长参与度明显提升',
      effectNote: '从最小可完成动作重建参与惯性',
      outputArtifact: '约定记录表',
      collaborativeTools: [],
      dimensions: ['参与效能'],
      evidenceSource: '行为改变校本实践',
      crossModuleTags: [],
      prerequisiteTools: ['沟通容器修复计划'],
      alternativeTools: [],
      advancedTools: [],
      contraindications: []
    }
  ],

  keywords: [
    {
      core: ['家长投诉', '被投诉', '家长闹'],
      expanded: ['家长发火', '家长威胁', '恶意维权'],
      exclude: [],
      category: '家校冲突',
      scale: '家校沟通六维速查',
      risk: 'orange',
      matchMode: 'fuzzy',
      contextConstraint: '教师自述与家长发生冲突时',
      description: '家校冲突场景直接引导六维速查'
    }
  ]
}
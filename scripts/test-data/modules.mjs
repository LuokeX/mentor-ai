/**
 * 五模块的三库业务内容（接近真实版）。
 *
 * 与之前的占位数据（「工具一/工具二」「维度A/B」）的区别：
 * - 量表题目取自 shared/assessments.ts 里的现行速评题库，再补一份深度量表
 * - 等级用各模块真实的等级体系（六色 / 四期 / A-E / L1-L3 / LP1-LP3），
 *   而不是通用的 red/orange/yellow —— server/domain/reports.ts 的 riskLabel()
 *   按这套取值做中文映射，用别的值报告里会直接显示原始英文
 * - 归因项、工具、话术都用业务真实措辞
 *
 * 咬合约束（改内容时必须一起改）：
 *   evidences[].attributionCode  → attributionItems[].code
 *   evidences[].assessmentCode   → scales[].code
 *   evidences[].condition 里的维度编码 → scales[].dimensions[].code
 *   tools[].attributionCode      → attributionItems[].code
 *   tools[].dimensions           → scales[].dimensions[].code
 *   tools[].severity             → gradingRules[].severity（同一套枚举）
 *   templates[].level            → gradingRules[].level
 */

const FREQ_5 = 'FREQ_5'
const AGREE_5 = 'AGREE_5'

export const OPTION_GROUPS = [
  [FREQ_5, 1, '几乎没有', 1], [FREQ_5, 2, '很少', 2], [FREQ_5, 3, '有时', 3],
  [FREQ_5, 4, '经常', 4], [FREQ_5, 5, '几乎每天', 5],
  [AGREE_5, 1, '完全不符合', 1], [AGREE_5, 2, '比较不符合', 2], [AGREE_5, 3, '一般', 3],
  [AGREE_5, 4, '比较符合', 4], [AGREE_5, 5, '非常符合', 5]
]

// ===================================================================
// self_growth 自我成长赋能
// ===================================================================

const selfGrowth = {
  code: 'self_growth',
  label: '自我成长赋能',
  scales: [
    {
      code: 'SG_FIVE_Q', title: '班主任状态五问', shortName: '状态五问', optionGroup: FREQ_5,
      description: '回顾最近一周的真实状态，3 分钟完成，系统按六色给出提示。',
      minutes: 3, frequency: 'monthly', required: true,
      dimensions: [
        { code: 'SG_EMOTION', name: '情绪状态', questionIds: ['q1'], high: '情绪耗竭风险高，可能伴随躯体症状', low: '情绪状态良好，具备较好的自我调节能力' },
        { code: 'SG_BOUNDARY', name: '角色边界', questionIds: ['q2'], high: '责任边界模糊，倾向于独自承接全部问题', low: '职责边界清晰' },
        { code: 'SG_MEANING', name: '意义感知', questionIds: ['q3'], high: '意义感流失，需重点关注', low: '意义感充足' },
        { code: 'SG_EFFICACY', name: '效能信心', questionIds: ['q4'], high: '对处理复杂问题缺乏信心', low: '效能感稳定' },
        { code: 'SG_SUPPORT', name: '同伴支持', questionIds: ['q5'], high: '困难长期无人分担', low: '有稳定的支持来源' }
      ],
      questions: [
        ['q1', 'SG_EMOTION', '这一周，我有多少时间感到身心疲惫、难以恢复？', false],
        ['q2', 'SG_BOUNDARY', '这一周，我有多少次感到「什么都是我的责任」？', false],
        ['q3', 'SG_MEANING', '这一周，有多少次我觉得「当班主任是值得的」？', true],
        ['q4', 'SG_EFFICACY', '遇到让我头疼的学生或家长问题时，我对自己能处理好多有信心？', true],
        ['q5', 'SG_SUPPORT', '这一周，我有多少时间感到工作中的困难没有人可以分担？', false]
      ]
    },
    {
      code: 'SG_HERO_AS', title: '教师心理资本与状态深度评估', shortName: 'HERO深评', optionGroup: AGREE_5,
      description: '基于 HERO 心理资本框架，用于状态五问提示需支持后的深度评估。',
      minutes: 8, frequency: 'per_case', required: false,
      dimensions: [
        { code: 'SG_HOPE', name: '希望', questionIds: ['h1', 'h2'], high: '对目标路径有清晰规划', low: '看不到可行路径' },
        { code: 'SG_EFFICACY', name: '效能信心', questionIds: ['e1', 'e2'], high: '相信自己能应对挑战', low: '对自身能力持续怀疑' },
        { code: 'SG_RESILIENCE', name: '韧性', questionIds: ['r1', 'r2'], high: '受挫后能较快恢复', low: '受挫后长时间难以恢复' },
        { code: 'SG_OPTIMISM', name: '乐观', questionIds: ['o1', 'o2'], high: '对未来持积极预期', low: '倾向于预期负面结果' }
      ],
      questions: [
        ['h1', 'SG_HOPE', '面对当前的班级难题，我能想出不止一条可行的解决路径。', true],
        ['h2', 'SG_HOPE', '我对这个学期想达成的目标有清晰的推进计划。', true],
        ['e1', 'SG_EFFICACY', '即使遇到从未处理过的家校冲突，我也相信自己能处理好。', true],
        ['e2', 'SG_EFFICACY', '我有信心影响班上最难带的那几个学生。', true],
        ['r1', 'SG_RESILIENCE', '被家长质疑或投诉后，我能较快恢复工作状态。', true],
        ['r2', 'SG_RESILIENCE', '工作中的挫折不会长时间影响我的生活。', true],
        ['o1', 'SG_OPTIMISM', '我倾向于相信班级的情况会慢慢变好。', true],
        ['o2', 'SG_OPTIMISM', '遇到问题时，我更多想到的是机会而不是麻烦。', true]
      ]
    }
  ],
  computed: [
    ['状态总分', '总分', '状态五问总分，反向题已折算', 'SG_FIVE_Q', 'q1-q5', '']
  ],
  attributions: [
    { code: 'SG_AT_EXHAUST', name: '情绪耗竭', weight: 1.3, tags: 'self_growth,emotion,pressure',
      desc: '教师的情绪资源被持续消耗且难以自然恢复，是职业倦怠的核心成分。',
      high: '晨起即感疲惫、对学生反应变钝、下班后无力社交',
      trigger: '长期高强度班务叠加缺乏恢复时段',
      action: '本周内安排两段各 30 分钟的不可打扰恢复时段，并减少一项非必要班务承接' },
    { code: 'SG_AT_BOUNDARY', name: '角色边界失守', weight: 1.1, tags: 'self_growth,boundary',
      desc: '教师把超出职责范围的责任持续揽在自己身上，导致负荷不可控。',
      high: '认为「什么都是我的责任」、难以拒绝额外要求、下班后仍在处理班务',
      trigger: '学校分工不清或教师自我期待过高',
      action: '做一次职责边界盘点，把当前压力拆成可控制、可影响、暂时不可控三类，只推进可控的一项' },
    { code: 'SG_AT_MEANING', name: '意义感流失', weight: 1.4, tags: 'self_growth,meaning',
      desc: '教师对班主任工作的价值感知下降，是需要重点关注的信号。',
      high: '反复怀疑工作的价值、对学生的进步不再有反应',
      trigger: '长期付出未获反馈，或经历重大挫败事件',
      action: '记录一件本周确实因为你而变好的小事，并找一位同伴讲给他听' },
    { code: 'SG_AT_EFFICACY', name: '效能感不足', weight: 1.0, tags: 'self_growth,efficacy',
      desc: '教师对自己处理复杂问题的能力缺乏信心，容易回避而非应对。',
      high: '遇到难题先想到「我搞不定」、倾向于上交问题',
      trigger: '缺少可复用的方法储备或成功经验',
      action: '选一个最小的难题，用一个具体工具完整走一遍并记录结果' },
    { code: 'SG_AT_SUPPORT', name: '支持系统缺失', weight: 1.1, tags: 'self_growth,support',
      desc: '教师遇到困难时缺少可求助的同伴或制度通道，独自消化问题。',
      high: '独自消化问题、不主动求助、认为求助等于无能',
      trigger: '教研组协作弱或校内缺少同伴支持机制',
      action: '本周找一位同事做一次 20 分钟的结构化复盘，只说事实、感受和需要的支持' }
  ],
  evidences: [
    ['SG_EV_01', 'SG_AT_EXHAUST', 'SG_FIVE_Q', '题[q1] >= 4', 2.5, '疲惫题项处于高位，情绪资源已被大量消耗'],
    ['SG_EV_02', 'SG_AT_EXHAUST', 'SG_FIVE_Q', '题[q1] >= 3', 1, '疲惫题项高于常模均值，处于早期消耗阶段'],
    ['SG_EV_03', 'SG_AT_BOUNDARY', 'SG_FIVE_Q', '题[q2] >= 4', 2.5, '频繁出现「什么都是我的责任」的感受'],
    ['SG_EV_04', 'SG_AT_BOUNDARY', 'SG_FIVE_Q', '题[q2] >= 3', 1, '责任边界开始模糊'],
    ['SG_EV_05', 'SG_AT_MEANING', 'SG_FIVE_Q', '题[q3] >= 4', 3, '意义感知处于低位（反向计分后得分高）'],
    ['SG_EV_06', 'SG_AT_MEANING', 'SG_FIVE_Q', '题[q3] >= 3', 1, '意义感出现波动'],
    ['SG_EV_07', 'SG_AT_EFFICACY', 'SG_FIVE_Q', '题[q4] >= 4', 2, '面对复杂问题时效能信心不足'],
    ['SG_EV_08', 'SG_AT_EFFICACY', 'SG_FIVE_Q', '题[q4] >= 3', 1, '效能信心有所下降'],
    ['SG_EV_09', 'SG_AT_SUPPORT', 'SG_FIVE_Q', '题[q5] >= 4', 2.5, '工作困难长期无人分担'],
    ['SG_EV_10', 'SG_AT_SUPPORT', 'SG_FIVE_Q', '题[q5] >= 3', 1, '支持来源不够稳定'],
    ['SG_EV_11', 'SG_AT_EXHAUST', 'SG_FIVE_Q', '题[q1] >= 4 且 题[q3] >= 4', 2, '疲惫与意义感同时告急，是情绪耗竭的核心信号'],
    // 深度量表的证据，按 assessmentCode 与速评隔离
    ['SG_EV_21', 'SG_AT_EFFICACY', 'SG_HERO_AS', '维度[SG_EFFICACY] >= 3.5', 2.5, 'HERO 效能维度偏低'],
    ['SG_EV_22', 'SG_AT_EXHAUST', 'SG_HERO_AS', '维度[SG_RESILIENCE] >= 3.5', 2.5, 'HERO 韧性维度偏低，受挫后恢复困难'],
    ['SG_EV_23', 'SG_AT_MEANING', 'SG_HERO_AS', '维度[SG_HOPE] >= 3.5', 2, 'HERO 希望维度偏低，看不到可行路径'],
    ['SG_EV_24', 'SG_AT_MEANING', 'SG_HERO_AS', '维度[SG_OPTIMISM] >= 3.5', 1.5, 'HERO 乐观维度偏低']
  ],
  gradingRules: [
    ['SG_GRADE_PURPLE', 'SG_FIVE_Q', 10, '题[q3] >= 4 且 题[q1] >= 4', 'purple', '需转介', 'crisis', true,
      '疲惫与意义感同时处于高位，已暂停常规建议并生成转介工单。', '', '心理专员', ''],
    ['SG_GRADE_RED', 'SG_FIVE_Q', 20, '状态总分 >= 20', 'red', '需关注', 'high', false,
      '多项指标处于高位，建议本周内安排一次支持性沟通。', '连续两次红色', '年级组长', '14天后复评'],
    ['SG_GRADE_ORANGE', 'SG_FIVE_Q', 30, '状态总分 >= 17', 'orange', '需支持', 'high', false,
      '状态已进入需要主动支持的区间，建议减少非必要承接。', '连续两次橙色', '年级组长', '30天后复评'],
    ['SG_GRADE_YELLOW', 'SG_FIVE_Q', 40, '状态总分 >= 13', 'yellow', '关注', 'medium', false,
      '出现需要关注的波动，建议做针对性调整。', '连续两次黄色', '年级组长', '30天后复评'],
    ['SG_GRADE_BLUE', 'SG_FIVE_Q', 50, '状态总分 >= 10', 'blue', '轻微波动', 'low', false,
      '存在轻微波动，保持现有节奏并留意变化即可。', '复评转为黄色或以上', '年级组长', '90天后复评'],
    ['SG_GRADE_GREEN', '', 999, '', 'green', '状态良好', 'low', false,
      '当前状态整体稳定，保持现有节奏。', '', '', '']
  ],
  redLines: [
    ['题[q1] >= 5 且 题[q3] >= 5', '疲惫与意义感双双触顶，属自我成长模块红线', 'module',
      '立即阻断常规建议输出，展示求助指引，生成转介工单通知心理专员',
      '停止当前评估流程,展示危机求助指引,创建安全事件,生成转介工单,短信通知心理专员',
      '当事教师完成心理专员面谈，且专员在系统中标记为「已处置」', '心理专员',
      '[教师姓名]老师在自我成长评估中触发红线：疲惫与意义感同时告急。请尽快登录系统查看工单。']
  ],
  tools: [
    { code: 'SG_RX_001', name: '三分钟补能法', short: '3分钟补能', form: 'exercise', severity: 'medium',
      at: 'SG_AT_EXHAUST', tags: 'self_growth,emotion,pressure', dims: 'SG_EMOTION',
      scene: '感到情绪即将失控、疲惫难以恢复时', effect: '快速降低主观压力，恢复对当下的控制感',
      steps: ['离开当前情境，找一个不被打扰的空间', '做三轮缓慢呼吸，吸气 4 秒、呼气 6 秒', '给当下的情绪命名，不评价', '选一个 5 分钟内能完成的最小行动'],
      script: '现在先停三分钟，这三分钟只属于你自己。', expect: '单次可下降 1-2 分主观压力值',
      time: '3 分钟', cycle: '每日 1-2 次，连续 7 天', evidence: 'B',
      source: 'Kabat-Zinn 正念减压研究；教师群体适应性改编（2023）',
      indicator: '主观压力值下降 >= 1 分', fail: '连续使用 3 次后主观压力值未下降',
      forbid: '不用于替代危机处置；出现自伤念头或持续失眠时须转介心理专员' },
    { code: 'SG_RX_002', name: '压力三分法盘点表', short: '三分法', form: 'worksheet', severity: 'medium',
      at: 'SG_AT_BOUNDARY', tags: 'self_growth,boundary', dims: 'SG_BOUNDARY',
      scene: '感到「什么都是我的责任」、任务无法排序时', effect: '把弥散的压力转成可操作的清单',
      steps: ['列出当前所有让你焦虑的事项，不做筛选', '逐项标记为「我能控制」「我能影响」「暂时不可控」', '暂时不可控的一栏整体划掉，本周不再想它', '从「我能控制」里只挑一项，写清今天的第一步'],
      script: '这件事我会在核实后回复，目前先按约定步骤处理。', expect: '待处理事项减少三分之一以上',
      time: '20 分钟', cycle: '每周一次', evidence: 'C', source: '教师职业压力管理实务手册',
      indicator: '「暂时不可控」栏目占比 >= 30%', fail: '连续两周无法把任何事项归入「我能控制」',
      forbid: '不要在盘点时同步处理事项，先列完再动手' },
    { code: 'SG_RX_003', name: '同伴结构化复盘', short: '同伴复盘', form: 'framework', severity: 'high',
      at: 'SG_AT_SUPPORT', tags: 'self_growth,support', dims: 'SG_SUPPORT',
      scene: '长期独自承接问题、缺少可求助对象时', effect: '建立稳定的同伴支持通道',
      steps: ['约一位信任的同事，明确只谈 20 分钟', '按「事实—感受—我需要的支持」三段说，不要求对方给答案', '请对方复述一遍你说的事实，确认没有偏差', '约定下一次复盘时间'],
      script: '我最近在这个问题上消耗比较大，想请你帮我一起看一下事实和下一步，不需要马上给答案。',
      expect: '形成至少一个可定期复盘的同伴关系', time: '20 分钟', cycle: '每两周一次', evidence: 'B',
      source: '教师同伴支持机制研究', indicator: '连续两次完成复盘约定', fail: '两次邀约均未成行',
      forbid: '不要在复盘中评价第三方同事或学生' },
    { code: 'SG_RX_004', name: '意义锚点记录', short: '意义锚点', form: 'exercise', severity: 'high',
      at: 'SG_AT_MEANING', tags: 'self_growth,meaning', dims: 'SG_MEANING',
      scene: '反复怀疑工作价值、对学生进步不再有反应时', effect: '重建工作意义的可见证据',
      steps: ['每天下班前写一句：今天有一件事因为我而不一样', '不追求重大事件，一句问候、一次等待都算', '连续记录七天后回看，圈出最触动你的三条', '把其中一条讲给一位同事听'],
      script: '我今天注意到他主动帮同学捡了书，这在两周前是没有的。', expect: '意义感知题项得分改善 1 分以上',
      time: '3 分钟', cycle: '每日一次，连续 7 天', evidence: 'B', source: '积极心理学教师干预研究',
      indicator: '七天内完成 >= 5 次记录', fail: '连续三天无法写出任何一条',
      forbid: '不要把这个练习变成工作总结' },
    { code: 'SG_RX_005', name: '最小成功案例复演', short: '最小复演', form: 'framework', severity: 'low',
      at: 'SG_AT_EFFICACY', tags: 'self_growth,efficacy', dims: 'SG_EFFICACY',
      scene: '遇到难题先想到「我搞不定」时', effect: '把已有经验转成可复用的方法',
      steps: ['回忆一件你处理得还不错的类似事件', '写出当时你具体做了哪三步', '把这三步套用到当前难题上，标出需要调整的部分', '只执行第一步，执行后记录效果'],
      script: '上次遇到类似情况我是先做了这一步，这次也从这里开始。', expect: '形成一条可复用的处理路径',
      time: '15 分钟', cycle: '按需', evidence: 'C', source: '焦点解决短期干预教师应用',
      indicator: '写出至少三步可执行动作', fail: '回忆不起任何成功案例（此时改用 SG_RX_003）',
      forbid: '不要拿他人的成功案例替代自己的' },
    { code: 'SG_RX_006', name: '危机求助指引卡', short: '求助指引', form: 'checklist', severity: 'crisis',
      at: 'SG_AT_MEANING', tags: 'self_growth,meaning,crisis', dims: 'SG_MEANING',
      scene: '出现持续失眠、自伤念头或强烈无意义感时', effect: '确保教师知道向谁求助、怎么求助',
      steps: ['停止当前所有非必要工作', '联系校内心理专员，说明当前状态', '如存在即时危险，拨打 110 或 120', '告知一位可信任的家人或朋友当前情况'],
      script: '我现在的状态需要一些专业支持，想请你帮我联系一下心理专员。', expect: '在 24 小时内建立专业支持连接',
      time: '10 分钟', cycle: '按需', evidence: 'A', source: '校园心理危机干预规范',
      indicator: '完成一次专业联系', fail: '24 小时内未建立任何联系',
      forbid: '不得由班主任自行承担危机处置；不得延迟转介',
      contra: [['当事人已在专业干预中', 'warn', '已有专业支持时避免重复动员造成压力', '与专员确认现有干预方案']] }
  ],
  routes: [
    ['SG_KW_01', '撑不住,快崩溃,干不下去', '太累了,不想干了,想辞职', '累死了（玩笑）', 1, 'fuzzy', 'orange', '职业倦怠', 'SG_FIVE_Q', 'SG_RX_001', 0.9, '教师表达强烈疲惫或职业倦怠'],
    ['SG_KW_02', '什么都是我的事,推给我', '责任全在我,没人帮我分担', '', 2, 'fuzzy', 'yellow', '边界失守', 'SG_FIVE_Q', 'SG_RX_002', 0.8, '教师表达责任边界模糊'],
    ['SG_KW_03', '没意思,不值得,白干了', '当班主任有什么用,figured', '', 3, 'fuzzy', 'orange', '意义流失', 'SG_FIVE_Q', 'SG_RX_004', 0.85, '教师表达工作意义感流失'],
    ['SG_KW_04', '没人商量,只能自己扛', '找不到人说,孤立无援', '', 4, 'fuzzy', 'yellow', '支持缺失', 'SG_FIVE_Q', 'SG_RX_003', 0.7, '教师表达缺少支持来源']
  ],
  templates: [
    ['purple', 'summary', '评估显示，您在「${主要归因}」上的信号已经处于需要重点关注的位置。系统已暂停常规建议并生成转介工单，心理专员会与您联系。在此之前，请优先照顾好自己的基本作息。'],
    ['red', 'summary', '本次评估的主要归因是「${主要归因}」，同时「${次要归因}」也需要一并关注。建议本周内安排一次支持性沟通，并从推荐工具中选一项今天就能开始的动作。'],
    ['orange', 'summary', '本次评估提示「${主要归因}」已进入需要主动支持的区间。重点不是再增加任务，而是先识别消耗来源、恢复可控感。'],
    ['yellow', 'summary', '本次评估提示「${主要归因}」值得关注，尚未到需要外部介入的程度，建议先用推荐工具自主调整。'],
    ['blue', 'summary', '本次评估显示存在轻微波动，主要落在「${主要归因}」。保持现有节奏，留意变化即可。'],
    ['green', 'summary', '本次评估未发现需要重点干预的信号，当前状态整体稳定，保持现有节奏即可。']
  ]
}

// ===================================================================
// class_system 班级系统建设
// ===================================================================

const classSystem = {
  code: 'class_system',
  label: '班级系统建设',
  scales: [
    {
      code: 'CS_FIVE_SYS', title: '班级五系统速评', shortName: '五系统速评', optionGroup: AGREE_5,
      description: '每个系统三道题，定位当前最需要建设的班级子系统。反向计分：得分越高表示越薄弱。',
      minutes: 5, frequency: 'monthly', required: true,
      dimensions: [
        { code: 'CS_GOAL', name: '目标系统', questionIds: ['goal1', 'goal2', 'goal3'], high: '目标未被学生理解或未转化为可观察里程碑', low: '目标清晰且已落地' },
        { code: 'CS_ORG', name: '组织系统', questionIds: ['org1', 'org2', 'org3'], high: '岗位职责不清，事务集中在教师身上', low: '学生分工稳定运转' },
        { code: 'CS_ACTIVITY', name: '活动系统', questionIds: ['act1', 'act2', 'act3'], high: '活动脱离学生真实需要且缺少复盘', low: '活动有回应、有复盘' },
        { code: 'CS_ENV', name: '环境系统', questionIds: ['env1', 'env2', 'env3'], high: '规则停留在墙上，混乱后难以恢复', low: '环境与规则支持秩序' },
        { code: 'CS_RELATION', name: '关系系统', questionIds: ['rel1', 'rel2', 'rel3'], high: '冲突难以修复，缺少同伴互助', low: '关系稳定，学生被听见' }
      ],
      questions: [
        ['goal1', 'CS_GOAL', '学生清楚本班共同目标以及为什么要实现它。', true],
        ['goal2', 'CS_GOAL', '班级目标已转化为本学期可观察的里程碑。', true],
        ['goal3', 'CS_GOAL', '日常活动和评价与班级目标保持一致。', true],
        ['org1', 'CS_ORG', '班干部岗位职责清楚且能稳定运转。', true],
        ['org2', 'CS_ORG', '班级事务能够由学生参与分工，而非全部由教师承担。', true],
        ['org3', 'CS_ORG', '班级日常关键节点有明确的执行流程。', true],
        ['act1', 'CS_ACTIVITY', '班级活动能够回应学生真实需要。', true],
        ['act2', 'CS_ACTIVITY', '活动结束后会进行简短复盘并形成改进。', true],
        ['act3', 'CS_ACTIVITY', '多数学生都有参与和承担责任的机会。', true],
        ['env1', 'CS_ENV', '班级空间和信息布置能够支持秩序与学习。', true],
        ['env2', 'CS_ENV', '班级规则由师生共同理解而非只贴在墙上。', true],
        ['env3', 'CS_ENV', '出现混乱时能够快速恢复稳定节奏。', true],
        ['rel1', 'CS_RELATION', '学生普遍感到被尊重、被听见。', true],
        ['rel2', 'CS_RELATION', '学生冲突能够被及时处理并修复关系。', true],
        ['rel3', 'CS_RELATION', '班级中存在稳定的互助和同伴支持。', true]
      ]
    },
    {
      code: 'CS_ENERGY', title: '班级能量场问卷', shortName: '能量场', optionGroup: AGREE_5,
      description: '教师端观察问卷，与五系统速评交叉验证，用于判断班级氛围的稳定性。',
      minutes: 4, frequency: 'per_case', required: false,
      dimensions: [
        { code: 'CS_ORDER', name: '秩序能量', questionIds: ['en1', 'en2'], high: '秩序需要教师持续在场维持', low: '秩序可自主维持' },
        { code: 'CS_LEARNING', name: '学习能量', questionIds: ['en3', 'en4'], high: '学习投入依赖外部推动', low: '学习氛围自发' },
        { code: 'CS_CONNECT', name: '联结能量', questionIds: ['en5', 'en6'], high: '学生之间缺少正向联结', low: '同伴联结紧密' }
      ],
      questions: [
        ['en1', 'CS_ORDER', '我不在教室时，班级秩序仍能维持。', true],
        ['en2', 'CS_ORDER', '课间到上课的过渡不需要我反复提醒。', true],
        ['en3', 'CS_LEARNING', '多数学生在自习时能自主投入。', true],
        ['en4', 'CS_LEARNING', '学生会主动追问自己不懂的问题。', true],
        ['en5', 'CS_CONNECT', '学生之间会自发互相帮助。', true],
        ['en6', 'CS_CONNECT', '新转入的学生能较快融入集体。', true]
      ]
    }
  ],
  computed: [
    ['系统均分', '均分', '五系统整体均分，越高表示越薄弱', 'CS_FIVE_SYS', '', '']
  ],
  attributions: [
    { code: 'CS_AT_GOAL', name: '目标系统未落地', weight: 1.1, tags: 'class_system,goal',
      desc: '班级目标没有被学生理解，或没有转化为可观察的阶段性成果。',
      high: '学生说不出班级目标；目标只贴在墙上', trigger: '目标由教师单方面制定且缺少里程碑拆解',
      action: '把本学期目标拆成三个可观察的里程碑，与学生共同确认第一个' },
    { code: 'CS_AT_ORG', name: '组织系统缺位', weight: 1.2, tags: 'class_system,org',
      desc: '班级事务过度集中在教师身上，学生岗位职责不清或无法稳定运转。',
      high: '所有事都要教师亲自过问；班干部形同虚设', trigger: '岗位设置缺少职责说明和交接流程',
      action: '选一个日常事务，写清责任人、执行步骤、异常处理和复盘时间，试行一周' },
    { code: 'CS_AT_ACTIVITY', name: '活动系统空转', weight: 1.0, tags: 'class_system,activity',
      desc: '班级活动没有回应学生真实需要，或缺少复盘导致无法沉淀。',
      high: '活动办完就结束，学生参与度低', trigger: '活动主题由教师指定且无复盘环节',
      action: '在下一次活动后加一个十分钟复盘，让学生说出一个保留动作和一个调整动作' },
    { code: 'CS_AT_ENV', name: '环境系统薄弱', weight: 1.0, tags: 'class_system,environment',
      desc: '班级规则和空间布置无法支撑稳定的学习秩序。',
      high: '规则只贴在墙上；混乱后难以恢复', trigger: '规则由教师单方制定，缺少共同理解',
      action: '挑一条最常被违反的规则，和学生一起重新表述成可观察的行为标准' },
    { code: 'CS_AT_RELATION', name: '关系系统受损', weight: 1.3, tags: 'class_system,relation',
      desc: '学生之间的冲突难以修复，缺少稳定的同伴支持结构。',
      high: '冲突反复发生；存在被孤立的学生', trigger: '缺少冲突处理流程和同伴互助机制',
      action: '建立一个固定的冲突修复流程，并在下一次冲突时完整走一遍' }
  ],
  evidences: [
    ['CS_EV_01', 'CS_AT_GOAL', 'CS_FIVE_SYS', '维度[CS_GOAL] >= 4', 2.5, '目标系统得分处于高位，目标未被学生理解或未落地'],
    ['CS_EV_02', 'CS_AT_GOAL', 'CS_FIVE_SYS', '维度[CS_GOAL] >= 3', 1, '目标系统存在待建设的环节'],
    ['CS_EV_03', 'CS_AT_ORG', 'CS_FIVE_SYS', '维度[CS_ORG] >= 4', 2.5, '组织系统得分处于高位，事务过度集中在教师身上'],
    ['CS_EV_04', 'CS_AT_ORG', 'CS_FIVE_SYS', '维度[CS_ORG] >= 3', 1, '组织系统存在待建设的环节'],
    ['CS_EV_05', 'CS_AT_ACTIVITY', 'CS_FIVE_SYS', '维度[CS_ACTIVITY] >= 4', 2.5, '活动系统得分处于高位，活动缺少回应与复盘'],
    ['CS_EV_06', 'CS_AT_ACTIVITY', 'CS_FIVE_SYS', '维度[CS_ACTIVITY] >= 3', 1, '活动系统存在待建设的环节'],
    ['CS_EV_07', 'CS_AT_ENV', 'CS_FIVE_SYS', '维度[CS_ENV] >= 4', 2.5, '环境系统得分处于高位，秩序难以自主恢复'],
    ['CS_EV_08', 'CS_AT_ENV', 'CS_FIVE_SYS', '维度[CS_ENV] >= 3', 1, '环境系统存在待建设的环节'],
    ['CS_EV_09', 'CS_AT_RELATION', 'CS_FIVE_SYS', '维度[CS_RELATION] >= 4', 3, '关系系统得分处于高位，冲突难以修复'],
    ['CS_EV_10', 'CS_AT_RELATION', 'CS_FIVE_SYS', '维度[CS_RELATION] >= 3', 1, '关系系统存在待建设的环节'],
    ['CS_EV_21', 'CS_AT_ENV', 'CS_ENERGY', '维度[CS_ORDER] >= 3.5', 2, '能量场问卷显示秩序需要教师持续在场维持'],
    ['CS_EV_22', 'CS_AT_ORG', 'CS_ENERGY', '维度[CS_ORDER] >= 3', 1.5, '秩序对教师在场的依赖提示组织系统缺位'],
    ['CS_EV_23', 'CS_AT_RELATION', 'CS_ENERGY', '维度[CS_CONNECT] >= 3.5', 2.5, '能量场问卷显示学生之间缺少正向联结'],
    ['CS_EV_24', 'CS_AT_ACTIVITY', 'CS_ENERGY', '维度[CS_LEARNING] >= 3.5', 2, '学习投入依赖外部推动，活动未能激发内驱']
  ],
  gradingRules: [
    ['CS_GRADE_SURVIVAL', 'CS_FIVE_SYS', 10, '系统均分 >= 4', 'survival', '生存期', 'crisis', false,
      '班级多个子系统同时薄弱，当前处于生存期，需要先稳住秩序再谈建设。', '连续两次生存期', '年级组长', '14天后复评'],
    ['CS_GRADE_NORMING', 'CS_FIVE_SYS', 20, '系统均分 >= 3.2', 'norming', '规范期', 'high', false,
      '班级处于规范期，重点是把薄弱系统补成可重复执行的机制。', '连续两次规范期', '年级组长', '30天后复评'],
    ['CS_GRADE_OPERATING', 'CS_FIVE_SYS', 30, '系统均分 >= 2.4', 'operating', '运行期', 'medium', false,
      '班级基本能够自主运行，可以聚焦单个子系统做精细建设。', '复评退回规范期或生存期', '年级组长', '60天后复评'],
    ['CS_GRADE_MATURE', '', 999, '', 'mature', '成熟期', 'low', false,
      '班级系统运行成熟，建议把已有经验沉淀成可交接的班级手册。', '复评退回运行期以下', '年级组长', '90天后复评']
  ],
  redLines: [
    ['维度[CS_RELATION] >= 4.7', '关系系统极端薄弱，可能存在校园欺凌或严重孤立', 'module',
      '暂停常规班级建设建议，转入学生个体问题模块做逐个筛查，并通知年级组长',
      '停止常规建议输出,提示转入学生个体问题模块,通知年级组长,记录安全事件',
      '完成全班关系筛查且年级组长确认无欺凌情形', '年级组长',
      '[班级]关系系统评估触发红线，请安排逐个学生筛查。']
  ],
  tools: [
    { code: 'CS_RX_001', name: '班级目标里程碑拆解表', short: '目标拆解', form: 'worksheet', severity: 'medium',
      at: 'CS_AT_GOAL', tags: 'class_system,goal', dims: 'CS_GOAL',
      scene: '学生说不出班级目标，或目标只停留在口号', effect: '把抽象目标转成可观察的阶段成果',
      steps: ['和学生一起用一句话说清本学期班级要成为什么样', '把这句话拆成三个可观察的里程碑', '为第一个里程碑写清完成标准和检查时间', '贴在教室并每两周对照一次'],
      script: '我们这学期只做好一件事，你们觉得应该是哪一件？', expect: '学生能复述目标和第一个里程碑',
      time: '一节班会', cycle: '每学期一次', evidence: 'B', source: '班级系统建设手册 第2章',
      indicator: '随机抽问三名学生能说出目标', fail: '两周后仍无人能复述',
      forbid: '不要由教师单方面宣布目标' },
    { code: 'CS_RX_002', name: '班级事务 SOP 卡', short: '事务SOP', form: 'checklist', severity: 'high',
      at: 'CS_AT_ORG', tags: 'class_system,org', dims: 'CS_ORG',
      scene: '班级事务过度集中在教师身上', effect: '把日常事务转成学生可独立执行的流程',
      steps: ['选一个每天都发生的事务（如晨检、放学清扫）', '写清责任人、执行步骤、异常处理和复盘时间', '让学生试运行三天，教师只观察不介入', '第四天复盘，只调整卡住的那一步'],
      script: '这件事从明天起由你负责，遇到处理不了的情况再来找我。', expect: '该事务连续一周无需教师介入',
      time: '30 分钟', cycle: '每两周新增一项', evidence: 'B', source: '班级系统建设手册 第3章',
      indicator: '连续 5 天无需教师提醒', fail: '试运行三天内出现两次以上中断',
      forbid: '不要同时铺开多个 SOP；一次只做一项' },
    { code: 'CS_RX_003', name: '十分钟班级微复盘', short: '微复盘', form: 'framework', severity: 'medium',
      at: 'CS_AT_ACTIVITY', tags: 'class_system,activity', dims: 'CS_ACTIVITY',
      scene: '活动办完就结束，经验无法沉淀', effect: '把活动经验转成可重复的改进',
      steps: ['活动结束当天，留出十分钟', '每人说一个「下次要保留的动作」', '每人说一个「下次要调整的动作」', '教师只记录不评价，把结果贴在班级角'],
      script: '今天我们只讨论一件事：哪个环节帮助大家更稳定，哪个环节明天需要调整。',
      expect: '形成至少两条下次可执行的改进', time: '10 分钟', cycle: '每次活动后', evidence: 'B',
      source: '班级系统建设手册 第4章', indicator: '产出 >= 2 条具体改进', fail: '学生只说「挺好的」',
      forbid: '教师不要在复盘中先发表意见' },
    { code: 'CS_RX_004', name: '规则共构工作坊', short: '规则共构', form: 'framework', severity: 'medium',
      at: 'CS_AT_ENV', tags: 'class_system,environment', dims: 'CS_ENV',
      scene: '规则只贴在墙上，学生不认同', effect: '把规则从教师要求转成共同约定',
      steps: ['挑一条最常被违反的规则', '让学生说出这条规则存在的理由，教师补充缺失的部分', '一起把规则改写成可观察的行为描述', '约定试行两周后复盘'],
      script: '这条规则不是为了限制大家，而是为了让学习和相处更可预期。我们先试行三天再复盘。',
      expect: '该规则违反次数下降 50% 以上', time: '一节班会', cycle: '每月一条', evidence: 'B',
      source: '班级系统建设手册 第5章', indicator: '两周内违反次数明显下降', fail: '两周后无变化',
      forbid: '不要一次重构全部规则' },
    { code: 'CS_RX_005', name: '冲突修复四步法', short: '冲突修复', form: 'script', severity: 'high',
      at: 'CS_AT_RELATION', tags: 'class_system,relation', dims: 'CS_RELATION',
      scene: '学生冲突反复发生且难以修复', effect: '建立可重复的冲突处理流程',
      steps: ['分开双方，各自说清「发生了什么」，只说事实', '各自说「我当时的感受」，不评价对方', '各自说「我希望接下来怎样」', '共同确认一个可执行的下一步，并约定检查时间'],
      script: '我们先不讨论谁对谁错，先把事实说清楚。', expect: '同类冲突复发率下降',
      time: '20 分钟', cycle: '按需', evidence: 'A', source: '修复式实践在班级管理中的应用',
      indicator: '双方均能说出对方的诉求', fail: '任一方拒绝进入流程',
      forbid: '不要在全班面前处理个体冲突',
      contra: [['冲突涉及肢体伤害或欺凌', 'block', '涉及安全事件须优先启动应急流程而非同伴调解', '启动校园安全应急预案并通知年级组长']] },
    { code: 'CS_RX_006', name: '同伴互助配对表', short: '互助配对', form: 'worksheet', severity: 'low',
      at: 'CS_AT_RELATION', tags: 'class_system,relation', dims: 'CS_RELATION',
      scene: '班级缺少稳定的同伴支持结构', effect: '建立可持续的同伴互助关系',
      steps: ['按学习和性格互补原则做两两配对', '给每对一个具体的互助任务，如每天互查作业', '每周收一次简短反馈，只问「这周互相帮到了什么」', '两周后按反馈调整配对'],
      script: '你们两个这周互相提醒一下，周五我来听听你们互相帮到了什么。',
      expect: '被孤立学生数量下降', time: '20 分钟', cycle: '每月调整一次', evidence: 'C',
      source: '同伴支持机制实务', indicator: '80% 配对能说出互助内容', fail: '半数配对无实际互动',
      forbid: '不要把配对当成优生帮差生的单向安排' }
  ],
  routes: [
    ['CS_KW_01', '班级乱,管不住,纪律差', '课堂混乱,说话没人听', '', 1, 'fuzzy', 'orange', '秩序问题', 'CS_FIVE_SYS', 'CS_RX_004', 0.9, '教师表达班级秩序失控'],
    ['CS_KW_02', '班干部,岗位,分工', '没人干活,都要我自己来', '', 2, 'fuzzy', 'yellow', '组织问题', 'CS_FIVE_SYS', 'CS_RX_002', 0.8, '教师表达班级事务过度集中'],
    ['CS_KW_03', '打架,吵架,同学矛盾', '闹翻了,不理人,起冲突', '', 3, 'fuzzy', 'orange', '关系冲突', 'CS_ENERGY', 'CS_RX_005', 0.85, '班级内出现同伴冲突'],
    ['CS_KW_04', '被孤立,没朋友,不合群', '没人跟他玩,排挤', '', 4, 'fuzzy', 'orange', '同伴排斥', 'CS_ENERGY', 'CS_RX_006', 0.8, '出现学生被孤立的信号']
  ],
  templates: [
    ['survival', 'summary', '班级当前处于生存期，多个子系统同时薄弱，最突出的是「${主要归因}」。这个阶段的重点不是全面建设，而是先稳住秩序：选一个系统，做一件能立刻见效的事。'],
    ['norming', 'summary', '班级处于规范期，当前最需要建设的是「${主要归因}」，同时「${次要归因}」也值得关注。这类问题通常不靠一次提醒解决，需要转化为可观察的班级机制。'],
    ['operating', 'summary', '班级已经能够自主运行，可以聚焦「${主要归因}」做精细建设。相对稳定的部分可以作为带动全班调整的支点。'],
    ['mature', 'summary', '班级系统运行成熟，建议把已有的做法沉淀成可交接的班级手册，让经验不随班主任变动而流失。']
  ]
}

// ===================================================================
// home_school 家校沟通合作
// ===================================================================

const homeSchool = {
  code: 'home_school',
  label: '家校沟通合作',
  scales: [
    {
      code: 'HS_QUICK', title: '家校沟通双维与容器速查', shortName: '双维速查', optionGroup: AGREE_5,
      description: '判断家长配合度、沟通态度和当前关系容器。反向计分：得分越高表示状况越差。',
      minutes: 5, frequency: 'per_case', required: true,
      dimensions: [
        { code: 'HS_COOP', name: '配合度', questionIds: ['coop1', 'coop2', 'coop3'], high: '家长回应慢、不参与共同行动', low: '配合度良好' },
        { code: 'HS_ATTITUDE', name: '沟通态度', questionIds: ['att1', 'att2', 'att3'], high: '出现不尊重、混淆事实与情绪甚至威胁行为', low: '沟通态度可控' },
        { code: 'HS_CONTAINER', name: '关系容器', questionIds: ['con1', 'con2', 'con3'], high: '关系无法承受坦诚讨论', low: '关系容器充足' }
      ],
      questions: [
        ['coop1', 'HS_COOP', '家长能够及时回应学校的重要沟通。', true],
        ['coop2', 'HS_COOP', '家长愿意共同讨论并执行已经达成的行动。', true],
        ['coop3', 'HS_COOP', '出现分歧后，家长仍愿意继续保持沟通。', true],
        ['att1', 'HS_ATTITUDE', '家长表达不满时仍能保持基本尊重。', true],
        ['att2', 'HS_ATTITUDE', '家长能够区分事实、推测和情绪。', true],
        ['att3', 'HS_ATTITUDE', '家长没有出现威胁、公开抹黑或恶意维权行为。', true],
        ['con1', 'HS_CONTAINER', '目前的关系可以承受一次坦诚而具体的讨论。', true],
        ['con2', 'HS_CONTAINER', '双方能够在情绪出现时暂停并回到问题解决。', true],
        ['con3', 'HS_CONTAINER', '过去的积极沟通经验仍能成为当前关系资源。', true]
      ]
    },
    {
      code: 'HS_PARENT_TYPE', title: '家长分型与沟通策略评估', shortName: '家长分型', optionGroup: AGREE_5,
      description: '在双维速查提示需要重点沟通后使用，用于判断家长互动模式并匹配沟通策略。',
      minutes: 6, frequency: 'per_case', required: false,
      dimensions: [
        { code: 'HS_ANXIETY', name: '焦虑水平', questionIds: ['p1', 'p2'], high: '家长处于高焦虑，难以接收复杂信息', low: '情绪相对平稳' },
        { code: 'HS_CONTROL', name: '控制倾向', questionIds: ['p3', 'p4'], high: '家长倾向于主导教育方式并质疑学校安排', low: '愿意接受学校专业判断' },
        { code: 'HS_TRUST', name: '信任基础', questionIds: ['p5', 'p6'], high: '对学校缺乏基本信任', low: '有较好的信任基础' }
      ],
      questions: [
        ['p1', 'HS_ANXIETY', '家长在沟通中反复确认同一件事。', true],
        ['p2', 'HS_ANXIETY', '家长常在非工作时间发来紧急消息。', true],
        ['p3', 'HS_CONTROL', '家长会具体指定学校应该如何处理。', true],
        ['p4', 'HS_CONTROL', '家长对学校既有安排提出较多质疑。', true],
        ['p5', 'HS_TRUST', '家长相信教师是出于孩子利益在做判断。', true],
        ['p6', 'HS_TRUST', '过去的沟通中，家长兑现过共同约定。', true]
      ]
    }
  ],
  computed: [
    ['容器强度', '维度[HS_CONTAINER]', '关系容器承载力，越高表示越脆弱', 'HS_QUICK', 'con1-con3', 'HS_CONTAINER'],
    ['风险总分', '总分', '双维速查总分', 'HS_QUICK', '', '']
  ],
  attributions: [
    { code: 'HS_AT_CONFLICT', name: '沟通冲突升级', weight: 1.4, tags: 'home_school,conflict',
      desc: '家长的表达方式已经越过基本尊重的边界，关系进入对抗状态。',
      high: '出现威胁、公开抹黑或恶意维权；沟通中反复攻击个人',
      trigger: '长期诉求未被回应，或某次事件处理让家长感到不被尊重',
      action: '不在情绪高点解释责任，先记录家长诉求、事实依据和待核实点，并上报年级组长' },
    { code: 'HS_AT_CONTAINER', name: '关系容器不足', weight: 1.2, tags: 'home_school,container',
      desc: '当前关系无法承受一次坦诚而具体的讨论，需要先修复再沟通。',
      high: '一说具体问题就情绪激化；过去无积极沟通经验可调用',
      trigger: '缺少日常正向接触，只在出问题时联系',
      action: '本周主动做一次与问题无关的正向接触，只反馈孩子的一个具体进步' },
    { code: 'HS_AT_COOP', name: '配合度不足', weight: 1.0, tags: 'home_school,cooperation',
      desc: '家长未参与共同行动，导致校内措施缺少家庭侧的配合。',
      high: '不回消息、约定的事没有落实', trigger: '家长精力有限或不认同学校的处理方式',
      action: '把请求缩小到一个本周内能完成的具体动作，并明确完成后的反馈方式' },
    { code: 'HS_AT_ANXIETY', name: '家长焦虑过载', weight: 1.1, tags: 'home_school,anxiety',
      desc: '家长处于高焦虑状态，难以接收和处理复杂信息。',
      high: '反复确认同一件事；非工作时间频繁发来紧急消息',
      trigger: '对孩子状况缺乏可控感，信息来源零散',
      action: '固定一个每周反馈时间点，让家长知道什么时候能拿到什么信息，减少不确定感' },
    { code: 'HS_AT_TRUST', name: '信任基础薄弱', weight: 1.2, tags: 'home_school,trust',
      desc: '家长不相信教师是出于孩子利益在做判断，任何建议都会被质疑。',
      high: '对学校既有安排提出较多质疑；不认为教师站在孩子一边',
      trigger: '过往承诺未兑现或信息不透明',
      action: '选一件小事，明确承诺并按时兑现，用可验证的行为重建信任' }
  ],
  evidences: [
    ['HS_EV_01', 'HS_AT_CONFLICT', 'HS_QUICK', '维度[HS_ATTITUDE] >= 4', 3, '沟通态度维度处于高位，已出现越界表达'],
    ['HS_EV_02', 'HS_AT_CONFLICT', 'HS_QUICK', '题[att3] >= 4', 3, '出现威胁、公开抹黑或恶意维权行为'],
    ['HS_EV_03', 'HS_AT_CONFLICT', 'HS_QUICK', '维度[HS_ATTITUDE] >= 3', 1, '沟通态度出现值得关注的变化'],
    ['HS_EV_04', 'HS_AT_CONTAINER', 'HS_QUICK', '维度[HS_CONTAINER] >= 4', 2.5, '关系容器无法承受坦诚讨论'],
    ['HS_EV_05', 'HS_AT_CONTAINER', 'HS_QUICK', '维度[HS_CONTAINER] >= 3', 1, '关系容器承载力下降'],
    ['HS_EV_06', 'HS_AT_COOP', 'HS_QUICK', '维度[HS_COOP] >= 4', 2.5, '配合度维度处于高位，共同行动难以落实'],
    ['HS_EV_07', 'HS_AT_COOP', 'HS_QUICK', '维度[HS_COOP] >= 3', 1, '配合度出现下降'],
    ['HS_EV_21', 'HS_AT_ANXIETY', 'HS_PARENT_TYPE', '维度[HS_ANXIETY] >= 3.5', 2.5, '家长焦虑水平偏高，难以处理复杂信息'],
    ['HS_EV_22', 'HS_AT_ANXIETY', 'HS_PARENT_TYPE', '维度[HS_ANXIETY] >= 3', 1, '家长出现焦虑信号'],
    ['HS_EV_23', 'HS_AT_TRUST', 'HS_PARENT_TYPE', '维度[HS_TRUST] >= 3.5', 2.5, '信任基础薄弱，建议先做信任修复'],
    ['HS_EV_24', 'HS_AT_CONFLICT', 'HS_PARENT_TYPE', '维度[HS_CONTROL] >= 4', 2, '控制倾向强且质疑较多，存在冲突升级风险'],
    ['HS_EV_25', 'HS_AT_TRUST', 'HS_PARENT_TYPE', '维度[HS_TRUST] >= 3', 1, '信任基础需要巩固']
  ],
  gradingRules: [
    ['HS_GRADE_E', 'HS_QUICK', 10, '题[att3] >= 4', 'E', 'E 级保护通道', 'crisis', true,
      '出现威胁或恶意维权行为，已转入保护通道，请勿单独沟通。', '', '年级组长/校方', ''],
    ['HS_GRADE_D', 'HS_QUICK', 20, '风险总分 >= 32', 'D', 'D 级高冲突', 'high', false,
      '沟通风险较高，建议由年级组长陪同沟通并全程留痕。', '连续两次 D 级', '年级组长', '7天后复评'],
    ['HS_GRADE_C', 'HS_QUICK', 30, '风险总分 >= 25', 'C', 'C 级需谨慎', 'high', false,
      '沟通存在明显阻力，建议先稳住情绪和事实边界，再决定沟通节奏。', '连续两次 C 级', '年级组长', '14天后复评'],
    ['HS_GRADE_B', 'HS_QUICK', 40, '风险总分 >= 18', 'B', 'B 级需铺垫', 'medium', false,
      '沟通前需要做一定铺垫，重点是先修复关系容器。', '复评升级到 C 级或以上', '年级组长', '30天后复评'],
    ['HS_GRADE_A', '', 999, '', 'A', 'A 级常规沟通', 'low', false,
      '家校关系状况良好，可按常规节奏沟通。', '', '', '']
  ],
  redLines: [
    ['题[att3] >= 5', '家长出现明确威胁、公开抹黑或恶意维权行为', 'module',
      '停止教师单独沟通，转入学校保护通道，全程留痕并由年级组长或校方介入',
      '停止单独沟通,启用保护通道,全程留痕,通知年级组长,必要时上报校方',
      '经年级组长评估确认沟通可恢复常规', '年级组长',
      '[班级]家校沟通触发 E 级保护通道，请勿让班主任单独沟通。']
  ],
  tools: [
    { code: 'HS_RX_001', name: '先跟后带话术卡', short: '先跟后带', form: 'script', severity: 'medium',
      at: 'HS_AT_CONTAINER', tags: 'home_school,container', dims: 'HS_CONTAINER',
      scene: '家长有情绪但尚未升级，需要先稳住关系', effect: '在不认同内容的前提下承接情绪',
      steps: ['先复述家长的担心，用他的原话', '表达理解而非认同：「我能感受到您现在很担心」', '把话题引向可核实的事实', '约定一个具体的下一步和反馈时间'],
      script: '我能感受到您现在很担心。我们先把事实逐项核实，再一起决定下一步。',
      expect: '单次沟通内情绪明显降温', time: '10 分钟', cycle: '按需', evidence: 'B',
      source: '家校沟通实务手册 第3章', indicator: '家长愿意继续讨论具体事实', fail: '两次尝试后情绪仍持续升级',
      forbid: '不要在情绪高点解释责任归属；不要承诺未核实的事项' },
    { code: 'HS_RX_002', name: '事实边界记录表', short: '事实记录', form: 'worksheet', severity: 'high',
      at: 'HS_AT_CONFLICT', tags: 'home_school,conflict', dims: 'HS_ATTITUDE',
      scene: '沟通开始出现指责和归因争议时', effect: '把争议从情绪层面拉回可核实的事实',
      steps: ['分三栏记录：家长诉求 / 已核实事实 / 待核实点', '每一条都注明时间、在场人和信息来源', '待核实点明确由谁在什么时间核实', '核实结果书面反馈给家长'],
      script: '这一条我需要先向任课老师核实，明天下午三点前给您答复。',
      expect: '争议点从模糊指责收敛为可核实清单', time: '20 分钟', cycle: '每次冲突性沟通后',
      evidence: 'A', source: '家校沟通实务手册 第5章', indicator: '待核实点全部有明确责任人和时限',
      fail: '家长拒绝进入事实核实流程', forbid: '不要凭记忆回应；不要在未核实前认定责任' },
    { code: 'HS_RX_003', name: '沟通容器修复计划', short: '容器修复', form: 'framework', severity: 'medium',
      at: 'HS_AT_CONTAINER', tags: 'home_school,container', dims: 'HS_CONTAINER',
      scene: '关系只在出问题时才联系，缺少正向经验', effect: '重建可承载坦诚讨论的关系基础',
      steps: ['本周主动做一次与问题无关的正向接触', '只反馈孩子的一个具体进步，不带任何请求', '两周内累计三次正向接触后，再谈需要讨论的问题', '每次接触后记录家长的回应变化'],
      script: '今天想跟您说件小事，孩子这周主动帮同学讲了一道题。',
      expect: '家长回应速度和态度改善', time: '5 分钟', cycle: '每周一次，连续三周', evidence: 'B',
      source: '家校沟通实务手册 第4章', indicator: '三次接触后家长主动回应', fail: '三次接触后无任何回应',
      forbid: '正向接触时不要夹带任何请求或批评' },
    { code: 'HS_RX_004', name: '最小请求约定法', short: '最小请求', form: 'script', severity: 'low',
      at: 'HS_AT_COOP', tags: 'home_school,cooperation', dims: 'HS_COOP',
      scene: '家长不回消息或约定的事没有落实', effect: '把配合请求缩小到可完成的尺度',
      steps: ['把原本的请求拆到一周内能完成的最小动作', '明确「做什么、什么时候、怎么反馈」三件事', '完成后当天给出正向反馈', '连续两次完成后再提高一点要求'],
      script: '这周只请您做一件事：晚饭后问一句今天数学课听懂了多少，周五告诉我他怎么说。',
      expect: '家长完成率提升', time: '5 分钟', cycle: '每周一次', evidence: 'B',
      source: '家校沟通实务手册 第6章', indicator: '连续两周完成约定', fail: '连续两次未完成（改用 HS_RX_003）',
      forbid: '不要一次提出多项请求' },
    { code: 'HS_RX_005', name: '定期反馈节奏表', short: '反馈节奏', form: 'worksheet', severity: 'medium',
      at: 'HS_AT_ANXIETY', tags: 'home_school,anxiety', dims: 'HS_ANXIETY',
      scene: '家长反复确认同一件事、非工作时间频繁联系', effect: '用可预期的信息节奏降低焦虑',
      steps: ['与家长约定固定的反馈时间点，如每周五下午', '明确每次反馈包含哪三项内容', '约定非紧急事项统一在反馈时处理', '紧急情况的判断标准写清楚'],
      script: '我每周五下午会把这三件事同步给您，中间如果有紧急情况我会随时联系。',
      expect: '非工作时间消息量下降', time: '15 分钟', cycle: '约定一次，长期执行', evidence: 'B',
      source: '家校沟通实务手册 第7章', indicator: '非工作时间消息减少 50%', fail: '约定后一周内仍频繁越界',
      forbid: '不要承诺随时回复；约定后必须自己先遵守' },
    { code: 'HS_RX_006', name: '承诺兑现清单', short: '承诺兑现', form: 'checklist', severity: 'medium',
      at: 'HS_AT_TRUST', tags: 'home_school,trust', dims: 'HS_TRUST',
      scene: '家长不相信教师站在孩子一边', effect: '用可验证的行为重建信任',
      steps: ['只承诺一件本周确定能做到的小事', '明确完成时间和验证方式', '按时完成并主动告知结果', '连续兑现三次后再讨论更大的议题'],
      script: '这周我会安排他坐到第二排，周五我告诉您效果怎么样。',
      expect: '家长开始接受教师的专业判断', time: '10 分钟', cycle: '每周一次，连续三周',
      evidence: 'B', source: '家校信任重建研究', indicator: '连续三次按时兑现', fail: '任一次未按时兑现（需重新开始）',
      forbid: '不要承诺不在自己权限内的事' },
    { code: 'HS_RX_007', name: 'E 级保护通道操作卡', short: 'E级保护', form: 'checklist', severity: 'crisis',
      at: 'HS_AT_CONFLICT', tags: 'home_school,conflict,crisis', dims: 'HS_ATTITUDE',
      scene: '家长出现威胁、公开抹黑或恶意维权', effect: '保护教师并把处置转到学校层面',
      steps: ['立即停止单独沟通，不再单方回应', '完整保存聊天记录、通话记录和相关材料', '当天上报年级组长并填写事件说明', '后续沟通全部由年级组长或校方主导，教师只提供事实'],
      script: '这件事我需要请年级组长一起来处理，我们另约时间当面谈。',
      expect: '教师退出单独沟通，风险转由学校承接', time: '30 分钟', cycle: '按需', evidence: 'A',
      source: '校方家校冲突处置规范', indicator: '24 小时内完成上报和留痕', fail: '教师仍在单独沟通',
      forbid: '严禁教师单独回应威胁；严禁删除任何沟通记录',
      contra: [['事件已进入法律程序', 'block', '进入法律程序后一切沟通由校方法务承接', '移交校方法务处理']] }
  ],
  routes: [
    ['HS_KW_01', '投诉,举报,找校长', '曝光,发到网上,教育局', '', 1, 'exact', 'red', '冲突升级', 'HS_QUICK', 'HS_RX_007', 1.0, '家长表达投诉或维权意图，走保护通道'],
    ['HS_KW_02', '家长不配合,不回消息,不管孩子', '联系不上家长,家长不上心', '', 2, 'fuzzy', 'yellow', '配合不足', 'HS_QUICK', 'HS_RX_004', 0.8, '家长配合度不足'],
    ['HS_KW_03', '家长天天问,一直发消息', '半夜发消息,反复确认', '', 3, 'fuzzy', 'yellow', '焦虑过载', 'HS_PARENT_TYPE', 'HS_RX_005', 0.75, '家长焦虑水平偏高'],
    ['HS_KW_04', '家长质疑,不信任,觉得我针对', '说我偏心,不相信老师', '', 4, 'fuzzy', 'orange', '信任薄弱', 'HS_PARENT_TYPE', 'HS_RX_006', 0.8, '家校信任基础薄弱']
  ],
  templates: [
    ['E', 'summary', '本次评估触发 E 级保护通道，核心问题是「${主要归因}」。请立即停止单独沟通，保存全部记录并当天上报年级组长，后续由学校层面承接。'],
    ['D', 'summary', '本次沟通风险等级为 D 级，主要归因是「${主要归因}」，同时需关注「${次要归因}」。建议由年级组长陪同沟通并全程留痕。'],
    ['C', 'summary', '本次评估提示沟通存在明显阻力，核心变量是「${主要归因}」。处理重点不是先说服家长，而是先稳住情绪和事实边界，再决定沟通节奏。'],
    ['B', 'summary', '本次评估显示沟通前需要一定铺垫，主要落在「${主要归因}」。建议先修复关系容器，积累两到三次正向接触后再谈具体问题。'],
    ['A', 'summary', '当前家校关系状况良好，可按常规节奏沟通。保持日常的正向接触，让关系容器持续有储备。']
  ]
}

// ===================================================================
// student_case 学生个体问题
// ===================================================================

const studentCase = {
  code: 'student_case',
  label: '学生个体问题',
  scales: [
    {
      code: 'SC_FIVE_CAT', title: '学生个体问题快速筛查', shortName: '五类筛查', optionGroup: AGREE_5,
      description: '从学业、行为、情绪、社交和适应五类表现进行教育场景筛查，不构成医学诊断。',
      minutes: 6, frequency: 'per_case', required: true,
      dimensions: [
        { code: 'SC_ACADEMIC', name: '学业表现', questionIds: ['aca1', 'aca2', 'aca3'], high: '学业表现持续下降且常规支持无效', low: '学业表现稳定' },
        { code: 'SC_BEHAVIOR', name: '行为表现', questionIds: ['beh1', 'beh2', 'beh3'], high: '冲动或对抗行为频繁且难以预测', low: '行为表现可控' },
        { code: 'SC_EMOTION', name: '情绪状态', questionIds: ['emo1', 'emo2', 'emo3'], high: '持续低落焦虑且影响日常功能', low: '情绪状态平稳' },
        { code: 'SC_SOCIAL', name: '同伴社交', questionIds: ['soc1', 'soc2', 'soc3'], high: '冲突或孤立反复发生且修复无效', low: '同伴关系稳定' },
        { code: 'SC_ADAPT', name: '适应状况', questionIds: ['adp1', 'adp2', 'adp3'], high: '出现拒学、躯体化且持续四周以上', low: '适应良好' }
      ],
      questions: [
        ['aca1', 'SC_ACADEMIC', '学习表现近期出现持续且明显的下降。', false],
        ['aca2', 'SC_ACADEMIC', '完成作业、听课或考试受到明显影响。', false],
        ['aca3', 'SC_ACADEMIC', '已有常规支持措施没有带来改善。', false],
        ['beh1', 'SC_BEHAVIOR', '冲动、对抗或规则破坏行为频繁出现。', false],
        ['beh2', 'SC_BEHAVIOR', '行为已经明显影响本人或同伴的学习。', false],
        ['beh3', 'SC_BEHAVIOR', '行为发生的场景和诱因较难预测。', false],
        ['emo1', 'SC_EMOTION', '持续出现低落、焦虑、易怒或明显退缩。', false],
        ['emo2', 'SC_EMOTION', '情绪变化已经影响日常功能。', false],
        ['emo3', 'SC_EMOTION', '学生很难表达或调节当前感受。', false],
        ['soc1', 'SC_SOCIAL', '与同伴的冲突、排斥或孤立反复发生。', false],
        ['soc2', 'SC_SOCIAL', '学生缺少稳定的同伴支持。', false],
        ['soc3', 'SC_SOCIAL', '常规关系修复方式效果有限。', false],
        ['adp1', 'SC_ADAPT', '在转班、家庭变化或重要事件后持续难以适应。', false],
        ['adp2', 'SC_ADAPT', '出现明显躯体不适、拒学或回避。', false],
        ['adp3', 'SC_ADAPT', '问题持续四周以上且没有改善趋势。', false]
      ]
    },
    {
      code: 'SC_EBRCA', title: 'EBRCA 结构化观察记录', shortName: 'EBRCA', optionGroup: AGREE_5,
      description: '在五类筛查提示需要深入了解后使用，按事件—行为—结果—诱因—已尝试支持做结构化观察。',
      minutes: 8, frequency: 'per_case', required: false,
      dimensions: [
        { code: 'SC_TRIGGER', name: '诱因清晰度', questionIds: ['ob1', 'ob2'], high: '诱因不明确，行为难以预防', low: '诱因清晰可干预' },
        { code: 'SC_FUNCTION', name: '功能影响', questionIds: ['ob3', 'ob4'], high: '已明显影响学习与生活功能', low: '功能影响有限' },
        { code: 'SC_SUPPORT_TRIED', name: '既有支持有效性', questionIds: ['ob5', 'ob6'], high: '已尝试的支持基本无效', low: '既有支持有效' }
      ],
      questions: [
        ['ob1', 'SC_TRIGGER', '行为发生前的情境难以识别。', false],
        ['ob2', 'SC_TRIGGER', '同样的情境下行为反应不一致。', false],
        ['ob3', 'SC_FUNCTION', '该表现已影响学生完成日常学习任务。', false],
        ['ob4', 'SC_FUNCTION', '该表现已影响学生与他人的正常互动。', false],
        ['ob5', 'SC_SUPPORT_TRIED', '已尝试的座位调整、谈话等措施没有带来改善。', false],
        ['ob6', 'SC_SUPPORT_TRIED', '家庭配合的支持措施没有带来改善。', false]
      ]
    }
  ],
  computed: [
    ['筛查总分', '总分', '五类筛查总分', 'SC_FIVE_CAT', '', '']
  ],
  attributions: [
    { code: 'SC_AT_EMOTION', name: '情绪调节困难', weight: 1.4, tags: 'student_case,emotion',
      desc: '学生持续出现低落、焦虑或退缩，且难以表达和调节当前感受。',
      high: '持续低落或易怒；很难说清自己的感受', trigger: '可能与家庭变化、同伴关系或学业压力相关',
      action: '本周做一次低压力谈话，从可观察事实开始，不贴标签' },
    { code: 'SC_AT_BEHAVIOR', name: '行为调控困难', weight: 1.3, tags: 'student_case,behavior',
      desc: '冲动、对抗或规则破坏行为频繁出现，且诱因难以预测。',
      high: '行为频繁且场景不可预测；已影响他人学习', trigger: '可能与执行功能、情绪调节或环境刺激相关',
      action: '完成一周 ABC 结构化观察，记录行为前情境、行为本身和行为后结果' },
    { code: 'SC_AT_SOCIAL', name: '同伴关系受损', weight: 1.2, tags: 'student_case,social',
      desc: '与同伴的冲突、排斥或孤立反复发生，缺少稳定的支持关系。',
      high: '被孤立或反复冲突；常规修复方式无效', trigger: '社交技能不足或班级关系结构问题',
      action: '安排一次结构化的同伴配对活动，并观察互动质量' },
    { code: 'SC_AT_ACADEMIC', name: '学业功能下降', weight: 1.0, tags: 'student_case,academic',
      desc: '学业表现持续下降，且已有常规支持措施没有带来改善。',
      high: '成绩持续下滑；作业和听课明显受影响', trigger: '可能是学习问题模块的信号，需要交叉评估',
      action: '转入学习问题模块做三层诊断，区分行为、认知与关系层面的卡点' },
    { code: 'SC_AT_ADAPT', name: '适应障碍信号', weight: 1.5, tags: 'student_case,adapt,crisis',
      desc: '出现拒学、躯体化或明显回避，且持续四周以上没有改善趋势。',
      high: '拒学、躯体不适、明显回避；持续四周以上', trigger: '重大生活事件或长期压力累积',
      action: '整理时间线与已尝试措施，启动专业会商流程' }
  ],
  evidences: [
    ['SC_EV_01', 'SC_AT_EMOTION', 'SC_FIVE_CAT', '维度[SC_EMOTION] >= 4', 3, '情绪维度处于高位，已影响日常功能'],
    ['SC_EV_02', 'SC_AT_EMOTION', 'SC_FIVE_CAT', '维度[SC_EMOTION] >= 3', 1, '情绪维度出现需要关注的信号'],
    ['SC_EV_03', 'SC_AT_BEHAVIOR', 'SC_FIVE_CAT', '维度[SC_BEHAVIOR] >= 4', 3, '行为维度处于高位，行为频繁且难以预测'],
    ['SC_EV_04', 'SC_AT_BEHAVIOR', 'SC_FIVE_CAT', '维度[SC_BEHAVIOR] >= 3', 1, '行为维度出现需要关注的信号'],
    ['SC_EV_05', 'SC_AT_SOCIAL', 'SC_FIVE_CAT', '维度[SC_SOCIAL] >= 4', 2.5, '同伴社交维度处于高位，冲突或孤立反复发生'],
    ['SC_EV_06', 'SC_AT_SOCIAL', 'SC_FIVE_CAT', '维度[SC_SOCIAL] >= 3', 1, '同伴社交出现需要关注的信号'],
    ['SC_EV_07', 'SC_AT_ACADEMIC', 'SC_FIVE_CAT', '维度[SC_ACADEMIC] >= 4', 2.5, '学业维度处于高位且常规支持无效'],
    ['SC_EV_08', 'SC_AT_ACADEMIC', 'SC_FIVE_CAT', '维度[SC_ACADEMIC] >= 3', 1, '学业表现出现下降'],
    ['SC_EV_09', 'SC_AT_ADAPT', 'SC_FIVE_CAT', '维度[SC_ADAPT] >= 4', 3.5, '适应维度处于高位，出现拒学或躯体化信号'],
    ['SC_EV_10', 'SC_AT_ADAPT', 'SC_FIVE_CAT', '题[adp3] >= 4', 2, '问题已持续四周以上且无改善趋势'],
    ['SC_EV_11', 'SC_AT_ADAPT', 'SC_FIVE_CAT', '维度[SC_ADAPT] >= 3', 1, '适应状况出现需要关注的信号'],
    ['SC_EV_21', 'SC_AT_BEHAVIOR', 'SC_EBRCA', '维度[SC_TRIGGER] >= 3.5', 2.5, '结构化观察显示行为诱因不清晰，难以预防'],
    ['SC_EV_22', 'SC_AT_ADAPT', 'SC_EBRCA', '维度[SC_FUNCTION] >= 3.5', 3, '结构化观察显示功能影响已经明显'],
    ['SC_EV_23', 'SC_AT_EMOTION', 'SC_EBRCA', '维度[SC_SUPPORT_TRIED] >= 3.5', 2.5, '已尝试的支持措施基本无效，需要升级支持层级'],
    ['SC_EV_24', 'SC_AT_SOCIAL', 'SC_EBRCA', '维度[SC_FUNCTION] >= 3', 1.5, '功能影响已波及正常互动']
  ],
  gradingRules: [
    ['SC_GRADE_L3', 'SC_FIVE_CAT', 10, '筛查总分 >= 52', 'L3', 'L3 专业会商', 'crisis', true,
      '多个维度同时处于高位，已达到专业会商层级，请整理材料并启动转介。', '', '心理专员', ''],
    ['SC_GRADE_L2', 'SC_FIVE_CAT', 20, '筛查总分 >= 38', 'L2', 'L2 年级协同', 'high', false,
      '问题已超出单个教师可独立处理的范围，建议启动年级协同。', '连续两次 L2', '年级组长', '14天后复评'],
    ['SC_GRADE_L1', '', 999, '', 'L1', 'L1 教师支持', 'medium', false,
      '当前可由教师通过结构化观察和低压力谈话提供支持。', '复评升级到 L2 或以上', '年级组长', '30天后复评']
  ],
  redLines: [
    ['题[adp2] >= 5 且 题[emo2] >= 5', '出现明显拒学或躯体化，且情绪已影响日常功能', 'module',
      '立即阻断常规建议输出，展示危机求助指引，生成转介工单通知心理专员',
      '停止常规建议输出,展示危机求助指引,创建安全事件,生成转介工单,通知心理专员',
      '心理专员完成评估并在系统中标记为「已处置」', '心理专员',
      '[学生]个体问题评估触发红线：出现拒学与情绪功能受损。请尽快介入。']
  ],
  tools: [
    { code: 'SC_RX_001', name: 'ABC 结构化观察记录', short: 'ABC观察', form: 'worksheet', severity: 'medium',
      at: 'SC_AT_BEHAVIOR', tags: 'student_case,behavior', dims: 'SC_BEHAVIOR',
      scene: '行为频繁且诱因难以识别时', effect: '把模糊印象转成可分析的行为数据',
      steps: ['连续一周，每次行为发生时记录三栏：A 发生前情境 / B 可观察行为 / C 行为后结果', '只记录看到的，不写推测和评价', '一周后统计最高频的 A 和 C', '针对最高频的 A 做一次环境调整并观察变化'],
      script: '我注意到你最近有些变化，我想先了解你的感受。你可以只说一点点。',
      expect: '识别出至少一个可干预的诱因', time: '每次 2 分钟', cycle: '连续 7 天', evidence: 'A',
      source: '应用行为分析在班级中的实践', indicator: '一周内记录 >= 8 次', fail: '一周记录不足 3 次',
      forbid: '不要在记录中使用诊断性词汇；不要向学生展示记录表' },
    { code: 'SC_RX_002', name: '低压力谈话框架', short: '低压谈话', form: 'script', severity: 'medium',
      at: 'SC_AT_EMOTION', tags: 'student_case,emotion', dims: 'SC_EMOTION',
      scene: '学生情绪明显但难以表达时', effect: '在不施压的前提下建立表达通道',
      steps: ['选一个不被打扰、非正式的场合', '从一个具体的观察事实开始，不问「你怎么了」', '给出选择而非追问：「你可以只说一点点，也可以先不说」', '结束时明确下一次可以找你的时间和方式'],
      script: '我注意到你这两天午休都一个人待着。你可以只说一点点，不需要马上解释清楚。',
      expect: '学生愿意做出任何程度的表达', time: '10 分钟', cycle: '每周一次', evidence: 'B',
      source: '学生个体支持手册 第3章', indicator: '学生做出回应（包括沉默但未回避）',
      fail: '连续两次学生完全回避', forbid: '不要在其他学生在场时进行；不要承诺保密后又告知他人' },
    { code: 'SC_RX_003', name: '同伴联结重建方案', short: '同伴联结', form: 'framework', severity: 'medium',
      at: 'SC_AT_SOCIAL', tags: 'student_case,social', dims: 'SC_SOCIAL',
      scene: '学生被孤立或同伴冲突反复发生', effect: '通过结构化任务重建同伴关系',
      steps: ['找一个该学生擅长的领域，设计一个需要合作的小任务', '为其匹配一到两位关系中性的同学', '任务完成后公开肯定该学生的具体贡献', '两周后观察自然互动是否增加'],
      script: '这件事你最在行，你带着他们两个一起弄，周五给大家看看。',
      expect: '自然互动频次增加', time: '一周', cycle: '每两周一轮', evidence: 'B',
      source: '同伴关系干预实务', indicator: '两周内出现自发互动', fail: '两轮后无变化（升级至 L2）',
      forbid: '不要公开点明该学生「需要帮助」' },
    { code: 'SC_RX_004', name: '三级支持决策卡', short: '分级决策', form: 'checklist', severity: 'high',
      at: 'SC_AT_ADAPT', tags: 'student_case,adapt', dims: 'SC_ADAPT',
      scene: '需要判断由教师支持、年级协同还是专业会商', effect: '让支持层级的判断有据可依',
      steps: ['整理问题的起止时间线和关键事件', '列出已尝试的支持措施和各自效果', '对照三级标准判断当前层级', '按层级准备对应材料并启动流程'],
      script: '目前我们先基于观察事实协同支持，不做标签判断，重点是看哪些支持对学生有效。',
      expect: '形成一份可交接的支持材料', time: '30 分钟', cycle: '每次层级变化时', evidence: 'A',
      source: '学生个体支持手册 第6章', indicator: '材料包含时间线、措施和效果三部分',
      fail: '无法回忆已尝试过哪些措施', forbid: '不得在材料中写入诊断性结论' },
    { code: 'SC_RX_005', name: '学业交叉评估转介单', short: '学业转介', form: 'checklist', severity: 'low',
      at: 'SC_AT_ACADEMIC', tags: 'student_case,academic', dims: 'SC_ACADEMIC',
      scene: '学业下降是最突出的表现时', effect: '把学业问题转到学习问题模块做精准诊断',
      steps: ['确认学业下降已持续四周以上', '记录哪些科目、哪些环节受影响最明显', '在学习问题模块完成三层诊断', '按三层诊断结果匹配教学支架'],
      script: '我们关注的不只是分数，而是他在学习过程中遇到了什么困难。',
      expect: '定位到行为、认知或关系层面的具体卡点', time: '15 分钟', cycle: '按需', evidence: 'B',
      source: '跨模块协同指引', indicator: '完成学习问题模块的三层诊断', fail: '诊断结果无明确主导层面',
      forbid: '不要在未做三层诊断前直接安排补课' },
    { code: 'SC_RX_006', name: '危机转介操作卡', short: '危机转介', form: 'checklist', severity: 'crisis',
      at: 'SC_AT_ADAPT', tags: 'student_case,adapt,crisis', dims: 'SC_ADAPT',
      scene: '出现拒学、躯体化或自伤相关信号', effect: '确保危机情形被专业力量及时接住',
      steps: ['确保学生当下处于安全环境并有人陪伴', '立即联系校内心理专员，说明观察到的具体事实', '同步通知年级组长和家长', '完整记录时间线，不做任何诊断性表述'],
      script: '我现在需要请专业老师一起来看看，我会一直陪着你。',
      expect: '在 24 小时内建立专业支持连接', time: '立即', cycle: '按需', evidence: 'A',
      source: '校园心理危机干预规范', indicator: '2 小时内完成专员联系', fail: '超过 24 小时未建立联系',
      forbid: '严禁班主任自行判断风险等级；严禁延迟上报；严禁在学生面前讨论转介',
      contra: [['学生已在专业干预中', 'warn', '避免重复动员造成学生压力', '与心理专员确认现有干预方案后再行动']] }
  ],
  routes: [
    ['SC_KW_01', '不想活,想死,活着没意思', '结束生命,生无可恋,不如死了', '不想活了（玩笑）', 1, 'exact', 'red', '自杀意念', 'SC_FIVE_CAT', 'SC_RX_006', 1.0, '任一命中即走危机流程，不分时段和模块'],
    ['SC_KW_02', '自伤,划手,伤害自己', '割腕,弄伤自己', '', 2, 'exact', 'red', '自伤行为', 'SC_FIVE_CAT', 'SC_RX_006', 1.0, '自伤相关表达，立即走危机流程'],
    ['SC_KW_03', '不想上学,不肯来,请假很多', '拒学,逃学,装病', '', 3, 'fuzzy', 'orange', '拒学信号', 'SC_FIVE_CAT', 'SC_RX_004', 0.9, '出现拒学相关信号'],
    ['SC_KW_04', '被欺负,被孤立,没人跟他玩', '被排挤,被针对', '', 4, 'fuzzy', 'orange', '同伴排斥', 'SC_EBRCA', 'SC_RX_003', 0.85, '出现同伴排斥信号'],
    ['SC_KW_05', '情绪不好,很低落,爱哭', '不说话,躲着人,发脾气', '', 5, 'fuzzy', 'yellow', '情绪信号', 'SC_FIVE_CAT', 'SC_RX_002', 0.7, '出现情绪相关信号']
  ],
  templates: [
    ['L3', 'summary', '本次筛查结果达到 L3 专业会商层级，最突出的是「${主要归因}」。请整理时间线、已尝试措施和效果，并启动转介流程。在专业介入前，保持日常陪伴和安全环境。'],
    ['L2', 'summary', '本次筛查结果为 L2 年级协同层级，主要归因是「${主要归因}」，同时「${次要归因}」也需要关注。建议整理协同材料并与年级组共同制定支持方案。'],
    ['L1', 'summary', '本次筛查结果为 L1 教师支持层级，主要落在「${主要归因}」。处理重点是先做教育场景下的结构化观察，区分表现、诱因和已尝试支持，不做标签判断。']
  ]
}

// ===================================================================
// learning_problem 学生学习问题
// ===================================================================

const learningProblem = {
  code: 'learning_problem',
  label: '学生学习问题',
  scales: [
    {
      code: 'LP_THREE_LAYER', title: '学生学习问题三层诊断', shortName: '三层诊断', optionGroup: AGREE_5,
      description: '从行为、认知和关系三个层面识别学生学习困难的主导因素，不构成学习障碍诊断。',
      minutes: 5, frequency: 'per_case', required: true,
      dimensions: [
        { code: 'LP_BEHAVIOR', name: '行为层', questionIds: ['beh1', 'beh2', 'beh3', 'beh4'], high: '学习行为持续失序且外部推动无效', low: '学习行为稳定' },
        { code: 'LP_COGNITION', name: '认知层', questionIds: ['cog1', 'cog2', 'cog3'], high: '理解停留表面，缺少元认知策略', low: '认知加工顺畅' },
        { code: 'LP_RELATION', name: '关系层', questionIds: ['rel1', 'rel2', 'rel3'], high: '师生、同伴或家庭关系明显影响学习投入', low: '关系支持充分' }
      ],
      questions: [
        ['beh1', 'LP_BEHAVIOR', '学生经常不交或拖延完成作业。', false],
        ['beh2', 'LP_BEHAVIOR', '课堂上明显走神、分心或做与学习无关的事。', false],
        ['beh3', 'LP_BEHAVIOR', '考试或测验成绩与实际能力之间存在明显落差。', false],
        ['beh4', 'LP_BEHAVIOR', '已有提醒或奖励措施对改善学习行为效果有限。', false],
        ['cog1', 'LP_COGNITION', '学生对核心概念的理解停留在表面，难以迁移或应用。', false],
        ['cog2', 'LP_COGNITION', '学生在记忆、推理或组织信息方面存在明显困难。', false],
        ['cog3', 'LP_COGNITION', '学生在独立解决问题时容易卡住，缺少元认知策略。', false],
        ['rel1', 'LP_RELATION', '师生关系或课堂归属感对学生的学习动机有明显影响。', false],
        ['rel2', 'LP_RELATION', '同伴之间的比较、竞争或排斥影响了学生的学习投入。', false],
        ['rel3', 'LP_RELATION', '家庭对学习的支持、期待或冲突明显影响了学生的学业状态。', false]
      ]
    },
    {
      code: 'LP_MOTIVATION', title: '学习动机与学业情绪评估', shortName: '动机情绪', optionGroup: AGREE_5,
      description: '在三层诊断提示关系层或行为层为主导后使用，用于区分动机类型和学业情绪状态。',
      minutes: 6, frequency: 'per_case', required: false,
      dimensions: [
        { code: 'LP_INTRINSIC', name: '内在动机', questionIds: ['m1', 'm2'], high: '学习完全依赖外部推动', low: '有内在学习兴趣' },
        { code: 'LP_ANXIETY', name: '学业焦虑', questionIds: ['m3', 'm4'], high: '学业焦虑明显影响表现', low: '焦虑水平可控' },
        { code: 'LP_SELF_EFFICACY', name: '学业自我效能', questionIds: ['m5', 'm6'], high: '认为自己学不会，习得性无助', low: '相信努力有用' }
      ],
      questions: [
        ['m1', 'LP_INTRINSIC', '没有老师或家长督促时，学生几乎不主动学习。', false],
        ['m2', 'LP_INTRINSIC', '学生学习主要是为了避免被批评。', false],
        ['m3', 'LP_ANXIETY', '临近考试时学生出现明显紧张或躯体不适。', false],
        ['m4', 'LP_ANXIETY', '学生因为怕出错而不敢在课堂上表达。', false],
        ['m5', 'LP_SELF_EFFICACY', '学生认为自己再怎么努力也学不好某些科目。', false],
        ['m6', 'LP_SELF_EFFICACY', '学生把失败归因于自己能力不行而不是方法问题。', false]
      ]
    }
  ],
  computed: [
    ['诊断总分', '总分', '三层诊断总分', 'LP_THREE_LAYER', '', '']
  ],
  attributions: [
    { code: 'LP_AT_BEHAVIOR', name: '学习行为失序', weight: 1.2, tags: 'learning_problem,behavior',
      desc: '学习行为持续失序，且提醒或奖励等外部推动手段效果有限。',
      high: '作业拖延、课堂分心；提醒和奖励都不再有效',
      trigger: '可能与执行功能、任务难度或环境干扰相关',
      action: '完成一周学习行为观察，记录课堂参与、作业完成和测验表现的模式' },
    { code: 'LP_AT_COGNITION', name: '认知加工困难', weight: 1.3, tags: 'learning_problem,cognition',
      desc: '学生对核心概念的理解停留在表面，缺少可迁移的学习策略。',
      high: '会做原题不会变式；独立解题时容易卡住',
      trigger: '缺少元认知策略或前置知识存在断层',
      action: '试用一项教学支架：从示范、提示、提问、同伴互助中选一项并记录效果' },
    { code: 'LP_AT_RELATION', name: '关系层影响', weight: 1.2, tags: 'learning_problem,relation',
      desc: '师生关系、同伴比较或家庭期待明显影响了学生的学习投入。',
      high: '换老师后表现差异明显；因同伴比较而回避课堂',
      trigger: '课堂归属感不足或家庭期待与能力错配',
      action: '本周创造一次该学生在课堂上被正向看见的机会' },
    { code: 'LP_AT_MOTIVATION', name: '内驱动机不足', weight: 1.1, tags: 'learning_problem,motivation',
      desc: '学习完全依赖外部推动，学生缺少自主的学习目标。',
      high: '没人督促就不学；学习是为了避免批评',
      trigger: '长期外部控制导致自主感缺失',
      action: '让学生自己选择一项本周的学习任务并定义完成标准' },
    { code: 'LP_AT_EFFICACY', name: '习得性无助', weight: 1.4, tags: 'learning_problem,efficacy',
      desc: '学生认为再努力也学不好，把失败归因于能力而非方法。',
      high: '「我就是学不会数学」；放弃尝试',
      trigger: '长期失败经验累积且缺少归因引导',
      action: '设计一个必然能成功的最小任务，并明确把成功归因到具体方法上' }
  ],
  evidences: [
    ['LP_EV_01', 'LP_AT_BEHAVIOR', 'LP_THREE_LAYER', '维度[LP_BEHAVIOR] >= 4', 3, '行为层得分处于高位，学习行为持续失序'],
    ['LP_EV_02', 'LP_AT_BEHAVIOR', 'LP_THREE_LAYER', '维度[LP_BEHAVIOR] >= 3', 1, '行为层出现需要关注的信号'],
    ['LP_EV_03', 'LP_AT_BEHAVIOR', 'LP_THREE_LAYER', '题[beh4] >= 4', 2, '提醒和奖励等外部推动手段已经失效'],
    ['LP_EV_04', 'LP_AT_COGNITION', 'LP_THREE_LAYER', '维度[LP_COGNITION] >= 4', 3, '认知层得分处于高位，理解停留在表面'],
    ['LP_EV_05', 'LP_AT_COGNITION', 'LP_THREE_LAYER', '维度[LP_COGNITION] >= 3', 1, '认知层出现需要关注的信号'],
    ['LP_EV_06', 'LP_AT_COGNITION', 'LP_THREE_LAYER', '题[cog3] >= 4', 2, '缺少元认知策略，独立解题时容易卡住'],
    ['LP_EV_07', 'LP_AT_RELATION', 'LP_THREE_LAYER', '维度[LP_RELATION] >= 4', 3, '关系层得分处于高位，关系因素明显影响学习'],
    ['LP_EV_08', 'LP_AT_RELATION', 'LP_THREE_LAYER', '维度[LP_RELATION] >= 3', 1, '关系层出现需要关注的信号'],
    ['LP_EV_21', 'LP_AT_MOTIVATION', 'LP_MOTIVATION', '维度[LP_INTRINSIC] >= 3.5', 2.5, '内在动机维度偏低，学习依赖外部推动'],
    ['LP_EV_22', 'LP_AT_MOTIVATION', 'LP_MOTIVATION', '维度[LP_INTRINSIC] >= 3', 1, '内在动机出现下降信号'],
    ['LP_EV_23', 'LP_AT_EFFICACY', 'LP_MOTIVATION', '维度[LP_SELF_EFFICACY] >= 3.5', 3, '学业自我效能偏低，出现习得性无助信号'],
    ['LP_EV_24', 'LP_AT_EFFICACY', 'LP_MOTIVATION', '维度[LP_SELF_EFFICACY] >= 3', 1, '学业自我效能需要关注'],
    ['LP_EV_25', 'LP_AT_RELATION', 'LP_MOTIVATION', '维度[LP_ANXIETY] >= 3.5', 2, '学业焦虑明显，可能与课堂关系或家庭期待相关']
  ],
  gradingRules: [
    ['LP_GRADE_LP3', 'LP_THREE_LAYER', 10, '诊断总分 >= 38', 'LP3', 'LP3 系统干预', 'crisis', false,
      '多个层面同时受阻，建议整合教师、年级和家庭支持，制定系统干预计划。', '连续两次 LP3 或伴随安全风险', '年级组长', '14天后复评'],
    ['LP_GRADE_LP2', 'LP_THREE_LAYER', 20, '诊断总分 >= 27', 'LP2', 'LP2 深入诊断', 'high', false,
      '需要进一步诊断，建议结合课堂观察做交叉验证后再匹配工具。', '连续两次 LP2', '教研组长', '30天后复评'],
    ['LP_GRADE_LP1', '', 999, '', 'LP1', 'LP1 教师自主支持', 'medium', false,
      '当前可由教师通过教学策略调整自主支持。', '复评升级到 LP2 或以上', '教研组长', '30天后复评']
  ],
  redLines: [
    ['维度[LP_RELATION] >= 4.7 且 题[rel3] >= 5', '家庭因素对学习的负面影响达到极端水平，可能存在家庭功能问题', 'module',
      '暂停常规学习支持建议，转入学生个体问题模块做适应性评估，并通知心理专员',
      '停止常规建议输出,提示转入学生个体问题模块,通知心理专员,记录事件',
      '完成学生个体问题模块评估且心理专员确认', '心理专员',
      '[学生]学习问题评估中家庭关系因素触发红线，请安排个体评估。']
  ],
  tools: [
    { code: 'LP_RX_001', name: '一周学习行为观察表', short: '行为观察', form: 'worksheet', severity: 'medium',
      at: 'LP_AT_BEHAVIOR', tags: 'learning_problem,behavior', dims: 'LP_BEHAVIOR',
      scene: '学习行为持续失序但原因不明时', effect: '找出行为失序的具体模式和时段',
      steps: ['连续五天记录课堂参与、作业完成和测验表现三项', '标出每天状态最好和最差的时段', '找出重复出现的模式，如某节课后必然分心', '针对最高频的模式做一次环境或任务调整'],
      script: '我注意到你在数学课的后半节特别容易走神，我们一起看看能怎么调整。',
      expect: '识别出至少一个可干预的行为模式', time: '每天 5 分钟', cycle: '连续 5 天', evidence: 'A',
      source: '学习问题智能辅导系统 第2章', indicator: '五天内记录完整', fail: '记录不足三天',
      forbid: '不要在记录期间同时改变多个变量' },
    { code: 'LP_RX_002', name: 'ZPD 教学支架卡', short: 'ZPD支架', form: 'framework', severity: 'high',
      at: 'LP_AT_COGNITION', tags: 'learning_problem,cognition', dims: 'LP_COGNITION',
      scene: '学生会做原题但不会变式时', effect: '在最近发展区内提供恰当强度的支持',
      steps: ['确定目标和学生当前的实际水平', '判断两者之间的最近发展区', '从示范、提示、提问、同伴互助中选一种支架', '明确退出标准，逐步撤除支架'],
      script: '你先看我做一遍，然后我们一起做一遍，最后你自己做一遍。',
      expect: '学生能独立完成一道变式题', time: '一节课', cycle: '每周两次', evidence: 'A',
      source: '维果茨基理论的课堂应用', indicator: '撤除支架后仍能完成', fail: '三次后仍完全依赖支架',
      forbid: '不要直接给答案；不要跳过示范环节' },
    { code: 'LP_RX_003', name: '元认知提问清单', short: '元认知', form: 'checklist', severity: 'medium',
      at: 'LP_AT_COGNITION', tags: 'learning_problem,cognition', dims: 'LP_COGNITION',
      scene: '学生独立解题时容易卡住', effect: '把外部提示内化为自我提问习惯',
      steps: ['给学生一张固定的四问清单：我要解决什么？我知道什么？我打算怎么做？做完怎么检查？', '前三次由教师带着问', '之后让学生自己对照清单出声说', '两周后撤掉清单，观察是否保留'],
      script: '先别急着算，你先说说这道题在问什么。', expect: '学生能自主使用至少两个自我提问',
      time: '10 分钟', cycle: '每次作业辅导时', evidence: 'A', source: '元认知策略教学研究',
      indicator: '两周后能不看清单自问', fail: '两周后仍完全依赖提示',
      forbid: '不要在学生思考时打断' },
    { code: 'LP_RX_004', name: '课堂正向看见机会设计', short: '正向看见', form: 'framework', severity: 'medium',
      at: 'LP_AT_RELATION', tags: 'learning_problem,relation', dims: 'LP_RELATION',
      scene: '学生因课堂归属感不足而回避学习', effect: '重建学生与课堂的正向联结',
      steps: ['找一个该学生确定能答对的问题', '在课堂上点名请他回答', '肯定具体的思路而不是笼统说「很好」', '连续三次后观察其课堂参与变化'],
      script: '刚才他用的这个方法很关键，我们都跟着他的思路走一遍。',
      expect: '课堂主动参与次数增加', time: '每次 2 分钟', cycle: '每周三次，连续两周', evidence: 'B',
      source: '课堂归属感与学业投入研究', indicator: '两周内主动举手次数增加', fail: '两周后无变化',
      forbid: '不要设计明显降低难度的问题让其他学生看出来' },
    { code: 'LP_RX_005', name: '自主任务选择卡', short: '自主选择', form: 'worksheet', severity: 'low',
      at: 'LP_AT_MOTIVATION', tags: 'learning_problem,motivation', dims: 'LP_INTRINSIC',
      scene: '学生完全依赖外部推动才学习', effect: '通过给予选择权恢复自主感',
      steps: ['给出三个难度相近但形式不同的任务选项', '让学生自己选一个并说明为什么选它', '让学生自己定义「做到什么程度算完成」', '完成后只针对他自己定的标准做反馈'],
      script: '这三个你挑一个，挑完告诉我你觉得做到什么程度算完成。',
      expect: '学生开始主动定义学习目标', time: '10 分钟', cycle: '每周一次', evidence: 'B',
      source: '自我决定理论的课堂应用', indicator: '学生能说出选择理由', fail: '连续两次拒绝选择',
      forbid: '不要否定学生自定的完成标准' },
    { code: 'LP_RX_006', name: '归因重塑最小任务', short: '归因重塑', form: 'exercise', severity: 'high',
      at: 'LP_AT_EFFICACY', tags: 'learning_problem,efficacy', dims: 'LP_SELF_EFFICACY',
      scene: '学生认为「我就是学不会」时', effect: '把成功归因从能力转向方法',
      steps: ['设计一个该学生必然能完成的最小任务', '完成后立刻问：「你觉得这次为什么做到了？」', '如果他答「运气好」或「题简单」，引导到具体方法上', '连续五次后回看，让他自己总结用过哪些方法'],
      script: '这次你先把题目读了两遍才动手，就是这一步让你没掉进坑里。',
      expect: '学生开始用方法解释成功', time: '15 分钟', cycle: '每周两次，连续三周', evidence: 'A',
      source: '归因理论在学业干预中的应用', indicator: '五次内出现方法归因', fail: '五次后仍归因于运气或难度',
      forbid: '不要用「你很聪明」这类能力归因来鼓励' },
    { code: 'LP_RX_007', name: '系统干预协同方案', short: '系统干预', form: 'framework', severity: 'crisis',
      at: 'LP_AT_COGNITION', tags: 'learning_problem,cognition,crisis', dims: 'LP_COGNITION',
      scene: '三个层面同时受阻，单一措施无效时', effect: '整合多方资源制定系统干预',
      steps: ['召集班主任、任课教师和家长做一次三方会商', '基于三层诊断结果确定一个主攻层面', '为每一方明确一项具体的支持动作和检查节点', '两周后复盘，只调整无效的那一项'],
      script: '我们这次不铺开做，只挑一个层面，两周后看效果再决定下一步。',
      expect: '形成一份三方共同承诺的干预计划', time: '60 分钟', cycle: '每两周复盘一次', evidence: 'B',
      source: '学习困难系统干预实务', indicator: '三方均有明确动作和时限',
      fail: '任一方无法承诺具体动作', forbid: '不要同时启动超过三项措施',
      contra: [['疑似存在学习障碍或注意力障碍', 'warn', '教育干预无法替代专业评估', '建议家长带孩子到专业机构做评估，教育支持同步进行']] }
  ],
  routes: [
    ['LP_KW_01', '成绩下滑,考砸了,退步', '越来越差,跟不上', '', 1, 'fuzzy', 'yellow', '学业下降', 'LP_THREE_LAYER', 'LP_RX_001', 0.85, '学业表现下降信号'],
    ['LP_KW_02', '不写作业,拖着不做,交不上', '作业总是不交,拖延', '', 2, 'fuzzy', 'yellow', '行为失序', 'LP_THREE_LAYER', 'LP_RX_001', 0.8, '学习行为失序信号'],
    ['LP_KW_03', '听不懂,学不会,不理解', '讲了也不会,一变就不会', '', 3, 'fuzzy', 'orange', '认知困难', 'LP_THREE_LAYER', 'LP_RX_002', 0.85, '认知层困难信号'],
    ['LP_KW_04', '不想学,没兴趣,懒得学', '不上心,提不起劲', '', 4, 'fuzzy', 'yellow', '动机不足', 'LP_MOTIVATION', 'LP_RX_005', 0.75, '学习动机不足信号'],
    ['LP_KW_05', '我就是学不会,笨,没救了', '再努力也没用,放弃了', '', 5, 'fuzzy', 'orange', '习得性无助', 'LP_MOTIVATION', 'LP_RX_006', 0.9, '习得性无助信号']
  ],
  templates: [
    ['LP3', 'summary', '本次诊断结果为 LP3 系统干预层级，主导因素是「${主要归因}」，同时「${次要归因}」也在起作用。这个层级不适合单点施力，建议整合教师、年级和家庭支持，一次只主攻一个层面。'],
    ['LP2', 'summary', '本次诊断结果为 LP2 深入诊断层级，主导因素落在「${主要归因}」。处理重点不是增加练习量，而是先结合课堂观察做交叉验证，确认卡点在哪一层。'],
    ['LP1', 'summary', '本次诊断结果为 LP1 教师自主支持层级，主导因素是「${主要归因}」。当前可由教师通过教学策略调整自主支持，从推荐工具中选一项本周试用并记录效果。']
  ]
}

export const MODULES = [selfGrowth, classSystem, homeSchool, studentCase, learningProblem]

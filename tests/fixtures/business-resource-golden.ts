import type { ModuleId } from '../../shared/contracts'

export const goldenModule: ModuleId = 'home_school'

export const goldenAssessmentPayload = {
  instruments: [{
    code: 'HS-GOLD-A1',
    instrumentCode: 'HS-GOLD-A1',
    version: '1.0.0',
    module: goldenModule,
    title: '家校沟通黄金样例量表',
    description: '用于验证三库导入质量链路的稳定样例',
    estimatedMinutes: 1,
    questions: [
      {
        id: 'q1',
        text: '最近一周家长沟通是否频繁且情绪化？',
        dimension: '沟通频率',
        options: [{ label: '很低', value: 1 }, { label: '一般', value: 3 }, { label: '很高', value: 5 }]
      },
      {
        id: 'q2',
        text: '沟通内容是否能聚焦事实和下一步？',
        dimension: '事实聚焦',
        options: [{ label: '不能', value: 1 }, { label: '部分能', value: 3 }, { label: '能够', value: 5 }]
      }
    ],
    scoring: {
      conflict: 'q1',
      clarity: 'q2'
    },
    // V2: 维度定义，消除校验警告
    dimensionDefs: [
      { code: 'communication', name: '沟通频率', questionIds: ['q1'], calcMethod: 'mean' as const },
      { code: 'clarity', name: '事实聚焦', questionIds: ['q2'], calcMethod: 'mean' as const }
    ]
  }]
}

export const goldenAttributionPayload = {
  module: goldenModule,
  version: '1.0.0',
  computed: { conflict: 'MAX(scores)' },
  branches: [{
    pri: 10,
    when: 'conflict >= 4',
    level: 'high',
    blocked: true,
    ruleId: 'hs-gold-high',
    primaryAttribution: '家校沟通冲突升级',
    secondaryAttributions: ['信息不同步'],
    reasons: ['冲突题项偏高，需要先降温再澄清。'],
    toolTags: ['home_school', 'conflict', 'script']
  }, {
    pri: 100,
    level: 'stable',
    blocked: false,
    ruleId: 'hs-gold-default',
    primaryAttribution: '沟通结构待澄清',
    secondaryAttributions: [],
    reasons: ['未命中高风险规则，进入常规维护。'],
    toolTags: ['home_school', 'stable']
  }],
  actions: [{
    title: '先完成事实澄清',
    detail: '记录争议事实、家长期待和下一次沟通时间。',
    status: 'pending'
  }],
  tools: [{
    title: '三步降温沟通卡',
    content: '接住情绪、澄清事实、约定下一步。'
  }],
  crisis: { when: 'conflict >= 5', blocked: true }
}

export const goldenToolPayload = {
  tools: [{
    code: 'HS-GOLD-T1',
    name: '三步降温沟通卡',
    form: '话术卡',
    symptoms: '家长情绪激烈但未触发安全红线',
    expectedEffect: '完成情绪降温、事实澄清和下一步约定',
    level: 'high',
    primaryAttribution: '家校沟通冲突升级',
    tags: ['家校沟通'],
    toolTags: ['home_school', 'conflict', 'script'],
    dimensions: ['事实聚焦'],
    duration: '1 次沟通内完成',
    timePerSession: '10 分钟',
    steps: ['接住情绪', '复述事实', '约定下一步'],
    // V2: 结构化步骤，消除校验警告
    structuredSteps: [
      { seq: 1, title: '接住情绪', description: '重复家长期待，表达理解而非认同' },
      { seq: 2, title: '复述事实', description: '只复述双方可核实的客观事实' },
      { seq: 3, title: '约定下一步', description: '明确下次沟通时间和形式' }
    ],
    contraindicationRules: [
      { condition: '家长已升级为公开投诉', type: 'block' as const, description: '已进入公开投诉渠道，不再适用降温沟通', alternativeSuggestion: '转介学校沟通专员或校长室' },
      { condition: '涉及学生安全事件', type: 'block' as const, description: '安全问题优先启动应急流程', alternativeSuggestion: '启动学校安全应急预案，同步通知分管领导和心理老师' }
    ],
    scripts: '我理解您现在很着急，我们先把事实核清楚。',
    prohibitions: '不要承诺未核实事项',
    targetUsers: '班主任'
  }]
}

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
    }
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
    blocked: false,
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
  }]
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
    scripts: '我理解您现在很着急，我们先把事实核清楚。',
    prohibitions: '不要承诺未核实事项',
    targetUsers: '班主任'
  }]
}

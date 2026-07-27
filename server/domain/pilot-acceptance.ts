export interface PilotAcceptanceInput {
  activationRate: number
  firstTaskRate: number
  planExecutionRate: number
  reviewRate: number
  assistantFailureRate: number
  crisisAckWithinSlaRate: number | null
  resourceCoverageRate: number
  resourceProjectionReadyRate: number
  planFeedbackCount: number
  attributionAccuracyAvg: number | null
  toolUsabilityAvg: number | null
  reportCompletenessRate: number
}

export interface PilotAcceptanceItem {
  key: string
  label: string
  value: number | null
  target: number
  direction: 'gte' | 'lte'
  status: 'pass' | 'watch' | 'fail'
  unit: 'ratio' | 'score' | 'count'
}

export function buildPilotAcceptance(input: PilotAcceptanceInput) {
  const items: PilotAcceptanceItem[] = [
    makeItem('activation', '账号激活率', input.activationRate, 0.8, 'gte', 'ratio'),
    makeItem('first_task', '10 分钟首任务率', input.firstTaskRate, 0.6, 'gte', 'ratio'),
    makeItem('resource_coverage', '三库发布覆盖率', input.resourceCoverageRate, 1, 'gte', 'ratio'),
    makeItem('resource_projection', '三库结构化就绪率', input.resourceProjectionReadyRate, 1, 'gte', 'ratio'),
    makeItem('report_completeness', '方案工作单完整率', input.reportCompletenessRate, 0.8, 'gte', 'ratio'),
    makeItem('plan_execution', '7 日方案执行率', input.planExecutionRate, 0.5, 'gte', 'ratio'),
    makeItem('review_rate', '7 日复盘率', input.reviewRate, 0.3, 'gte', 'ratio'),
    makeItem('feedback_count', '方案质量反馈数', input.planFeedbackCount, 5, 'gte', 'count'),
    makeItem('attribution_accuracy', '归因准确性均分', input.attributionAccuracyAvg, 3.5, 'gte', 'score'),
    makeItem('tool_usability', '工具可用性均分', input.toolUsabilityAvg, 3.5, 'gte', 'score'),
    makeItem('assistant_failure', 'AI 失败率', input.assistantFailureRate, 0.1, 'lte', 'ratio')
  ]

  if (input.crisisAckWithinSlaRate !== null) {
    items.push(makeItem('crisis_sla', '危机确认 SLA 达成率', input.crisisAckWithinSlaRate, 0.9, 'gte', 'ratio'))
  }

  const passed = items.filter(item => item.status === 'pass').length
  const failed = items.filter(item => item.status === 'fail').length
  return {
    status: failed === 0 && passed === items.length ? 'ready' : failed <= 2 ? 'watch' : 'not_ready',
    score: Math.round((passed / items.length) * 100),
    passed,
    total: items.length,
    items
  }
}

function makeItem(
  key: string,
  label: string,
  value: number | null,
  target: number,
  direction: 'gte' | 'lte',
  unit: PilotAcceptanceItem['unit']
): PilotAcceptanceItem {
  return {
    key,
    label,
    value,
    target,
    direction,
    unit,
    status: statusFor(value, target, direction)
  }
}

function statusFor(value: number | null, target: number, direction: 'gte' | 'lte') {
  if (value === null || Number.isNaN(value)) return 'watch'
  const pass = direction === 'gte' ? value >= target : value <= target
  if (pass) return 'pass'
  const watch = direction === 'gte' ? value >= target * 0.8 : value <= target * 1.5
  return watch ? 'watch' : 'fail'
}

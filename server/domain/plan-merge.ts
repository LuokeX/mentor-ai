/**
 * 多量表合并领域逻辑（纯函数，不依赖数据库）。
 *
 * 评估组内提交多张量表后，方案不应只保留第一张量表的内容：
 * 正文、归因报告、工具、行动项、复盘时间、资源版本都要重新合并。
 * 合并规则保持一致口径，可单测：
 * - 归因按提交顺序合并、按编码去重，主归因取组内首张量表的主归因；
 * - 严重度取组内最严重（安全导向），等级取最近一次评估结论；
 * - 维度并集取最大值（与严重度口径一致）；
 * - 工具/行动项按内容去重合并，复盘时间基于最后提交重新计算。
 */
import type { AttributionOutcome, RuleExecResult } from '../../shared/contracts'

const SEVERITY_RANK: Record<string, number> = { crisis: 4, high: 3, medium: 2, low: 1 }

export function severityRank(severity?: string): number {
  return severity ? SEVERITY_RANK[severity] ?? 0 : 0
}

/** 比较两个严重度，返回更严重的一方；相同返回后者（较新的评估）。 */
export function worseSeverity(a?: string, b?: string): string | undefined {
  return severityRank(b) >= severityRank(a) ? b : a
}

/** 归因按提交顺序合并、按 code 去重（保留首次出现的项，即更早提交的量表优先）。 */
export function mergeAttributions(groups: Array<AttributionOutcome[]>): AttributionOutcome[] {
  const seen = new Set<string>()
  const merged: AttributionOutcome[] = []
  for (const group of groups) {
    for (const attribution of group) {
      if (!attribution || seen.has(attribution.code)) continue
      seen.add(attribution.code)
      merged.push(attribution)
    }
  }
  return merged
}

/** 工具按编码去重（无编码回退到标题），保留先提交的工具正文。 */
export function mergeTools<T extends { title: string, content: string, code?: string }>(groups: Array<Array<T>>): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (const group of groups) {
    for (const tool of group) {
      const key = tool.code?.trim() || tool.title.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      merged.push(tool)
    }
  }
  return merged
}

/** 行动项按 标题+正文 去重合并，保持提交顺序。 */
export function mergeActions<T extends { title: string, detail: string }>(groups: Array<Array<T>>): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (const group of groups) {
    for (const action of group) {
      const key = `${action.title}\u0000${action.detail}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(action)
    }
  }
  return merged
}

function mergeUnique(values: string[]): string[] {
  return [...new Set(values.map(item => item?.trim()).filter(Boolean))]
}

/**
 * 合并评估组内多张量表的执行结果。
 * 传入组内按提交顺序排列的非 blocked 结果；空数组返回 null。
 */
export function mergeGroupResults(results: RuleExecResult[]): RuleExecResult | null {
  const valid = results.filter(result => result && !result.blocked)
  if (!valid.length) return null

  const last = valid[valid.length - 1]!
  const dimensions: Record<string, number> = {}
  const dimensionLabels: Record<string, string> = {}
  for (const result of valid) {
    for (const [code, score] of Object.entries(result.dimensions || {})) {
      dimensions[code] = Math.max(dimensions[code] ?? Number.NEGATIVE_INFINITY, score)
    }
    Object.assign(dimensionLabels, result.dimensionLabels || {})
  }
  const attributions = mergeAttributions(valid.map(result => result.attributions || []))
  const matchedRedLines = mergeUnique(valid.flatMap(result => (result.matchedRedLines || []).map(line => line.condition)))
    .map(condition => valid.flatMap(result => result.matchedRedLines || []).find(line => line.condition === condition))
    .filter((line): line is NonNullable<RuleExecResult['matchedRedLines']>[number] => Boolean(line))

  // 严重度取组内最严重；worseSeverity 返回 string | undefined，此处用循环保持类型收窄
  let severity = valid[0]!.severity
  for (const item of valid) {
    const worse = worseSeverity(severity, item.severity)
    if (worse && severityRank(worse) > severityRank(severity)) severity = worse as RuleExecResult['severity']
  }

  return {
    level: last.level,
    levelName: last.levelName,
    severity,
    reasons: mergeUnique(valid.flatMap(result => result.reasons)),
    blocked: false,
    matchedRuleIds: mergeUnique(valid.flatMap(result => result.matchedRuleIds)),
    attributions,
    primaryAttribution: attributions[0]?.name || last.primaryAttribution,
    secondaryAttributions: attributions.slice(1)
      .filter(attribution => attribution.strength !== 'reference')
      .map(attribution => attribution.name),
    toolTags: mergeUnique(valid.flatMap(result => result.toolTags)),
    computedValues: Object.assign({}, ...valid.map(result => result.computedValues || {})),
    unavailableVariables: mergeUnique(valid.flatMap(result => result.unavailableVariables)),
    dimensions,
    dimensionLabels,
    actions: mergeActions(valid.map(result => result.actions || [])),
    tools: mergeTools(valid.map(result => result.tools || [])),
    escalationTarget: last.escalationTarget,
    interventionToolCodes: mergeUnique(valid.flatMap(result => result.interventionToolCodes || [])),
    matchedRedLines
  }
}
/**
 * 「状态良好，无需方案」判定。
 *
 * 评估结论为绿色并不总是意味着不用出方案：student_case 的「紫色-待观察」、
 * home_school 的「A级」都是绿色级别但带观察或干预动作，仍需生成方案。
 * 只有命中各模块的绿色兜底规则（优先级 999 的 *_GR_DEFAULT）且没有任何
 * 归因、行动时，才认为本次评估「没问题」，跳过方案生成。
 *
 * 注意不检查 tools：工具是工具库按等级/维度加权匹配的结果，绿色状态下
 * 也会匹配到通用放松类工具（如 SG_RX_01~05），与「是否有问题」无关。
 */
import type { ModuleId, RuleExecResult } from '../../shared/contracts'

/** 各模块的绿色兜底规则 id（优先级 999 的那条，语义为「状态良好/无明显信号」）。 */
const NO_PLAN_RULE_IDS: Record<ModuleId, string> = {
  self_growth: 'SG_GR_DEFAULT',
  class_system: 'CS_GR_DEFAULT',
  home_school: 'HS_GR_DEFAULT',
  student_case: 'SC_GR_DEFAULT',
  learning_problem: 'LP_GR_DEFAULT'
}

/**
 * 判定评估结果是否需要跳过方案生成。
 * 全部满足才返回 true：非熔断、绿色级别、无归因、无行动，
 * 且命中的分级规则只包含本模块的绿色兜底规则。
 */
export function isNoPlanNeeded(result: RuleExecResult, module: ModuleId): boolean {
  if (result.blocked) return false
  if (result.level !== 'green') return false
  if (result.attributions.length > 0) return false
  if (result.actions.length > 0) return false
  const defaultRule = NO_PLAN_RULE_IDS[module]
  if (!defaultRule) return false
  return result.matchedRuleIds.every(id => id === defaultRule)
}
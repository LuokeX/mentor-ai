/**
 * 方案动作展示层合并的「读取上下文」解析。
 *
 * 方案页的动作展示走 `mergePlanActionDisplay`：把工具并进带出它的动作（归因条 / 等级
 * 干预条），并把可执行条目截断到 `MAX_EXECUTABLE_PLAN_ACTIONS`。该合并依赖两样读取时
 * 才能拿到的数据：
 *   1. 工具归属：生成方案时已记进 `plans.tools`（`sourceChannel` + 归因编码/名称），
 *      读取时直接消费；只有老方案（没有标记）或 AI 依据知识片段生成的新工具才回退到
 *      工具库 attributionLabel 反查——这一通道以前是唯一来源，保留只为兼容历史数据。
 *   2. 归因顺序：报告 attributions 已按占比降序，用于归因行排序与截断。
 *
 * 这里把两者抽成共享函数，供两处复用，保证「教师看到的动作」与「验收时要求决策
 * 的动作」是同一套规则：
 *   - 方案详情读取（`server/api/v1/plans/[id].get.ts]`）；
 *   - 方案接受/拒绝校验（`server/api/v1/plans/[id]/acceptance.patch.ts`）。
 *
 * 否则会出现「被并入归因条的工具行、被截断隐藏的归因行」在页面上看不到、却因为
 * 仍是 pending 而卡住「确认并执行」的问题。
 */
import type { H3Event } from 'h3'
import { moduleIdSchema } from '../../shared/contracts'
import { listPublishedModuleTools } from './module-resources'
import {
  MAX_EXECUTABLE_PLAN_ACTIONS,
  TOOL_ACTION_PREFIX,
  mergePlanActionDisplay,
  splitAttributionLabels,
  toolTitleOf,
  type PlanActionDisplayAction,
  type PlanToolPlacement
} from './plan-action-display'

/**
 * 解析工具名 → 归因名数组的绑定（回退通道，仅用于没有来源标记的工具）。
 * 解析失败（未发布工具库、模块值异常、库读取报错）返回空 Map，调用方据此把工具行
 * 按「无归属」单独展示，不静默吞掉。
 */
export async function resolvePlanToolAttributionBinding(
  event: H3Event,
  module: string | null | undefined,
  schoolId: string
): Promise<Map<string, string[]>> {
  const parsedModule = moduleIdSchema.safeParse(module)
  if (!parsedModule.success) return new Map()
  try {
    const { tools } = await listPublishedModuleTools(event, parsedModule.data, schoolId)
    const binding = new Map<string, string[]>()
    for (const tool of tools as Array<{ name?: string, title?: string, attributionLabel?: string }>) {
      const title = String(tool.name || tool.title || '').trim()
      const labels = splitAttributionLabels(tool.attributionLabel)
      if (title && labels.length) binding.set(title, labels)
    }
    return binding
  } catch {
    return new Map()
  }
}

/** 报告归因顺序（report.attributions 名称，已按占比降序）。 */
export function resolvePlanAttributionOrder(report: unknown): string[] {
  const attributions = (report as { attributions?: Array<{ name?: string }> } | null)?.attributions || []
  return attributions.map(item => String(item.name || '').trim()).filter(Boolean)
}

/**
 * 从方案快照 `plans.tools` 读生成时记录的工具归属：
 *   - `sourceChannel: 'intervention'`（⑤e 等级直选）→ 并进等级干预条；
 *   - `sourceChannel: 'attribution'` 且带 `attributionName` → 并进该归因条；
 *   - 其余（老方案、AI 生成的新工具、归因名缺失）不产生条目，交给回退解析。
 */
export function buildPlanToolPlacement(planTools: unknown): Map<string, PlanToolPlacement> {
  const placement = new Map<string, PlanToolPlacement>()
  const list = Array.isArray(planTools) ? planTools : []
  for (const item of list as Array<Record<string, unknown>>) {
    const title = String(item?.title || item?.name || '').trim()
    if (!title) continue
    if (item.sourceChannel === 'intervention') {
      placement.set(title, { channel: 'intervention' })
      continue
    }
    if (item.sourceChannel === 'attribution') {
      const attributionName = String(item.attributionName || '').trim()
      if (attributionName) placement.set(title, { channel: 'attribution', attributionName })
    }
  }
  return placement
}

/**
 * 组装方案页与验收校验共用的工具归属：生成时记录优先；只有「方案里确实存在、但记录里
 * 没有」的工具才回查工具库（老方案回退），方案里没有工具行时不做多余查询。
 */
export async function resolvePlanToolPlacementBinding(
  event: H3Event,
  input: {
    module: string | null | undefined
    schoolId: string
    /** 方案里实际存在的「使用工具」行标题 */
    toolTitles: string[]
    /** 方案快照 plans.tools */
    planTools?: unknown
  }
): Promise<{ placement: Map<string, PlanToolPlacement>, fallbackBinding: Map<string, string[]> }> {
  const placement = buildPlanToolPlacement(input.planTools)
  const needsFallback = input.toolTitles.some(title => Boolean(title) && !placement.has(title))
  if (!needsFallback) return { placement, fallbackBinding: new Map() }
  const fallbackBinding = await resolvePlanToolAttributionBinding(event, input.module, input.schoolId)
  return { placement, fallbackBinding }
}

/**
 * 计算方案动作的「可决策展示集」：与方案详情读取层走同一套合并/截断规则，返回教师
 * 实际能在方案页确认的行动 ID。接受的校验只应要求这些动作已决策——被并入归因条的工具行、
 * 超出展示上限被隐藏的归因行不单独要求教师决策。
 */
export async function resolveDecidablePlanActionIds(
  event: H3Event,
  input: {
    module: string | null | undefined
    schoolId: string
    report: unknown
    actions: Array<{ id: string, title: string, detail?: string | null }>
    /** 方案快照 plans.tools：生成时记录的工具归属 */
    tools?: unknown
  }
): Promise<Set<string>> {
  const toolTitles = input.actions
    .filter(action => action.title.startsWith(TOOL_ACTION_PREFIX))
    .map(action => toolTitleOf(action.title))
  const { placement, fallbackBinding } = await resolvePlanToolPlacementBinding(event, {
    module: input.module,
    schoolId: input.schoolId,
    toolTitles,
    planTools: input.tools
  })
  const attributionOrder = resolvePlanAttributionOrder(input.report)
  const displayed = mergePlanActionDisplay(
    input.actions as unknown as PlanActionDisplayAction[],
    placement,
    attributionOrder,
    MAX_EXECUTABLE_PLAN_ACTIONS,
    fallbackBinding
  )
  return new Set(displayed.map(action => action.id))
}

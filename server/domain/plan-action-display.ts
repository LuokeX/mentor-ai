/**
 * 方案详情页展示层的「归因 + 工具」合并视图（读取时投影，不写库）。
 *
 * 背景：方案动作由三块独立拼装——归因通道（「针对「归因」」）、等级干预通道
 * （「按「等级」干预」）、工具匹配通道（「使用工具「工具」」）。业务反馈「针对
 * 归因」与「使用工具」名称割裂、让老师困惑，要求把工具步骤并进带出它的那条动作，
 * 并且可执行条目（归因 + 等级干预）最多保留 3 条。
 *
 * 工具归属的来源（本文件只消费，不解析）：
 *   - 生成方案时写进 `plans.tools` 的 `sourceChannel`：归因加权匹配带出的记
 *     `attribution` + 归因编码/名称，⑤e 等级直选带出的记 `intervention`；
 *   - 读取层据此构造 `Map<工具名, PlanToolPlacement>`（见 plan-action-display-context），
 *     本文件不做任何网络/数据库调用，纯函数便于单测；
 *   - 老方案与 AI 依据知识片段生成的新工具没有标记，由调用方用工具库
 *     attributionLabel 反查后以 fallbackBinding 传入，行为与改造前一致。
 *
 * 实现约定：
 *   - 一个工具只并进一处：归因带出的进「针对「归因」」条，等级直选带出的进第一条
 *     「按「等级」干预」条；同一工具重复落库时按标题去重，只保留首次正文。
 *   - 目标归因行不存在或被 3 条上限截断时，该工具随行隐藏（不单独展示）；
 *     ⑤e 只配工具没配等级干预动作时，降级为独立「使用工具」行，不丢正文。
 *   - 不删底层 plan_actions 行：仅在返回给前端的展示向量里，把「使用工具」行
 *     的正文并入目标行（附加 mergedTools 数组），并移除独立的「使用工具」行。
 *   - 截断只作用于「可执行条目」（归因行 + 等级干预行）：等级干预优先保留，
 *     归因行按占比降序填满剩余名额，超出的归因行丢弃；深度诊断待办与手动新增
 *     是跳转/补充性质，不参与 3 条名额。
 *   - 单条动作（归因条 / 等级干预条）下并入的配套工具最多 `MAX_TOOLS_PER_ACTION` 条
 *     （默认 2），按生成时的优先级顺序保留前几条；超出的工具随行隐藏，与归因行被
 *     截断时的处理一致。
 *   - 降级：无归属标记且回退解析也匹配不上时，保持「使用工具」行原样单独展示，
 *     不静默吞掉。
 */

export type PlanActionDisplayAction = {
  id: string
  sequence: number
  title: string
  detail: string
  decision: 'pending' | 'included' | 'rejected'
  status: string
  dueAt: string | null
  completedAt: string | null
  executedAt: string | null
  executionNote: string | null
  startedAt?: string | null
  blockedAt?: string | null
  blockReason?: string | null
  blockNote?: string | null
  evidenceType?: string | null
  evidenceSummary?: string | null
  teacherConfidence?: number | null
  kind?: string | null
  instrumentCode?: string | null
  mergedTools?: Array<{ title: string, content: string }>
  [key: string]: unknown
}

/** 工具动作标题口径（与 plan-actions.toToolActions / toolActionTitle 一致）。 */
export const TOOL_ACTION_PREFIX = '使用工具「'
const ATTRIBUTION_ACTION_PREFIX = '针对「'
const INTERVENTION_ACTION_PREFIX = '按「'
/** 深度诊断待办标题（与 plan-session suggestionAction 一致）。 */
const INSTRUMENT_SUGGESTION_PREFIX = '建议完成深度诊断「'

function isToolAction(title: string): boolean {
  return title.startsWith(TOOL_ACTION_PREFIX)
}
function isAttributionAction(title: string): boolean {
  return title.startsWith(ATTRIBUTION_ACTION_PREFIX)
}
function isInterventionAction(title: string): boolean {
  return title.startsWith(INTERVENTION_ACTION_PREFIX)
}
function isInstrumentSuggestion(title: string): boolean {
  return title.startsWith(INSTRUMENT_SUGGESTION_PREFIX)
}

/** 从「使用工具「X」」标题里取出工具名 X。 */
export function toolTitleOf(actionTitle: string): string {
  return actionTitle.slice(TOOL_ACTION_PREFIX.length, -1).trim() || actionTitle.trim()
}
/** 从「针对「Y」」标题里取出归因名 Y。 */
function attributionNameOf(actionTitle: string): string {
  return actionTitle.slice(ATTRIBUTION_ACTION_PREFIX.length, -1).trim() || actionTitle.trim()
}

/** 可执行条目（归因 + 等级干预）在方案页的展示上限。 */
export const MAX_EXECUTABLE_PLAN_ACTIONS = 3

/**
 * 单个动作下最多并入的「配套工具」数量。
 *
 * 生成阶段一条归因可能带出多条工具（归因加权匹配按得分降序取，最多 MAX_MATCHED_TOOLS 条），
 * 等级干预通道也可能一次配置多个直选工具；全量并入会让老师的「针对「某归因」」条或
 * 「按「某等级」干预」条正文过长。展示时只保留优先级最高的前 N 条，其余随行隐藏
 * （不单独展示），与归因行被 3 条上限截断时的处理保持一致。
 */
export const MAX_TOOLS_PER_ACTION = 2

/**
 * 一个工具可服务多个归因，工具库的 attributionLabel 是「;」「，」等分隔的多值清单
 * （如「意义感流失;效能感不足」）。这里统一拆成去重后的归因名数组，供绑定匹配。
 */
export function splitAttributionLabels(label: unknown): string[] {
  const names = String(label || '')
    .split(/[;；,，、/|]+/)
    .map(item => item.trim())
    .filter(Boolean)
  return [...new Set(names)]
}

/**
 * 工具在方案页的归属（生成时记录在 plans.tools，读取时直接消费）。
 *   - attribution：由这条归因带出，并进「针对「归因」」条；
 *   - intervention：等级直选带出，并进「按「等级」干预」条。
 */
export type PlanToolPlacement =
  | { channel: 'attribution', attributionName: string }
  | { channel: 'intervention' }

/**
 * 合并「使用工具」行到带出它的动作，并截断可执行条目。
 * @param actions       读取层解密后的动作展示数组
 * @param placement     工具名（title） → 生成时记录的归属（plans.tools 的 sourceChannel）
 * @param attributionOrder 归因名按占比降序，用于归因行排序与截断
 * @param maxExecutable 可执行条目上限，默认 3
 * @param fallbackBinding 无归属标记的工具（老方案 / AI 生成的新工具）回退用的
 *                        工具名 → 归因名数组（工具库 attributionLabel 解析结果）
 * @param maxToolsPerAction 单个动作下并入的配套工具上限，默认 2
 */
export function mergePlanActionDisplay(
  actions: PlanActionDisplayAction[],
  placement: Map<string, PlanToolPlacement>,
  attributionOrder: string[],
  maxExecutable = MAX_EXECUTABLE_PLAN_ACTIONS,
  fallbackBinding: Map<string, string[]> = new Map(),
  maxToolsPerAction = MAX_TOOLS_PER_ACTION
): PlanActionDisplayAction[] {
  const output: PlanActionDisplayAction[] = []

  // 方案里出现的归因名（按动作顺序 = 报告归因占比降序），决定回退工具并入哪一条。
  const existingAttributions = actions
    .filter(action => isAttributionAction(action.title))
    .map(action => attributionNameOf(action.title))
  const hasInterventionAction = actions.some(action => isInterventionAction(action.title))

  // 工具行按标题去重：同一工具可能被重复落库（快照与工具匹配各插一次），
  // 展示时只保留首次出现的正文，避免「配套工具」重复列同一工具。
  const toolByTitle = new Map<string, { title: string, content: string }>()
  for (const action of actions) {
    if (!isToolAction(action.title)) continue
    const toolTitle = toolTitleOf(action.title)
    if (toolByTitle.has(toolTitle)) continue
    toolByTitle.set(toolTitle, { title: toolTitle, content: action.detail || '' })
  }

  // 按生成时记录的归属分组：归因带出的进归因组，等级直选带出的进等级组。
  // 没有归属标记的工具（老方案 / AI 生成的新工具）回退到工具库绑定：并进「它自己声明
  // 优先、且方案里确实存在」的第一条归因。一个工具只挂一处，避免重复展示。
  const toolsByAttribution = new Map<string, Array<{ title: string, content: string }>>()
  const interventionTools: Array<{ title: string, content: string }> = []
  const absorbedToolTitles = new Set<string>()
  for (const [toolTitle, tool] of toolByTitle) {
    const assigned = placement.get(toolTitle)
    if (assigned?.channel === 'attribution') {
      // 目标归因行不存在或被 3 条上限截断时，该工具随行隐藏（仍算已归属，不单独展示）。
      absorbedToolTitles.add(toolTitle)
      const list = toolsByAttribution.get(assigned.attributionName) || []
      list.push(tool)
      toolsByAttribution.set(assigned.attributionName, list)
      continue
    }
    if (assigned?.channel === 'intervention') {
      // ⑤e 允许只配工具不配动作：没有等级干预行可挂时降级为独立工具行，不丢正文。
      if (!hasInterventionAction) continue
      absorbedToolTitles.add(toolTitle)
      interventionTools.push(tool)
      continue
    }
    const target = (fallbackBinding.get(toolTitle) || []).find(name => existingAttributions.includes(name))
    if (!target) continue
    absorbedToolTitles.add(toolTitle)
    const list = toolsByAttribution.get(target) || []
    list.push(tool)
    toolsByAttribution.set(target, list)
  }

  // 构造合并后的展示向量，并按可执行/非可执行分组。
  const executables: PlanActionDisplayAction[] = []
  const nonExecutables: PlanActionDisplayAction[] = []
  const orphanTools: PlanActionDisplayAction[] = []
  const emittedOrphanTitles = new Set<string>()
  let interventionAttached = false
  for (const action of actions) {
    if (isToolAction(action.title)) {
      const toolTitle = toolTitleOf(action.title)
      // 已并入目标行的工具行：跳过；无归属的工具行去重后保留原样单独展示（降级）。
      if (absorbedToolTitles.has(toolTitle) || emittedOrphanTitles.has(toolTitle)) continue
      emittedOrphanTitles.add(toolTitle)
      orphanTools.push(action)
      continue
    }
    if (isAttributionAction(action.title)) {
      // 单条动作下只并入优先级最高的前 N 条工具；超出的工具随行隐藏（已是已归属工具，
      // 不降级为独立「使用工具」行）。
      const tools = (toolsByAttribution.get(attributionNameOf(action.title)) || [])
        .slice(0, maxToolsPerAction)
      const merged: PlanActionDisplayAction = tools.length
        ? { ...action, mergedTools: tools }
        : action
      executables.push(merged)
      continue
    }
    if (isInterventionAction(action.title)) {
      // 等级直选工具并进第一条等级干预行（等级干预可能有同名多条）；
      // 同样只保留优先级最高的前 N 条，超出部分随行隐藏。
      if (!interventionAttached && interventionTools.length) {
        interventionAttached = true
        executables.push({ ...action, mergedTools: interventionTools.slice(0, maxToolsPerAction) })
      } else {
        executables.push(action)
      }
      continue
    }
    nonExecutables.push(action)
  }

  // 截断：等级干预优先，其余归因行按占比降序填满剩余名额。
  const interventions = executables.filter(action => isInterventionAction(action.title))
  const attributions = executables.filter(action => isAttributionAction(action.title))
  const orderIndex = new Map(attributionOrder.map((name, index) => [name, index]))
  attributions.sort((a, b) => {
    const ia = orderIndex.get(attributionNameOf(a.title)) ?? Number.MAX_SAFE_INTEGER
    const ib = orderIndex.get(attributionNameOf(b.title)) ?? Number.MAX_SAFE_INTEGER
    return ia - ib
  })
  const kept: PlanActionDisplayAction[] = []
  for (const action of interventions) {
    if (kept.length >= maxExecutable) break
    kept.push(action)
  }
  for (const action of attributions) {
    if (kept.length >= maxExecutable) break
    kept.push(action)
  }

  output.push(...kept)
  // 降级的工具行保持原样，放在可执行条目之后；非可执行（待办/手动新增）最后。
  output.push(...orphanTools)
  output.push(...nonExecutables)
  return output
}

/**
 * 业务填写向导的「代入试算」——v4 模板 ⑪ 全链路推演算例的交互化。
 *
 * v4 让业务填完 Excel 后自己代入一组示例作答走一遍完整计算，
 * 验证「作答 → 归因加权 → 分级 → 方案输出」链路数值正确。
 * 向导把这一步搬进第 9 步：业务给每张量表的每个维度设一个 1..5 的强度，
 * 模拟器走与运行期完全相同的管道（编译 → 解析 → 规则引擎）算出结果，
 * 保证「在这里看到什么，上线后就是什么」。
 *
 * 两层输入：
 *   1. 维度强度（answers）：维度内所有题取同一强度，逐题填 20+ 题不现实；
 *   2. 逐题覆盖（perQuestion）：单独改某道题的选项分值，覆盖维度强度。
 *      用于验证「条件引用第 N 题」「反向题混排」这类维度粒度验证不到的场景。
 *
 * 跨量表联动：量表按前置关系拓扑排序逐个计算，前面的作答折算成 priors
 * （与线上 buildInstrumentOptions 的 toPriorResults 同一套规则），
 * 后续量表的计算变量、触发条件（PRIOR_*）因此能在试算里真实算出。
 */
import type { WizardInput } from '../../shared/business-wizard'
import type { AssessmentDefinition } from '../../shared/assessments'
import { attributionConfigSchema } from '../../shared/contracts'
import type { RuleConfig, RuleExecResult } from '../../shared/contracts'
import { compileWizardInput } from './business-wizard-compile'
import { parseModuleResourceFile } from './module-resource-file-import'
import { executeRules, evaluateTriggerCondition, type PriorAssessmentResult } from './rules-executor'

/** 模拟作答：量表名 → 维度名 → 1..5 强度（维度内所有题取同一强度，逐题填 20+ 题不现实） */
export type SimulateAnswers = Record<string, Record<string, number>>

/** 逐题覆盖：量表名 → 题号(qN) → 选项原始分值。覆盖维度强度，未覆盖的题仍按维度强度展开。 */
export type SimulatePerQuestion = Record<string, Record<string, number>>

export interface SimulateRunOptions {
  /** 逐题覆盖（可选），key 为编译产物里的题号 q1..qn */
  perQuestion?: SimulatePerQuestion
}

export interface SimulateScaleResult {
  /** 量表中文名，业务输入的原名 */
  name: string
  /** 编译生成的量表编码 */
  code: string
  /** 命中等级中文名（⑥ 分级的「等级中文名」） */
  levelName: string
  /** 严重度（危机/高/中/低），人话展示用 */
  severityLabel: string
  /** 是否触发红线（熔断） */
  redLine: boolean
  /** 红线处置要求（⑥「处置要求」），触发时展示 */
  redLineAction?: string
  /** 主要归因中文名 */
  primaryAttribution: string
  /** 全部命中归因（按权重降序） */
  attributions: Array<{ name: string, share: number, strength: 'primary' | 'secondary' | 'reference', reasons: string[] }>
  /** 命中归因上的工具标签（⑦ 工具按它匹配） */
  toolTags: string[]
  /** 本次作答算不出的计算变量（引用了其他量表的数据），不影响结果但相关规则不命中 */
  unavailableVariables: string[]
  /**
   * 触发条件评估（非入口量表）：按「已算出的前置量表作答」判断这张表要不要做。
   * 入口量表或未设触发条件时为 null。
   */
  trigger: { met: boolean, error?: string } | null
  /** 计算变量实算值（本次作答能算出的），供前端展示「变量名 = 值」 */
  computedValues: Record<string, number>
  /** 因「引用的量表没作答」而算不出的计算变量名（前端提示给对应量表补作答） */
  missingAnswerScales: string[]
  /** 单量表试算失败（如引用错配），展示原因而不是让整个请求失败 */
  error?: string
}

export interface SimulateRunResult {
  scales: SimulateScaleResult[]
}

/** 强度 1..5 → 该题选项集合里的实际分值（选项从 0 或 1 开始都适用） */
function intensityToRaw(intensity: number, options: Array<{ value: number }>): number {
  if (options.length <= 1) return options[0]?.value ?? intensity
  const idx = Math.round(((Math.min(5, Math.max(1, intensity)) - 1) / 4) * (options.length - 1))
  return options[Math.min(idx, options.length - 1)]!.value
}

/** 题目维度编码 → 中文名（simAnswers 的 key 是业务填的中文名）。V1 数据里维度即中文名，原样返回。 */
function dimensionName(definition: AssessmentDefinition, dimCode: string): string {
  const def = definition.dimensionDefs?.find(d => d.code === dimCode || d.name === dimCode)
  return def ? def.name : dimCode
}

/** 量表按前置关系拓扑排序（DFS，visited 先标记防循环依赖）：入口筛查最先，深度量表在其前置之后。 */
function topoSortScales(scales: WizardInput['scales']): WizardInput['scales'] {
  const named = scales.filter(s => s.name)
  const visited = new Set<string>()
  const order: WizardInput['scales'] = []
  const visit = (s: WizardInput['scales'][number]) => {
    if (visited.has(s.name)) return
    visited.add(s.name)
    for (const pre of s.prerequisites || []) {
      const p = named.find(x => x.name === pre)
      if (p) visit(p)
    }
    order.push(s)
  }
  for (const s of named) visit(s)
  return order
}

/** 逐题展开：覆盖值优先，其次维度强度映射，最后默认中间强度 3。 */
function expandAnswers(
  definition: AssessmentDefinition,
  scaleName: string,
  answers: SimulateAnswers,
  perQuestion?: SimulatePerQuestion
): Record<string, number> {
  const intensityByDim = answers[scaleName] ?? {}
  const overrides = perQuestion?.[scaleName] ?? {}
  const out: Record<string, number> = {}
  for (const q of definition.questions) {
    const override = overrides[q.id]
    if (override !== undefined) {
      out[q.id] = override
      continue
    }
    const dim = dimensionName(definition, q.dimension)
    const intensity = intensityByDim[dim] ?? 3
    out[q.id] = intensityToRaw(intensity, q.options)
  }
  return out
}

/** 把本次模拟作答折算成后续量表的 priors——与线上 buildInstrumentOptions 的 toPriorResults 同一套折算规则。 */
function toPriorResult(
  definition: AssessmentDefinition,
  perQuestion: Record<string, number>,
  result: RuleExecResult
): PriorAssessmentResult {
  const scores: Record<string, number> = {}
  for (const question of definition.questions) {
    const raw = Number(perQuestion[question.id] ?? NaN)
    if (!Number.isFinite(raw)) continue
    const values = (question.options || []).map(option => option.value)
    scores[question.id] = question.reverse && values.length
      ? Math.min(...values) + Math.max(...values) - raw
      : raw
  }
  const list = Object.values(scores)
  const sum = list.reduce((total, value) => total + value, 0)
  return {
    level: result.level ?? null,
    severity: result.severity ?? null,
    dimensions: result.dimensions ?? {},
    scores,
    sum,
    avg: list.length ? Number((sum / list.length).toFixed(4)) : 0
  }
}

/** 非入口量表：按已算出的前置量表结果评估触发条件（用编译产物里的表达式，与线上同源）。 */
function evaluateScaleTrigger(
  definition: AssessmentDefinition,
  priors: Record<string, PriorAssessmentResult>
): { met: boolean, error?: string } | null {
  const condition = definition.triggerCondition?.trim()
  if (definition.instrumentRole === 'screening' || !condition) return null
  const ev = evaluateTriggerCondition(condition, priors)
  return { met: ev.met, error: ev.error }
}

/**
 * 哪些 unavailable 计算变量是因为「它引用的量表没作答」而算不出。
 * 计算变量是模块级的，挂在量表 A 上的变量只有在执行 A 时才可能算出：
 *   1. 向导表达式里显式写了 量表[...] 跨表引用（手工导入的库里可能带，向导表单不支持）；
 *   2. 变量挂载的量表本次没有作答——它在别的量表上执行必然算不出。
 * 返回变量名（去重），前端提示「给对应量表设定作答后可算出」。
 */
function missingAnswerVariables(
  input: WizardInput,
  unavailableVariables: string[],
  answers: SimulateAnswers,
  perQuestion: SimulatePerQuestion | undefined,
  currentScale: string
): string[] {
  if (!unavailableVariables.length) return []
  const answered = new Set([...Object.keys(answers), ...Object.keys(perQuestion || {}), currentScale])
  const missing = new Set<string>()
  for (const v of input.computedVariables || []) {
    if (!unavailableVariables.includes(v.name)) continue
    for (const m of String(v.expression || '').matchAll(/量表\s*\[\s*([^\]]+?)\s*\]/g)) {
      const name = m[1]!.trim()
      if (name && !answered.has(name)) missing.add(v.name)
    }
    if (v.scale && !answered.has(v.scale)) missing.add(v.name)
  }
  return [...missing]
}

export function simulateWizardRun(
  input: WizardInput,
  answers: SimulateAnswers,
  opts: SimulateRunOptions = {}
): SimulateRunResult {
  const compiled = compileWizardInput(input)
  const libs = new Map(compiled.libraries.map(lib => [lib.libraryType, lib]))
  const assessmentLib = libs.get('assessment')
  const attributionLib = libs.get('attribution')
  if (!assessmentLib || !attributionLib) {
    throw new Error('编译结果缺少量表库或归因库，无法试算')
  }

  const assessmentPayload = parseModuleResourceFile({
    module: input.module,
    libraryType: 'assessment',
    filename: 'assessment.xlsx',
    contentBase64: assessmentLib.buffer.toString('base64')
  })
  const instruments = (assessmentPayload.instruments ?? []) as AssessmentDefinition[]

  const attributionPayload = parseModuleResourceFile({
    module: input.module,
    libraryType: 'attribution',
    filename: 'attribution.xlsx',
    contentBase64: attributionLib.buffer.toString('base64')
  })
  const parsedConfig = attributionConfigSchema.safeParse(attributionPayload)
  if (!parsedConfig.success) {
    throw new Error(`归因库结构无效，无法试算：${parsedConfig.error.issues[0]?.message || '未知错误'}`)
  }
  const config = parsedConfig.data as unknown as RuleConfig

  // 跨量表联动：按前置链排序逐个计算，前面的作答折算成 priors 喂给后续量表
  const ordered = topoSortScales(input.scales)
  const priors: Record<string, PriorAssessmentResult> = {}
  const scales: SimulateScaleResult[] = []
  for (const scale of ordered) {
    const definition = instruments.find(i => i.title === scale.name)
    if (!definition) {
      scales.push({
        name: scale.name, code: '', levelName: '', severityLabel: '', redLine: false,
        primaryAttribution: '', attributions: [], toolTags: [], unavailableVariables: [],
        trigger: null, computedValues: {}, missingAnswerScales: [],
        error: `找不到量表《${scale.name}》的解析结果`
      })
      continue
    }

    const perQuestion = expandAnswers(definition, scale.name, answers, opts.perQuestion)
    const trigger = evaluateScaleTrigger(definition, priors)

    try {
      const result = executeRules(config, perQuestion, definition, {}, priors)
      // 折算成本次作答的 prior，供依赖这张量表的后续量表使用
      priors[definition.instrumentCode || definition.code] = toPriorResult(definition, perQuestion, result)
      const severityLabel: Record<string, string> = {
        crisis: '危机', high: '高', medium: '中', low: '低'
      }
      scales.push({
        name: scale.name,
        code: definition.instrumentCode || definition.code,
        levelName: result.levelName || result.level,
        severityLabel: severityLabel[result.severity] || result.severity,
        redLine: result.blocked,
        redLineAction: result.blocked ? (config.redLines?.find(r => r.condition)?.requiredActions || '') : undefined,
        primaryAttribution: result.primaryAttribution,
        attributions: result.attributions.map(a => ({
          name: a.name, share: a.share, strength: a.strength, reasons: a.reasons
        })),
        toolTags: result.toolTags,
        unavailableVariables: result.unavailableVariables,
        trigger,
        computedValues: result.computedValues ?? {},
        missingAnswerScales: missingAnswerVariables(input, result.unavailableVariables, answers, opts.perQuestion, scale.name)
      })
    } catch (error) {
      scales.push({
        name: scale.name, code: definition.instrumentCode || definition.code,
        levelName: '', severityLabel: '', redLine: false, primaryAttribution: '',
        attributions: [], toolTags: [], unavailableVariables: [],
        trigger, computedValues: {}, missingAnswerScales: [],
        error: error instanceof Error ? error.message : '未知错误'
      })
    }
  }

  return { scales }
}
/**
 * 业务填写向导的「代入试算」——v4 模板 ⑪ 全链路推演算例的交互化。
 *
 * v4 让业务填完 Excel 后自己代入一组示例作答走一遍完整计算，
 * 验证「作答 → 归因加权 → 分级 → 方案输出」链路数值正确。
 * 向导把这一步搬进第 9 步：业务给每张量表的每个维度设一个 1..5 的强度，
 * 模拟器走与运行期完全相同的管道（编译 → 解析 → 规则引擎）算出结果，
 * 保证「在这里看到什么，上线后就是什么」。
 */
import type { WizardInput } from '../../shared/business-wizard'
import type { AssessmentDefinition } from '../../shared/assessments'
import { attributionConfigSchema } from '../../shared/contracts'
import type { RuleConfig } from '../../shared/contracts'
import { compileWizardInput } from './business-wizard-compile'
import { parseModuleResourceFile } from './module-resource-file-import'
import { executeRules } from './rules-executor'

/** 模拟作答：量表名 → 维度名 → 1..5 强度（维度内所有题取同一强度，逐题填 20+ 题不现实） */
export type SimulateAnswers = Record<string, Record<string, number>>

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

export function simulateWizardRun(input: WizardInput, answers: SimulateAnswers): SimulateRunResult {
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

  const scales: SimulateScaleResult[] = []
  for (const scale of input.scales) {
    const definition = instruments.find(i => i.title === scale.name)
    if (!definition) {
      scales.push({
        name: scale.name, code: '', levelName: '', severityLabel: '', redLine: false,
        primaryAttribution: '', attributions: [], toolTags: [], unavailableVariables: [],
        error: `找不到量表《${scale.name}》的解析结果`
      })
      continue
    }

    // 维度强度 → 逐题作答。每题的强度取它所属维度的值，未设置的维度按 3（中间值）。
    const intensityByDim = answers[scale.name] ?? {}
    const perQuestion: Record<string, number> = {}
    for (const q of definition.questions) {
      const dim = dimensionName(definition, q.dimension)
      const intensity = intensityByDim[dim] ?? 3
      perQuestion[q.id] = intensityToRaw(intensity, q.options)
    }

    try {
      const result = executeRules(config, perQuestion, definition)
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
        unavailableVariables: result.unavailableVariables
      })
    } catch (error) {
      scales.push({
        name: scale.name, code: definition.instrumentCode || definition.code,
        levelName: '', severityLabel: '', redLine: false, primaryAttribution: '',
        attributions: [], toolTags: [], unavailableVariables: [],
        error: error instanceof Error ? error.message : '未知错误'
      })
    }
  }

  return { scales }
}
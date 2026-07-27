import { z } from 'zod'
import { assessmentDefinitions } from '../../shared/assessments'
import {
  attributionConfigSchema,
  toolLibraryPayloadSchema,
  type LibraryType,
  type ModuleId
} from '../../shared/contracts'
import type { AssessmentDefinition } from '../../shared/assessments'
import { executeRules } from './rules-executor'

const assessmentPayloadSchema = z.object({
  instruments: z.array(z.custom<AssessmentDefinition>()).optional()
}).passthrough()

interface ValidationIssue {
  severity: 'error' | 'warning'
  message: string
  path?: string
}

export function validateModuleResourcePayload(input: {
  module: ModuleId
  libraryType: LibraryType
  payload: Record<string, unknown>
}) {
  const issues: ValidationIssue[] = []
  const add = (severity: ValidationIssue['severity'], message: string, path?: string) => issues.push({ severity, message, path })

  if (input.libraryType === 'assessment') {
    const parsed = assessmentPayloadSchema.safeParse(input.payload)
    if (!parsed.success) add('error', '量表 payload 必须是单量表或 instruments 数组')
    const rawInstruments = Array.isArray(input.payload.instruments) ? input.payload.instruments : [input.payload]
    const instruments = rawInstruments as Array<Record<string, unknown>>
    if (!instruments.length) add('error', '量表库至少需要一个量表')
    const instrumentCodes = new Set<string>()
    for (const [index, instrument] of instruments.entries()) {
      const questions = Array.isArray(instrument.questions) ? instrument.questions as Array<Record<string, unknown>> : []
      const instrumentCode = String(instrument.code || instrument.instrumentCode || '')
      if (!instrumentCode) add('error', '量表缺少 code 或 instrumentCode', `instruments.${index}`)
      if (instrumentCode && instrumentCodes.has(instrumentCode)) add('error', `量表编码重复：${instrumentCode}`, `instruments.${index}.code`)
      if (instrumentCode) instrumentCodes.add(instrumentCode)
      if (!instrument.title) add('error', '量表缺少 title', `instruments.${index}`)
      if (!questions.length) add('error', '量表缺少题项', `instruments.${index}.questions`)
      const questionIds = new Set<string>()
      for (const [qIndex, question] of questions.entries()) {
        const id = String(question.id || '')
        if (!id) add('error', '题项缺少 id', `instruments.${index}.questions.${qIndex}.id`)
        if (questionIds.has(id)) add('error', `题项 id 重复：${id}`, `instruments.${index}.questions.${qIndex}.id`)
        questionIds.add(id)
        if (!question.text) add('error', '题项缺少题干', `instruments.${index}.questions.${qIndex}.text`)
        if (!question.dimension) add('warning', '题项缺少维度，归因解释会变弱', `instruments.${index}.questions.${qIndex}.dimension`)
        if (!Array.isArray(question.options) || question.options.length < 2) add('error', '题项至少需要 2 个选项', `instruments.${index}.questions.${qIndex}.options`)
      }
    }
  }

  if (input.libraryType === 'attribution') {
    const parsed = attributionConfigSchema.safeParse(input.payload)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) add('error', issue.message, issue.path.join('.'))
    } else {
      const config = parsed.data
      if (config.module !== input.module) add('error', `归因库 module 与资源库不一致：${config.module}`)
      if (!config.branches.some(branch => !branch.when)) add('error', '归因库必须有一条兜底规则')
      const ruleIds = new Set<string>()
      for (const branch of config.branches) {
        if (ruleIds.has(branch.ruleId)) add('error', `规则编码重复：${branch.ruleId}`)
        ruleIds.add(branch.ruleId)
        if (!branch.toolTags.length) add('warning', `规则 ${branch.ruleId} 缺少工具标签，可能无法匹配工具`)
        if ((branch.blocked || branch.level.toLowerCase().includes('red')) && !config.crisis) {
          add('warning', `高风险/阻断规则 ${branch.ruleId} 建议配置 crisis 或明确升级条件`)
        }
      }
    }
  }

  if (input.libraryType === 'tool') {
    const parsed = toolLibraryPayloadSchema.safeParse(input.payload)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) add('error', issue.message, issue.path.join('.'))
    } else {
      const codes = new Set<string>()
      for (const tool of parsed.data.tools) {
        if (codes.has(tool.code)) add('error', `工具编码重复：${tool.code}`)
        codes.add(tool.code)
        const matchHints = [
          tool.level,
          tool.severity,
          tool.attribution,
          tool.primaryAttribution,
          ...(tool.attributions || []),
          ...(tool.tags || []),
          ...(tool.toolTags || []),
          ...(tool.dimensions || [])
        ].filter(Boolean)
        if (!matchHints.length) add('warning', `工具 ${tool.code} 缺少等级、归因、标签或维度，匹配命中率会偏低`)
        if (!tool.prohibitions) add('warning', `工具 ${tool.code} 缺少禁忌条件`)
        if (!tool.expectedEffect) add('warning', `工具 ${tool.code} 缺少预期输出或效果`)
      }
    }
  }

  return {
    ok: !issues.some(issue => issue.severity === 'error'),
    issueCount: issues.length,
    errors: issues.filter(issue => issue.severity === 'error'),
    warnings: issues.filter(issue => issue.severity === 'warning')
  }
}

export function previewModuleResourcePayload(input: {
  module: ModuleId
  libraryType: LibraryType
  payload: Record<string, unknown>
}) {
  if (input.libraryType === 'assessment') {
    const instruments = Array.isArray(input.payload.instruments) ? input.payload.instruments as Array<Record<string, unknown>> : [input.payload]
    return {
      type: 'assessment',
      instrumentCount: instruments.length,
      instruments: instruments.slice(0, 10).map(instrument => ({
        code: instrument.code || instrument.instrumentCode,
        title: instrument.title,
        questionCount: Array.isArray(instrument.questions) ? instrument.questions.length : 0
      }))
    }
  }
  if (input.libraryType === 'tool') {
    const parsed = toolLibraryPayloadSchema.safeParse(input.payload)
    const tools = parsed.success ? parsed.data.tools : []
    return {
      type: 'tool',
      toolCount: tools.length,
      tools: tools.slice(0, 10).map(tool => ({
        code: tool.code,
        name: tool.name,
        form: tool.form,
        matchHints: [tool.level, tool.severity, tool.primaryAttribution, ...(tool.toolTags || []), ...(tool.tags || [])].filter(Boolean)
      }))
    }
  }
  const parsed = attributionConfigSchema.safeParse(input.payload)
  if (!parsed.success) return { type: 'attribution', error: '归因库结构无效，无法预览' }
  const definition = assessmentDefinitions[input.module]
  const answers = Object.fromEntries(definition.questions.map(question => [question.id, 3]))
  const result = executeRules(parsed.data, answers, definition)
  return {
    type: 'attribution',
    branchCount: parsed.data.branches.length,
    computedVariables: Object.keys(parsed.data.computed),
    defaultPreview: {
      answers,
      level: result.level,
      primaryAttribution: result.primaryAttribution,
      secondaryAttributions: result.secondaryAttributions,
      reasons: result.reasons,
      toolTags: result.toolTags
    }
  }
}

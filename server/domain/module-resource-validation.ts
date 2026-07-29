import { z } from 'zod'
import { assessmentDefinitions } from '../../shared/assessments'
import {
  attributionConfigSchema,
  toolLibraryPayloadSchema,
  outputTemplateLibraryPayloadSchema,
  keywordRouteLibraryPayloadSchema,
  type AttributionConfig,
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

/**
 * 同模块当前生效的对侧资源。量表库和归因库必须成对自洽：
 * 归因表达式里的 SCORE(qid)/RAW(qid) 在题目不存在时会让规则引擎抛异常，
 * 也就是教师提交评估直接失败，因此两个方向都要在发布前拦下来。
 */
export interface ModuleResourceCounterpart {
  assessmentDefinition?: AssessmentDefinition | null
  attributionConfig?: AttributionConfig | null
}

/** 抽取归因表达式引用到的题目 id，覆盖 SCORE(q1)、RAW('q1') 两种写法。 */
export function collectReferencedQuestionIds(config: AttributionConfig): string[] {
  const expressions = [
    ...Object.values(config.computed),
    ...config.evidences.map(evidence => evidence.condition),
    ...config.gradingRules.map(rule => rule.when).filter((when): when is string => Boolean(when)),
    ...(config.crisis ? [config.crisis.when] : []),
    ...(config.redLines || []).map(rl => rl.condition)
  ]
  const pattern = /\b(?:SCORE|RAW)\s*\(\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*\)/g
  const ids = new Set<string>()
  for (const expression of expressions) {
    for (const match of expression.matchAll(pattern)) {
      const id = match[1] || match[2] || match[3]
      if (id) ids.add(id)
    }
  }
  return [...ids]
}

function instrumentQuestionIds(instruments: Array<Record<string, unknown>>): Set<string> {
  const ids = new Set<string>()
  for (const instrument of instruments) {
    const questions = Array.isArray(instrument.questions) ? instrument.questions as Array<Record<string, unknown>> : []
    for (const question of questions) if (question.id) ids.add(String(question.id))
  }
  return ids
}

export function validateModuleResourcePayload(input: {
  module: ModuleId
  libraryType: LibraryType
  payload: Record<string, unknown>
  counterpart?: ModuleResourceCounterpart
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

    // 反向交叉校验：换量表不能把现行归因库引用的题目换没了。
    const attribution = input.counterpart?.attributionConfig
    if (attribution) {
      const available = instrumentQuestionIds(instruments)
      const missing = collectReferencedQuestionIds(attribution).filter(id => !available.has(id))
      if (missing.length) {
        add('error', `现行归因库引用的题目在新量表中不存在：${missing.join('、')}；发布后教师提交评估会直接失败`)
      }
    }

    // V2: 维度定义校验
    for (const [index, instrument] of instruments.entries()) {
      const questions = Array.isArray(instrument.questions) ? instrument.questions as Array<Record<string, unknown>> : []
      const questionIds = new Set(questions.map(q => String(q.id || '')))
      const dimensionDefs = Array.isArray(instrument.dimensionDefs) ? instrument.dimensionDefs as Array<Record<string, unknown>> : []
      if (dimensionDefs.length) {
        for (const [dIndex, dim] of dimensionDefs.entries()) {
          const code = dim.code || ''
          if (!code) add('error', '维度定义缺少 code', `instruments.${index}.dimensionDefs.${dIndex}.code`)
          if (!dim.name) add('error', '维度定义缺少 name', `instruments.${index}.dimensionDefs.${dIndex}.name`)
          const dimQuestionIds = Array.isArray(dim.questionIds) ? dim.questionIds as string[] : []
          if (!dimQuestionIds.length) {
            add('warning', `维度 ${code || dIndex} 未关联任何题项`, `instruments.${index}.dimensionDefs.${dIndex}`)
          }
          const missingQids = dimQuestionIds.filter(qid => !questionIds.has(String(qid)))
          if (missingQids.length) {
            add('error', `维度 ${code} 引用的题项不存在：${missingQids.join('、')}`, `instruments.${index}.dimensionDefs.${dIndex}.questionIds`)
          }
          const calcMethod = dim.calcMethod
          if (calcMethod && !['mean', 'sum', 'weighted', 'count'].includes(String(calcMethod))) {
            add('error', `维度 ${code} 的 calcMethod 值无效：${calcMethod}`, `instruments.${index}.dimensionDefs.${dIndex}.calcMethod`)
          }
          if (calcMethod === 'weighted' && dim.weight === undefined) {
            add('warning', `维度 ${code} 使用加权计算但未设置 weight`, `instruments.${index}.dimensionDefs.${dIndex}.weight`)
          }
        }
      } else {
        // 旧量表可能没有 dimensionDefs，根据 question.dimension 推断
        const dimensionNames = new Set(questions.map(q => String(q.dimension || '')).filter(Boolean))
        if (dimensionNames.size) {
          add('warning', `量表 ${String(instrument.code || instrument.instrumentCode || '')} 建议配置 dimensionDefs 以明确维度计算方式；当前题项维度：${[...dimensionNames].join('、')}`)
        }
      }

      // V2: 量表元数据校验
      if (instrument.triggerMethod && !['manual', 'auto', 'scheduled'].includes(String(instrument.triggerMethod))) {
        add('warning', `triggerMethod 值无效：${instrument.triggerMethod}`, `instruments.${index}.triggerMethod`)
      }
      if (instrument.resultVisibility && !['teacher_only', 'teacher_and_student', 'psychologist'].includes(String(instrument.resultVisibility))) {
        add('warning', `resultVisibility 值无效：${instrument.resultVisibility}`, `instruments.${index}.resultVisibility`)
      }
      if (instrument.frequency && !['once', 'daily', 'weekly', 'monthly', 'per_case', 'semester'].includes(String(instrument.frequency))) {
        add('warning', `frequency 值无效：${instrument.frequency}`, `instruments.${index}.frequency`)
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

      // 兜底分级规则必须存在，且优先级必须是最大值。
      // 业务的直觉是「兜底 = 第 0 条」，但引擎按 pri 升序首条命中即停，
      // pri 最小的无条件规则会吃掉全部作答，使其余规则永远不可达。
      const fallbackRules = config.gradingRules.filter(rule => !rule.when)
      if (!fallbackRules.length) add('error', '分级规则必须有一条不带触发条件的兜底规则')
      const maxPri = Math.max(...config.gradingRules.map(rule => rule.pri))
      for (const rule of fallbackRules) {
        if (rule.pri < maxPri) {
          add('error', `兜底分级规则 ${rule.ruleId} 的优先级 ${rule.pri} 不是最大值（当前最大 ${maxPri}），会使优先级更大的规则永远不可达`)
        }
      }

      // 熔断护栏：crisis 或 blocked 分级规则或 redLines 是评估侧唯一的红线出口。
      const hasCrisis = Boolean(config.crisis)
      const hasRedLines = (config.redLines || []).length > 0
      const hasBlockedRule = config.gradingRules.some(rule => rule.blocked)
      if (!hasCrisis && !hasBlockedRule && !hasRedLines) {
        add('error', '归因库必须定义 crisis 红线、redLines 或至少保留一条 blocked 分级规则；三者都没有会使该模块的评估熔断失效')
      }

      // V2: redLines 独立校验
      for (const [rIndex, redLine] of (config.redLines || []).entries()) {
        if (!redLine.condition) add('error', `redLines[${rIndex}] 缺少 condition`)
        if (!redLine.description) add('error', `redLines[${rIndex}] 缺少 description`)
        if (!redLine.scope) add('error', `redLines[${rIndex}] 缺少 scope`)
        if (!redLine.actions.length) add('warning', `redLines[${rIndex}] 缺少 actions，熔断后将无具体处置指引`)
      }
      const ruleIds = new Set<string>()
      for (const rule of config.gradingRules) {
        if (ruleIds.has(rule.ruleId)) add('error', `分级规则编码重复：${rule.ruleId}`)
        ruleIds.add(rule.ruleId)
        if ((rule.blocked || rule.severity === 'crisis') && !config.crisis && !hasRedLines) {
          add('warning', `高风险/阻断规则 ${rule.ruleId} 建议配置 crisis 或 redLines`)
        }
        if (rule.escalationCondition && !rule.escalationTarget) {
          add('warning', `分级规则 ${rule.ruleId} 设置了升级条件但未指定升级目标`)
        }
        if (rule.reEvaluationTrigger && !rule.escalationCondition) {
          add('warning', `分级规则 ${rule.ruleId} 设置了复评触发条件但未定义升级条件`)
        }
      }

      // 归因项：编码唯一，且每条都要有工具标签，否则工具匹配只剩归因编码一条通路
      const attributionCodes = new Set<string>()
      for (const item of config.attributionItems) {
        if (attributionCodes.has(item.code)) add('error', `归因编码重复：${item.code}`)
        attributionCodes.add(item.code)
        if (!item.toolTags.length) add('warning', `归因项 ${item.code} 缺少工具标签，工具匹配将只依赖归因编码`)
      }

      // 证据规则：引用的归因项必须存在；每条归因项至少要有一条证据，否则永远算不出分
      const evidenceCodes = new Set<string>()
      const attributionsWithEvidence = new Set<string>()
      for (const evidence of config.evidences) {
        if (evidenceCodes.has(evidence.evidenceCode)) add('error', `证据编码重复：${evidence.evidenceCode}`)
        evidenceCodes.add(evidence.evidenceCode)
        if (!attributionCodes.has(evidence.attributionCode)) {
          add('error', `证据 ${evidence.evidenceCode} 引用的归因编码 ${evidence.attributionCode} 不存在`)
        } else {
          attributionsWithEvidence.add(evidence.attributionCode)
        }
      }
      for (const item of config.attributionItems) {
        if (!attributionsWithEvidence.has(item.code)) {
          add('error', `归因项 ${item.code} 没有任何证据规则，永远不会被命中`)
        }
      }

      // 正向交叉校验：归因表达式引用的题目必须在现行量表里存在。
      const definition = input.counterpart?.assessmentDefinition
      if (definition) {
        const available = new Set(definition.questions.map(question => question.id))
        const missing = collectReferencedQuestionIds(config).filter(id => !available.has(id))
        if (missing.length) {
          add('error', `归因库引用的题目在现行量表《${definition.title}》中不存在：${missing.join('、')}`)
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
        // 归因编码是工具匹配的主通路（权重最高），缺了它基本推不出来
        if (!tool.attributionCode && !(tool.attributionCodes || []).length) {
          add('error', `工具 ${tool.code} 未填对应归因编码，不会被任何归因推荐出来`)
        }
        const matchHints = [
          tool.severity,
          ...(tool.tags || []),
          ...(tool.toolTags || []),
          ...(tool.dimensions || [])
        ].filter(Boolean)
        if (!matchHints.length) add('warning', `工具 ${tool.code} 缺少严重度、标签和维度，匹配得分只剩归因一项`)
        if (!tool.prohibitions && !(tool.contraindicationRules || []).length) {
          add('warning', `工具 ${tool.code} 缺少禁忌条件`)
        }
        if (!tool.expectedEffect) add('warning', `工具 ${tool.code} 缺少预期输出或效果`)

        // V2: structuredSteps 校验
        if (tool.structuredSteps && tool.structuredSteps.length) {
          const seqs = new Set<number>()
          for (const step of tool.structuredSteps) {
            if (seqs.has(step.seq)) add('error', `工具 ${tool.code} structuredSteps 序号重复：${step.seq}`)
            seqs.add(step.seq)
            if (!step.title) add('error', `工具 ${tool.code} structuredSteps[${step.seq}] 缺少 title`)
          }
        } else if (tool.steps.length > 0) {
          add('warning', `工具 ${tool.code} 使用自由文本 steps，建议迁移到 structuredSteps`)
        }

        // V2: contraindicationRules 校验
        for (const [cIndex, rule] of (tool.contraindicationRules || []).entries()) {
          if (!rule.condition) add('error', `工具 ${tool.code} contraindicationRules[${cIndex}] 缺少 condition`)
          if (!rule.type || !['block', 'warn'].includes(rule.type)) {
            add('error', `工具 ${tool.code} contraindicationRules[${cIndex}] type 无效：${rule.type}`)
          }
          if (rule.type === 'block' && !rule.alternativeSuggestion) {
            add('warning', `工具 ${tool.code} block 型禁忌规则建议提供 alternativeSuggestion`)
          }
        }

        // V2: 跨模块标签校验
        if (tool.crossModuleTags) {
          const validModules = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']
          for (const tag of tool.crossModuleTags) {
            if (!validModules.includes(tag)) {
              add('warning', `工具 ${tool.code} crossModuleTags 中的 "${tag}" 不是有效模块`)
            }
          }
        }

        // V2: 证据等级校验
        if (tool.evidenceLevel && !['A', 'B', 'C', 'D'].includes(tool.evidenceLevel)) {
          add('warning', `工具 ${tool.code} evidenceLevel 值无效：${tool.evidenceLevel}`)
        }
      }
    }
  }

  // V2 新增: output_template 校验
  if (input.libraryType === 'output_template') {
    const parsed = outputTemplateLibraryPayloadSchema.safeParse(input.payload)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) add('error', issue.message, issue.path.join('.'))
    } else {
      const codes = new Set<string>()
      const levels = new Set<string>()
      for (const template of parsed.data.templates) {
        if (codes.has(template.code)) add('error', `模板编码重复：${template.code}`)
        codes.add(template.code)
        levels.add(template.attributionLevel)
        if (template.module !== input.module) {
          add('warning', `模板 ${template.code} 的 module 与资源库不一致`)
        }
      }
      if (!levels.size) {
        add('warning', 'output_template 至少需要包含一个命中等级')
      }
    }
  }

  // V2 新增: keyword_route 校验
  if (input.libraryType === 'keyword_route') {
    const parsed = keywordRouteLibraryPayloadSchema.safeParse(input.payload)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) add('error', issue.message, issue.path.join('.'))
    } else {
      const codes = new Set<string>()
      for (const route of parsed.data.routes) {
        if (codes.has(route.code)) add('error', `路由编码重复：${route.code}`)
        codes.add(route.code)
        if (!route.coreKeywords.trim()) add('error', `路由 ${route.code} 的 coreKeywords 不能为空`)
        if (route.module !== input.module) {
          add('warning', `路由 ${route.code} 的 module 与资源库不一致`)
        }
        if (route.matchMode === 'regex') {
          try { new RegExp(route.coreKeywords) } catch {
            add('error', `路由 ${route.code} 的 coreKeywords 不是有效正则表达式`)
          }
        }
        if (route.exclusionKeywords && route.exclusionKeywords.length) {
          const overlap = route.exclusionKeywords.filter(kw =>
            route.coreKeywords.includes(kw) || (route.expandedKeywords || '').includes(kw)
          )
          if (overlap.length) {
            add('warning', `路由 ${route.code} 的 exclusionKeywords 与触发词重叠：${overlap.join('、')}`)
          }
        }
      }
    }
  }

  // V2 新增: knowledge 校验已独立为知识库系统，不通过三库运营台校验

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
  counterpart?: ModuleResourceCounterpart
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
        matchHints: [tool.severity, tool.attributionCode, ...(tool.attributionCodes || []), ...(tool.toolTags || []), ...(tool.tags || [])].filter(Boolean)
      }))
    }
  }

  if (input.libraryType === 'output_template') {
    const parsed = outputTemplateLibraryPayloadSchema.safeParse(input.payload)
    const templates = parsed.success ? parsed.data.templates : []
    return {
      type: 'output_template',
      templateCount: templates.length,
      templates: templates.slice(0, 10).map(t => ({
        code: t.code,
        attributionLevel: t.attributionLevel,
        type: t.type,
        order: t.order
      }))
    }
  }

  if (input.libraryType === 'keyword_route') {
    const parsed = keywordRouteLibraryPayloadSchema.safeParse(input.payload)
    const routes = parsed.success ? parsed.data.routes : []
    return {
      type: 'keyword_route',
      routeCount: routes.length,
      routes: routes.slice(0, 10).map(r => ({
        code: r.code,
        coreKeywords: r.coreKeywords,
        module: r.module,
        matchPriority: r.matchPriority,
        riskLevel: r.riskLevel
      }))
    }
  }
  // knowledge 已独立为知识库系统
  const parsed = attributionConfigSchema.safeParse(input.payload)
  if (!parsed.success) return { type: 'attribution', error: '归因库结构无效，无法预览' }
  // 必须针对现行量表求值：用代码兜底量表预览会在题目 id 不一致时给出与线上不同的分级。
  const definition = input.counterpart?.assessmentDefinition ?? assessmentDefinitions[input.module]
  const usedFallbackDefinition = !input.counterpart?.assessmentDefinition
  const answers = Object.fromEntries(definition.questions.map(question => [question.id, 3]))
  const base = {
    type: 'attribution' as const,
    attributionItemCount: parsed.data.attributionItems.length,
    evidenceCount: parsed.data.evidences.length,
    gradingRuleCount: parsed.data.gradingRules.length,
    computedVariables: Object.keys(parsed.data.computed),
    assessmentTitle: definition.title,
    usedFallbackDefinition
  }
  try {
    const result = executeRules(parsed.data, answers, definition)
    return {
      ...base,
      defaultPreview: {
        answers,
        level: result.level,
        blocked: result.blocked,
        primaryAttribution: result.primaryAttribution,
        secondaryAttributions: result.secondaryAttributions,
        reasons: result.reasons,
        toolTags: result.toolTags
      }
    }
  } catch (error) {
    // 题目引用错配会让规则引擎抛异常——预览要把它显示出来，而不是让整个请求 500。
    return { ...base, error: `按《${definition.title}》试算失败：${error instanceof Error ? error.message : '未知错误'}` }
  }
}

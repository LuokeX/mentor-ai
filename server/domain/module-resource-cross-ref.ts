import type { LibraryType, ModuleId } from '../../shared/contracts'

// ---- 类型定义 ----

export interface CrossRefIssue {
  severity: 'error' | 'warning' | 'info'
  sourceLibraryType: LibraryType
  sourceCode: string
  sourceField: string
  sourceValue: string
  targetLibraryType: LibraryType
  targetField: string
  message: string
}

export interface CrossRefReport {
  module: ModuleId
  librariesAvailable: LibraryType[]
  librariesMissing: LibraryType[]
  issues: CrossRefIssue[]
}

// ---- 从 payload 提取索引 ----

/** 从 assessment payload 提取所有量表编码集合 */
function extractAssessmentCodes(payload: Record<string, unknown>): Set<string> {
  const codes = new Set<string>()
  const instruments = Array.isArray(payload.instruments) ? payload.instruments : [payload]
  for (const inst of instruments) {
    const code = (inst as Record<string, unknown>).code || (inst as Record<string, unknown>).instrumentCode
    if (code) codes.add(String(code))
  }
  return codes
}

/** 从 attribution payload 提取归因编码、等级集合，以及证据/分级规则引用的量表编码 */
function extractAttributionIndex(payload: Record<string, unknown>): {
  attributionCodes: Set<string>
  levels: Set<string>
  assessmentCodes: Array<{ code: string, from: string }>
} {
  const attributionCodes = new Set<string>()
  const levels = new Set<string>()
  const assessmentCodes: Array<{ code: string, from: string }> = []

  const items = (payload as Record<string, unknown>).attributionItems
  if (Array.isArray(items)) {
    for (const item of items as Array<Record<string, unknown>>) {
      if (item.code) attributionCodes.add(String(item.code))
    }
  }

  const evidences = (payload as Record<string, unknown>).evidences
  if (Array.isArray(evidences)) {
    for (const evidence of evidences as Array<Record<string, unknown>>) {
      if (evidence.assessmentCode) {
        assessmentCodes.push({ code: String(evidence.assessmentCode), from: String(evidence.evidenceCode || '证据规则') })
      }
    }
  }

  const gradingRules = (payload as Record<string, unknown>).gradingRules
  if (Array.isArray(gradingRules)) {
    for (const rule of gradingRules as Array<Record<string, unknown>>) {
      if (rule.level) levels.add(String(rule.level))
      if (rule.assessmentCode) {
        assessmentCodes.push({ code: String(rule.assessmentCode), from: String(rule.ruleId || '分级规则') })
      }
    }
  }

  return { attributionCodes, levels, assessmentCodes }
}

/** 从 tool payload 提取所有工具编码集合 + 归因引用列表 + 工具内部自引用 */
function extractToolIndex(payload: Record<string, unknown>): {
  codes: Set<string>
  attributionRefs: Array<{ code: string; field: string; value: string }>
  selfRefs: Array<{ code: string; field: string; value: string }>
} {
  const codes = new Set<string>()
  const attributionRefs: Array<{ code: string; field: string; value: string }> = []
  const selfRefs: Array<{ code: string; field: string; value: string }> = []
  const tools = (payload as Record<string, unknown>).tools
  if (Array.isArray(tools)) {
    for (const tool of tools as Array<Record<string, unknown>>) {
      const code = String(tool.code || '')
      if (code) codes.add(code)
      // 收集归因编码引用。attributionLabel 是展示用快照，不参与校验。
      const attributionCode = tool.attributionCode
      if (typeof attributionCode === 'string' && attributionCode.trim()) {
        attributionRefs.push({ code, field: 'attributionCode', value: attributionCode.trim() })
      }
      const attributionCodes = tool.attributionCodes
      if (Array.isArray(attributionCodes)) {
        for (const attr of attributionCodes) {
          if (typeof attr === 'string' && attr.trim()) {
            attributionRefs.push({ code, field: 'attributionCodes[]', value: attr.trim() })
          }
        }
      }
      // 工具内部自引用：前置/替代/进阶/协同工具编码
      for (const field of ['prerequisiteToolCode', 'alternativeToolCode', 'advancedToolCode']) {
        const value = tool[field]
        if (typeof value === 'string' && value.trim()) {
          selfRefs.push({ code, field, value: value.trim() })
        }
      }
      const collabCodes = tool.collaborativeToolCodes
      if (Array.isArray(collabCodes)) {
        for (const cc of collabCodes) {
          if (typeof cc === 'string' && cc.trim()) {
            selfRefs.push({ code, field: 'collaborativeToolCodes[]', value: cc.trim() })
          }
        }
      }
    }
  }
  return { codes, attributionRefs, selfRefs }
}

/** 从 keyword_route payload 提取路由编码 + assessment/tool 引用 */
function extractRouteIndex(payload: Record<string, unknown>): Array<{
  code: string
  linkedAssessmentCode?: string
  linkedToolCode?: string
}> {
  const result: Array<{
    code: string
    linkedAssessmentCode?: string
    linkedToolCode?: string
  }> = []
  const routes = (payload as Record<string, unknown>).routes
  if (Array.isArray(routes)) {
    for (const route of routes as Array<Record<string, unknown>>) {
      const code = String(route.code || '')
      const linkedAssessmentCode = typeof route.linkedAssessmentCode === 'string' ? route.linkedAssessmentCode.trim() : undefined
      const linkedToolCode = typeof route.linkedToolCode === 'string' ? route.linkedToolCode.trim() : undefined
      if (code && (linkedAssessmentCode || linkedToolCode)) {
        result.push({ code, linkedAssessmentCode, linkedToolCode })
      }
    }
  }
  return result
}

/** 从 output_template payload 提取模板编码 + attributionLevel 引用 */
function extractTemplateIndex(payload: Record<string, unknown>): Array<{
  code: string
  attributionLevel: string
}> {
  const result: Array<{ code: string; attributionLevel: string }> = []
  const templates = (payload as Record<string, unknown>).templates
  if (Array.isArray(templates)) {
    for (const tpl of templates as Array<Record<string, unknown>>) {
      const code = String(tpl.code || '')
      const attributionLevel = typeof tpl.attributionLevel === 'string' ? tpl.attributionLevel.trim() : ''
      if (code && attributionLevel) {
        result.push({ code, attributionLevel })
      }
    }
  }
  return result
}

// ---- 核心校验函数 ----

/**
 * 对同一模块下已发布的库进行交叉引用校验。
 *
 * libraries: 该模块下已发布的库记录（含 libraryType）
 * versionPayloads: Map<libraryType, payload> —— 每种库类型取最新已发布版本的 payload
 */
export function checkCrossReferences(
  module: ModuleId,
  libraries: Array<{ libraryType: string }>,
  versionPayloads: Map<string, Record<string, unknown>>,
): CrossRefReport {
  const issues: CrossRefIssue[] = []

  const add = (
    severity: CrossRefIssue['severity'],
    sourceLibraryType: LibraryType,
    sourceCode: string,
    sourceField: string,
    sourceValue: string,
    targetLibraryType: LibraryType,
    targetField: string,
    message: string,
  ) => issues.push({ severity, sourceLibraryType, sourceCode, sourceField, sourceValue, targetLibraryType, targetField, message })

  // 所有相关的库类型（排除 knowledge）
  const allRefTypes: LibraryType[] = ['assessment', 'attribution', 'tool', 'output_template', 'keyword_route']
  const availableSet = new Set(libraries.map(l => l.libraryType as LibraryType))
  const librariesAvailable = allRefTypes.filter(t => availableSet.has(t))
  const librariesMissing = allRefTypes.filter(t => !availableSet.has(t))

  // ---- 提取各库类型的索引数据 ----
  const assessmentCodes = new Set<string>()
  let attributionItemCodes = new Set<string>()
  let attributionLevels = new Set<string>()
  const toolCodes = new Set<string>()

  // assessment
  const assessmentPayload = versionPayloads.get('assessment')
  if (assessmentPayload) {
    for (const code of extractAssessmentCodes(assessmentPayload)) assessmentCodes.add(code)
  }

  // attribution
  const attributionPayload = versionPayloads.get('attribution')
  if (attributionPayload) {
    const idx = extractAttributionIndex(attributionPayload)
    attributionItemCodes = idx.attributionCodes
    attributionLevels = idx.levels

    // 链 1: attribution → assessment。证据规则按量表编码过滤执行，编码对不上等于该证据永远不生效。
    if (assessmentPayload) {
      for (const ref of idx.assessmentCodes) {
        if (!assessmentCodes.has(ref.code)) {
          add('error', 'attribution', ref.from, 'assessmentCode', ref.code, 'assessment', 'code',
            `引用的量表编码 "${ref.code}" 在现行量表中不存在，该规则永远不会被执行`)
        }
      }
    }
  }

  // tool
  const toolPayload = versionPayloads.get('tool')
  if (toolPayload) {
    const toolIdx = extractToolIndex(toolPayload)
    for (const code of toolIdx.codes) toolCodes.add(code)

    // 链 2: tool → attribution
    if (attributionPayload) {
      for (const ref of toolIdx.attributionRefs) {
        if (!attributionItemCodes.has(ref.value)) {
          add('error', 'tool', ref.code, ref.field, ref.value, 'attribution', 'code',
            `工具的 ${ref.field} "${ref.value}" 在归因项清单中不存在，该工具不会被任何归因推出来`)
        }
      }
    }

    // 链 7: tool → tool (内部自引用：前置/替代/进阶/协同工具编码)
    for (const ref of toolIdx.selfRefs) {
      if (!toolCodes.has(ref.value)) {
        const severity = ref.field === 'prerequisiteToolCode' ? 'error' as const : 'warning' as const
        add(severity, 'tool', ref.code, ref.field, ref.value, 'tool', 'code',
          `工具引用的${ref.field === 'prerequisiteToolCode' ? '前置' : ref.field === 'alternativeToolCode' ? '替代' : ref.field === 'advancedToolCode' ? '进阶' : '协同'}工具编码 "${ref.value}" 在工具库中不存在`)
      }
    }
  }

  // keyword_route
  const routePayload = versionPayloads.get('keyword_route')
  if (routePayload) {
    const routeRefs = extractRouteIndex(routePayload)

    // 链 3: keyword_route → assessment
    if (assessmentPayload) {
      for (const ref of routeRefs) {
        if (ref.linkedAssessmentCode && !assessmentCodes.has(ref.linkedAssessmentCode)) {
          add('warning', 'keyword_route', ref.code, 'linkedAssessmentCode', ref.linkedAssessmentCode, 'assessment', 'code',
            `路由引用的量表编码 "${ref.linkedAssessmentCode}" 在现行量表中不存在`)
        }
      }
    }

    // 链 4: keyword_route → tool
    if (toolPayload) {
      for (const ref of routeRefs) {
        if (ref.linkedToolCode && !toolCodes.has(ref.linkedToolCode)) {
          add('warning', 'keyword_route', ref.code, 'linkedToolCode', ref.linkedToolCode, 'tool', 'code',
            `路由引用的工具编码 "${ref.linkedToolCode}" 在现行工具库中不存在`)
        }
      }
    }
  }

  // output_template
  const templatePayload = versionPayloads.get('output_template')
  if (templatePayload) {
    const templateRefs = extractTemplateIndex(templatePayload)

    // 链 5: output_template → attribution
    if (attributionPayload) {
      for (const ref of templateRefs) {
        if (!attributionLevels.has(ref.attributionLevel)) {
          add('error', 'output_template', ref.code, 'attributionLevel', ref.attributionLevel, 'attribution', 'level',
            `模板的命中归因等级 "${ref.attributionLevel}" 在归因库分支中未找到匹配`)
        }
      }
    }
  }

  // 链 6: 依赖库缺失 —— 标记 info 级别
  // 对于引用方存在但目标库缺失的情况，生成 info
  if (toolPayload && !attributionPayload) {
    const toolIdx = extractToolIndex(toolPayload)
    const distinctValues = [...new Set(toolIdx.attributionRefs.map(r => r.value))]
    if (distinctValues.length) {
      add('info', 'tool', `(${toolIdx.attributionRefs.length} 条)`, 'attributionCode', distinctValues.slice(0, 3).join('、') + (distinctValues.length > 3 ? '...' : ''),
        'attribution', 'code',
        '工具库中引用了归因编码，但归因库尚未导入，无法校验匹配')
    }
  }

  if (routePayload && !assessmentPayload) {
    const routeRefs = extractRouteIndex(routePayload)
    const assessmentRefs = routeRefs.filter(r => r.linkedAssessmentCode)
    if (assessmentRefs.length) {
      add('info', 'keyword_route', `(${assessmentRefs.length} 条)`, 'linkedAssessmentCode', assessmentRefs.map(r => r.linkedAssessmentCode!).join('、'),
        'assessment', 'code',
        '路由库引用了量表编码，但量表库尚未导入，无法校验匹配')
    }
  }

  if (routePayload && !toolPayload) {
    const routeRefs = extractRouteIndex(routePayload)
    const toolRefs = routeRefs.filter(r => r.linkedToolCode)
    if (toolRefs.length) {
      add('info', 'keyword_route', `(${toolRefs.length} 条)`, 'linkedToolCode', toolRefs.map(r => r.linkedToolCode!).join('、'),
        'tool', 'code',
        '路由库引用了工具编码，但工具库尚未导入，无法校验匹配')
    }
  }

  if (templatePayload && !attributionPayload) {
    const templateRefs = extractTemplateIndex(templatePayload)
    if (templateRefs.length) {
      const levels = [...new Set(templateRefs.map(r => r.attributionLevel))]
      add('info', 'output_template', `(${templateRefs.length} 条)`, 'attributionLevel', levels.join('、'),
        'attribution', 'level',
        '输出模板库引用了归因等级，但归因库尚未导入，无法校验匹配')
    }
  }

  if (attributionPayload && !assessmentPayload) {
    const idx = extractAttributionIndex(attributionPayload)
    if (idx.assessmentCodes.length) {
      add('info', 'attribution', `(${idx.assessmentCodes.length} 条)`, 'assessmentCode',
        [...new Set(idx.assessmentCodes.map(ref => ref.code))].join('、'),
        'assessment', 'code',
        '归因库引用了量表编码，但量表库尚未导入，无法校验匹配')
    }
  }

  return {
    module,
    librariesAvailable,
    librariesMissing,
    issues: issues.sort((a, b) => {
      const order = { error: 0, warning: 1, info: 2 }
      return order[a.severity] - order[b.severity]
    }),
  }
}
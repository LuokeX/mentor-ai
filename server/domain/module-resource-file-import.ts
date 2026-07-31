import XLSX from 'xlsx'
import {
  attributionConfigSchema,
  parseInstrumentRole,
  type AssessmentDimensionDef,
  type KeywordRouteEntry,
  type LibraryType,
  type ModuleId,
  type OutputTemplateEntry,
  type Severity,
  type ToolContraindicationRule,
  type ToolRxEntry,
  type ToolStructuredStep
} from '../../shared/contracts'
import type { AssessmentDefinition } from '../../shared/assessments'

interface SheetData {
  name: string
  rows: Record<string, string | undefined>[]
}

/**
 * @param diagnostics 可选的收集器。解析走到「不报错但很可能解析错」的兜底分支时
 *   会往里推一条中文提示，供预检面板展示。不传则这些提示被丢弃，行为与从前一致。
 */
export function parseModuleResourceFile(input: {
  module: ModuleId
  libraryType: LibraryType
  filename: string
  contentBase64: string
}, diagnostics?: string[]): Record<string, unknown> {
  const buffer = Buffer.from(input.contentBase64, 'base64')
  if (input.filename.toLowerCase().endsWith('.json')) {
    return JSON.parse(buffer.toString('utf8')) as Record<string, unknown>
  }
  if (!/\.(xlsx|xls)$/i.test(input.filename)) {
    throw new Error('仅支持 .xlsx、.xls 或 .json 文件')
  }
  const sheets = readWorkbook(buffer)
  if (input.libraryType === 'assessment') return { instruments: parseAssessmentSheets(sheets, input.module, diagnostics) }
  if (input.libraryType === 'tool') return { tools: parseToolSheets(sheets) }
  if (input.libraryType === 'keyword_route') return { routes: parseKeywordRouteSheets(sheets, input.module) }
  if (input.libraryType === 'output_template') return { templates: parseOutputTemplateSheets(sheets, input.module) }
  return parseAttributionSheets(sheets, input.module) as unknown as Record<string, unknown>
}

/**
 * 纯说明页，永远不含数据，必须在读取阶段就剔除。
 * 它们是散文而不是表格，一旦漏进来，任何走「逐 sheet 兜底」的解析分支
 * （assessment 的 legacy、attribution 的 genericRows）都会把整页散文当成业务数据。
 */
const GUIDE_SHEET_PATTERN = /使用说明|字段映射|填写总览|严格填写说明|枚举字典|条件写法速查|编排指南|角色说明|路径示意|编排自检/i

function readWorkbook(buffer: Buffer): SheetData[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  return workbook.SheetNames
    .filter(name => !GUIDE_SHEET_PATTERN.test(name))
    .map((name) => {
      const sheet = workbook.Sheets[name]
      const raw = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: undefined }) : []
      const headerIndex = inferHeaderRow(raw)
      const headers = (raw[headerIndex] || []).map(value => String(value ?? '').trim()).filter(Boolean)
      const rows: Record<string, string | undefined>[] = []
      for (let i = headerIndex + 1; i < raw.length; i++) {
        const row = raw[i]
        if (!row || row.every(value => value === undefined || value === null || String(value).trim() === '')) continue
        const item: Record<string, string | undefined> = {}
        for (let index = 0; index < headers.length; index++) {
          const value = row[index]
          item[headers[index]!] = value === undefined || value === null ? undefined : String(value).trim()
        }
        rows.push(item)
      }
      return { name, rows }
    })
    .filter(sheet => sheet.rows.length > 0)
}

function inferHeaderRow(rows: unknown[][]) {
  const hints = [
    'module', 'code', 'instrumentCode', '题号', '题项', '工具编码', '规则编码', '变量名', '优先级', '主归因', '评估编码',
    // V2 新增
    '量表编码', '量表名称', '工具名称', '所属模块', '适用年级', '触发方式', '作答频次',
    '维度编码', '计算方式', '计算表达式', '归因理由', '输出动作摘要', '升级条件',
    '红线条件', '熔断范围', '步骤序号', '禁忌条件', '指标类别',
    // output_template & keyword_route 表头特征词
    '模板编码', '模板类型', '模板内容', '占位符说明', '关键词编码', '核心触发词', '命中归因等级',
    // knowledge 表头特征词
    '文档标题', '来源类型', '标签关键词', '文档内容', '来源出处',
  ]
  let bestIndex = 0
  let bestScore = -1
  for (let index = 0; index < Math.min(rows.length, 12); index++) {
    const values = (rows[index] || []).map(value => String(value ?? '').trim()).filter(Boolean)
    const score = values.reduce((sum, value) => {
      const normalized = value.toLowerCase()
      return sum + hints.reduce((itemScore, hint) => itemScore + (normalized.includes(hint.toLowerCase()) ? 1 : 0), 0)
    }, 0)
    if (score > bestScore) {
      bestIndex = index
      bestScore = score
    }
  }
  return bestScore > 0 ? bestIndex : 0
}

function findSheet(sheets: SheetData[], patterns: RegExp[]) {
  return sheets.find(sheet => patterns.some(pattern => pattern.test(sheet.name)))
}

function parseAssessmentSheets(sheets: SheetData[], module: ModuleId, diagnostics?: string[]): AssessmentDefinition[] {
  // 序号后必须加字母边界：v4 起 ③a~③d 是编排说明页，裸 /③/ 会把「③a 量表编排指南」
  // 当成量表清单。findSheet 取第一个匹配，今天靠 sheet 顺序侥幸正确——业务一旦
  // 只保留说明页而删掉 ③，就会拿散文当表格解析，且不报错。
  const instrumentSheet = findSheet(sheets, [/③(?![a-zA-Z])|量表-清单/])
  const questionSheet = findSheet(sheets, [/④(?![a-zA-Z])|量表-题目/])
  if (instrumentSheet && questionSheet) {
    return parseAssessmentSheetsV3(sheets, module, instrumentSheet, questionSheet)
  }
  // legacy 分支把「每张 sheet 当成一个量表」，对标准模板文件而言基本必然解析错，
  // 但它不抛错。不留痕的话业务只会看到题目莫名其妙，查不到是模板结构不对。
  diagnostics?.push(
    `未找到「③ 量表-清单」或「④ 量表-题目」Sheet（实际 sheet：${sheets.map(sheet => sheet.name).join('、') || '空文件'}），`
    + '已退回旧版逐 Sheet 解析——每张 sheet 会被当成一个独立量表，结果大概率不是你想要的。'
    + '请改用 三库填写模板_v4.xlsx 的标准结构。'
  )
  return parseAssessmentSheetsLegacy(sheets, module)
}

function parseAssessmentSheetsV3(
  sheets: SheetData[],
  module: ModuleId,
  instrumentSheet: SheetData,
  questionSheet: SheetData
): AssessmentDefinition[] {
  const optionGroups = parseAssessmentOptionGroups(findSheet(sheets, [/④b|选项组/]))
  const dimensionDefsByInstrument = parseAssessmentDimensionDefs(findSheet(sheets, [/④c|维度定义/]))

  return instrumentSheet.rows
    .map((row) => {
      const code = read(row, ['code', 'instrumentCode', '量表编码', '评估编码'])
      const title = read(row, ['title', '量表名称', '评估名称'])
      if (!code || !title) return null
      const dimensionDefs = dimensionDefsByInstrument[code] || []
      const questions = parseAssessmentQuestions(questionSheet, code, dimensionDefs, optionGroups)
      if (!questions.length) return null
      return {
        code,
        instrumentCode: code,
        version: read(row, ['version', '版本']) || '1.0.0',
        module,
        title,
        description: read(row, ['description', '说明', '量表说明']) || `${title}（${questions.length}题）`,
        estimatedMinutes: Number(read(row, ['estimatedMinutes', '预计完成时间', '预计用时分钟'])) || Math.max(1, Math.ceil(questions.length / 5)),
        instrumentRole: parseInstrumentRole(read(row, ['量表角色', 'instrumentRole', 'role'])),
        shortName: read(row, ['量表简称', 'shortName']),
        applicableSchoolSection: read(row, ['适用学部']),
        applicableGrades: parseNumberList(read(row, ['适用年级'])),
        applicableSubjects: parseStringList(read(row, ['适用学科'])),
        targetAudience: read(row, ['施测对象']),
        formType: read(row, ['施测形式']),
        triggerMethod: read(row, ['触发方式']),
        frequency: read(row, ['作答频次']),
        isRequired: read(row, ['是否必做']) === '是' || undefined,
        timeLimitMinutes: Number(read(row, ['作答时限分钟'])) || undefined,
        minQuestions: Number(read(row, ['最低题数'])) || undefined,
        usageTiming: read(row, ['使用时机']),
        reAssessmentIntervalDays: Number(read(row, ['重评间隔天数'])) || undefined,
        prerequisiteCodes: parseStringList(read(row, ['前置量表编码'])),
        exclusiveCodes: parseStringList(read(row, ['互斥量表编码'])),
        triggerCondition: read(row, ['触发条件', 'triggerCondition']),
        triggerConditionNote: read(row, ['触发条件说明', 'triggerConditionNote']),
        resultVisibility: read(row, ['结果可见性']),
        responsibleRole: read(row, ['责任角色']),
        dataSensitivity: read(row, ['数据敏感级']),
        sourceType: read(row, ['来源属性']),
        externalAuthorizationNote: read(row, ['外部授权说明']),
        sourceRef: read(row, ['手册出处']),
        normReference: read(row, ['常模参照']),
        reliabilityNote: read(row, ['信度说明']),
        validityNote: read(row, ['效度说明']),
        privacyNotice: read(row, ['隐私声明']),
        applicabilityPreconditions: read(row, ['适用前提']),
        contraindications: read(row, ['不适合情况']),
        postAssessmentActions: read(row, ['后续建议动作']),
        questions,
        dimensionDefs
      }
    })
    .filter(Boolean) as AssessmentDefinition[]
}

function parseAssessmentSheetsLegacy(sheets: SheetData[], module: ModuleId): AssessmentDefinition[] {
  return sheets
    .map((sheet, index) => {
      const first = sheet.rows[0] || {}
      const code = read(first, ['code', 'instrumentCode', '量表编码', '评估编码']) || `${module}/${sheet.name || `instrument-${index + 1}`}`
      const title = read(first, ['title', '量表名称', '评估名称']) || sheet.name || code
      const questions = sheet.rows
        .map((row, qIndex) => {
          const text = read(row, ['questions[].text', 'questionText', '题干', '题项', '题项内容', '题目', '评估条目', '评估提问', '使用端评估提问1', '评估名称'])
          if (!text || isMetadata(text)) return null
          const id = read(row, ['questions[].id', 'questionId', '题号', '编号', '序号', '评估编码']) || `q${qIndex + 1}`
          return {
            id: uniqueId(id, qIndex),
            text,
            dimension: read(row, ['questions[].dimension', 'dimension', '维度', '所属维度', '评估维度', '主要评估维度', '子维度']) || '',
            reverse: parseBool(read(row, ['questions[].reverse', 'reverse', '反向', '是否反向'])),
            options: parseOptions(row)
          }
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
      const seen = new Set<string>()
      return {
        code,
        instrumentCode: code,
        version: read(first, ['version', '版本']) || '1.0.0',
        module,
        title,
        description: read(first, ['description', '说明', '量表说明']) || `${title}（${questions.length}题）`,
        estimatedMinutes: Number(read(first, ['estimatedMinutes', '预计完成时间', '预计用时分钟'])) || Math.max(1, Math.ceil(questions.length / 5)),
        // V2 元数据
        shortName: read(first, ['量表简称', 'shortName']),
        applicableSchoolSection: read(first, ['适用学部']),
        applicableGrades: parseNumberList(read(first, ['适用年级'])),
        applicableSubjects: parseStringList(read(first, ['适用学科'])),
        targetAudience: read(first, ['施测对象']),
        formType: read(first, ['施测形式']),
        triggerMethod: read(first, ['触发方式']),
        frequency: read(first, ['作答频次']),
        isRequired: read(first, ['是否必做']) === '是' || undefined,
        timeLimitMinutes: Number(read(first, ['作答时限分钟'])) || undefined,
        minQuestions: Number(read(first, ['最低题数'])) || undefined,
        usageTiming: read(first, ['使用时机']),
        reAssessmentIntervalDays: Number(read(first, ['重评间隔天数'])) || undefined,
        prerequisiteCodes: parseStringList(read(first, ['前置量表编码'])),
        exclusiveCodes: parseStringList(read(first, ['互斥量表编码'])),
        resultVisibility: read(first, ['结果可见性']),
        responsibleRole: read(first, ['责任角色']),
        dataSensitivity: read(first, ['数据敏感级']),
        sourceType: read(first, ['来源属性']),
        externalAuthorizationNote: read(first, ['外部授权说明']),
        sourceRef: read(first, ['手册出处']),
        normReference: read(first, ['常模参照']),
        reliabilityNote: read(first, ['信度说明']),
        validityNote: read(first, ['效度说明']),
        privacyNotice: read(first, ['隐私声明']),
        applicabilityPreconditions: read(first, ['适用前提']),
        contraindications: read(first, ['不适合情况']),
        postAssessmentActions: read(first, ['后续建议动作']),
        questions: questions.map((question, qIndex) => {
          let id = question.id
          if (seen.has(id)) id = `${id}-${qIndex + 1}`
          seen.add(id)
          return { ...question, id }
        })
      }
    })
    .filter(item => item.questions.length > 0)
}

function parseAssessmentOptionGroups(sheet: SheetData | undefined) {
  const groups: Record<string, Array<{ label: string, value: number }>> = {}
  if (!sheet) return groups
  for (const row of sheet.rows) {
    const code = read(row, ['选项组编码', 'optionGroupCode'])
    const label = read(row, ['选项文本', 'label'])
    const value = Number(read(row, ['分值', 'value']))
    if (!code || !label || !Number.isFinite(value)) continue
    if (!groups[code]) groups[code] = []
    groups[code]!.push({ label, value })
  }
  for (const code of Object.keys(groups)) {
    groups[code]!.sort((a, b) => a.value - b.value)
  }
  return groups
}

function parseAssessmentDimensionDefs(sheet: SheetData | undefined) {
  const byInstrument: Record<string, AssessmentDimensionDef[]> = {}
  if (!sheet) return byInstrument
  for (const row of sheet.rows) {
    const instrumentCode = read(row, ['量表编码', 'instrumentCode'])
    const code = read(row, ['维度编码', 'dimensionCode', 'code'])
    const name = read(row, ['维度名称', 'dimensionName', 'name'])
    if (!instrumentCode || !code || !name) continue
    if (!byInstrument[instrumentCode]) byInstrument[instrumentCode] = []
    byInstrument[instrumentCode]!.push({
      code,
      name,
      questionIds: splitList(read(row, ['所属题号列表', '所属题号', 'questionIds'])),
      calcMethod: (read(row, ['计算方式', 'calcMethod']) || 'mean') as AssessmentDimensionDef['calcMethod'],
      weight: Number(read(row, ['权重系数', 'weight'])) || undefined,
      description: read(row, ['维度说明', 'description']),
      highInterpretation: read(row, ['高分解释', 'highInterpretation']),
      lowInterpretation: read(row, ['低分解释', 'lowInterpretation']),
      normMean: Number(read(row, ['常模均值', 'normMean'])) || undefined,
      normStd: Number(read(row, ['常模标准差', 'normStd'])) || undefined
    })
  }
  return byInstrument
}

function parseAssessmentQuestions(
  sheet: SheetData,
  instrumentCode: string,
  dimensionDefs: AssessmentDimensionDef[],
  optionGroups: Record<string, Array<{ label: string, value: number }>>
) {
  const rows = sheet.rows.filter(row => read(row, ['量表编码', 'instrumentCode']) === instrumentCode)
  const questions: AssessmentDefinition['questions'] = []
  const seen = new Set<string>()
  for (const [index, row] of rows.entries()) {
    const text = read(row, ['questions[].text', 'questionText', '题干', '题项', '题项内容', '题目', '评估条目', '评估提问', '使用端评估提问1'])
    if (!text || isMetadata(text)) continue
    const rawId = read(row, ['questions[].id', 'questionId', '题号', '编号', '序号']) || `q${index + 1}`
    let id = uniqueId(rawId, index)
    if (seen.has(id)) id = `${id}-${index + 1}`
    seen.add(id)

    const rawDimension = read(row, ['维度编码', 'questions[].dimension', 'dimension', '维度', '所属维度', '评估维度', '主要评估维度', '子维度']) || ''
    const matchedDimension = dimensionDefs.find(item => item.code === rawDimension || item.name === rawDimension)
    const optionGroupCode = read(row, ['选项组编码', 'optionGroupCode'])
    const options = optionGroupCode && optionGroups[optionGroupCode]?.length
      ? optionGroups[optionGroupCode]!
      : parseOptions(row)
    questions.push({
      id,
      text,
      dimension: matchedDimension?.code || rawDimension,
      reverse: parseBool(read(row, ['questions[].reverse', 'reverse', '反向计分', '反向', '是否反向'])),
      help: read(row, ['答题提示', '题目说明', 'help']),
      options
    })
  }
  return questions
}

function parseToolSheets(sheets: SheetData[]): ToolRxEntry[] {
  const tools: ToolRxEntry[] = []
  const stepMap = new Map<string, ToolStructuredStep[]>()
  const contraMap = new Map<string, ToolContraindicationRule[]>()

  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      // ---- ⑦b 工具-步骤明细 ----
      const stepSeq = read(row, ['步骤序号', 'seq'])
      const stepTitle = read(row, ['步骤标题', 'title'])
      if (stepSeq && stepTitle) {
        const toolCode = read(row, ['工具编码', 'code']) || ''
        const step: ToolStructuredStep = {
          seq: Number(stepSeq),
          title: stepTitle,
          description: read(row, ['步骤说明', 'description']) || '',
        }
        assignIfPresent(step, 'estimatedTime', read(row, ['预计耗时', 'estimatedTime']))
        assignIfPresent(step, 'materials', read(row, ['所需材料', 'materials']))
        assignIfPresent(step, 'keyTip', read(row, ['关键提示', 'keyTip']))
        assignIfPresent(step, 'scriptTemplate', read(row, ['话术模板', 'scriptTemplate']))
        assignIfPresent(step, 'successCriteria', read(row, ['成功标准', 'successCriteria']))
        assignIfPresent(step, 'commonIssues', read(row, ['常见问题', 'commonIssues']))
        if (!stepMap.has(toolCode)) stepMap.set(toolCode, [])
        stepMap.get(toolCode)!.push(step)
        continue
      }

      // ---- ⑧ 工具-禁忌规则 ----
      const contraCondition = read(row, ['禁忌条件', 'condition'])
      const contraType = read(row, ['禁忌类型', 'type'])
      if (contraCondition && contraType) {
        const toolCode = read(row, ['工具编码', 'code']) || ''
        const rule: ToolContraindicationRule = {
          condition: contraCondition,
          type: contraType as ToolContraindicationRule['type'],
          description: read(row, ['禁忌说明', 'description']) || '',
        }
        assignIfPresent(rule, 'alternativeSuggestion', read(row, ['替代建议', 'alternativeSuggestion']))
        assignIfPresent(rule, 'applicableTeacherGroup', read(row, ['适用教师群体', 'applicableTeacherGroup']))
        assignIfPresent(rule, 'reference', read(row, ['依据', 'reference']))
        if (!contraMap.has(toolCode)) contraMap.set(toolCode, [])
        contraMap.get(toolCode)!.push(rule)
        continue
      }

      // ---- ⑦ 工具-处方总表 (主表) ----
      const code = read(row, ['code', '工具编码', '工具ID', '编号'])
      const name = read(row, ['name', '工具名称', '处方名称'])
      const steps = splitList(read(row, ['steps', '执行步骤', '操作步骤', '操作步骤（详细）', '具体操作步骤', '核心操作', '操作步骤摘要']))
      if (!code || !name || !steps.length) continue
      const tool: ToolRxEntry = {
        code,
        name,
        form: read(row, ['form', '工具形式', '处方形式', '工具类型']) || '',
        symptoms: read(row, ['symptoms', '适用症状/场景', '适用问题/场景', '适用场景', '触发情景', '适用症状场景']) || '',
        steps
      }
      assignIfPresent(tool, 'expectedEffect', read(row, ['expectedEffect', '预期输出或效果', '预期效果', '输出物']))
      assignIfPresent(tool, 'severity', parseSeverity(read(row, ['severity', '严重度分级', '严重度'])))
      assignIfPresent(tool, 'level', read(row, ['level', '适用等级', '等级']))
      // 「对应归因编码」列允许分号/逗号分隔多值：第一个进单值字段，全量进列表字段供匹配
      const attributionRefs = splitList(read(row, ['attributionCode', '对应归因编码', '归因编码']))
      const attributionListOnly = splitList(read(row, ['attributionCodes', '对应归因编码列表', '归因编码列表']))
      const mergedAttributionRefs = attributionRefs.length > 1
        ? attributionRefs
        : attributionRefs.length === 1 && attributionListOnly.length
          ? [...new Set([...attributionRefs, ...attributionListOnly])]
          : attributionRefs.length ? attributionRefs : attributionListOnly
      assignIfPresent(tool, 'attributionCode', mergedAttributionRefs[0])
      if (mergedAttributionRefs.length > 1) assignIfPresent(tool, 'attributionCodes', mergedAttributionRefs)
      assignIfPresent(tool, 'attributionLabel', read(row, ['attributionLabel', '对应归因名称', '对应归因']))
      assignIfPresent(tool, 'tags', splitList(read(row, ['tags', '场景标签', '标签'])))
      assignIfPresent(tool, 'toolTags', splitList(read(row, ['toolTags', '工具标签', '匹配标签'])))
      assignIfPresent(tool, 'duration', read(row, ['duration', '建议周期', '疗程与频次']))
      assignIfPresent(tool, 'timePerSession', read(row, ['timePerSession', '单次时长', '单次耗时']))
      assignIfPresent(tool, 'scripts', read(row, ['scripts', '关键话术', '话术']))
      assignIfPresent(tool, 'prohibitions', read(row, ['prohibitions', '禁忌条件', '禁止事项', '禁忌说明']))
      assignIfPresent(tool, 'targetUsers', read(row, ['targetUsers', '适用对象', '责任角色']))
      assignIfPresent(tool, 'dimensions', splitList(read(row, ['dimensions', '作用维度编码', '适用维度', '作用维度', '维度'])))
      assignIfPresent(tool, 'effectNote', read(row, ['effectNote', '效果说明']))
      // V2 新增
      assignIfPresent(tool, 'shortName', read(row, ['工具简称']))
      assignIfPresent(tool, 'prerequisiteToolCode', read(row, ['前置工具编码']))
      assignIfPresent(tool, 'alternativeToolCode', read(row, ['替代工具编码']))
      assignIfPresent(tool, 'advancedToolCode', read(row, ['进阶工具编码']))
      assignIfPresent(tool, 'evidenceLevel', read(row, ['证据等级']) as ToolRxEntry['evidenceLevel'])
      assignIfPresent(tool, 'evidenceSource', read(row, ['证据来源']))
      assignIfPresent(tool, 'outcomeIndicators', read(row, ['效果指标']))
      assignIfPresent(tool, 'failureCriteria', read(row, ['失败标准']))
      assignIfPresent(tool, 'preparationNeeded', read(row, ['准备事项']))
      assignIfPresent(tool, 'materialsRequired', read(row, ['所需材料']))
      assignIfPresent(tool, 'outputArtifact', read(row, ['输出物']))
      assignIfPresent(tool, 'collaborativeToolCodes', splitList(read(row, ['协同工具编码'])))
      assignIfPresent(tool, 'crossModuleTags', splitList(read(row, ['跨模块标签'])))
      assignIfPresent(tool, 'sourceRef', read(row, ['手册出处']))
      // V2 模板补齐
      assignIfPresent(tool, 'applicableSchoolSection', read(row, ['适用学部']))
      assignIfPresent(tool, 'reAssessmentIntervalDays', Number(read(row, ['重评间隔天数'])) || undefined)
      assignIfPresent(tool, 'contraindicationNote', read(row, ['禁忌说明']))
      assignIfPresent(tool, 'toolVersion', read(row, ['版本']))
      tools.push(tool)
    }
  }

  // 合并结构化步骤和禁忌规则到对应工具
  for (const tool of tools) {
    const toolCode = tool.code
    if (stepMap.has(toolCode)) {
      tool.structuredSteps = stepMap.get(toolCode)
    }
    if (contraMap.has(toolCode)) {
      tool.contraindicationRules = contraMap.get(toolCode)
    }
  }

  return tools
}

function assignIfPresent<T extends Record<string, unknown>, K extends keyof T>(target: T, key: K, value: T[K] | undefined) {
  if (value === undefined) return
  if (Array.isArray(value) && value.length === 0) return
  if (typeof value === 'string' && !value.trim()) return
  target[key] = value
}

function parseAttributionSheets(sheets: SheetData[], module: ModuleId) {
  const computed: Record<string, string> = {}
  const attributionItems: Array<Record<string, unknown>> = []
  const evidences: Array<Record<string, unknown>> = []
  const gradingRules: Array<Record<string, unknown>> = []
  const redLines: Array<Record<string, unknown>> = []
  const actions: Array<{ title: string, detail: string, status: 'pending' }> = []
  const tools: Array<{ title: string, content: string }> = []
  let version = '1.0.0'

  const computedSheet = findSheet(sheets, [/⑤b|计算变量/])
  // 只按实义名匹配，不能用 ⑤c 序号前缀——v2 的「⑤c 归因-分级规则」会被误命中，
  // 于是 v2 文件走进 v3 解析路径、抽不出归因项，报出的错还指向别处。
  const attributionItemSheet = findSheet(sheets, [/归因项|归因清单/])
  const evidenceSheet = findSheet(sheets, [/⑤d|证据规则/])
  const gradingSheet = findSheet(sheets, [/⑤e|分级规则/])
  const redLineSheet = findSheet(sheets, [/⑥|红线熔断/])
  const genericRows = !attributionItemSheet && !evidenceSheet && !gradingSheet
    ? sheets.flatMap(sheet => sheet.rows)
    : []

  for (const sheet of [computedSheet, attributionItemSheet, evidenceSheet, gradingSheet, redLineSheet]) {
    for (const row of sheet?.rows || []) {
      version = read(row, ['version', '版本']) || version
    }
  }
  for (const row of genericRows) {
    version = read(row, ['version', '版本']) || version
  }

  for (const row of computedSheet?.rows || genericRows) {
    const variableName = read(row, ['variableName', '变量名', '变量编码'])
    const expression = read(row, ['expression', '表达式', '计算表达式'])
    if (variableName && expression) computed[variableName] = expression
  }

  for (const row of attributionItemSheet?.rows || genericRows) {
    const attributionCode = read(row, ['attributionCode', '归因编码'])
    const attributionName = read(row, ['attributionName', '归因名称'])
    if (attributionCode && attributionName) {
      attributionItems.push({
        code: attributionCode,
        name: attributionName,
        module,
        baseWeight: Number(read(row, ['baseWeight', '权重基数'])) || 1,
        toolTags: splitList(read(row, ['toolTags', '工具标签', '匹配标签'])),
        description: read(row, ['归因说明', 'description']),
        highManifestation: read(row, ['高分表现']),
        typicalTrigger: read(row, ['典型诱因']),
        suggestedAction: read(row, ['建议动作']),
        sourceRef: read(row, ['手册出处'])
      })
    }
  }

  for (const row of evidenceSheet?.rows || genericRows) {
    const evidenceAttribution = read(row, ['evidenceAttributionCode', '证据归因编码', '归因编码', 'attributionCode'])
    const evidenceCondition = read(row, ['evidenceCondition', '证据触发条件', '触发条件', '条件表达式', 'condition', 'when'])
    const evidenceAssessment = read(row, ['evidenceAssessmentCode', '证据依据量表编码', '依据量表编码', '量表编码', 'assessmentCode'])
    if (evidenceAttribution && evidenceCondition && evidenceAssessment) {
      evidences.push({
        attributionCode: evidenceAttribution,
        assessmentCode: evidenceAssessment,
        evidenceCode: read(row, ['evidenceCode', '证据编码']) || `${evidenceAttribution}-EV${evidences.length + 1}`,
        condition: evidenceCondition,
        weight: Number(read(row, ['evidenceWeight', '证据权重', 'weight', '权重'])) || 1,
        description: read(row, ['证据说明', 'evidenceDescription']) || `命中条件 ${evidenceCondition}`,
        sourceRef: read(row, ['手册出处'])
      })
    }
  }

  for (const row of gradingSheet?.rows || genericRows) {
    const ruleId = read(row, ['ruleId', '规则编码', '规则ID'])
    const level = read(row, ['level', '等级', '输出等级', '命中等级'])
    if (level) {
      gradingRules.push({
        ruleId: ruleId || `${module}-grading-${gradingRules.length + 1}`,
        assessmentCode: read(row, ['依据量表编码', '量表编码']) || undefined,
        pri: Number(read(row, ['priority', 'pri', '优先级'])) || gradingRules.length + 1,
        when: read(row, ['when', '条件表达式', '触发条件', '命中条件']) || undefined,
        level,
        levelName: read(row, ['等级中文名']),
        severity: parseSeverity(read(row, ['severity', '严重度'])),
        blocked: parseBool(read(row, ['blocked', '是否红线熔断', '是否阻断', '阻断'])),
        resultDescription: read(row, ['结果说明']),
        escalationCondition: read(row, ['升级条件']),
        escalationTarget: read(row, ['升级目标']),
        reEvaluationTrigger: read(row, ['复评触发条件']),
        sourceRef: read(row, ['手册出处'])
      })
    }
  }

  for (const row of redLineSheet?.rows || genericRows) {
    const redCondition = read(row, ['红线条件', 'redLineCondition'])
    const redDescription = read(row, ['红线说明', 'redLineDescription'])
    if (redCondition && redDescription) {
      redLines.push({
        module,
        condition: redCondition,
        description: redDescription,
        scope: read(row, ['熔断范围', 'scope']) || 'module',
        requiredActions: read(row, ['处置要求', 'requiredActions']) || '',
        actions: splitList(read(row, ['熔断后动作', 'actions'])),
        recoveryCondition: read(row, ['恢复条件', 'recoveryCondition']),
        responsibleRole: read(row, ['责任人', 'responsibleRole']),
        notificationTemplate: read(row, ['通知模板', 'notificationTemplate']),
        sourceRef: read(row, ['手册出处', 'sourceRef']),
      })
    }
  }

  for (const row of genericRows) {
    const actionTitle = read(row, ['actionTitle', '行动标题'])
    const actionDetail = read(row, ['actionDetail', '行动详情'])
    if (actionTitle && actionDetail) actions.push({ title: actionTitle, detail: actionDetail, status: 'pending' })
    const toolTitle = read(row, ['toolTitle', '工具标题'])
    const toolContent = read(row, ['toolContent', '工具内容'])
    if (toolTitle && toolContent) tools.push({ title: toolTitle, content: toolContent })
  }

  // v2 结构识别：v2 把归因和分级混在一张「⑤c 归因-分级规则」里，用「主归因」列承载归因。
  // 直接交给 zod 会抛出 attributionItems too_small 的原始报错，业务完全看不懂，
  // 所以这里先给一条能照着改的提示。
  const looksLikeV2 = sheets.some(sheet =>
    sheet.rows.some(row => Object.keys(row).some(key => key.startsWith('主归因')))
  )
  if (!attributionItems.length && looksLikeV2) {
    throw new Error(
      '检测到 v2 版归因库结构（「⑤c 归因-分级规则」里带「主归因」列）。'
      + 'v3 已把它拆成三张 sheet：⑤c 归因项（归因编码/归因名称/权重基数）、'
      + '⑤d 证据规则（归因编码/依据量表编码/触发条件/证据权重）、'
      + '⑤e 分级规则（只保留等级与严重度）。'
      + '请改用 business-libraries/templates/三库填写模板_v4.xlsx 重新填写后再导入。'
    )
  }
  if (!attributionItems.length) {
    throw new Error('归因库缺少「⑤c 归因项」Sheet 或该 Sheet 没有有效行；请对照 v4 模板补齐归因编码与归因名称。')
  }
  if (!evidences.length) {
    throw new Error('归因库缺少「⑤d 证据规则」Sheet；没有证据规则，任何归因都算不出分。')
  }
  if (!gradingRules.length) {
    throw new Error('归因库缺少「⑤e 分级规则」Sheet；至少需要一条不带触发条件的兜底规则。')
  }

  return attributionConfigSchema.parse({
    module, version, computed, attributionItems, evidences, gradingRules, actions, tools, redLines
  })
}

function parseKeywordRouteSheets(sheets: SheetData[], module: ModuleId): KeywordRouteEntry[] {
  return sheets.flatMap(sheet => sheet.rows.map((row): KeywordRouteEntry | null => {
    const code = read(row, ['关键词编码', 'code'])
    const coreKeywords = read(row, ['核心触发词', 'coreKeywords'])
    if (!code || !coreKeywords) return null
    return {
      code,
      coreKeywords,
      expandedKeywords: read(row, ['扩展词与近义表达', 'expandedKeywords']),
      exclusionKeywords: splitList(read(row, ['排除词', 'exclusionKeywords'])),
      module,
      matchPriority: Number(read(row, ['匹配优先级', 'matchPriority'])) || 0,
      matchMode: (read(row, ['匹配模式', 'matchMode']) || 'fuzzy') as KeywordRouteEntry['matchMode'],
      riskLevel: read(row, ['风险等级', 'riskLevel']) || 'low',
      semanticCategory: read(row, ['语义分类', 'semanticCategory']),
      linkedAssessmentCode: read(row, ['关联量表编码', 'linkedAssessmentCode']),
      linkedToolCode: read(row, ['关联工具编码', 'linkedToolCode']),
      contextConstraint: read(row, ['情境限定', 'contextConstraint']),
      routeWeight: Number(read(row, ['路由权重', 'routeWeight'])) || undefined,
      temporalValidity: (read(row, ['时效性', 'temporalValidity']) || 'always') as KeywordRouteEntry['temporalValidity'],
      description: read(row, ['场景描述', 'description']),
    }
  }).filter((item): item is KeywordRouteEntry => Boolean(item)))
}

function parseOutputTemplateSheets(sheets: SheetData[], module: ModuleId): OutputTemplateEntry[] {
  return sheets.flatMap(sheet => sheet.rows.map((row): OutputTemplateEntry | null => {
    const code = read(row, ['模板编码', 'code'])
    const type = read(row, ['模板类型', 'type'])
    const content = read(row, ['模板内容', 'content'])
    if (!code || !type || !content) return null
    return {
      code,
      module,
      attributionLevel: read(row, ['命中归因等级', 'attributionLevel']) || '',
      type: type as OutputTemplateEntry['type'],
      content,
      placeholders: read(row, ['占位符说明', 'placeholders']),
      order: Number(read(row, ['排序', 'order'])) || 0,
    }
  }).filter((item): item is OutputTemplateEntry => Boolean(item)))
}

export interface KnowledgeEntry {
  title: string
  module: ModuleId
  sourceType: string
  tags: string[]
  content: string
  sourceRef?: string
  notes?: string
}

const VALID_SOURCE_TYPES = ['markdown', 'text', 'json'] as const
const MODULE_IDS: ModuleId[] = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']

export function parseKnowledgeSheets(sheets: SheetData[], defaultModule: ModuleId): KnowledgeEntry[] {
  // 查找「知识文档」Sheet（优先按名匹配，fallback 按含知识/文档关键字的 Sheet 或第一个数据 Sheet）
  const targetSheet = sheets.find(s => /知识文档|知识库|knowledge/i.test(s.name)) || sheets[0]
  if (!targetSheet) return []

  return targetSheet.rows.map((row): KnowledgeEntry | null => {
    const title = read(row, ['文档标题', 'title'])
    const content = read(row, ['文档内容', 'content'])
    if (!title || !content) return null

    // 所属模块：优先取行内值，否则用导入参数
    const moduleRaw = read(row, ['所属模块', 'module'])
    let entryModule = defaultModule
    if (moduleRaw) {
      const matched = MODULE_IDS.find(m => m === moduleRaw || moduleRaw.includes(m))
      if (matched) entryModule = matched
    }

    // 来源类型
    const sourceTypeRaw = read(row, ['来源类型', 'sourceType'])
    const sourceType = sourceTypeRaw && VALID_SOURCE_TYPES.includes(sourceTypeRaw as typeof VALID_SOURCE_TYPES[number])
      ? sourceTypeRaw
      : 'markdown'

    // 标签关键词：逗号/分号分隔
    const tagsRaw = read(row, ['标签关键词', 'tags'])
    const tags = tagsRaw ? tagsRaw.split(/[,，;；]/).map(t => t.trim()).filter(Boolean) : []

    return {
      title,
      module: entryModule,
      sourceType,
      tags,
      content,
      sourceRef: read(row, ['来源出处', 'sourceRef']),
      notes: read(row, ['备注', 'notes']),
    }
  }).filter((item): item is KnowledgeEntry => Boolean(item))
}

function read(row: Record<string, string | undefined>, keys: string[]) {
  for (const key of keys) {
    if (row[key]) return row[key]
  }
  const headers = Object.keys(row)
  for (const key of keys) {
    const normalizedKey = normalizeKey(key)
    const match = headers.find(header => normalizeKey(header) === normalizedKey || normalizeKey(header).includes(normalizedKey))
    if (match && row[match]) return row[match]
  }
  return undefined
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[.[\]\s_（）()：:]/g, '')
}

function parseOptions(row: Record<string, string | undefined>) {
  const raw = read(row, ['options', '选项', '选项与分值', '计分', '评分锚点'])
  if (raw) {
    const parsed = splitList(raw)
      .map((item) => {
        const match = item.match(/(-?\d+(?:\.\d+)?)\s*[=:：]\s*(.+)|(.+?)\s*[=:：]\s*(-?\d+(?:\.\d+)?)/)
        if (!match) return null
        const value = Number(match[1] || match[4])
        const label = String(match[2] || match[3] || '').trim()
        return Number.isFinite(value) && label ? { label, value } : null
      })
      .filter((item): item is { label: string, value: number } => Boolean(item))
    if (parsed.length >= 2) return parsed
  }
  return [
    { label: '完全不符合', value: 1 },
    { label: '比较不符合', value: 2 },
    { label: '一般', value: 3 },
    { label: '比较符合', value: 4 },
    { label: '非常符合', value: 5 }
  ]
}

function splitList(value: string | undefined): string[] {
  return (value || '').split(/[,，、;；\n]/).map(item => item.trim()).filter(Boolean)
}

function parseStringList(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const result = splitList(value)
  return result.length > 0 ? result : undefined
}

function parseNumberList(value: string | undefined): number[] | undefined {
  if (!value) return undefined
  const result = value.split(/[,，、;；\s]+/).map(v => Number(v.trim())).filter(n => Number.isFinite(n))
  return result.length > 0 ? result : undefined
}

const SEVERITY_ALIASES: Record<string, Severity> = {
  low: 'low', medium: 'medium', high: 'high', crisis: 'crisis',
  轻度: 'low', 中度: 'medium', 重度: 'high', 危机: 'crisis',
  低: 'low', 中: 'medium', 高: 'high'
}

/** 严重度归一化。归因库分级规则与工具库必须落在同一套枚举上。 */
function parseSeverity(value: string | undefined): Severity {
  return SEVERITY_ALIASES[(value || '').trim().toLowerCase()] || 'medium'
}

function parseBool(value: string | undefined) {
  return ['是', 'true', 'yes', '1', 'y', '反向', '阻断'].includes((value || '').trim().toLowerCase())
}

function uniqueId(id: string, index: number) {
  const value = id.trim()
  if (!value || isMetadata(value)) return `q${index + 1}`
  return value.replace(/\s+/g, '-').slice(0, 60)
}

function isMetadata(value: string) {
  return /^(评分规则|评分标准|计分规则|结果判读|阈值分级|使用说明|来源|指导语|适用学段)$/i.test(value.trim())
}

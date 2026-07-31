// 工具库 transformer：将各种格式的工具 xlsx → ToolRxEntry[]
// V2 支持：⑦ 工具-处方总表 + ⑦b 工具-步骤明细 + ⑧ 工具-禁忌规则
import type { ToolRxEntry, ToolStructuredStep, ToolContraindicationRule } from '../../../shared/contracts'
import { readXlsxFile, extractValue, type SheetData } from '../xlsx-reader'

/**
 * 严重度归一化。工具库与归因库的分级规则必须落在同一套枚举上，
 * 否则运行时拿两套词做比对，永远匹配不上。填了无法识别的值返回 undefined，
 * 由校验环节报错，而不是静默降级成某个默认档位。
 */
const SEVERITY_ALIASES: Record<string, ToolRxEntry['severity']> = {
  low: 'low', medium: 'medium', high: 'high', crisis: 'crisis',
  轻度: 'low', 中度: 'medium', 重度: 'high', 危机: 'crisis',
  低: 'low', 中: 'medium', 高: 'high'
}

function parseSeverity(value: string | undefined): ToolRxEntry['severity'] {
  const normalized = (value || '').trim().toLowerCase()
  if (!normalized) return undefined
  return SEVERITY_ALIASES[normalized]
}

function splitList(value: string | undefined): string[] {
  return (value || '')
    .split(/[,，、;；\n]/)
    .map(item => item.trim())
    .filter(Boolean)
}

/**
 * ⑦「对应归因编码」列：业务很自然地会用分号填多个归因（一个工具对多个归因）。
 * 不拆开的话整串会变成一个永不匹配的假编码——正是模板总览警告的
 * 「静默失败：方案里没有工具」。第一个值进单值字段兼容旧消费方，全量进列表字段供匹配。
 */
function parseAttributionRefs(row: Record<string, string | undefined>): { attributionCode?: string, attributionCodes?: string[] } {
  const refs = splitList(extractValue(row, ['对应归因编码', '归因编码', 'attributionCode']))
  const listOnly = splitList(extractValue(row, ['对应归因编码列表', '归因编码列表', 'attributionCodes']))
  const merged = refs.length > 1 ? refs : (refs.length === 1 && listOnly.length ? [...new Set([...refs, ...listOnly])] : refs.length ? refs : listOnly)
  return {
    attributionCode: merged[0],
    attributionCodes: merged.length > 1 ? merged : undefined
  }
}

function parseStringList(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const result = splitList(value)
  return result.length > 0 ? result : undefined
}

/**
 * V2 格式解析：从 ⑦ 工具-处方总表 + ⑦b 工具-步骤明细 + ⑧ 工具-禁忌规则 组装
 */
function parseToolFileV2(sheets: SheetData[]): ToolRxEntry[] {
  const mainSheet = sheets.find(s => /⑦[^b]|处方总表|工具-处方/.test(s.name))
  const stepSheet = sheets.find(s => /⑦b|步骤明细/.test(s.name))
  const contraSheet = sheets.find(s => /⑧|禁忌规则/.test(s.name))

  if (!mainSheet) return []

  // 预解析结构化步骤和禁忌规则，按 toolCode 分组
  const stepsByCode = parseStructuredSteps(stepSheet)
  const contraindicationsByCode = parseContraindicationRules(contraSheet)

  const entries: ToolRxEntry[] = []

  for (const row of mainSheet.rows) {
    const code = extractValue(row, ['工具编码', '工具ID', '编号', 'code'])
    const name = extractValue(row, ['工具名称', '处方名称', 'name'])
    if (!code || !name) continue

    const stepsRaw = extractValue(row, ['操作步骤摘要', '执行步骤', '操作步骤'])
    const steps = splitList(stepsRaw)
    const attributionRefs = parseAttributionRefs(row)

    entries.push({
      code,
      name,
      form: extractValue(row, ['工具形式', '处方形式', '工具类型', 'form']) || '',
      symptoms: extractValue(row, ['适用症状场景', '适用症状/场景', '适用问题/场景', 'symptoms']) || '',
      expectedEffect: extractValue(row, ['预期效果', 'expectedEffect']),
      severity: parseSeverity(extractValue(row, ['严重度', '严重度分级', 'severity'])),
      level: extractValue(row, ['适用等级', 'level']),
      attributionCode: attributionRefs.attributionCode,
      attributionCodes: attributionRefs.attributionCodes,
      attributionLabel: extractValue(row, ['对应归因名称', '对应归因', 'attributionLabel']),
      tags: parseStringList(extractValue(row, ['tags', '场景标签', '标签'])),
      toolTags: parseStringList(extractValue(row, ['工具标签', '匹配标签', 'toolTags'])),
      duration: extractValue(row, ['疗程与频次', 'duration']),
      timePerSession: extractValue(row, ['单次耗时', 'timePerSession']),
      steps: steps.length > 0 ? steps : ['详见结构化步骤'],
      scripts: extractValue(row, ['关键话术', 'scripts']),
      prohibitions: extractValue(row, ['禁止事项', '禁忌说明', 'prohibitions']),
      targetUsers: extractValue(row, ['适用对象', 'targetUsers']),
      dimensions: parseStringList(extractValue(row, ['作用维度编码', '作用维度', '维度', 'dimensions'])),
      effectNote: extractValue(row, ['效果说明', 'effectNote']),
      // V2 新增
      shortName: extractValue(row, ['工具简称']),
      prerequisiteToolCode: extractValue(row, ['前置工具编码']),
      alternativeToolCode: extractValue(row, ['替代工具编码']),
      advancedToolCode: extractValue(row, ['进阶工具编码']),
      evidenceLevel: extractValue(row, ['证据等级']) as ToolRxEntry['evidenceLevel'],
      evidenceSource: extractValue(row, ['证据来源']),
      outcomeIndicators: extractValue(row, ['效果指标']),
      failureCriteria: extractValue(row, ['失败标准']),
      preparationNeeded: extractValue(row, ['准备事项']),
      materialsRequired: extractValue(row, ['所需材料']),
      outputArtifact: extractValue(row, ['输出物']),
      collaborativeToolCodes: parseStringList(extractValue(row, ['协同工具编码'])),
      crossModuleTags: parseStringList(extractValue(row, ['跨模块标签'])),
      sourceRef: extractValue(row, ['手册出处']),
      // V2 模板补齐
      applicableSchoolSection: extractValue(row, ['适用学部']),
      reAssessmentIntervalDays: Number(extractValue(row, ['重评间隔天数'])) || undefined,
      contraindicationNote: extractValue(row, ['禁忌说明']),
      structuredSteps: stepsByCode[code],
      contraindicationRules: contraindicationsByCode[code],
    })
  }

  return entries
}

/** 解析 ⑦b 工具-步骤明细，按工具编码分组 */
function parseStructuredSteps(sheet: SheetData | undefined): Record<string, ToolStructuredStep[]> {
  const result: Record<string, ToolStructuredStep[]> = {}
  if (!sheet) return result

  for (const row of sheet.rows) {
    const toolCode = extractValue(row, ['工具编码'])
    const seq = Number(extractValue(row, ['步骤序号']))
    if (!toolCode || !Number.isFinite(seq)) continue

    if (!result[toolCode]) result[toolCode] = []

    result[toolCode]!.push({
      seq,
      title: extractValue(row, ['步骤标题']) || '',
      description: extractValue(row, ['步骤说明']) || '',
      estimatedTime: extractValue(row, ['预计耗时']),
      materials: extractValue(row, ['所需材料']),
      keyTip: extractValue(row, ['关键提示']),
      scriptTemplate: extractValue(row, ['话术模板']),
      successCriteria: extractValue(row, ['成功标准']),
      commonIssues: extractValue(row, ['常见问题']),
    })
  }

  // 按 seq 排序
  for (const key of Object.keys(result)) {
    result[key]!.sort((a, b) => a.seq - b.seq)
  }

  return result
}

/** 解析 ⑧ 工具-禁忌规则，按工具编码分组 */
function parseContraindicationRules(sheet: SheetData | undefined): Record<string, ToolContraindicationRule[]> {
  const result: Record<string, ToolContraindicationRule[]> = {}
  if (!sheet) return result

  for (const row of sheet.rows) {
    const toolCode = extractValue(row, ['工具编码'])
    const condition = extractValue(row, ['禁忌条件', 'condition'])
    if (!toolCode || !condition) continue

    if (!result[toolCode]) result[toolCode] = []

    result[toolCode]!.push({
      condition,
      type: (extractValue(row, ['禁忌类型', 'type']) || 'warn') as 'block' | 'warn',
      description: extractValue(row, ['禁忌说明', 'description']) || '',
      alternativeSuggestion: extractValue(row, ['替代建议', 'alternativeSuggestion']),
      applicableTeacherGroup: extractValue(row, ['适用教师群体']),
      reference: extractValue(row, ['依据', 'reference']),
    })
  }

  return result
}

// ========== 旧格式解析器（保持向后兼容） ==========

/**
 * 处方总表格式 (self_growth, student_case)
 */
function parseRxFormat(filePath: string): ToolRxEntry[] {
  const sheets = readXlsxFile(filePath, { sheetFilter: name => name.includes('总表') || name.includes('处方') })
  const entries: ToolRxEntry[] = []

  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const code = row['编号'] || row['处方编号'] || ''
      const name = row['处方名称'] || row['工具名称'] || ''
      if (!code || !name) continue

      const stepsRaw = row['操作步骤（详细）'] || row['操作步骤'] || row['核心操作'] || ''
      const steps = stepsRaw.split(/[;；\n]/).map(s => s.trim()).filter(Boolean)

      entries.push({
        code, name,
        form: row['处方形式'] || row['工具类型'] || '',
        symptoms: row['适用症状/场景'] || row['适用问题/场景'] || '',
        expectedEffect: row['预期效果'] || undefined,
        severity: parseSeverity(row['严重度分级']),
        duration: row['疗程与频次'] || undefined,
        timePerSession: row['单次耗时'] || undefined,
        steps,
        scripts: row['关键话术'] || undefined,
        prohibitions: row['禁止事项'] || undefined,
        targetUsers: row['适用对象'] || undefined,
        dimensions: (row['作用维度编码'] || row['作用维度'] || row['维度'] || '')?.split(/[,，、+]/).map(d => d.trim()).filter(Boolean) || undefined,
      })
    }
  }

  return entries
}

/**
 * 班级系统工具索引格式 (class_system)
 */
function parseClassSystemFormat(filePath: string): ToolRxEntry[] {
  const sheets = readXlsxFile(filePath, { sheetFilter: name => name.includes('索引') || name.includes('工具') })
  const entries: ToolRxEntry[] = []

  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const code = row['工具ID'] || ''
      const name = row['工具名称'] || ''
      if (!code || !name) continue

      const stepsRaw = row['核心操作(摘要)'] || row['核心操作'] || row['操作步骤'] || ''
      const steps = stepsRaw.split(/[;；\n]/).map(s => s.trim()).filter(Boolean)

      entries.push({
        code, name,
        form: row['所属模块'] || row['模块'] || '',
        symptoms: row['适用问题/场景'] || row['适用场景'] || '',
        steps,
        scripts: undefined,
        prohibitions: undefined,
        dimensions: [row['所属模块'] || ''].filter(Boolean),
      })
    }
  }

  return entries
}

/**
 * 家校沟通工具库格式 (home_school)
 */
function parseHomeSchoolFormat(filePath: string): ToolRxEntry[] {
  const sheets = readXlsxFile(filePath, { headerRowIndex: 1, sheetFilter: name => name.includes('工具库') && !name.includes('说明') })
  const entries: ToolRxEntry[] = []

  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const code = row['模块编码'] || ''
      const name = row['模块名称'] || ''
      if (!code || !name) continue

      const stepsRaw = row['解决处理路径'] || row['核心方法_工具'] || ''
      const steps = stepsRaw.split(/[;；]/).map(s => s.trim()).filter(Boolean)

      entries.push({
        code, name,
        form: row['所属类别'] || '',
        symptoms: row['适用场景_触发条件'] || row['模块说明'] || '',
        steps,
        scripts: undefined,
        prohibitions: undefined,
        targetUsers: row['责任角色'] || undefined,
        dimensions: (row['关联技术标签'] || '')?.split(/[;；]/).map(d => d.trim()).filter(Boolean) || undefined,
      })
    }
  }

  return entries
}

/**
 * 学习问题工具库格式 (learning_problem): 多 Sheet，每 Sheet 一个流程阶段
 */
function parseLearningProblemFormat(filePath: string): ToolRxEntry[] {
  const sheets = readXlsxFile(filePath, { sheetFilter: name => !name.includes('说明') && !name.includes('总表') })
  const entries: ToolRxEntry[] = []

  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const code = row['工具ID'] || ''
      const name = row['工具名称'] || ''
      if (!code || !name) continue

      const stepsRaw = row['具体操作步骤'] || row['操作步骤'] || ''
      const steps = stepsRaw.split(/[;；\n]/).map(s => s.trim()).filter(Boolean)

      entries.push({
        code, name,
        form: row['工具类型'] || '',
        symptoms: row['触发情景（调用条件）'] || row['触发情景'] || row['工具说明'] || '',
        expectedEffect: row['输出物'] || undefined,
        steps,
        scripts: undefined,
        prohibitions: undefined,
        targetUsers: row['适用人群'] || undefined,
        dimensions: (row['子维度'] || row['关联/协同工具'] || '')?.split(/[,，、→]/).map(d => d.replace(/[←→]/g, '').trim()).filter(Boolean) || undefined,
      })
    }
  }

  return entries
}

type ToolFileFormat = 'rx' | 'class_system' | 'home_school' | 'learning_problem'

export function parseToolFile(filePath: string, format: ToolFileFormat): ToolRxEntry[] {
  switch (format) {
    case 'rx': return parseRxFormat(filePath)
    case 'class_system': return parseClassSystemFormat(filePath)
    case 'home_school': return parseHomeSchoolFormat(filePath)
    case 'learning_problem': return parseLearningProblemFormat(filePath)
  }
}

export function parseStandardToolFile(filePath: string): ToolRxEntry[] {
  const sheets = readXlsxFile(filePath)

  // 检测 V2 格式
  const isV2 = sheets.some(s => /⑦|处方总表|工具-处方/.test(s.name))
  if (isV2) return parseToolFileV2(sheets)

  // 旧格式回退
  const filtered = sheets.filter(s => !s.name.includes('说明') && !s.name.includes('模板'))
  const entries: ToolRxEntry[] = []

  for (const sheet of filtered) {
    for (const row of sheet.rows) {
      const code = extractValue(row, ['code', '工具编码', '工具ID', '编号'])
      const name = extractValue(row, ['name', '工具名称', '处方名称'])
      if (!code || !name) continue
      const stepsRaw = extractValue(row, ['steps', '执行步骤', '操作步骤', '操作步骤（详细）', '具体操作步骤', '核心操作'])
      const steps = splitList(stepsRaw)
      if (!steps.length) continue
      const attributionRefs = parseAttributionRefs(row)

      entries.push({
        code, name,
        form: extractValue(row, ['form', '工具形式', '处方形式', '工具类型']) || '',
        symptoms: extractValue(row, ['symptoms', '适用症状/场景', '适用问题/场景', '适用场景', '触发情景']) || '',
        expectedEffect: extractValue(row, ['expectedEffect', '预期输出或效果', '预期效果', '输出物']),
        severity: parseSeverity(extractValue(row, ['severity', '严重度', '严重度分级'])),
        level: extractValue(row, ['level', '适用等级', '等级']),
        attributionCode: attributionRefs.attributionCode,
        attributionCodes: attributionRefs.attributionCodes,
        attributionLabel: extractValue(row, ['attributionLabel', '对应归因名称', '对应归因']),
        tags: splitList(extractValue(row, ['tags', '场景标签', '标签'])),
        toolTags: splitList(extractValue(row, ['toolTags', '工具标签', '匹配标签'])),
        duration: extractValue(row, ['duration', '建议周期', '疗程与频次']),
        timePerSession: extractValue(row, ['timePerSession', '单次时长', '单次耗时']),
        steps,
        scripts: extractValue(row, ['scripts', '关键话术', '话术']),
        prohibitions: extractValue(row, ['prohibitions', '禁忌条件', '禁止事项']),
        targetUsers: extractValue(row, ['targetUsers', '适用对象', '责任角色']),
        dimensions: splitList(extractValue(row, ['dimensions', '作用维度编码', '适用维度', '作用维度', '维度']))
      })
    }
  }

  return entries
}
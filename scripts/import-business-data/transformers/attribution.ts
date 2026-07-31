// 归因库 transformer：将业务表格 xlsx → AttributionConfig
// V3 结构：⑤b 归因-计算变量 + ⑤c 归因项 + ⑤d 证据规则 + ⑤e 分级规则 + ⑥ 归因-红线熔断
// 遇到 v2 结构（归因和分级混在一张 ⑤c 里）会明确报错提示换模板，不做静默兼容。
import type { AttributionConfig, ModuleId } from '../../../shared/contracts'
import { attributionConfigSchema } from '../../../shared/contracts'
import { extractValue, readXlsxFile, type SheetData } from '../xlsx-reader'

function splitList(value: string | undefined): string[] {
  return (value || '')
    .split(/[,，、;；\n]/)
    .map(item => item.trim())
    .filter(Boolean)
}

function parseBool(value: string | undefined): boolean {
  const normalized = (value || '').trim().toLowerCase()
  return ['是', 'true', 'yes', 'y', '1', '阻断'].includes(normalized)
}

function parseIntOrDefault(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function findSheet(sheets: SheetData[], patterns: RegExp[]) {
  return sheets.find(sheet => patterns.some(pattern => pattern.test(sheet.name)))
}

function collectComputed(sheet: SheetData | undefined) {
  const computed: Record<string, string> = {}
  if (!sheet) return computed
  for (const row of sheet.rows) {
    const name = extractValue(row, ['变量名', '变量编码', '变量', 'computed', 'name'])
    const expr = extractValue(row, ['表达式', '计算表达式', '变量表达式', 'expression', 'expr'])
    if (name && expr) computed[name] = expr
  }
  return computed
}

function parseFloatOrDefault(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const SEVERITY_ALIASES: Record<string, 'low' | 'medium' | 'high' | 'crisis'> = {
  low: 'low', medium: 'medium', high: 'high', crisis: 'crisis',
  轻度: 'low', 中度: 'medium', 重度: 'high', 危机: 'crisis',
  低: 'low', 中: 'medium', 高: 'high'
}

function parseSeverity(value: string | undefined): 'low' | 'medium' | 'high' | 'crisis' {
  const normalized = (value || '').trim().toLowerCase()
  return SEVERITY_ALIASES[normalized] || 'medium'
}

/** ⑤c 归因项：模块级词表 */
function collectAttributionItems(sheet: SheetData | undefined, module: ModuleId, allSheets: SheetData[] = []) {
  if (!sheet) {
    // v2 把归因和分级混在一张「⑤c 归因-分级规则」里，用「主归因」列承载归因。
    // 报「缺少归因项 Sheet」业务会以为漏填了，其实是用错了模板版本。
    // 表头可能带 * 后缀（主归因*），按键名前缀匹配而不是全等
    const looksLikeV2 = allSheets.some(item =>
      item.rows.some(row => Object.keys(row).some(key => key.startsWith('主归因')))
    )
    if (looksLikeV2) {
      throw new Error(
        '检测到 v2 版归因库结构（「⑤c 归因-分级规则」里带「主归因」列）。'
        + 'v3 已拆成 ⑤c 归因项 / ⑤d 证据规则 / ⑤e 分级规则三张 sheet，'
        + '请改用 business-libraries/templates/三库填写模板_v4.xlsx 重新填写。'
      )
    }
    throw new Error('归因库表格缺少「⑤c 归因项」Sheet')
  }

  return sheet.rows
    .map(row => {
      const code = extractValue(row, ['归因编码', 'attributionCode', 'code'])
      const name = extractValue(row, ['归因名称', 'attributionName', 'name'])
      if (!code || !name) return null
      return {
        code,
        name,
        module,
        baseWeight: parseFloatOrDefault(extractValue(row, ['权重基数', 'baseWeight', '权重']), 1),
        toolTags: splitList(extractValue(row, ['工具标签', '匹配标签', 'toolTags', 'tags'])),
        description: extractValue(row, ['归因说明', 'description']),
        highManifestation: extractValue(row, ['高分表现', 'highManifestation']),
        typicalTrigger: extractValue(row, ['典型诱因', 'typicalTrigger']),
        suggestedAction: extractValue(row, ['建议动作', 'suggestedAction']),
        sourceRef: extractValue(row, ['手册出处', 'sourceRef'])
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

/** ⑤d 证据规则：量表级 */
function collectEvidences(sheet: SheetData | undefined) {
  if (!sheet) throw new Error('归因库表格缺少「⑤d 证据规则」Sheet；没有证据规则，任何归因都算不出分')

  return sheet.rows
    .map((row, index) => {
      const attributionCode = extractValue(row, ['归因编码', 'attributionCode'])
      const assessmentCode = extractValue(row, ['依据量表编码', '量表编码', 'assessmentCode'])
      const condition = extractValue(row, ['触发条件', '条件表达式', 'condition', 'when'])
      const description = extractValue(row, ['证据说明', '归因理由', 'description'])
      if (!attributionCode || !assessmentCode || !condition) return null
      return {
        attributionCode,
        assessmentCode,
        evidenceCode: extractValue(row, ['证据编码', 'evidenceCode']) || `${attributionCode}-EV${index + 1}`,
        condition,
        weight: parseFloatOrDefault(extractValue(row, ['证据权重', 'weight', '权重']), 1),
        description: description || `命中条件 ${condition}`,
        sourceRef: extractValue(row, ['手册出处', 'sourceRef'])
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

/** ⑤e 分级规则：只产出等级与严重度 */
function collectGradingRules(sheet: SheetData | undefined, module: ModuleId) {
  if (!sheet) throw new Error('归因库表格缺少「⑤e 分级规则」Sheet；至少需要一条不带触发条件的兜底规则')

  return sheet.rows
    .map((row, index) => {
      const pri = parseIntOrDefault(extractValue(row, ['优先级', 'pri', 'priority']), index + 1)
      const level = extractValue(row, ['命中等级', '等级', '输出等级', 'level'])
      if (!level) return null
      return {
        ruleId: extractValue(row, ['规则编码', '规则ID', 'ruleId']) || `${module}-grading-${pri}`,
        assessmentCode: extractValue(row, ['依据量表编码', '量表编码', 'assessmentCode']) || undefined,
        pri,
        when: extractValue(row, ['触发条件', '条件表达式', '命中条件', 'when', 'condition']) || undefined,
        level,
        levelName: extractValue(row, ['等级中文名', 'levelName']),
        severity: parseSeverity(extractValue(row, ['严重度', 'severity'])),
        blocked: parseBool(extractValue(row, ['是否红线熔断', '是否阻断', '阻断', 'blocked'])),
        resultDescription: extractValue(row, ['结果说明', 'resultDescription']),
        escalationCondition: extractValue(row, ['升级条件', 'escalationCondition']),
        escalationTarget: extractValue(row, ['升级目标', 'escalationTarget']),
        reEvaluationTrigger: extractValue(row, ['复评触发条件', 'reEvaluationTrigger']),
        sourceRef: extractValue(row, ['手册出处', 'sourceRef'])
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

function collectActions(sheet: SheetData | undefined) {
  if (!sheet) return []
  return sheet.rows
    .map(row => {
      const title = extractValue(row, ['行动标题', '标题', 'title'])
      const detail = extractValue(row, ['行动详情', '详情', 'detail'])
      if (!title || !detail) return null
      return { title, detail, status: 'pending' as const }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

function collectTools(sheet: SheetData | undefined) {
  if (!sheet) return []
  return sheet.rows
    .map(row => {
      const title = extractValue(row, ['工具标题', '工具名称', 'title'])
      const content = extractValue(row, ['工具内容', '内容', 'content'])
      if (!title || !content) return null
      return { title, content }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

function collectCrisis(sheet: SheetData | undefined) {
  if (!sheet) return undefined
  for (const row of sheet.rows) {
    const when = extractValue(row, ['条件表达式', '命中条件', 'when', 'condition'])
    const blocked = extractValue(row, ['是否阻断', '阻断', 'blocked'])
    if (when) return {
      when,
      blocked: blocked === undefined ? true : parseBool(blocked)
    }
  }
  return undefined
}

/** 从 ⑥ 归因-红线熔断 提取 redLines */
function collectRedLines(sheet: SheetData | undefined, module: ModuleId) {
  if (!sheet) return []
  return sheet.rows
    .map(row => {
      const condition = extractValue(row, ['红线条件', 'condition'])
      const description = extractValue(row, ['红线说明', 'description'])
      if (!condition || !description) return null
      return {
        module,
        condition,
        description,
        scope: (extractValue(row, ['熔断范围', 'scope']) || 'module') as 'instrument' | 'module' | 'system',
        requiredActions: extractValue(row, ['处置要求', 'requiredActions']) || '',
        actions: splitList(extractValue(row, ['熔断后动作', 'actions'])),
        recoveryCondition: extractValue(row, ['恢复条件', 'recoveryCondition']),
        responsibleRole: extractValue(row, ['责任人', 'responsibleRole']),
        notificationTemplate: extractValue(row, ['通知模板', 'notificationTemplate']),
        sourceRef: extractValue(row, ['手册出处', 'sourceRef']),
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

function collectVersion(sheets: SheetData[]) {
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const version = extractValue(row, ['版本', 'version'])
      if (version) return version
    }
  }
  return '1.0.0'
}

export function parseAttributionFile(filePath: string, module: ModuleId): AttributionConfig {
  const sheets = readXlsxFile(filePath)

  // V3 Sheet 名检测。归因项/证据规则/分级规则必须分开，先匹配更具体的名字。
  const computedSheet = findSheet(sheets, [/⑤b|计算变量/, /变量/, /computed/i])
  // 只按 sheet 的实义名匹配，不能用 ⑤c/⑤d/⑤e 这类序号前缀——
  // v2 的「⑤c 归因-分级规则」会被 /⑤c/ 命中而被误当成归因项表。
  const attributionItemSheet = findSheet(sheets, [/归因项/, /归因清单/, /attribution[-_ ]?item/i])
  const evidenceSheet = findSheet(sheets, [/证据规则/, /证据/, /evidence/i])
  const gradingSheet = findSheet(sheets, [/分级规则/, /grading/i])
  const actionSheet = findSheet(sheets, [/行动/, /action/i])
  const toolSheet = findSheet(sheets, [/提示工具/, /内置工具/, /tool/i])
  const crisisSheet = findSheet(sheets, [/危机/, /crisis/i])
  const redLineSheet = findSheet(sheets, [/⑥|红线熔断/])

  const payload = {
    module,
    version: collectVersion(sheets),
    computed: collectComputed(computedSheet),
    attributionItems: collectAttributionItems(attributionItemSheet, module, sheets),
    evidences: collectEvidences(evidenceSheet),
    gradingRules: collectGradingRules(gradingSheet, module),
    actions: collectActions(actionSheet),
    tools: collectTools(toolSheet),
    crisis: collectCrisis(crisisSheet),
    redLines: collectRedLines(redLineSheet, module),
  }

  return attributionConfigSchema.parse(payload)
}
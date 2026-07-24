// 归因库 transformer：将业务表格 xlsx → AttributionConfig
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

function collectBranches(sheet: SheetData | undefined, module: ModuleId) {
  if (!sheet) throw new Error('归因库表格缺少“规则分支”Sheet')

  return sheet.rows
    .map((row, index) => {
      const pri = parseIntOrDefault(extractValue(row, ['优先级', 'pri', 'priority']), index + 1)
      const level = extractValue(row, ['等级', '输出等级', 'level'])
      const ruleId = extractValue(row, ['规则编码', '规则ID', 'ruleId', 'rule_id']) || `${module}-attribution-${pri}`
      const primaryAttribution = extractValue(row, ['主归因', 'primaryAttribution', 'primary_attribution'])
      const reasons = splitList(extractValue(row, ['原因说明', '原因文案', 'reasons', 'reason']))
      if (!level && !primaryAttribution && reasons.length === 0) return null
      return {
        pri,
        when: extractValue(row, ['条件表达式', '命中条件', 'when', 'condition']) || undefined,
        level: level || '',
        blocked: parseBool(extractValue(row, ['是否阻断', '阻断', 'blocked'])),
        ruleId,
        primaryAttribution: primaryAttribution || '',
        secondaryAttributions: splitList(extractValue(row, ['次归因', 'secondaryAttributions', 'secondary_attributions'])),
        reasons,
        toolTags: splitList(extractValue(row, ['工具标签', '匹配标签', 'toolTags', 'tags']))
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
  const computedSheet = findSheet(sheets, [/变量/, /computed/i])
  const branchSheet = findSheet(sheets, [/规则/, /分支/, /branch/i])
  const actionSheet = findSheet(sheets, [/行动/, /action/i])
  const toolSheet = findSheet(sheets, [/提示工具/, /内置工具/, /tool/i])
  const crisisSheet = findSheet(sheets, [/危机/, /红线/, /crisis/i])

  const payload = {
    module,
    version: collectVersion(sheets),
    computed: collectComputed(computedSheet),
    branches: collectBranches(branchSheet, module),
    actions: collectActions(actionSheet),
    tools: collectTools(toolSheet),
    crisis: collectCrisis(crisisSheet)
  }

  return attributionConfigSchema.parse(payload)
}

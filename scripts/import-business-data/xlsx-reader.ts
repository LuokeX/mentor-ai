// 通用 xlsx 解析器：读取 Excel 文件，支持多 Sheet、跳过标题行、模糊列名匹配
import XLSX from 'xlsx'

export interface SheetData {
  name: string
  headers: string[]
  rows: Record<string, string | undefined>[]
}

/**
 * 读取 xlsx 文件的所有 Sheet，返回结构化数据。
 * - headerRowIndex: 列名所在行号（1-based，默认 1）
 * - skipRowsBefore: 跳过头部的描述性行（如标题、说明等）
 */
export function readXlsxFile(filePath: string, options?: {
  headerRowIndex?: number
  skipRowsBefore?: number
  sheetFilter?: (name: string) => boolean
}): SheetData[] {
  const workbook = XLSX.readFile(filePath)
  const { headerRowIndex = 1, skipRowsBefore = 0, sheetFilter } = options ?? {}
  const explicitHeaderRow = options && Object.prototype.hasOwnProperty.call(options, 'headerRowIndex')

  const results: SheetData[] = []

  for (const sheetName of workbook.SheetNames) {
    if (sheetFilter && !sheetFilter(sheetName)) continue

    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    // 转为数组（header: 1 表示以数组形式输出）
    const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: undefined })
    if (raw.length === 0) continue

    const dataStart = explicitHeaderRow
      ? skipRowsBefore + headerRowIndex - 1
      : inferHeaderRow(raw, skipRowsBefore)
    if (dataStart >= raw.length) continue

    const headers = (raw[dataStart] ?? []).map(h => String(h ?? '').trim()).filter(Boolean)
    if (headers.length === 0) continue

    const rows: Record<string, string | undefined>[] = []
    for (let i = dataStart + 1; i < raw.length; i++) {
      const row = raw[i]
      if (!row || row.every(c => c === undefined || c === null || String(c).trim() === '')) continue

      const obj: Record<string, string | undefined> = {}
      for (let j = 0; j < headers.length; j++) {
        const val = row[j]
        obj[headers[j]!] = val !== undefined && val !== null ? String(val).trim() : undefined
      }
      rows.push(obj)
    }

    if (rows.length > 0) {
      results.push({ name: sheetName, headers, rows })
    }
  }

  return results
}

function inferHeaderRow(rows: unknown[][], startIndex: number) {
  const headerHints = [
    '编号', '代码', '题号', '序号', '工具id', '工具ID', '处方名称', '工具名称',
    '术语', '术语id', '术语ID', '专业名称', '核心定义', '定义(精确)',
    '评估编码', '评估名称', '评估维度', '所属维度', '题干', '评估项目', '字段名(field)',
    '变量名', '表达式', '优先级', '条件表达式', '等级', '规则编码', '主归因', '原因说明', '工具标签'
  ]
  let bestIndex = startIndex
  let bestScore = -1
  const end = Math.min(rows.length, startIndex + 10)
  for (let index = startIndex; index < end; index++) {
    const cells = (rows[index] || []).map(value => String(value ?? '').trim()).filter(Boolean)
    if (cells.length < 2) continue
    const score = cells.reduce((sum, cell) => {
      const normalized = cell.toLowerCase()
      return sum + headerHints.reduce((cellScore, hint) => {
        const normalizedHint = hint.toLowerCase()
        if (normalized === normalizedHint) return cellScore + 3
        if (cell.length <= 24 && normalized.includes(normalizedHint)) return cellScore + 1
        return cellScore
      }, 0)
    }, 0)
    if (score > bestScore) {
      bestIndex = index
      bestScore = score
    }
  }
  return bestScore > 0 ? bestIndex : startIndex
}

/**
 * 模糊列名匹配：从 headers 中找到与 targetName 最相似的列名。
 * 匹配规则：
 * 1. 完全匹配
 * 2. 包含匹配（header 包含 target 或 target 包含 header）
 * 3. 忽略括号、冒号、空格后的匹配
 */
export function fuzzyMatchColumn(headers: string[], targetName: string): string | null {
  const normalized = targetName.toLowerCase().replace(/[（(].*[)）]/g, '').replace(/[:：]/g, '').trim()

  // 完全匹配
  const exact = headers.find(h => h.toLowerCase() === normalized)
  if (exact) return exact

  // 包含匹配
  const contains = headers.find(h => {
    const hn = h.toLowerCase().replace(/[（(].*[)）]/g, '').replace(/[:：]/g, '').trim()
    return hn.includes(normalized) || normalized.includes(hn)
  })
  if (contains) return contains

  return null
}

/**
 * 从行数据中按多种可能的列名提取值
 */
export function extractValue(row: Record<string, string | undefined>, candidates: string[]): string | undefined {
  for (const c of candidates) {
    const val = row[c]
    if (val) return val
  }
  // 模糊匹配
  const headers = Object.keys(row)
  for (const c of candidates) {
    const matched = fuzzyMatchColumn(headers, c)
    if (matched && row[matched]) return row[matched]
  }
  return undefined
}

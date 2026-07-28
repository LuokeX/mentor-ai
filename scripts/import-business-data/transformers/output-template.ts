// 方案输出模板 transformer：将 ⑩ 方案输出模板 xlsx → OutputTemplateEntry[]
import type { OutputTemplateEntry, ModuleId } from '../../../shared/contracts'
import { readXlsxFile, extractValue, type SheetData } from '../xlsx-reader'

/**
 * V2 格式解析：从 ⑩ 方案输出模板 提取模板条目
 */
export function parseOutputTemplateFile(filePath: string, moduleCode: ModuleId): OutputTemplateEntry[] {
  const sheets = readXlsxFile(filePath)
  const templateSheet = sheets.find(s => /⑩|输出模板/.test(s.name))
      || sheets[0]
  if (!templateSheet) return []

  const entries: OutputTemplateEntry[] = []

  for (const row of templateSheet.rows) {
    const code = extractValue(row, ['模板编码', 'code'])
    const type = extractValue(row, ['模板类型', 'type'])
    const content = extractValue(row, ['模板内容', 'content'])
    if (!code || !type || !content) continue

    entries.push({
      code,
      module: moduleCode,
      attributionLevel: extractValue(row, ['命中归因等级', 'attributionLevel']) || '',
      type: type as OutputTemplateEntry['type'],
      content,
      placeholders: extractValue(row, ['占位符说明', 'placeholders']),
      order: Number(extractValue(row, ['排序', 'order'])) || 0,
    })
  }

  return entries
}
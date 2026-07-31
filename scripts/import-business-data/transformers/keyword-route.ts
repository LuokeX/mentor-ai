// 关键词路由 transformer：将 ⑨ 关键词-路由 xlsx → KeywordRouteEntry[]
import type { KeywordRouteEntry, ModuleId } from '../../../shared/contracts'
import { readXlsxFile, extractValue, type SheetData } from '../xlsx-reader'

function splitList(value: string | undefined): string[] {
  return (value || '')
    .split(/[,，、;；\n]/)
    .map(item => item.trim())
    .filter(Boolean)
}

function parseStringList(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const result = splitList(value)
  return result.length > 0 ? result : undefined
}

/**
 * V2 格式解析：从 ⑨ 关键词-路由 提取路由规则
 */
export function parseKeywordRouteFile(filePath: string, moduleCode: ModuleId): KeywordRouteEntry[] {
  const sheets = readXlsxFile(filePath)
  // 匹配不到就抛错，不能退回 sheets[0]：拿任意一张表当路由表解析出 0 条，
  // 业务只会看到「导入成功但没数据」，查不出是 sheet 名写错了。
  const routeSheet = sheets.find(s => /⑨|关键词.*路由|路由.*关键词/.test(s.name))
  if (!routeSheet) {
    throw new Error(`关键词路由表缺少「⑨ 关键词-路由」Sheet（实际 sheet：${sheets.map(s => s.name).join('、') || '空文件'}）`)
  }

  const entries: KeywordRouteEntry[] = []

  for (const row of routeSheet.rows) {
    const code = extractValue(row, ['关键词编码', 'code'])
    const coreKeywords = extractValue(row, ['核心触发词', 'coreKeywords'])
    if (!code || !coreKeywords) continue

    entries.push({
      code,
      coreKeywords,
      expandedKeywords: extractValue(row, ['扩展词与近义表达', 'expandedKeywords']),
      exclusionKeywords: parseStringList(extractValue(row, ['排除词', 'exclusionKeywords'])),
      module: moduleCode,
      matchPriority: Number(extractValue(row, ['匹配优先级', 'matchPriority'])) || 0,
      matchMode: (extractValue(row, ['匹配模式', 'matchMode']) || 'fuzzy') as KeywordRouteEntry['matchMode'],
      riskLevel: extractValue(row, ['风险等级', 'riskLevel']) || 'low',
      semanticCategory: extractValue(row, ['语义分类', 'semanticCategory']),
      linkedAssessmentCode: extractValue(row, ['关联量表编码', 'linkedAssessmentCode']),
      linkedToolCode: extractValue(row, ['关联工具编码', 'linkedToolCode']),
      contextConstraint: extractValue(row, ['情境限定', 'contextConstraint']),
      routeWeight: Number(extractValue(row, ['路由权重', 'routeWeight'])) || undefined,
      temporalValidity: (extractValue(row, ['时效性', 'temporalValidity']) || 'always') as KeywordRouteEntry['temporalValidity'],
      description: extractValue(row, ['场景描述', 'description']),
    })
  }

  return entries
}
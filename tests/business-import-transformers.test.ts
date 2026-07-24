import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { parseAttributionFile } from '../scripts/import-business-data/transformers/attribution'

describe('business import transformers', () => {
  it('parses attribution rules from a business xlsx template', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['module', 'version', 'variableName', 'expression', 'description'],
      ['home_school', '1.0.0', 'conflict', 'MAX(scores)', '冲突最高分']
    ]), '归因变量')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['module', 'version', 'priority', 'when', 'level', 'blocked', 'ruleId', 'primaryAttribution', 'secondaryAttributions', 'reasons', 'toolTags'],
      ['home_school', '1.0.0', '10', 'conflict >= 4', 'high', '否', 'home-school-high', '家校沟通冲突升级', '沟通边界不清;家长期待不一致', '冲突题项偏高，需要先降温。', 'home_school;conflict;high'],
      ['home_school', '1.0.0', '100', '', 'stable', '否', 'home-school-default', '家校沟通状态稳定', '', '进入常规维护。', 'home_school;stable']
    ]), '归因规则')

    const filePath = join(mkdtempSync(join(tmpdir(), 'mentor-attribution-')), 'attribution.xlsx')
    XLSX.writeFile(workbook, filePath)

    const parsed = parseAttributionFile(filePath, 'home_school')
    expect(parsed.computed.conflict).toBe('MAX(scores)')
    expect(parsed.branches).toHaveLength(2)
    expect(parsed.branches[0]?.primaryAttribution).toBe('家校沟通冲突升级')
    expect(parsed.branches[0]?.secondaryAttributions).toEqual(['沟通边界不清', '家长期待不一致'])
    expect(parsed.branches[1]?.when).toBeUndefined()
  })
})

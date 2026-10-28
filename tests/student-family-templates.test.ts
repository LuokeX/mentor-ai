import { describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import { STUDENT_FAMILY_HEADERS } from '../server/domain/student-family-templates'

function readHeaders(path: string): { sheetName: string, headers: string[], merges: number } {
  const workbook = XLSX.readFile(path)
  const sheetName = workbook.SheetNames[0]!
  const sheet = workbook.Sheets[sheetName]!
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: undefined })
  const header = (rows[0] ?? []).map(value => String(value ?? '').trim())
  while (header.length && header[header.length - 1] === '') header.pop()
  return { sheetName, headers: header, merges: Array.isArray(sheet['!merges']) ? sheet['!merges'].length : 0 }
}

describe('小学/初中学生+家长合表模板', () => {
  it.each([
    ['primary', 'public/templates/student-family-primary.xlsx'],
    ['junior', 'public/templates/student-family-junior.xlsx'],
  ] as const)('%s 模板表头与代码常量一致', (section, path) => {
    const { sheetName, headers, merges } = readHeaders(path)
    expect(sheetName).toBe('Sheet1')
    expect(merges).toBe(0)
    expect(headers).toEqual([...STUDENT_FAMILY_HEADERS[section]])
  })

  it('小学模板尾部空表头不参与比较', () => {
    const { headers } = readHeaders('public/templates/student-family-primary.xlsx')
    expect(headers).toHaveLength(38)
  })

  it('初中模板包含 57 列', () => {
    const { headers } = readHeaders('public/templates/student-family-junior.xlsx')
    expect(headers).toHaveLength(57)
  })
})

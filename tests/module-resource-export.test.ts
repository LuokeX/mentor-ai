/**
 * 运营台「导出」链路的回归测试。
 *
 * 两条硬约束：
 *   1. 导出文件的每个 sheet 表头必须与 v4 模板逐列一致——导出文件会被业务当模板继续编辑，
 *      列序错了就是数据损坏。
 *   2. 导出 → 重新解析必须无损——这是「导出 → 改 → 再导入」闭环的根基。
 *      历史上工具库导出曾因漏写「效果说明」整行错位 1 列，重新导入时字段全部错位。
 */
import { describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { exportVersionToXlsx } from '../server/domain/module-resource-export'
import { parseModuleResourceFile } from '../server/domain/module-resource-file-import'

const BASE = resolve('business-libraries/test-data')
const MODULES = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']
const LIB_TYPES = ['assessment', 'attribution', 'tool', 'keyword_route', 'output_template']
const TEMPLATE = resolve('business-libraries/templates/三库填写模板_v4.xlsx')

describe('导出链路与 v4 模板对齐', () => {
  const tpl = XLSX.readFile(TEMPLATE)
  const tplHeaders: Record<string, string[]> = {}
  for (const name of tpl.SheetNames) {
    tplHeaders[name] = (XLSX.utils.sheet_to_json<any[]>(tpl.Sheets[name], { header: 1 })[0] || []).map(v => String(v ?? '').trim())
  }

  it('25 个文件的导出表头与 v4 模板逐列一致', () => {
    for (const mod of MODULES) {
      for (const lib of LIB_TYPES) {
        const payload = parseModuleResourceFile({
          module: mod, libraryType: lib as any, filename: `${lib}.xlsx`,
          contentBase64: readFileSync(resolve(BASE, mod, `${lib}.xlsx`)).toString('base64')
        })
        const wb = exportVersionToXlsx(lib as any, mod as any, payload)
        for (const name of wb.SheetNames) {
          const h = (XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1 })[0] || []).map(v => String(v ?? '').trim())
          expect(h, `${mod}/${lib}.xlsx「${name}」表头`).toEqual(tplHeaders[name])
        }
      }
    }
  })

  it('25 个文件导出 → 重新解析无损', () => {
    for (const mod of MODULES) {
      for (const lib of LIB_TYPES) {
        const payload = parseModuleResourceFile({
          module: mod, libraryType: lib as any, filename: `${lib}.xlsx`,
          contentBase64: readFileSync(resolve(BASE, mod, `${lib}.xlsx`)).toString('base64')
        })
        const wb = exportVersionToXlsx(lib as any, mod as any, payload)
        const re = parseModuleResourceFile({
          module: mod, libraryType: lib as any, filename: `${lib}.xlsx`,
          contentBase64: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64')
        })
        expect(JSON.parse(JSON.stringify(re)), `${mod}/${lib}.xlsx 导出→解析`).toEqual(JSON.parse(JSON.stringify(payload)))
      }
    }
  })
})
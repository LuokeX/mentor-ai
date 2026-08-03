#!/usr/bin/env node
/**
 * 把 test-data 的 5 个 assessment.xlsx 从旧列序升级到 v4 模板列序。
 *
 * 只做三件事，内容一字不改：
 *   1. 按列名取值（不依赖旧列位置）
 *   2. 按 v4 模板表头重排列序
 *   3. 模板新增的列一律留空
 * ④b 选项组表头已与 v4 一致，原样保留。
 *
 * 用法：pnpm tsx scripts/upgrade-test-data-assessment.mjs
 */
import XLSX from 'xlsx'
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

const TEMPLATE = resolve('business-libraries/templates/三库填写模板_v4.xlsx')
const BASE = resolve('business-libraries/test-data')
const MODULES = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']
const UPGRADE_SHEETS = ['③ 量表-清单', '④ 量表-题目', '④c 量表-维度定义']

const tpl = XLSX.readFile(TEMPLATE)
const tplHeaders = {}
for (const name of UPGRADE_SHEETS) {
  tplHeaders[name] = (XLSX.utils.sheet_to_json(tpl.Sheets[name], { header: 1 })[0] || [])
    .map(v => String(v ?? '').trim())
}

for (const mod of MODULES) {
  const file = resolve(BASE, mod, 'assessment.xlsx')
  // 升级前备份到 /tmp，内容对比失败可恢复
  copyFileSync(file, `/tmp/assessment-${mod}-legacy.xlsx`)
  const wb = XLSX.readFile(file)
  for (const name of UPGRADE_SHEETS) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 })
    const oldHeader = (rows[0] || []).map(v => String(v ?? '').trim())
    const missing = tplHeaders[name].filter(h => !oldHeader.includes(h))
    const newRows = [tplHeaders[name]]
    for (const row of rows.slice(1)) {
      if (!row || !row.some(c => c !== undefined && c !== null && String(c).trim() !== '')) continue
      const byName = {}
      oldHeader.forEach((h, i) => { byName[h] = row[i] ?? '' })
      newRows.push(tplHeaders[name].map(h => byName[h] ?? ''))
    }
    wb.Sheets[name] = XLSX.utils.aoa_to_sheet(newRows)
    console.log(`${mod}「${name}」: ${rows.length - 1} 行，新增列 ${missing.join('、') || '(无)'}`)
  }
  XLSX.writeFile(wb, file)
}
console.log('done')
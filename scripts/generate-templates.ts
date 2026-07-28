/**
 * 从 V2 通用模板中提取 per-library-type 模板文件（仅保留表头行）。
 * 输出到 public/templates/{libraryType}.xlsx
 *
 * 运行: pnpm tsx scripts/generate-templates.ts
 */
import XLSX from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'

// V2 模板中 sheet 名 → libraryType 的映射
const SHEET_MAP: Record<string, string> = {
  '③ 量表-清单': 'assessment',
  '④ 量表-题目': 'assessment',
  '④b 量表-选项组': 'assessment',
  '④c 量表-维度定义': 'assessment',
  '⑤b 归因-计算变量': 'attribution',
  '⑤c 归因-分级规则': 'attribution',
  '⑥ 归因-红线熔断': 'attribution',
  '⑦ 工具-处方总表': 'tool',
  '⑦b 工具-步骤明细': 'tool',
  '⑧ 工具-禁忌规则': 'tool',
  '⑨ 关键词-路由': 'keyword_route',
  '⑩ 方案输出模板': 'output_template',
}

// 库类型中文名（用于 sheet 内部内容，不影响输出文件名）
const TYPE_LABELS: Record<string, string> = {
  assessment: '量表模板',
  attribution: '归因模板',
  tool: '工具模板',
  keyword_route: '关键词路由模板',
  output_template: '输出模板模板',
}

const SRC = path.resolve('public/templates/三库填写模板_v2.xlsx')
const OUT_DIR = path.resolve('public/templates')

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`❌ 源文件不存在: ${SRC}`)
    process.exit(1)
  }

  const workbook = XLSX.readFile(SRC)

  // 按 libraryType 分组 sheet
  const groups: Record<string, { name: string; data: unknown[][] }[]> = {}
  for (const sheetName of workbook.SheetNames) {
    const libType = SHEET_MAP[sheetName]
    if (!libType) continue // 跳过 ① 填写总览、② 枚举字典、⑤a 等

    const sheet = workbook.Sheets[sheetName]
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: undefined })

    // 只保留表头行（第一行），去掉数据行
    const headerRow = raw[0] || []
    if (headerRow.length === 0) {
      console.warn(`⚠ ${sheetName}: 表头为空，跳过`)
      continue
    }

    if (!groups[libType]) groups[libType] = []
    groups[libType].push({ name: sheetName, data: [headerRow] })
  }

  // 为每个 libraryType 生成独立的 xlsx
  for (const [libType, sheets] of Object.entries(groups)) {
    const outWorkbook = XLSX.utils.book_new()
    for (const { name, data } of sheets) {
      const outSheet = XLSX.utils.aoa_to_sheet(data)
      XLSX.utils.book_append_sheet(outWorkbook, outSheet, name)
    }

    const outPath = path.join(OUT_DIR, `${libType}.xlsx`)
    XLSX.writeFile(outWorkbook, outPath)
    console.log(`✅ ${libType}.xlsx (${sheets.length} sheets)`)
  }

  console.log(`\n已生成 ${Object.keys(groups).length} 个模板文件到 ${OUT_DIR}`)

  // 知识库模板：直接复制（独立模板，不来自三库 V2）
  const knowledgeSrc = path.resolve('business-libraries/templates/知识库填写模板.xlsx')
  const knowledgeDst = path.join(OUT_DIR, 'knowledge.xlsx')
  if (fs.existsSync(knowledgeSrc)) {
    fs.copyFileSync(knowledgeSrc, knowledgeDst)
    console.log('✅ knowledge.xlsx (独立模板)')
  } else {
    console.warn('⚠ 知识库填写模板.xlsx 不存在，跳过 knowledge.xlsx')
  }
}

main()
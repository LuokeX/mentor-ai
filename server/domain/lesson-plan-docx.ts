/**
 * 备课方案 Word 导出。
 *
 * 不引入文档生成依赖：按 OOXML 最小结构手写 DOCX（ZIP + word/document.xml），
 * 只依赖 Node 内置 zlib。文本一律 XML 转义，模型回答里的原始 HTML 不会进入文档。
 *
 * 支持的基础排版：标题（H1-H6）、段落、粗体/斜体/行内代码、无序/有序列表、
 * 引用、代码块、分隔线、Markdown 表格。图片暂不下载，仅在正文保留说明文字。
 */
import { deflateRawSync } from 'node:zlib'
import { formatDateTime } from '../utils/format-time'

export interface LessonPlanDocxInput {
  /** 会话标题或方案标题；回答没有 H1 时用作文档标题 */
  title: string
  /** 助手回答正文（Markdown） */
  markdown: string
  /** 导出时间（北京时间水印） */
  exportedAt?: Date
}

/** A4 纸宽 11906 twips - 左右各 1440 twips 页边距 */
const CONTENT_WIDTH_TWIPS = 9026
const BODY_SIZE = 22
const SMALL_SIZE = 18

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function crc32(buffer: Buffer): number {
  let crc = 0xFFFFFFFF
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function dosDateTime(value: Date): { time: number, date: number } {
  const time = ((value.getHours() & 0x1F) << 11) | ((value.getMinutes() & 0x3F) << 5) | ((value.getSeconds() >> 1) & 0x1F)
  const date = (((value.getFullYear() - 1980) & 0x7F) << 9) | (((value.getMonth() + 1) & 0x0F) << 5) | (value.getDate() & 0x1F)
  return { time, date }
}

/** 生成 ZIP（deflate，UTF-8 文件名）；DOCX 只需要标准 ZIP 容器。 */
function createZip(files: Array<{ name: string, data: Buffer }>, timestamp = new Date()): Buffer {
  const { time, date } = dosDateTime(timestamp)
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const crc = crc32(file.data)
    const compressed = deflateRawSync(file.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)

    offset += local.length + name.length + compressed.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, ...centralParts, end])
}

interface RunOptions {
  bold?: boolean
  italic?: boolean
  code?: boolean
  color?: string
  size?: number
}

function runXml(text: string, options: RunOptions = {}): string {
  if (!text) return ''
  const props: string[] = []
  if (options.code) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/>')
  if (options.bold) props.push('<w:b/>')
  if (options.italic) props.push('<w:i/>')
  if (options.color) props.push(`<w:color w:val="${options.color}"/>`)
  if (options.size) props.push(`<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>`)
  if (options.code) props.push('<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>')
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
}

/** 行内 Markdown：粗体、斜体、行内代码、链接（链接只保留文字与地址，不建跳转关系）。 */
function inlineRuns(text: string, base: RunOptions = {}): string {
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g
  const tokens: Array<{ text: string } & RunOptions> = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) tokens.push({ text: text.slice(last, index) })
    if (match[2] !== undefined) tokens.push({ text: match[2], bold: true })
    else if (match[3] !== undefined) tokens.push({ text: match[3], italic: true })
    else if (match[4] !== undefined) tokens.push({ text: match[4], code: true })
    else if (match[5] !== undefined) {
      const url = match[6] ?? ''
      tokens.push({ text: url && url !== match[5] ? `${match[5]}（${url}）` : match[5] })
    }
    last = index + match[0].length
  }
  if (last < text.length) tokens.push({ text: text.slice(last) })
  if (!tokens.length) tokens.push({ text })
  return tokens.map(token => runXml(token.text, {
    bold: base.bold || token.bold,
    italic: base.italic || token.italic,
    code: token.code,
    color: base.color,
    size: base.size
  })).join('')
}

interface ParagraphOptions {
  before?: number
  after?: number
  line?: number
  indent?: number
  hanging?: number
  shade?: string
  borderBottom?: boolean
}

function paragraphXml(content: string, options: ParagraphOptions = {}): string {
  const props: string[] = []
  if (options.borderBottom) props.push('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pBdr>')
  if (options.shade) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${options.shade}"/>`)
  props.push(`<w:spacing w:before="${options.before ?? 60}" w:after="${options.after ?? 60}" w:line="${options.line ?? 360}" w:lineRule="auto"/>`)
  if (options.indent !== undefined || options.hanging !== undefined) {
    props.push(`<w:ind${options.indent !== undefined ? ` w:left="${options.indent}"` : ''}${options.hanging !== undefined ? ` w:hanging="${options.hanging}"` : ''}/>`)
  }
  return `<w:p><w:pPr>${props.join('')}</w:pPr>${content}</w:p>`
}

function headingXml(level: number, text: string): string {
  const size = level === 1 ? 32 : level === 2 ? 28 : level === 3 ? 24 : 22
  return paragraphXml(inlineRuns(text, { bold: true, size }), {
    before: level === 1 ? 240 : 180,
    after: level === 1 ? 120 : 80,
    line: 360
  })
}

function listXml(text: string, marker: string): string {
  return paragraphXml(inlineRuns(`${marker} ${text}`, { size: BODY_SIZE }), {
    indent: 420,
    hanging: 210,
    before: 0,
    after: 0,
    line: 340
  })
}

function quoteXml(text: string): string {
  return paragraphXml(inlineRuns(text, { italic: true, color: '475569', size: 21 }), {
    indent: 420,
    before: 60,
    after: 60,
    line: 340
  })
}

function codeLineXml(line: string): string {
  return paragraphXml(runXml(line || ' ', { code: true, size: 19 }), {
    shade: 'F8FAFC',
    indent: 240,
    before: 0,
    after: 0,
    line: 300
  })
}

function horizontalRuleXml(): string {
  return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pBdr><w:spacing w:before="120" w:after="120"/></w:pPr></w:p>'
}

function splitTableRow(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|')) text = text.slice(0, -1)
  return text.split('|').map(cell => cell.trim())
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()))
}

function tableXml(rows: string[][]): string {
  const columns = Math.max(...rows.map(row => row.length), 1)
  const width = Math.floor(CONTENT_WIDTH_TWIPS / columns)
  const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join('')
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>`
  const rowsXml = rows.map((row, rowIndex) => {
    const cells = Array.from({ length: columns }, (_, columnIndex) => {
      const text = row[columnIndex] ?? ''
      const shade = rowIndex === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>' : ''
      const content = inlineRuns(text, { bold: rowIndex === 0, size: 20 })
      return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}<w:vAlign w:val="center"/></w:tcPr>${paragraphXml(content, { before: 40, after: 40, line: 300 })}</w:tc>`
    }).join('')
    return `<w:tr>${cells}</w:tr>`
  }).join('')
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border('top')}${border('left')}${border('bottom')}${border('right')}${border('insideH')}${border('insideV')}</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowsXml}</w:tbl>`
}

function isParagraphBlockStart(line: string): boolean {
  return /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```)/.test(line) || isTableSeparator(line)
}

/** 把 Markdown 转成 word/document.xml 的 body 片段（不含 document 根节点）。 */
export function markdownToWordXml(markdown: string, title = '备课方案', exportedAt = new Date()): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const firstNonEmpty = lines.find(line => line.trim())
  const body: string[] = []
  if (firstNonEmpty && !/^#{1,6}\s/.test(firstNonEmpty.trim())) {
    body.push(headingXml(1, title))
  }

  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    const trimmed = line.trim()

    if (!trimmed) { index++; continue }

    if (/^\s*```/.test(line)) {
      index++
      while (index < lines.length && !/^\s*```/.test(lines[index]!)) {
        body.push(codeLineXml(lines[index]!))
        index++
      }
      if (index < lines.length) index++
      continue
    }

    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1]!)) {
      const rows: string[][] = [splitTableRow(line)]
      index += 2
      while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim()) {
        rows.push(splitTableRow(lines[index]!))
        index++
      }
      body.push(tableXml(rows), '<w:p/>')
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      body.push(headingXml(heading[1]!.length, heading[2]!))
      index++
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      body.push(horizontalRuleXml())
      index++
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      body.push(quoteXml(line.replace(/^\s*>\s?/, '')))
      index++
      continue
    }

    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (unordered) {
      body.push(listXml(unordered[1]!, '•'))
      index++
      continue
    }

    const ordered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
    if (ordered) {
      body.push(listXml(ordered[2]!, `${ordered[1]}.`))
      index++
      continue
    }

    const paragraphLines: string[] = [trimmed]
    index++
    while (index < lines.length && lines[index]!.trim() && !isParagraphBlockStart(lines[index]!)) {
      paragraphLines.push(lines[index]!.trim())
      index++
    }
    body.push(paragraphXml(inlineRuns(paragraphLines.join(' '), { size: BODY_SIZE })))
  }

  body.push(paragraphXml(
    runXml(`导出于 ${formatDateTime(exportedAt)} · 班主任助理智能平台`, { size: SMALL_SIZE, color: '94A3B8', italic: true }),
    { before: 240, after: 0, line: 300 }
  ))
  return body.join('')
}

/** 生成可直接下载的 .docx 文件内容。 */
export function buildLessonPlanDocx(input: LessonPlanDocxInput): Buffer {
  const exportedAt = input.exportedAt ?? new Date()
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${markdownToWordXml(input.markdown, input.title, exportedAt)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(input.title)}</dc:title><dc:creator>班主任助理智能平台</dc:creator><cp:lastModifiedBy>班主任助理智能平台</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${exportedAt.toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${exportedAt.toISOString()}</dcterms:modified></cp:coreProperties>`

  return createZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'docProps/core.xml', data: Buffer.from(core, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') }
  ], exportedAt)
}

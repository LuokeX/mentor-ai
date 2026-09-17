/**
 * 向量知识库全量内容导出（业务校验用）。
 *
 * 背景：独立知识库文档（`module_resource_documents` / `module_resource_chunks`，libraryType=knowledge）
 * 是首页 AI 助手 `knowledge_search` 唯一可引用的平台依据。业务侧校验内容时，需要拿到
 * 「现在库里到底有什么、正文写的是什么、出处记的什么」，而不是只看后台列表。
 *
 * 产出：
 *  - XLSX 的「知识文档」表：列结构与平台后台「知识库 → 批量导入」模板同列（文档标题 / 所属模块 /
 *    来源类型 / 标签关键词 / 适用学部 / 文档内容 / 来源出处 / 备注），另带「编号」「模块名称」
 *    「参与检索」「文档ID」四列。前三列供阅读与口头定位；「文档ID」是回改导入的匹配依据，
 *    业务改稿时不能动，新增行留空。
 *  - XLSX 的「使用说明」表：数据来源、规模、字段口径与回改流程。
 *  - 同目录 `<文件名>_编号对照.csv`：编号 → 文档 ID，供内部回修定位（标题有重名），不发给业务。
 *
 * 配套的导入命令：`pnpm knowledge:import -- --file=<本文件>`（见 scripts/import-knowledge-base.ts）。
 *
 * 只读：不写库、不调外部模型。
 *
 * 用法：
 *   pnpm knowledge:export
 *   pnpm knowledge:export -- --out=/tmp/kb.xlsx
 *   pnpm knowledge:export -- --module=student_case
 *
 * 环境：读 process.env.DATABASE_URL 指向的库（本地 dev 为 localhost:5434/mentor_ai_dev）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import XLSX from 'xlsx'
import { loadLocalEnv } from './load-env'
import { useDb } from '../server/utils/db'
import { SCHOOL_SECTIONS } from '../shared/school-section'
import type { ModuleId } from '../shared/contracts'

const MODULE_ORDER: ModuleId[] = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']

const MODULE_LABELS: Record<string, string> = {
  self_growth: '自我成长赋能',
  class_system: '班级系统建设',
  home_school: '家校协同',
  student_case: '学生个案',
  learning_problem: '学习问题'
}

const SECTION_LABELS: Record<string, string> = {
  all: '全部学段',
  primary: '小学',
  junior: '初中',
  senior: '高中',
  repeat: '复读'
}

function readArg(name: string): string | null {
  const prefix = `--${name}=`
  const hit = process.argv.find(arg => arg.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

/** 北京时间日期戳（YYYYMMDD）。 */
function beijingDateStamp() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()).replace(/-/g, '')
}

function beijingTimestamp(value: string | Date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value))
}

/** 只保留 host:port/database，绝不带凭据。 */
function describeDatabaseUrl(url: string | undefined) {
  if (!url) return '(DATABASE_URL 未配置)'
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`
  } catch {
    return '(DATABASE_URL 无法解析)'
  }
}

interface DocumentRow {
  [key: string]: unknown
  id: string
  title: string
  status: string
  source_type: string
  content: string
  metadata: Record<string, unknown> | null
  version_id: string | null
  version_status: string | null
  version: string | null
  library_type: string | null
  scope: string | null
  updated_at: string | Date
}

interface ChunkRow {
  [key: string]: unknown
  document_id: string
  chunk_index: number
  heading: string | null
  content: string
  embedded: boolean
}

const moduleArg = readArg('module')
if (moduleArg && !MODULE_ORDER.includes(moduleArg as ModuleId)) {
  throw new Error(`--module 取值必须是 ${MODULE_ORDER.join(' / ')} 之一，收到：${moduleArg}`)
}
const filterModule = (moduleArg as ModuleId | null) ?? null
const outPath = resolve(readArg('out') || `exports/知识库全量内容_${beijingDateStamp()}.xlsx`)

loadLocalEnv()
const db = useDb()

const documentResult = await db.execute<DocumentRow>(sql`
  SELECT d.id,
         d.title,
         d.status,
         d.source_type,
         d.content,
         d.metadata,
         d.version_id,
         v.status AS version_status,
         v.version AS version,
         l.library_type,
         l.scope,
         d.updated_at
  FROM module_resource_documents d
  LEFT JOIN module_resource_versions v ON v.id = d.version_id
  LEFT JOIN module_resource_libraries l ON l.id = COALESCE(d.library_id, v.library_id)
  WHERE d.library_id IS NULL AND d.version_id IS NULL
  ORDER BY d.title
`)

// 来自三库版本的文档由版本发布维护，不进回改文件（改它们要改三库并重新发布）
const versionAttachedResult = await db.execute<{ count: string }>(sql`
  SELECT COUNT(*)::text AS count
  FROM module_resource_documents d
  WHERE d.library_id IS NOT NULL OR d.version_id IS NOT NULL
`)
const versionAttachedCount = Number(versionAttachedResult.rows[0]?.count || 0)

const chunkResult = await db.execute<ChunkRow>(sql`
  SELECT c.document_id,
         c.chunk_index,
         c.heading,
         c.content,
         (c.embedding IS NOT NULL) AS embedded
  FROM module_resource_chunks c
  ORDER BY c.document_id, c.chunk_index
`)

const chunksByDocument = new Map<string, ChunkRow[]>()
for (const chunk of chunkResult.rows) {
  const list = chunksByDocument.get(chunk.document_id) || []
  list.push(chunk)
  chunksByDocument.set(chunk.document_id, list)
}

interface ExportDocument {
  doc: DocumentRow
  module: string
  section: string
  tags: string[]
  sourceRef: string
  notes: string
  chunks: ChunkRow[]
  /** 是否满足知识检索的召回条件（ready + 不挂未发布版本）。 */
  searchable: boolean
  /** 挂在校级库上的文档只对本校可见。 */
  schoolScoped: boolean
  /** 最后更新时间（北京时间，精确到分钟）。 */
  updatedAt: string
}

const documents: ExportDocument[] = documentResult.rows
  .map((doc) => {
    const meta = (doc.metadata || {}) as Record<string, unknown>
    const module = typeof meta.module === 'string' && meta.module ? meta.module : 'self_growth'
    const sectionRaw = typeof meta.applicableSchoolSection === 'string' ? meta.applicableSchoolSection : ''
    const section = (SCHOOL_SECTIONS as readonly string[]).includes(sectionRaw) ? sectionRaw : 'all'
    return {
      doc,
      module,
      section,
      tags: Array.isArray(meta.tags) ? (meta.tags as unknown[]).map(tag => String(tag)) : [],
      sourceRef: typeof meta.sourceRef === 'string' ? meta.sourceRef : '',
      notes: typeof meta.notes === 'string' ? meta.notes : '',
      chunks: chunksByDocument.get(doc.id) || [],
      searchable: doc.status === 'ready' && (!doc.version_id || doc.version_status === 'published'),
      schoolScoped: doc.scope === 'school',
      updatedAt: beijingTimestamp(doc.updated_at)
    }
  })
  .filter(item => !filterModule || item.module === filterModule)

function moduleRank(module: string) {
  const index = MODULE_ORDER.indexOf(module as ModuleId)
  return index === -1 ? MODULE_ORDER.length : index
}

function sectionRank(section: string) {
  const index = (SCHOOL_SECTIONS as readonly string[]).indexOf(section)
  return index === -1 ? SCHOOL_SECTIONS.length : index
}

documents.sort((a, b) =>
  moduleRank(a.module) - moduleRank(b.module)
  || sectionRank(a.section) - sectionRank(b.section)
  || a.doc.title.localeCompare(b.doc.title, 'zh-Hans-CN')
)

const codeOf = new Map<string, string>()
documents.forEach((item, index) => codeOf.set(item.doc.id, `KB-${String(index + 1).padStart(4, '0')}`))

// ---- 主表：知识文档（与批量导入模板同列，可直接回改后导入） ----
const documentHeaders = [
  '编号', '文档标题', '所属模块', '模块名称', '来源类型', '标签关键词', '适用学部',
  '文档内容', '来源出处', '备注', '参与检索', '文档ID（勿改；新增行留空）'
]
const documentRows = documents.map(item => [
  codeOf.get(item.doc.id),
  item.doc.title,
  item.module,
  MODULE_LABELS[item.module] || item.module,
  item.doc.source_type || 'markdown',
  item.tags.join(', '),
  item.section,
  item.doc.content,
  item.sourceRef,
  item.notes,
  item.searchable ? (item.schoolScoped ? '是（校级，仅本校可见）' : '是') : '否',
  item.doc.id
])

// ---- Sidecar CSV：编号对照（工单回修时用编号定位到平台内文档，不随 XLSX 发给业务） ----
const mappingHeaders = ['编号', '文档ID', '文档标题', '所属模块', '适用学部', '切块数', '状态', '参与检索', '来源出处', '最后更新']
const mappingRows = documents.map(item => [
  codeOf.get(item.doc.id) || '',
  item.doc.id,
  item.doc.title,
  item.module,
  item.section,
  item.chunks.length,
  item.doc.version_id ? `${item.doc.status}（版本 ${item.doc.version || ''}：${item.doc.version_status || ''}）` : item.doc.status,
  item.searchable ? '是' : '否',
  item.sourceRef,
  item.updatedAt
])

// ---- Sheet 4：使用说明 ----
const totalChunks = documents.reduce((sum, item) => sum + item.chunks.length, 0)
const embeddedChunks = documents.reduce((sum, item) => sum + item.chunks.filter(chunk => chunk.embedded).length, 0)
const notSearchable = documents.filter(item => !item.searchable).length
const personNameNotes = documents.filter(item => /^[一-龥]{2,4}（/.test(item.notes)).length

function countBy<T extends string>(values: T[]) {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  return counts
}

const moduleCounts = countBy(documents.map(item => item.module))
const sectionCounts = countBy(documents.map(item => item.section))
const moduleSummary = MODULE_ORDER
  .filter(module => moduleCounts.has(module))
  .map(module => `${module}（${MODULE_LABELS[module]}）${moduleCounts.get(module)} 篇`)
  .join('；')
const sectionSummary = (SCHOOL_SECTIONS as readonly string[])
  .filter(section => sectionCounts.has(section as never))
  .map(section => `${section}（${SECTION_LABELS[section] || section}）${sectionCounts.get(section as never)} 篇`)
  .join('；')

const guideRows: string[][] = [
  ['项目', '说明'],
  ['导出对象', '平台「知识库」全部文档（module_resource_documents / module_resource_chunks），即首页 AI 助手知识检索唯一可引用的平台依据'],
  ['导出时间', `${beijingTimestamp()}（北京时间）`],
  ['数据来源', describeDatabaseUrl(process.env.DATABASE_URL)],
  ['文档 / 切块', `${documents.length} 篇 / ${totalChunks} 段；已生成向量 ${embeddedChunks} 段`],
  ['参与检索', notSearchable
    ? `有 ${notSearchable} 篇不参与检索（非 ready 或挂着未发布版本），见「知识文档」表「参与检索」列`
    : '全部参与检索（教师端知识检索可召回）'],
  ['按模块', moduleSummary || '（无）'],
  ['按适用学部', sectionSummary || '（无）'],
  ['「知识文档」表', '唯一的数据表，列结构与平台后台「知识库 → 批量导入」模板一致；多出的「编号」「模块名称」「参与检索」「文档ID」四列在批量导入时会被忽略。「编号」用于反馈时定位到具体一行，「文档ID」用于回改导入定位文档'],
  ['回改流程：怎么改', '本表改完即为最新内容：改文案直接改「文档内容」；新增文档在表末尾整行新增（「文档ID」列留空）；删除文档=删掉整行。其余列按现有取值填写'],
  ['回改流程：怎么回系统', '把改好的文件交给运维，用命令 pnpm knowledge:import -- --file=<本文件> 先看差异（新增/更新/删除各多少），确认后加 --write 写入。禁止用平台后台的「批量导入」导这份文件——那是纯新增，会产生重复文档'],
  ['回改注意：「文档ID」列', '这一列是系统主键，用于把表格行对回库里的文档：请勿修改、勿清空、勿删除整列（误删会导致整批文档被当成新增）。新增行的该列留空即可'],
  ['字段口径：所属模块', '检索时按模块过滤的取值：self_growth / class_system / home_school / student_case / learning_problem'],
  ['字段口径：来源类型', '当前平台只支持 markdown / text / json，存量文档均为 markdown'],
  ['字段口径：适用学部', 'all / primary / junior / senior / repeat。学段过滤开关当前关闭（SCHOOL_SECTION_FILTER_ENABLED=false），标注暂不影响召回；内容按学段细分完成后开启'],
  ['字段口径：标签关键词', '逗号分隔，供检索与展示使用；平台内多值字段'],
  ['字段口径：来源出处', '平台内记录的出处（metadata.sourceRef），用于核对原文来源，不是系统自动生成'],
  ['导入时的副作用', '正文有改动的文档会重新切块并重新生成向量（耗时取决于改动量）；只改标题/标签/学段/出处/备注不会重新向量化；删掉的行会连同其切片一起删除'],
  ['未列入本表的内容', versionAttachedCount
    ? `另有 ${versionAttachedCount} 篇由三库版本同步生成的文档不在本表：它们跟随三库版本发布更新，改内容请改三库再发版`
    : '库内所有知识文档都已列入本表（没有来自三库版本的文档）'],
  ['内容红线', '知识库文档不得出现真实教师、学生、家长姓名与联系方式，示例须脱敏或虚构'],
  ['待业务确认：备注列的教师称谓', personNameNotes
    ? `本批有 ${personNameNotes} 篇（来源「小学部教师知识库条目汇编（240条融合版）」）的备注列填的是「姓名（年级·角色）」形式的教师称谓。若为真实教师姓名，请按内容红线改为脱敏或虚构；若为编写人署名且业务认可保留，请忽略本条`
    : '本批备注列未发现「姓名（年级·角色）」形式的教师称谓']
]

const workbook = XLSX.utils.book_new()
const documentSheet = XLSX.utils.aoa_to_sheet([documentHeaders, ...documentRows])
documentSheet['!cols'] = [
  { wch: 10 }, { wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 28 }, { wch: 12 },
  { wch: 80 }, { wch: 40 }, { wch: 20 }, { wch: 18 }, { wch: 38 }
]
const guideSheet = XLSX.utils.aoa_to_sheet(guideRows)
guideSheet['!cols'] = [{ wch: 24 }, { wch: 110 }]

XLSX.utils.book_append_sheet(workbook, documentSheet, '知识文档')
// 表名带「使用说明」：平台两条导入链路的忽略规则都会跳过它（/填写说明|使用说明|字段映射|说明页/）
XLSX.utils.book_append_sheet(workbook, guideSheet, '使用说明')

const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, buffer)

// 编号对照单独出 CSV（带 BOM，Excel 直接打开不乱码）：供内部回修定位，不随 XLSX 发给业务
const mappingPath = `${outPath.replace(/\.xlsx$/i, '')}_编号对照.csv`
if (mappingPath !== outPath) {
  const csvCell = (value: unknown) => {
    const text = String(value ?? '')
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const csv = '\uFEFF' + [mappingHeaders, ...mappingRows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
  writeFileSync(mappingPath, csv, 'utf8')
}

console.log('向量知识库导出完成')
console.log(`  输出文件：${outPath}`)
if (mappingPath !== outPath) console.log(`  编号对照：${mappingPath}（内部定位用，不发给业务）`)
console.log(`  数据来源：${describeDatabaseUrl(process.env.DATABASE_URL)}`)
console.log(`  文档：${documents.length} 篇${notSearchable ? `（其中 ${notSearchable} 篇不参与检索）` : '（全部参与检索）'}`)
console.log(`  切块：${totalChunks} 段，已生成向量 ${embeddedChunks} 段`)
console.log(`  按模块：${moduleSummary || '（无）'}`)
console.log(`  按学部：${sectionSummary || '（无）'}`)

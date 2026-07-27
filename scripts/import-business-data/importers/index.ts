// 三库导入器：assessment/tool 由现有业务 Excel 转换，attribution 优先读业务表格，兼容标准 JSON。
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createVersion, end as closeDb, findOrCreateLibrary, publishVersion } from '../db-client'
import { parseStandardToolFile, parseToolFile } from '../transformers/tool'
import { parseAssessmentFile, toAssessmentPayload } from '../transformers/assessment'
import { parseAttributionFile } from '../transformers/attribution'
import { attributionConfigSchema, type LibraryType, type ModuleId } from '../../../shared/contracts'
import { evaluateImportQuality, formatImportQualityReport, type ImportQualityReport } from '../quality'

const RAW_BASE = resolve('业务需求')
const STANDARD_BASE = resolve('business-libraries')

interface ImportTask {
  module: ModuleId
  type: LibraryType
  filePath: string
  toolFormat?: 'rx' | 'class_system' | 'home_school' | 'learning_problem'
  libName: string
  notes: string
}

const MODULES: ModuleId[] = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']
// 核心三库（向后兼容旧 import:business-data；output_template/keyword_route 按需导入）
const LIBRARY_TYPES: LibraryType[] = ['assessment', 'attribution', 'tool']

const LEGACY_RAW_TASKS: ImportTask[] = [
  {
    module: 'class_system', type: 'tool', toolFormat: 'class_system',
    filePath: `${RAW_BASE}/班级系统建设 工具、评估、术语库/班级系统建设小学版_工具库（每个模块的解决处理）.xlsx`,
    libName: '班级系统建设·工具库', notes: '由业务 Excel 整理导入'
  },
  {
    module: 'class_system', type: 'assessment',
    filePath: `${RAW_BASE}/班级系统建设 工具、评估、术语库/班级系统建设_评估库（量表）_v2.xlsx`,
    libName: '班级系统建设·量表库', notes: '由业务 Excel 整理导入'
  },
  {
    module: 'self_growth', type: 'tool', toolFormat: 'rx',
    filePath: `${RAW_BASE}/个人成长模块-工具库、评估库、专业知识库/教师自我成长工具库.xlsx`,
    libName: '个人成长·工具库', notes: '由业务 Excel 整理导入'
  },
  {
    module: 'self_growth', type: 'assessment',
    filePath: `${RAW_BASE}/个人成长模块-工具库、评估库、专业知识库/教师自我成长模块_量表整理.xlsx`,
    libName: '个人成长·量表库', notes: '由业务 Excel 整理导入'
  },
  {
    module: 'home_school', type: 'tool', toolFormat: 'home_school',
    filePath: `${RAW_BASE}/家校沟通与合作-工具库、评估库、专业知识库0722/工具库.xlsx`,
    libName: '家校沟通·工具库', notes: '由业务 Excel 整理导入'
  },
  {
    module: 'home_school', type: 'assessment',
    filePath: `${RAW_BASE}/家校沟通与合作-工具库、评估库、专业知识库0722/评估库（量表）_V2.xlsx`,
    libName: '家校沟通·量表库', notes: '由业务 Excel 整理导入'
  },
  {
    module: 'student_case', type: 'tool', toolFormat: 'rx',
    filePath: `${RAW_BASE}/学生个体问题-工具库、评估库、专业知识库/学生个体问题工具库.xlsx`,
    libName: '学生个体问题·工具库', notes: '由业务 Excel 整理导入'
  },
  {
    module: 'student_case', type: 'assessment',
    filePath: `${RAW_BASE}/学生个体问题-工具库、评估库、专业知识库/学生个体问题评估库.xlsx`,
    libName: '学生个体问题·量表库', notes: '由业务 Excel 整理导入'
  },
  {
    module: 'learning_problem', type: 'tool', toolFormat: 'learning_problem',
    filePath: `${RAW_BASE}/学习问题模块-工具库、评估库、专业知识库/学习问题智能辅导系统-工具库-更新版.xlsx`,
    libName: '学习问题·工具库', notes: '由业务 Excel 整理导入'
  },
  {
    module: 'learning_problem', type: 'assessment',
    filePath: `${RAW_BASE}/学习问题模块-工具库、评估库、专业知识库/学习问题智能辅导系统-测量量表精华版.xlsx`,
    libName: '学习问题·量表库', notes: '由业务 Excel 整理导入'
  },
  ...MODULES.map(module => ({
    module,
    type: 'attribution' as const,
    filePath: `${STANDARD_BASE}/${module}/attribution.json`,
    libName: `${module}·归因库`,
    notes: '业务整理后的可执行归因规则'
  }))
]

function buildStandardTasks() {
  return MODULES.flatMap(module => LIBRARY_TYPES.map(type => ({
    module,
    type,
    filePath: `${STANDARD_BASE}/${module}/${type}`,
    libName: `${module}·${type === 'assessment' ? '量表库' : type === 'attribution' ? '归因库' : '工具库'}`,
    notes: '业务按三库整理模板提交的标准资源'
  } satisfies ImportTask)))
}

interface ImportResult {
  task: ImportTask
  count: number
  success: boolean
  error?: string
  quality?: ImportQualityReport
}

export async function runImport(task: ImportTask, options: { dryRun?: boolean; publish?: boolean; strictQuality?: boolean } = {}): Promise<ImportResult> {
  const { dryRun = false, publish = false, strictQuality = false } = options

  try {
    const filePath = resolveInputFile(task)
    if (!filePath) throw new Error(`文件不存在：${task.filePath}`)
    const payload = await loadPayload(task, filePath) as Record<string, unknown>
    const quality = evaluateImportQuality({
      module: task.module,
      libraryType: task.type,
      payload,
      strict: strictQuality
    })
    const count = task.type === 'assessment'
      ? Array.isArray((payload as { instruments?: unknown[] }).instruments) ? (payload as { instruments: unknown[] }).instruments.length : 1
      : task.type === 'tool'
        ? Array.isArray((payload as { tools?: unknown[] }).tools) ? (payload as { tools: unknown[] }).tools.length : 0
        : (payload as { branches: unknown[] }).branches.length

    if (count === 0) throw new Error('未解析出任何条目')
    if (quality.status === 'fail') {
      return { task, count, success: false, quality, error: '导入质量校验未通过' }
    }
    if (dryRun) return { task, count, success: true, quality }

    const libraryId = await findOrCreateLibrary(task.module, task.type, task.libName, task.notes)
    const version = task.type === 'attribution'
      ? (payload as { version: string }).version
      : '1.0.0'
    const versionId = await createVersion(libraryId, version, payload, task.notes)
    if (publish) await publishVersion(versionId)
    return { task, count, success: true, quality }
  } catch (err: any) {
    return { task, count: 0, success: false, error: err.message }
  }
}

export async function importAll(options: { dryRun?: boolean; publish?: boolean; strictQuality?: boolean; requireComplete?: boolean; includeLegacyRaw?: boolean; module?: string; type?: string } = {}) {
  let tasks = options.includeLegacyRaw ? LEGACY_RAW_TASKS : buildStandardTasks()
  if (options.module) tasks = tasks.filter(task => task.module === options.module)
  if (options.type) tasks = tasks.filter(task => task.type === options.type)
  tasks = tasks
    .map(task => ({ ...task, filePath: resolveInputFile(task) || task.filePath }))
  const missingTasks = options.includeLegacyRaw ? 0 : tasks.filter(task => !existsSync(task.filePath)).length
  if (!options.requireComplete) {
    tasks = tasks.filter(task => existsSync(task.filePath))
  }

  const results: ImportResult[] = []
  for (const task of tasks) {
    console.log(`${options.dryRun ? '[DRY RUN] ' : ''}Importing ${task.module}/${task.type}: ${task.filePath}`)
    const result = await runImport(task, options)
    results.push(result)
    if (result.success) console.log(`  OK: ${result.count} entries`)
    else console.error(`  FAIL: ${result.error}`)
    if (result.quality) console.log(formatImportQualityReport(result.quality))
  }

  const succeeded = results.filter(result => result.success).length
  const totalEntries = results.reduce((sum, result) => sum + result.count, 0)
  const warningTasks = results.filter(result => result.quality?.status === 'warn').length
  const failedQualityTasks = results.filter(result => result.quality?.status === 'fail').length
  if (missingTasks > 0) console.log(`Missing standard resource files: ${missingTasks}`)
  console.log(`\nDone: ${succeeded}/${results.length} tasks, ${totalEntries} total entries, qualityWarnings=${warningTasks}, qualityFailures=${failedQualityTasks}`)

  await closeDb()
  if (options.requireComplete && missingTasks > 0) {
    process.exitCode = 1
  }
  return results
}

async function loadPayload(task: ImportTask, filePath: string) {
  if (task.type === 'tool') {
    if (filePath.endsWith('.json')) {
      const json = JSON.parse(await readFile(filePath, 'utf8'))
      return Array.isArray(json) ? { tools: json } : json
    }
    return { tools: task.toolFormat ? parseToolFile(filePath, task.toolFormat) : parseStandardToolFile(filePath) }
  }
  if (task.type === 'assessment') {
    if (filePath.endsWith('.json')) return JSON.parse(await readFile(filePath, 'utf8'))
    const instruments = parseAssessmentFile(filePath, task.module)
    return { instruments: instruments.map(instrument => toAssessmentPayload(instrument, task.module)) }
  }
  if (filePath.endsWith('.xlsx')) return parseAttributionFile(filePath, task.module)
  const json = JSON.parse(await readFile(filePath, 'utf8'))
  return attributionConfigSchema.parse(json)
}

function resolveInputFile(task: ImportTask) {
  if (!task.filePath.endsWith('.xlsx') && !task.filePath.endsWith('.json')) {
    const xlsx = `${task.filePath}.xlsx`
    const json = `${task.filePath}.json`
    if (existsSync(xlsx)) return xlsx
    if (existsSync(json)) return json
  }
  if (task.type === 'attribution') {
    const tablePath = task.filePath.replace(/\.json$/i, '.xlsx')
    if (existsSync(tablePath)) return tablePath
  }
  if (existsSync(task.filePath)) return task.filePath
  return null
}

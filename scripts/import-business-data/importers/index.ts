// 三库导入器：assessment/tool 由现有业务 Excel 转换，attribution 优先读业务表格，兼容标准 JSON。
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createVersion, deleteGlobalResourceLibraries, end as closeDb, findOrCreateLibrary, publishVersion } from '../db-client'
import { parseStandardToolFile, parseToolFile } from '../transformers/tool'
import { parseAssessmentFile, toAssessmentPayload } from '../transformers/assessment'
import { parseAttributionFile } from '../transformers/attribution'
import { parseKeywordRouteFile } from '../transformers/keyword-route'
import { parseOutputTemplateFile } from '../transformers/output-template'
import { attributionConfigSchema, type LibraryType, type ModuleId } from '../../../shared/contracts'
import { evaluateImportQuality, formatImportQualityReport, type ImportQualityReport } from '../quality'

const RAW_BASE = resolve('业务需求')
// 标准三库源目录。业务正式交付放 business-libraries/<module>/，
// 仓库内自带的样例数据放 business-libraries/test-data/<module>/，
// resolveInputFile 会依次查找，因此两者都能被 pnpm import:business-data 直接导入。
const STANDARD_BASE = resolve('business-libraries')
const TEST_DATA_BASE = resolve('business-libraries/test-data')

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
const LIBRARY_TYPES: LibraryType[] = ['assessment', 'attribution', 'tool', 'keyword_route', 'output_template']
const LIBRARY_TYPE_LABELS: Record<LibraryType, string> = {
  assessment: '量表库',
  attribution: '归因库',
  tool: '工具库',
  keyword_route: '关键词路由库',
  output_template: '方案输出模板库'
}

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
    libName: `${module}·${LIBRARY_TYPE_LABELS[type]}`,
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

export async function runImport(task: ImportTask, options: { dryRun?: boolean; publish?: boolean; strictQuality?: boolean; version?: string } = {}): Promise<ImportResult> {
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
        : task.type === 'keyword_route'
          ? Array.isArray((payload as { routes?: unknown[] }).routes) ? (payload as { routes: unknown[] }).routes.length : 0
          : task.type === 'output_template'
            ? Array.isArray((payload as { templates?: unknown[] }).templates) ? (payload as { templates: unknown[] }).templates.length : 0
            : (payload as { attributionItems?: unknown[] }).attributionItems?.length || 0

    if (count === 0) throw new Error('未解析出任何条目')
    if (quality.status === 'fail') {
      return { task, count, success: false, quality, error: '导入质量校验未通过' }
    }
    if (dryRun) return { task, count, success: true, quality }

    const libraryId = await findOrCreateLibrary(task.module, task.type, task.libName, task.notes)
    // 显式指定版本号时优先使用。同一个库的版本号不可重复（唯一约束），
    // 想在保留旧版本的前提下重新导入，用 --version=1.0.1 而不是 --replace 删库。
    const version = options.version
      || ((task.type === 'attribution' || task.type === 'keyword_route' || task.type === 'output_template')
        ? (payload as { version: string }).version || '1.0.0'
        : '1.0.0')
    const versionId = await createVersion(libraryId, version, payload, task.notes)
    if (publish) await publishVersion(versionId)
    return { task, count, success: true, quality }
  } catch (err: any) {
    return { task, count: 0, success: false, error: err.message }
  }
}

export async function importAll(options: { dryRun?: boolean; publish?: boolean; strictQuality?: boolean; requireComplete?: boolean; includeLegacyRaw?: boolean; module?: string; type?: string; replace?: boolean; version?: string } = {}) {
  let tasks = options.includeLegacyRaw ? LEGACY_RAW_TASKS : buildStandardTasks()
  if (options.module) tasks = tasks.filter(task => task.module === options.module)
  if (options.type) tasks = tasks.filter(task => task.type === options.type)
  tasks = tasks
    .map(task => ({ ...task, filePath: resolveInputFile(task) || task.filePath }))
  const missingTasks = options.includeLegacyRaw ? 0 : tasks.filter(task => !existsSync(task.filePath)).length
  if (!options.requireComplete) {
    tasks = tasks.filter(task => existsSync(task.filePath))
  }

  if (options.replace && !options.dryRun && !options.includeLegacyRaw) {
    const uniqueTargets = Array.from(
      new Map(tasks.map(task => [`${task.module}/${task.type}`, { module: task.module, type: task.type }])).values()
    )
    const deleted = await deleteGlobalResourceLibraries(uniqueTargets)
    console.log(`Replaced global libraries: deleted=${deleted}`)
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
  if (task.type === 'keyword_route') {
    if (filePath.endsWith('.json')) {
      const json = JSON.parse(await readFile(filePath, 'utf8'))
      return Array.isArray(json) ? { routes: json } : json
    }
    return { routes: parseKeywordRouteFile(filePath, task.module) }
  }
  if (task.type === 'output_template') {
    if (filePath.endsWith('.json')) {
      const json = JSON.parse(await readFile(filePath, 'utf8'))
      return Array.isArray(json) ? { templates: json } : json
    }
    return { templates: parseOutputTemplateFile(filePath, task.module) }
  }
  // attribution
  if (filePath.endsWith('.xlsx')) return parseAttributionFile(filePath, task.module)
  const json = JSON.parse(await readFile(filePath, 'utf8'))
  return attributionConfigSchema.parse(json)
}

function resolveInputFile(task: ImportTask) {
  // 依次尝试正式交付目录和仓库自带样例目录
  const candidateBases = [task.filePath, task.filePath.replace(STANDARD_BASE, TEST_DATA_BASE)]
  for (const base of candidateBases) {
    if (!base.endsWith('.xlsx') && !base.endsWith('.json')) {
      const xlsx = `${base}.xlsx`
      const json = `${base}.json`
      if (existsSync(xlsx)) return xlsx
      if (existsSync(json)) return json
    }
    if (task.type === 'attribution') {
      const tablePath = base.replace(/\.json$/i, '.xlsx')
      if (existsSync(tablePath)) return tablePath
    }
    if (existsSync(base)) return base
  }
  return null
}

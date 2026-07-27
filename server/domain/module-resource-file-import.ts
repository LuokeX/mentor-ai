import XLSX from 'xlsx'
import {
  attributionConfigSchema,
  type LibraryType,
  type ModuleId,
  type ToolRxEntry
} from '../../shared/contracts'
import type { AssessmentDefinition } from '../../shared/assessments'

interface SheetData {
  name: string
  rows: Record<string, string | undefined>[]
}

export function parseModuleResourceFile(input: {
  module: ModuleId
  libraryType: LibraryType
  filename: string
  contentBase64: string
}): Record<string, unknown> {
  const buffer = Buffer.from(input.contentBase64, 'base64')
  if (input.filename.toLowerCase().endsWith('.json')) {
    return JSON.parse(buffer.toString('utf8')) as Record<string, unknown>
  }
  if (!/\.(xlsx|xls)$/i.test(input.filename)) {
    throw new Error('仅支持 .xlsx、.xls 或 .json 文件')
  }
  const sheets = readWorkbook(buffer)
  if (input.libraryType === 'assessment') return { instruments: parseAssessmentSheets(sheets, input.module) }
  if (input.libraryType === 'tool') return { tools: parseToolSheets(sheets) }
  return parseAttributionSheets(sheets, input.module) as unknown as Record<string, unknown>
}

function readWorkbook(buffer: Buffer): SheetData[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  return workbook.SheetNames
    .filter(name => !/说明|模板|字段/i.test(name))
    .map((name) => {
      const sheet = workbook.Sheets[name]
      const raw = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: undefined }) : []
      const headerIndex = inferHeaderRow(raw)
      const headers = (raw[headerIndex] || []).map(value => String(value ?? '').trim()).filter(Boolean)
      const rows: Record<string, string | undefined>[] = []
      for (let i = headerIndex + 1; i < raw.length; i++) {
        const row = raw[i]
        if (!row || row.every(value => value === undefined || value === null || String(value).trim() === '')) continue
        const item: Record<string, string | undefined> = {}
        for (let index = 0; index < headers.length; index++) {
          const value = row[index]
          item[headers[index]!] = value === undefined || value === null ? undefined : String(value).trim()
        }
        rows.push(item)
      }
      return { name, rows }
    })
    .filter(sheet => sheet.rows.length > 0)
}

function inferHeaderRow(rows: unknown[][]) {
  const hints = [
    'module', 'code', 'instrumentCode', '题号', '题项', '工具编码', '规则编码', '变量名', '优先级', '主归因', '评估编码',
    // V2 新增
    '量表编码', '量表名称', '工具名称', '所属模块', '适用年级', '触发方式', '作答频次',
    '维度编码', '计算方式', '计算表达式', '归因理由', '输出动作摘要', '升级条件',
    '红线条件', '熔断范围', '步骤序号', '禁忌条件', '指标类别'
  ]
  let bestIndex = 0
  let bestScore = -1
  for (let index = 0; index < Math.min(rows.length, 12); index++) {
    const values = (rows[index] || []).map(value => String(value ?? '').trim()).filter(Boolean)
    const score = values.reduce((sum, value) => {
      const normalized = value.toLowerCase()
      return sum + hints.reduce((itemScore, hint) => itemScore + (normalized.includes(hint.toLowerCase()) ? 1 : 0), 0)
    }, 0)
    if (score > bestScore) {
      bestIndex = index
      bestScore = score
    }
  }
  return bestScore > 0 ? bestIndex : 0
}

function parseAssessmentSheets(sheets: SheetData[], module: ModuleId): AssessmentDefinition[] {
  return sheets
    .map((sheet, index) => {
      const first = sheet.rows[0] || {}
      const code = read(first, ['code', 'instrumentCode', '量表编码', '评估编码']) || `${module}/${sheet.name || `instrument-${index + 1}`}`
      const title = read(first, ['title', '量表名称', '评估名称']) || sheet.name || code
      const questions = sheet.rows
        .map((row, qIndex) => {
          const text = read(row, ['questions[].text', 'questionText', '题干', '题项', '题项内容', '题目', '评估条目', '评估提问', '使用端评估提问1', '评估名称'])
          if (!text || isMetadata(text)) return null
          const id = read(row, ['questions[].id', 'questionId', '题号', '编号', '序号', '评估编码']) || `q${qIndex + 1}`
          return {
            id: uniqueId(id, qIndex),
            text,
            dimension: read(row, ['questions[].dimension', 'dimension', '维度', '所属维度', '评估维度', '主要评估维度', '子维度']) || '',
            reverse: parseBool(read(row, ['questions[].reverse', 'reverse', '反向', '是否反向'])),
            options: parseOptions(row)
          }
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
      const seen = new Set<string>()
      return {
        code,
        instrumentCode: code,
        version: read(first, ['version', '版本']) || '1.0.0',
        module,
        title,
        description: read(first, ['description', '说明', '量表说明']) || `${title}（${questions.length}题）`,
        estimatedMinutes: Number(read(first, ['estimatedMinutes', '预计完成时间'])) || Math.max(1, Math.ceil(questions.length / 5)),
        questions: questions.map((question, qIndex) => {
          let id = question.id
          if (seen.has(id)) id = `${id}-${qIndex + 1}`
          seen.add(id)
          return { ...question, id }
        })
      }
    })
    .filter(item => item.questions.length > 0)
}

function parseToolSheets(sheets: SheetData[]): ToolRxEntry[] {
  return sheets.flatMap(sheet => sheet.rows.map((row): ToolRxEntry | null => {
    const code = read(row, ['code', '工具编码', '工具ID', '编号'])
    const name = read(row, ['name', '工具名称', '处方名称'])
    const steps = splitList(read(row, ['steps', '执行步骤', '操作步骤', '操作步骤（详细）', '具体操作步骤', '核心操作', '操作步骤摘要']))
    if (!code || !name || !steps.length) return null
    const tool: ToolRxEntry = {
      code,
      name,
      form: read(row, ['form', '工具形式', '处方形式', '工具类型']) || '',
      symptoms: read(row, ['symptoms', '适用症状/场景', '适用问题/场景', '适用场景', '触发情景', '适用症状场景']) || '',
      steps
    }
    assignIfPresent(tool, 'expectedEffect', read(row, ['expectedEffect', '预期输出或效果', '预期效果', '输出物']))
    assignIfPresent(tool, 'severity', read(row, ['severity', '严重度分级', '严重度', '风险等级']))
    assignIfPresent(tool, 'level', read(row, ['level', '适用等级', '等级', '严重度']))
    assignIfPresent(tool, 'attribution', read(row, ['attribution', '适用归因', '对应归因', '主归因']))
    assignIfPresent(tool, 'attributions', splitList(read(row, ['attributions', '归因列表', '适用归因列表'])))
    assignIfPresent(tool, 'primaryAttribution', read(row, ['primaryAttribution', '对应归因', '主归因']))
    assignIfPresent(tool, 'tags', splitList(read(row, ['tags', '场景标签', '标签'])))
    assignIfPresent(tool, 'toolTags', splitList(read(row, ['toolTags', '工具标签', '匹配标签'])))
    assignIfPresent(tool, 'duration', read(row, ['duration', '建议周期', '疗程与频次']))
    assignIfPresent(tool, 'timePerSession', read(row, ['timePerSession', '单次时长', '单次耗时']))
    assignIfPresent(tool, 'scripts', read(row, ['scripts', '关键话术', '话术']))
    assignIfPresent(tool, 'prohibitions', read(row, ['prohibitions', '禁忌条件', '禁止事项', '禁忌说明']))
    assignIfPresent(tool, 'targetUsers', read(row, ['targetUsers', '适用对象', '责任角色']))
    assignIfPresent(tool, 'dimensions', splitList(read(row, ['dimensions', '适用维度', '作用维度', '维度'])))
    // V2 新增
    assignIfPresent(tool, 'shortName', read(row, ['工具简称']))
    assignIfPresent(tool, 'prerequisiteToolCode', read(row, ['前置工具编码']))
    assignIfPresent(tool, 'alternativeToolCode', read(row, ['替代工具编码']))
    assignIfPresent(tool, 'advancedToolCode', read(row, ['进阶工具编码']))
    assignIfPresent(tool, 'evidenceLevel', read(row, ['证据等级']) as ToolRxEntry['evidenceLevel'])
    assignIfPresent(tool, 'evidenceSource', read(row, ['证据来源']))
    assignIfPresent(tool, 'outcomeIndicators', read(row, ['效果指标']))
    assignIfPresent(tool, 'failureCriteria', read(row, ['失败标准']))
    assignIfPresent(tool, 'preparationNeeded', read(row, ['准备事项']))
    assignIfPresent(tool, 'materialsRequired', read(row, ['所需材料']))
    assignIfPresent(tool, 'outputArtifact', read(row, ['输出物']))
    assignIfPresent(tool, 'crossModuleTags', splitList(read(row, ['跨模块标签'])))
    return tool
  }).filter((item): item is ToolRxEntry => Boolean(item)))
}

function assignIfPresent<T extends Record<string, unknown>, K extends keyof T>(target: T, key: K, value: T[K] | undefined) {
  if (value === undefined) return
  if (Array.isArray(value) && value.length === 0) return
  if (typeof value === 'string' && !value.trim()) return
  target[key] = value
}

function parseAttributionSheets(sheets: SheetData[], module: ModuleId) {
  const computed: Record<string, string> = {}
  const branches: Array<Record<string, unknown>> = []
  const redLines: Array<Record<string, unknown>> = []
  const actions: Array<{ title: string, detail: string, status: 'pending' }> = []
  const tools: Array<{ title: string, content: string }> = []
  let version = '1.0.0'
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      version = read(row, ['version', '版本']) || version

      // 计算变量
      const variableName = read(row, ['variableName', '变量名', '变量编码'])
      const expression = read(row, ['expression', '表达式', '计算表达式'])
      if (variableName && expression) computed[variableName] = expression

      // 规则分支
      const ruleId = read(row, ['ruleId', '规则编码', '规则ID'])
      const primaryAttribution = read(row, ['primaryAttribution', '主归因'])
      const level = read(row, ['level', '等级', '输出等级', '命中等级'])
      if (ruleId || primaryAttribution || level) {
        branches.push({
          pri: Number(read(row, ['priority', 'pri', '优先级'])) || branches.length + 1,
          when: read(row, ['when', '条件表达式', '触发条件', '命中条件']) || undefined,
          level: level || '',
          blocked: parseBool(read(row, ['blocked', '是否红线熔断', '是否阻断', '阻断'])),
          ruleId: ruleId || `${module}-rule-${branches.length + 1}`,
          primaryAttribution: primaryAttribution || '',
          secondaryAttributions: splitList(read(row, ['secondaryAttributions', '次归因'])),
          reasons: splitList(read(row, ['reasons', '归因理由', '原因说明', '原因文案'])),
          toolTags: splitList(read(row, ['toolTags', '工具标签', '匹配标签'])),
          // V2 新增
          outputActionSummary: read(row, ['输出动作摘要']),
          outputToolSummary: read(row, ['输出工具摘要']),
          escalationCondition: read(row, ['升级条件']),
          escalationTarget: read(row, ['升级目标']),
          reEvaluationTrigger: read(row, ['复评触发条件']),
          sourceRef: read(row, ['手册出处']),
        })
      }

      // 红线熔断 (V2 ⑥)
      const redCondition = read(row, ['红线条件', 'redLineCondition'])
      const redDescription = read(row, ['红线说明', 'redLineDescription'])
      if (redCondition && redDescription) {
        redLines.push({
          module,
          condition: redCondition,
          description: redDescription,
          scope: read(row, ['熔断范围', 'scope']) || 'module',
          requiredActions: read(row, ['处置要求', 'requiredActions']) || '',
          actions: splitList(read(row, ['熔断后动作', 'actions'])),
          recoveryCondition: read(row, ['恢复条件', 'recoveryCondition']),
          responsibleRole: read(row, ['责任人', 'responsibleRole']),
          notificationTemplate: read(row, ['通知模板', 'notificationTemplate']),
          sourceRef: read(row, ['手册出处', 'sourceRef']),
        })
      }

      // actions / tools
      const actionTitle = read(row, ['actionTitle', '行动标题'])
      const actionDetail = read(row, ['actionDetail', '行动详情'])
      if (actionTitle && actionDetail) actions.push({ title: actionTitle, detail: actionDetail, status: 'pending' })
      const toolTitle = read(row, ['toolTitle', '工具标题'])
      const toolContent = read(row, ['toolContent', '工具内容'])
      if (toolTitle && toolContent) tools.push({ title: toolTitle, content: toolContent })
    }
  }
  return attributionConfigSchema.parse({ module, version, computed, branches, actions, tools, redLines })
}

function read(row: Record<string, string | undefined>, keys: string[]) {
  for (const key of keys) {
    if (row[key]) return row[key]
  }
  const headers = Object.keys(row)
  for (const key of keys) {
    const normalizedKey = normalizeKey(key)
    const match = headers.find(header => normalizeKey(header) === normalizedKey || normalizeKey(header).includes(normalizedKey))
    if (match && row[match]) return row[match]
  }
  return undefined
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[.[\]\s_（）()：:]/g, '')
}

function parseOptions(row: Record<string, string | undefined>) {
  const raw = read(row, ['options', '选项', '选项与分值', '计分', '评分锚点'])
  if (raw) {
    const parsed = splitList(raw)
      .map((item) => {
        const match = item.match(/(-?\d+(?:\.\d+)?)\s*[=:：]\s*(.+)|(.+?)\s*[=:：]\s*(-?\d+(?:\.\d+)?)/)
        if (!match) return null
        const value = Number(match[1] || match[4])
        const label = String(match[2] || match[3] || '').trim()
        return Number.isFinite(value) && label ? { label, value } : null
      })
      .filter((item): item is { label: string, value: number } => Boolean(item))
    if (parsed.length >= 2) return parsed
  }
  return [
    { label: '完全不符合', value: 1 },
    { label: '比较不符合', value: 2 },
    { label: '一般', value: 3 },
    { label: '比较符合', value: 4 },
    { label: '非常符合', value: 5 }
  ]
}

function splitList(value: string | undefined): string[] {
  return (value || '').split(/[,，、;；\n]/).map(item => item.trim()).filter(Boolean)
}

function parseBool(value: string | undefined) {
  return ['是', 'true', 'yes', '1', 'y', '反向', '阻断'].includes((value || '').trim().toLowerCase())
}

function uniqueId(id: string, index: number) {
  const value = id.trim()
  if (!value || isMetadata(value)) return `q${index + 1}`
  return value.replace(/\s+/g, '-').slice(0, 60)
}

function isMetadata(value: string) {
  return /^(评分规则|评分标准|计分规则|结果判读|阈值分级|使用说明|来源|指导语|适用学段)$/i.test(value.trim())
}

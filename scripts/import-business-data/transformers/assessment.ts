// 评估量表 transformer：将评估 xlsx → AssessmentPayload 数组
// 支持两种格式：
// - V2 模板: 固定 Sheet 名 ③ 量表-清单 / ④ 量表-题目 / ④b 量表-选项组 / ④c 量表-维度定义
// - 旧格式: 每个 Sheet 作为一个独立的量表 instrument
import type { AssessmentPayload, AssessmentDimensionDef } from '../../../shared/contracts'
import type { ModuleId } from '../../../shared/contracts'
import { extractValue, readXlsxFile, type SheetData } from '../xlsx-reader'

export interface AssessmentInstrument {
  code: string           // 量表编码，如 'class_system/A01'
  title: string
  description: string
  estimatedMinutes: number
  questions: Array<{
    id: string
    text: string
    dimension?: string
    subDimension?: string
    weight?: number
    help?: string
    reverse?: boolean
    required?: boolean
    displayCondition?: string
    dataUsage?: string
    questionNote?: string
    example?: string
    options: Array<{ label: string, value: number }>
  }>
  // V2 元数据
  shortName?: string
  applicableGrades?: number[]
  applicableSubjects?: string[]
  targetAudience?: string
  formType?: string
  triggerMethod?: 'manual' | 'auto' | 'scheduled'
  frequency?: 'once' | 'daily' | 'weekly' | 'monthly' | 'per_case' | 'semester'
  isRequired?: boolean
  timeLimitMinutes?: number
  minQuestions?: number
  usageTiming?: string
  reAssessmentIntervalDays?: number
  prerequisiteCodes?: string[]
  exclusiveCodes?: string[]
  resultVisibility?: 'teacher_only' | 'teacher_and_student' | 'psychologist'
  responsibleRole?: string
  dataSensitivity?: string
  sourceType?: string
  externalAuthorizationNote?: string
  sourceRef?: string
  normReference?: string
  reliabilityNote?: string
  validityNote?: string
  privacyNotice?: string
  applicabilityPreconditions?: string
  contraindications?: string
  postAssessmentActions?: string
  dimensionDefs?: AssessmentDimensionDef[]
}

const defaultFivePoint = [
  { label: '几乎没有', value: 1 },
  { label: '很少', value: 2 },
  { label: '有时', value: 3 },
  { label: '经常', value: 4 },
  { label: '几乎每天', value: 5 },
]

const defaultAgree = [
  { label: '完全不符合', value: 1 },
  { label: '比较不符合', value: 2 },
  { label: '一般', value: 3 },
  { label: '比较符合', value: 4 },
  { label: '非常符合', value: 5 },
]

/**
 * 从 xlsx 解析评估量表。
 * 自动检测 V2 模板格式（③ 量表-清单 等固定 Sheet 名），否则回退到旧格式。
 */
export function parseAssessmentFile(filePath: string, moduleCode: ModuleId): AssessmentInstrument[] {
  const allSheets = readXlsxFile(filePath)

  // 检测 V2 格式：是否有 ③ 量表-清单 或带编号的 Sheet
  const isV2 = allSheets.some(s => /③|量表-清单/.test(s.name))

  if (isV2) {
    return parseAssessmentFileV2(allSheets, moduleCode)
  }

  // 旧格式：每个 Sheet 作为独立 instrument
  return parseAssessmentFileLegacy(allSheets, moduleCode)
}

/** V2 模板解析：从 ③ 量表-清单 + ④ 量表-题目 + ④b 量表-选项组 + ④c 量表-维度定义 组装 */
function parseAssessmentFileV2(allSheets: SheetData[], moduleCode: ModuleId): AssessmentInstrument[] {
  const instrumentSheet = allSheets.find(s => /③|量表-清单/.test(s.name))
  const questionSheet = allSheets.find(s => /④[^bc]|量表-题目/.test(s.name))
  const optionSheet = allSheets.find(s => /④b|选项组/.test(s.name))
  const dimensionSheet = allSheets.find(s => /④c|维度定义/.test(s.name))

  if (!instrumentSheet) return []

  // 解析选项组：编码 → 选项列表
  const optionGroups = parseOptionGroups(optionSheet)

  // 解析维度定义：量表编码 → 维度列表
  const dimensionDefs = parseDimensionDefs(dimensionSheet)

  const instruments: AssessmentInstrument[] = []

  for (const row of instrumentSheet.rows) {
    const code = extractValue(row, ['量表编码', '评估编码', 'code'])
    const title = extractValue(row, ['量表名称', '评估名称', 'title'])
    if (!code || !title) continue

    // 从 ④ 量表-题目 提取该量表的题目
    const questions = extractQuestionsV2(questionSheet, code, optionGroups)

    const instrument: AssessmentInstrument = {
      code,
      title,
      description: extractValue(row, ['量表说明', '说明', 'description']) || `${title}（${questions.length}题）`,
      estimatedMinutes: Number(extractValue(row, ['预计用时分钟', '预计用时', 'estimatedMinutes'])) || Math.max(1, Math.ceil(questions.length * 12 / 60)),
      questions,
      // V2 元数据
      shortName: extractValue(row, ['量表简称', 'shortName']),
      applicableGrades: parseNumberList(extractValue(row, ['适用年级'])),
      applicableSubjects: parseStringList(extractValue(row, ['适用学科'])),
      targetAudience: extractValue(row, ['施测对象']),
      formType: extractValue(row, ['施测形式']),
      triggerMethod: extractValue(row, ['触发方式']) as AssessmentInstrument['triggerMethod'],
      frequency: extractValue(row, ['作答频次']) as AssessmentInstrument['frequency'],
      isRequired: extractValue(row, ['是否必做']) === '是',
      timeLimitMinutes: Number(extractValue(row, ['作答时限分钟'])) || undefined,
      minQuestions: Number(extractValue(row, ['最低题数'])) || undefined,
      usageTiming: extractValue(row, ['使用时机']),
      reAssessmentIntervalDays: Number(extractValue(row, ['重评间隔天数'])) || undefined,
      prerequisiteCodes: parseStringList(extractValue(row, ['前置量表编码'])),
      exclusiveCodes: parseStringList(extractValue(row, ['互斥量表编码'])),
      resultVisibility: extractValue(row, ['结果可见性']) as AssessmentInstrument['resultVisibility'],
      responsibleRole: extractValue(row, ['责任角色']),
      dataSensitivity: extractValue(row, ['数据敏感级']),
      sourceType: extractValue(row, ['来源属性']),
      externalAuthorizationNote: extractValue(row, ['外部授权说明']),
      sourceRef: extractValue(row, ['手册出处']),
      normReference: extractValue(row, ['常模参照']),
      reliabilityNote: extractValue(row, ['信度说明']),
      validityNote: extractValue(row, ['效度说明']),
      privacyNotice: extractValue(row, ['隐私声明']),
      applicabilityPreconditions: extractValue(row, ['适用前提']),
      contraindications: extractValue(row, ['不适合情况']),
      postAssessmentActions: extractValue(row, ['后续建议动作']),
      dimensionDefs: dimensionDefs[code],
    }

    instruments.push(instrument)
  }

  return instruments
}

/** 旧格式解析：每个 Sheet 作为独立 instrument */
function parseAssessmentFileLegacy(allSheets: SheetData[], moduleCode: ModuleId): AssessmentInstrument[] {
  const sheets = allSheets.filter(s => !s.name.includes('说明') && !s.name.includes('使用'))
  const instruments: AssessmentInstrument[] = []

  for (const sheet of sheets) {
    const sheetCode = extractInstrumentCode(sheet.name)
    const instrumentCode = sheetCode ? `${moduleCode}/${sheetCode}` : `${moduleCode}/${sheet.name}`

    const questions = extractQuestions(sheet.rows, sheet.headers)
    if (questions.length === 0) continue

    instruments.push({
      code: instrumentCode,
      title: sheet.name,
      description: `${sheet.name}（${questions.length}题）`,
      estimatedMinutes: Math.max(1, Math.ceil(questions.length * 12 / 60)),
      questions,
    })
  }

  return instruments
}

/** 解析选项组 Sheet: ④b 量表-选项组 */
function parseOptionGroups(sheet: SheetData | undefined): Record<string, Array<{ label: string, value: number }>> {
  const groups: Record<string, Array<{ label: string, value: number }>> = {}
  if (!sheet) return groups

  for (const row of sheet.rows) {
    const groupCode = extractValue(row, ['选项组编码'])
    const label = extractValue(row, ['选项文本', '选项'])
    const value = Number(extractValue(row, ['分值']))
    if (!groupCode || !label || !Number.isFinite(value)) continue
    if (!groups[groupCode]) groups[groupCode] = []
    groups[groupCode].push({ label, value })
  }

  return groups
}

/** 解析维度定义 Sheet: ④c 量表-维度定义 */
function parseDimensionDefs(sheet: SheetData | undefined): Record<string, AssessmentDimensionDef[]> {
  const defs: Record<string, AssessmentDimensionDef[]> = {}
  if (!sheet) return defs

  for (const row of sheet.rows) {
    const instrumentCode = extractValue(row, ['量表编码'])
    const dimCode = extractValue(row, ['维度编码'])
    const dimName = extractValue(row, ['维度名称'])
    if (!instrumentCode || !dimCode || !dimName) continue

    if (!defs[instrumentCode]) defs[instrumentCode] = []

    defs[instrumentCode]!.push({
      code: dimCode,
      name: dimName,
      questionIds: parseStringList(extractValue(row, ['所属题号列表', '所属题号'])),
      calcMethod: (extractValue(row, ['计算方式']) || 'mean') as AssessmentDimensionDef['calcMethod'],
      weight: Number(extractValue(row, ['权重系数'])) || undefined,
      description: extractValue(row, ['维度说明']),
      highInterpretation: extractValue(row, ['高分解释']),
      lowInterpretation: extractValue(row, ['低分解释']),
      normMean: Number(extractValue(row, ['常模均值'])) || undefined,
      normStd: Number(extractValue(row, ['常模标准差'])) || undefined,
    })
  }

  return defs
}

/** V2 格式题目提取：从 ④ 量表-题目 按量表编码筛选，关联选项组 */
function extractQuestionsV2(
  questionSheet: SheetData | undefined,
  instrumentCode: string,
  optionGroups: Record<string, Array<{ label: string, value: number }>>
): AssessmentInstrument['questions'] {
  if (!questionSheet) return []

  const questions: AssessmentInstrument['questions'] = []
  const seenIds = new Set<string>()
  let qid = 0

  const rows = questionSheet.rows.filter(row => {
    const code = extractValue(row, ['量表编码'])
    return code === instrumentCode
  })

  for (const row of rows) {
    const text = extractValue(row, ['题干', '题目', '题项', '问题'])
    if (!text || isMetadataValue(text)) continue

    const itemId = normalizeQuestionId(extractValue(row, ['题号', '编号', '序号']), qid + 1)
    const uniqueId = seenIds.has(itemId) ? `${itemId}-${qid + 1}` : itemId
    seenIds.add(itemId)

    const optionGroupCode = extractValue(row, ['选项组编码'])
    const options = optionGroupCode && optionGroups[optionGroupCode]
      ? optionGroups[optionGroupCode]!
      : defaultAgree

    questions.push({
      id: uniqueId,
      text,
      dimension: extractValue(row, ['维度']) || undefined,
      subDimension: extractValue(row, ['子维度']),
      weight: Number(extractValue(row, ['权重'])) || undefined,
      reverse: extractValue(row, ['反向计分', '反向']) === '是',
      required: extractValue(row, ['是否必答']) !== '否',
      displayCondition: extractValue(row, ['显示条件']),
      dataUsage: extractValue(row, ['数据用途']),
      questionNote: extractValue(row, ['题目说明']),
      example: extractValue(row, ['题干举例']),
      options,
    })
    qid++
  }

  return questions
}

function parseNumberList(value: string | undefined): number[] | undefined {
  if (!value) return undefined
  const result = value.split(/[,，、;；\s]+/).map(v => Number(v.trim())).filter(n => Number.isFinite(n))
  return result.length > 0 ? result : undefined
}

function parseStringList(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const result = splitList(value)
  return result.length > 0 ? result : undefined
}

function splitList(value: string): string[] {
  return value.split(/[,，、;；\n]/).map(s => s.trim()).filter(Boolean)
}

/** 从 Sheet 名中提取编号（如 A01, B03） */
function extractInstrumentCode(sheetName: string): string | null {
  const match = sheetName.match(/([A-Z]+\d+(?:[-_][A-Z])?)/i)
  return match ? match[1].replace('_', '-').toUpperCase() : null
}

/** 从行数据中提取题目列表 */
function extractQuestions(
  rows: Record<string, string | undefined>[],
  headers: string[]
): AssessmentInstrument['questions'] {
  const questions: AssessmentInstrument['questions'] = []
  const seenIds = new Set<string>()
  let qid = 0

  for (const row of rows) {
    // 尝试从行中提取题目文本
    let text = ''
    let dimension = ''
    let itemId = ''

    // 策略1: 找到"题目"或"题项"列
    text = extractValue(row, [
      '题目',
      '题项',
      '题项内容',
      '题干',
      '问题',
      '内容',
      '陈述',
      '问卷条目',
      '条目',
      '评估提问',
      '评估条目',
      '核心问题',
      '具体指标',
      '评估名称',
      '评估文件_量表',
      '维度说明',
      '使用端评估提问1'
    ]) || ''

    // 策略2: 找维度列
    dimension = extractValue(row, ['维度', '所属维度', '维度/量表', '评估维度', '分类', '子量表', '子维度', '类别', '量表名称', '指标类别']) || ''

    // 策略3: 找编号列
    itemId = extractValue(row, ['题号', '编号', '序号', '条目编号', '评估编码', '评估ID', '维度编码', '量表ID', '指标编号', '分类代码', '级别编号', '类型编号', '杠杆编号', '响应级别', '层级编号', 'ID']) || ''

    // 策略4: 如果上述策略都失败，尝试使用最后一列或最长的文本列
    if (!text) {
      const allVals = Object.values(row).filter(v => v && v.length >= 5 && !isMetadataValue(v))
      text = allVals.length > 0 ? allVals.reduce((a, b) => (b?.length ?? 0) > (a?.length ?? 0) ? b : a, allVals[0]) ?? '' : ''
    }

    if (!text || text.length < 3 || isNonQuestionRow(row, headers, text, itemId)) continue
    itemId = normalizeQuestionId(itemId, qid + 1)
    if (seenIds.has(itemId)) itemId = `${itemId}-${qid + 1}`
    seenIds.add(itemId)

    questions.push({
      id: itemId,
      text,
      dimension: dimension || undefined,
      options: defaultAgree,
    })
    qid++
  }

  return questions
}

function normalizeQuestionId(value: string | undefined, fallbackIndex: number) {
  const raw = (value || '').trim()
  if (!raw || isMetadataValue(raw)) return `q${fallbackIndex}`
  return raw.replace(/\s+/g, '-').slice(0, 60)
}

function isNonQuestionRow(
  row: Record<string, string | undefined>,
  headers: string[],
  text: string,
  itemId: string
) {
  const values = Object.values(row).map(value => value?.trim()).filter(Boolean) as string[]
  if (values.length === 0) return true
  const normalizedText = text.trim()
  const normalizedId = itemId.trim()
  const headerSet = new Set(headers.map(header => header.trim()))
  if (values.filter(value => headerSet.has(value)).length >= Math.min(2, values.length)) return true
  if (isMetadataValue(normalizedText) || isMetadataValue(normalizedId)) return true
  if (normalizedText === normalizedId && normalizedText.length <= 12) return true
  return false
}

function isMetadataValue(value: string) {
  const normalized = value.trim()
  if (!normalized) return true
  if (/^(评分规则|评分标准|计分规则|结果判读|阈值分级|使用说明|来源|指导语|适用学段|用法|编制目的|科学性与局限|三步走)$/i.test(normalized)) return true
  if (/^【?(评分规则|评分标准|计分规则|阈值分级|结果判读|维度解释|说明|备注)】?$/.test(normalized)) return true
  if (/^(一|二|三|四|五|六|七|八|九|十)[、.．]/.test(normalized) && normalized.length < 40) return true
  if (/^第[一二三四五六七八九十\d]+部分/.test(normalized)) return true
  return false
}

/**
 * 将 AssessmentInstrument 转换为 AssessmentPayload
 */
export function toAssessmentPayload(instrument: AssessmentInstrument, _module: ModuleId): AssessmentPayload {
  const payload: AssessmentPayload = {
    code: instrument.code,
    instrumentCode: instrument.code,
    version: '1.0.0',
    module: _module,
    title: instrument.title,
    description: instrument.description,
    estimatedMinutes: instrument.estimatedMinutes,
    questions: instrument.questions.map(q => ({
      id: q.id,
      text: q.text,
      dimension: q.dimension ?? '',
      subDimension: q.subDimension,
      weight: q.weight,
      help: q.help,
      reverse: q.reverse,
      required: q.required,
      displayCondition: q.displayCondition,
      dataUsage: q.dataUsage,
      questionNote: q.questionNote,
      example: q.example,
      options: q.options,
    })),
    // V2 元数据
    shortName: instrument.shortName,
    applicableGrades: instrument.applicableGrades,
    applicableSubjects: instrument.applicableSubjects,
    targetAudience: instrument.targetAudience,
    formType: instrument.formType,
    triggerMethod: instrument.triggerMethod,
    frequency: instrument.frequency,
    isRequired: instrument.isRequired,
    timeLimitMinutes: instrument.timeLimitMinutes,
    minQuestions: instrument.minQuestions,
    usageTiming: instrument.usageTiming,
    reAssessmentIntervalDays: instrument.reAssessmentIntervalDays,
    prerequisiteCodes: instrument.prerequisiteCodes,
    exclusiveCodes: instrument.exclusiveCodes,
    resultVisibility: instrument.resultVisibility,
    responsibleRole: instrument.responsibleRole,
    dataSensitivity: instrument.dataSensitivity,
    sourceType: instrument.sourceType,
    externalAuthorizationNote: instrument.externalAuthorizationNote,
    sourceRef: instrument.sourceRef,
    normReference: instrument.normReference,
    reliabilityNote: instrument.reliabilityNote,
    validityNote: instrument.validityNote,
    privacyNotice: instrument.privacyNotice,
    applicabilityPreconditions: instrument.applicabilityPreconditions,
    contraindications: instrument.contraindications,
    postAssessmentActions: instrument.postAssessmentActions,
    dimensionDefs: instrument.dimensionDefs,
  }
  return payload
}

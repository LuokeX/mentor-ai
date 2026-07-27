// 评估量表 transformer：将评估 xlsx → AssessmentPayload 数组
// 每个 Sheet 作为一个独立的量表 instrument
import type { AssessmentPayload } from '../../../shared/contracts'
import type { ModuleId } from '../../../shared/contracts'
import { extractValue, readXlsxFile } from '../xlsx-reader'

export interface AssessmentInstrument {
  code: string           // 量表编码，如 'class_system/A01'
  title: string
  description: string
  estimatedMinutes: number
  questions: Array<{
    id: string
    text: string
    dimension?: string
    help?: string
    reverse?: boolean
    options: Array<{ label: string, value: number }>
  }>
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
 * 每个 Sheet 作为一个独立的 instrument。
 *
 * 推断规则：
 * - 第一列通常是题号或维度名
 * - 如果 Sheet 名包含数字编号（如 A01, B03），使用它作为 instrument code 的一部分
 * - questions 中前几列可能是维度、题号，后面的列是题目文本
 */
export function parseAssessmentFile(filePath: string, moduleCode: ModuleId): AssessmentInstrument[] {
  const allSheets = readXlsxFile(filePath, { sheetFilter: name => !name.includes('说明') && !name.includes('使用') })

  const instruments: AssessmentInstrument[] = []

  for (const sheet of allSheets) {
    const sheetCode = extractInstrumentCode(sheet.name)
    const instrumentCode = sheetCode ? `${moduleCode}/${sheetCode}` : `${moduleCode}/${sheet.name}`

    const questions = extractQuestions(sheet.rows, sheet.headers)
    if (questions.length === 0) continue

    // 根据题量估算时间
    const estimatedMinutes = Math.max(1, Math.ceil(questions.length * 12 / 60))

    instruments.push({
      code: instrumentCode,
      title: sheet.name,
      description: `${sheet.name}（${questions.length}题）`,
      estimatedMinutes,
      questions,
    })
  }

  return instruments
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
export function toAssessmentPayload(instrument: AssessmentInstrument, module: ModuleId): AssessmentPayload {
  return {
    code: instrument.code,
    instrumentCode: instrument.code,
    version: '1.0.0',
    module,
    title: instrument.title,
    description: instrument.description,
    estimatedMinutes: instrument.estimatedMinutes,
    questions: instrument.questions.map(q => ({
      id: q.id,
      text: q.text,
      dimension: q.dimension ?? '',
      help: q.help,
      reverse: q.reverse,
      options: q.options,
    })),
  }
}

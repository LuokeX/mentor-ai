import { createHash } from 'node:crypto'
import XLSX from 'xlsx'
import { communicationChannelLabels, studentEventTypes, type CommunicationChannel, type StudentEventType } from '../../shared/contracts'
import { COMMUNICATION_RISK_LABELS } from '../../shared/dashboard'
import { searchableHash as nameSearchHash } from '../utils/crypto'

/**
 * 信息中心批量导入（学生 / 家长 / 家校沟通 / 学生事件记录）——纯解析与校验逻辑。
 *
 * 与 school-imports（学校管理员 CSV 导入）不同：
 * - 文件格式为 .xlsx（与三库导入一致，服务端 xlsx 解析）；
 * - 权限边界是「当前教师负责的班级 / 学生」，不是全校；
 * - 学生重复（同班级同姓名）与家长重复采用严格模式：任一错误行 → 整批不写入。
 *
 * 家校沟通 / 学生事件记录两类同样被学校管理员「导入管理」复用（范围改成全校在册学生，
 * 记录归属学生的负责教师），因此校验函数的 deps 由调用方决定范围，本文件不感知角色。
 *
 * 本文件不依赖 h3 / 数据库，便于 Vitest 直接测试；
 * 查库和写入逻辑在 information-import-io.ts。
 */

export type InformationImportType = 'students' | 'guardians' | 'communications' | 'student_events'
/** 家校沟通 / 学生事件记录（教师端与管理端共用的两类） */
export type BusinessImportType = Extract<InformationImportType, 'communications' | 'student_events'>
export type ImportRowError = { row: number, code: string, message: string }

export function isBusinessImportType(value: string): value is BusinessImportType {
  return value === 'communications' || value === 'student_events'
}

export const IMPORT_TEMPLATE_COLUMNS: Record<InformationImportType, Array<{ header: string, required: boolean, example: string }>> = {
  students: [
    { header: '姓名', required: true, example: '张三' },
    { header: '年级', required: false, example: '7' },
    { header: '班级', required: true, example: '七年级1班' },
    { header: '性别', required: false, example: '男' },
    { header: '民族', required: false, example: '汉族' },
    { header: '备注', required: false, example: '班主任家访记录' },
    { header: '现住址', required: false, example: 'XX 市 XX 区 XX 街道 1 号' },
    { header: '户籍', required: false, example: '本地' },
  ],
  guardians: [
    { header: '学生姓名', required: true, example: '张三' },
    { header: '与学生关系', required: false, example: '母亲' },
    { header: '家长姓名', required: true, example: '李四' },
    { header: '电话', required: false, example: '13800000001' },
    { header: '身份证号', required: false, example: '110101199001011234' },
    { header: '工作单位', required: false, example: 'XX 市人民医院' },
  ],
  communications: [
    { header: '学生姓名', required: true, example: '张三' },
    { header: '班级', required: false, example: '七年级1班' },
    { header: '沟通时间', required: true, example: '2026-10-08 15:30' },
    { header: '沟通摘要', required: true, example: '与家长沟通近期作业完成情况，家长表示会配合监督。' },
    { header: '沟通渠道', required: false, example: '电话' },
    { header: '家长类型', required: false, example: '母亲' },
    { header: '态度类型', required: false, example: '配合' },
    { header: '风险等级', required: false, example: '低风险' },
    { header: '容纳水平', required: false, example: '0' },
  ],
  student_events: [
    { header: '学生姓名', required: true, example: '张三' },
    { header: '班级', required: false, example: '七年级1班' },
    { header: '事件标题', required: true, example: '课间与同学发生口角' },
    { header: '发生时间', required: true, example: '2026-10-08 15:30' },
    { header: '事件类型', required: false, example: '行为规范类' },
    { header: '严重程度', required: false, example: '中' },
    { header: '事件说明', required: false, example: '课间因座位问题与同学争执，经劝解后平息。' },
    { header: '处理结果', required: false, example: '已与双方沟通并达成一致。' },
    { header: '状态', required: false, example: '待处理' },
  ],
}

/** 表头别名 → 列键（统一转小写、去空格后匹配） */
const HEADER_ALIASES: Record<InformationImportType, Record<string, string>> = {
  students: {
    '姓名': 'name',
    'name': 'name',
    '年级': 'grade',
    'grade': 'grade',
    '班级': 'className',
    'class': 'className',
    '班级名称': 'className',
    'classname': 'className',
    '性别': 'gender',
    'gender': 'gender',
    '民族': 'ethnicity',
    'ethnicity': 'ethnicity',
    '备注': 'notes',
    'notes': 'notes',
    '现住址': 'address',
    'address': 'address',
    '现住地址': 'address',
    '户籍': 'residence',
    'residence': 'residence',
    '户籍情况': 'residence',
    'residencetype': 'residence',
    '居住户籍情况': 'residence',
  },
  guardians: {
    '学生姓名': 'studentName',
    'studentname': 'studentName',
    '学生': 'studentName',
    '与学生关系': 'relation',
    'relation': 'relation',
    '关系': 'relation',
    '学生关系': 'relation',
    '家长姓名': 'name',
    'name': 'name',
    '家长': 'name',
    '电话': 'phone',
    'phone': 'phone',
    '联系电话': 'phone',
    '手机号': 'phone',
    '身份证号': 'idCard',
    'idcard': 'idCard',
    '身份证': 'idCard',
    '工作单位': 'workUnit',
    'workunit': 'workUnit',
    '单位': 'workUnit',
  },
  communications: {
    '学生姓名': 'studentName',
    '学生': 'studentName',
    '学生名': 'studentName',
    'studentname': 'studentName',
    'student': 'studentName',
    '班级': 'className',
    'class': 'className',
    '班级名称': 'className',
    'classname': 'className',
    '沟通时间': 'occurredAt',
    '沟通日期': 'occurredAt',
    '时间': 'occurredAt',
    '日期': 'occurredAt',
    'occurredat': 'occurredAt',
    'date': 'occurredAt',
    '沟通摘要': 'summary',
    '沟通内容': 'summary',
    '摘要': 'summary',
    '内容': 'summary',
    'summary': 'summary',
    '沟通渠道': 'channel',
    '沟通方式': 'channel',
    '渠道': 'channel',
    'channel': 'channel',
    '家长类型': 'parentType',
    '家长分型': 'parentType',
    'parenttype': 'parentType',
    '态度类型': 'attitudeType',
    '态度': 'attitudeType',
    'attitudetype': 'attitudeType',
    '风险等级': 'riskLevel',
    '风险': 'riskLevel',
    'risklevel': 'riskLevel',
    '容纳水平': 'containerLevel',
    '容纳度': 'containerLevel',
    'containerlevel': 'containerLevel',
  },
  student_events: {
    '学生姓名': 'studentName',
    '学生': 'studentName',
    '学生名': 'studentName',
    'studentname': 'studentName',
    'student': 'studentName',
    '班级': 'className',
    'class': 'className',
    '班级名称': 'className',
    'classname': 'className',
    '事件标题': 'title',
    '标题': 'title',
    'title': 'title',
    '发生时间': 'occurredAt',
    '事件时间': 'occurredAt',
    '时间': 'occurredAt',
    '日期': 'occurredAt',
    'occurredat': 'occurredAt',
    'date': 'occurredAt',
    '事件类型': 'eventType',
    '类型': 'eventType',
    'eventtype': 'eventType',
    '严重程度': 'severity',
    '严重度': 'severity',
    '程度': 'severity',
    'severity': 'severity',
    '事件说明': 'description',
    '说明': 'description',
    '描述': 'description',
    'description': 'description',
    '处理结果': 'resolution',
    '处理': 'resolution',
    '结果': 'resolution',
    'resolution': 'resolution',
    '状态': 'status',
    'status': 'status',
  },
}

/** xlsx 数据 sheet 里跳过名称含「说明/填写/示例/模板」的 sheet（模板说明页，不参与解析） */
const GUIDE_SHEET_PATTERN = /说明|填写|示例|模板/i

/**
 * 表头单元格归一化：去掉必填星号（* / ＊）、半角与全角空白后转小写。
 * 模板生成时必填列为「*姓名」这类前缀写法，用户也可能手动把星号放到名称后面，
 * 两种写法都要能落到同一列键上。
 */
function normalizeHeaderCell(value: unknown): string {
  return String(value ?? '')
    .replace(/[*＊]/g, '')
    .replace(/[\s\u3000]/g, '')
    .toLowerCase()
}

function addError(errors: ImportRowError[], row: number, code: string, message: string) {
  // 错误明细最多收集 200 条，防止超大文件撑爆响应
  if (errors.length < 200) errors.push({ row, code, message })
}

/** 解析年级列：1-12 整数、中文数字（一~十二）、「X年级」「初一~初三」「高一~高三」 */
export function parseGrade(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  const cnDigits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 }
  if (/^\d{1,2}$/.test(text)) {
    const num = Number(text)
    return num >= 1 && num <= 12 ? num : null
  }
  // 纯中文数字单字/双字（一~十二）
  if (cnDigits[text] !== undefined) return cnDigits[text]
  const levelMatch = /^(初|高)?(\d{1,2}|[一二三四五六七八九十]{1,2})年级?$/.exec(text)
  if (levelMatch) {
    const prefix = levelMatch[1] || ''
    const raw = levelMatch[2]!
    // 正则已限定 raw 在「一~十二」枚举内，此处 key 一定存在
    const num = /^\d+$/.test(raw) ? Number(raw) : cnDigits[raw]!
    if (!num) return null
    if (prefix === '初') return num >= 1 && num <= 6 ? 6 + num : null
    if (prefix === '高') return num >= 1 && num <= 3 ? 9 + num : null
    return num >= 1 && num <= 12 ? num : null
  }
  const short = /^(初[一二三四五六]|高[一二三])$/.exec(text)
  if (short) {
    const cnMap: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
    const letter = text[text.length - 1]!
    // 正则已限定 letter 在枚举内，此处 key 一定存在
    const num = cnMap[letter]!
    if (text.startsWith('初')) return 6 + num
    return 9 + num
  }
  return null
}

/** 解析数据 sheet：返回「行对象数组（表头键已按别名归一化）」；纯结构错误以 throws 表达 */
export function parseWorkbookRows(type: InformationImportType, contentBase64: string): { rows: Array<Record<string, string>>, checksum: string } {
  const bytes = Buffer.from(contentBase64, 'base64')
  if (!bytes.length) throw new Error('EMPTY_FILE')
  if (bytes.length > 2 * 1024 * 1024) throw new Error('FILE_TOO_LARGE')
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(bytes, { type: 'buffer' })
  } catch {
    throw new Error('INVALID_XLSX')
  }
  const dataSheetName = workbook.SheetNames.find(name => !GUIDE_SHEET_PATTERN.test(name))
  if (!dataSheetName) throw new Error('NO_DATA_SHEET')
  const sheet = workbook.Sheets[dataSheetName]
  if (!sheet) throw new Error('NO_DATA_SHEET')
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: undefined })
  let headerIndex = -1
  for (let index = 0; index < raw.length; index++) {
    const row = raw[index]
    if (row && row.some(value => value !== undefined && value !== null && String(value).trim() !== '')) {
      headerIndex = index
      break
    }
  }
  if (headerIndex < 0) throw new Error('EMPTY_FILE')
  // 模板里的必填列表头带 * 标记（如「*姓名」「*班级」），这里统一去掉星号与空白再匹配别名，
  // 否则教师下载模板填写后，必填列会被当成无法识别的列而整批报「必填字段为空」。
  const headerCells = raw[headerIndex]!.map(value => normalizeHeaderCell(value))
  const aliasMap = HEADER_ALIASES[type]
  const columnKey: Array<string | null> = headerCells.map(cell => aliasMap[cell] || null)
  const rows: Array<Record<string, string>> = []
  for (let index = headerIndex + 1; index < raw.length; index++) {
    const row = raw[index]
    if (!row || row.every(value => value === undefined || value === null || String(value).trim() === '')) continue
    const item: Record<string, string> = {}
    for (let col = 0; col < columnKey.length; col++) {
      const value = row[col]
      item[columnKey[col] || `_col${col}`] = value === undefined || value === null ? '' : String(value).trim()
    }
    rows.push(item)
  }
  if (!rows.length) throw new Error('EMPTY_FILE')
  if (rows.length > 2000) throw new Error('TOO_MANY_ROWS')
  return { rows, checksum: createHash('sha256').update(bytes).digest('hex') }
}

/** 年级 + 班级列匹配候选班级；多个候选或无法匹配返回 null（由调用方给出错误文案） */
export function matchClass(grade: number | null, className: string, classes: Array<{ id: string, name: string, grade: number }>): { match: string | null, ambiguous: boolean } {
  const exact = classes.filter(c => c.name === className)
  if (exact.length === 1) return { match: exact[0]!.id, ambiguous: false }
  if (exact.length > 1) return { match: null, ambiguous: true }
  const suffix = grade === null ? classes.filter(c => c.name.endsWith(className)) : classes.filter(c => c.grade === grade && c.name.endsWith(className))
  if (suffix.length === 1) return { match: suffix[0]!.id, ambiguous: false }
  if (suffix.length > 1) return { match: null, ambiguous: true }
  return { match: null, ambiguous: false }
}

function cell(row: Record<string, string>, key: string): string {
  const value = row[key]
  return value === undefined || value === null ? '' : String(value).trim()
}

export interface StudentValidateDeps {
  /** 当前教师负责的 active 班级 */
  classes: Array<{ id: string, name: string, grade: number }>
  /** 每个班级下已有学生的 (classId, nameSearch) */
  existing: Array<{ classId: string | null, nameSearch: string }>
  secret: string
}

/** 学生导入行的解析值（全为已 trim 的字符串，空字符串表示未填写） */
export interface StudentImportRowValues {
  name: string
  gradeText: string
  gender: string
  ethnicity: string
  notes: string
  address: string
  residence: string
}

export function validateStudentRows(rows: Array<Record<string, string>>, deps: StudentValidateDeps): { resolved: Array<{ row: number, values: StudentImportRowValues, classId: string, className: string }>, errors: ImportRowError[] } {
  const errors: ImportRowError[] = []
  const resolved: Array<{ row: number, values: StudentImportRowValues, classId: string, className: string }> = []
  const seenInFile = new Set<string>()
  const existingByKey = new Set(deps.existing.map(item => `${item.classId || ''}:${item.nameSearch}`))
  rows.forEach((raw, index) => {
    const line = index + 2
    const name = cell(raw, 'name')
    const className = cell(raw, 'className')
    const gradeText = cell(raw, 'grade')
    const gender = cell(raw, 'gender')
    const ethnicity = cell(raw, 'ethnicity')
    const notes = cell(raw, 'notes')
    const address = cell(raw, 'address')
    const residence = cell(raw, 'residence')
    const lengthValid = ethnicity.length <= 40 && notes.length <= 1000 && address.length <= 1000 && residence.length <= 80
    const genderValid = !gender || gender === '男' || gender === '女'
    const grade = parseGrade(gradeText)
    const gradeValid = !gradeText || grade !== null
    if (!name) { addError(errors, line, 'REQUIRED_FIELD', '姓名为空'); return }
    if (name.length > 80) { addError(errors, line, 'INVALID_NAME', '姓名长度不能超过 80'); return }
    if (!className) { addError(errors, line, 'REQUIRED_FIELD', '班级为空'); return }
    if (!gradeValid) addError(errors, line, 'INVALID_GRADE', '年级格式不正确（支持 1-12 整数或「七/七年级/初一」等写法）')
    if (!genderValid) addError(errors, line, 'INVALID_GENDER', '性别只允许填写「男」「女」或留空')
    if (!lengthValid) addError(errors, line, 'TOO_LONG', '字段长度超出限制（民族 40 / 备注 1000 / 现住址 1000 / 户籍 80）')
    const { match, ambiguous } = matchClass(grade, className, deps.classes)
    if (ambiguous) addError(errors, line, 'CLASS_AMBIGUOUS', `班级「${className}」匹配到多个班级，请填写班级全名（如「七年级1班」）`)
    else if (!match) addError(errors, line, 'CLASS_NOT_FOUND', `班级「${className}」不在您负责的班级中，请先在校内班级管理中确认班级名称`)
    if (!gradeValid || !genderValid || !lengthValid || ambiguous || !match) return
    const key = `${match}:${nameSearchHash(name, deps.secret)}`
    if (seenInFile.has(key)) addError(errors, line, 'DUPLICATE_IN_FILE', '文件内存在重复学生（同班级、同姓名）')
    else if (existingByKey.has(key)) addError(errors, line, 'EXISTS', '该班级下已存在同名学生，请确认后重试')
    else {
      seenInFile.add(key)
      resolved.push({ row: line, values: { name, gradeText, gender, ethnicity, notes, address, residence }, classId: match, className })
    }
  })
  return { resolved, errors }
}

export interface GuardianValidateDeps {
  /** 当前教师负责的学生 */
  students: Array<{ id: string, nameSearch: string }>
  /** 已有家长：参与关联的 (studentId, guardianNameSearch) 与全校 (idCardSearch) */
  linkedByName: Array<{ studentId: string, nameSearch: string }>
  idCards: string[]
  secret: string
}

/** 家长导入行的解析值（全为已 trim 的字符串，空字符串表示未填写） */
export interface GuardianImportRowValues {
  studentName: string
  relation: string
  name: string
  phone: string
  idCard: string
  workUnit: string
}

export function validateGuardianRows(rows: Array<Record<string, string>>, deps: GuardianValidateDeps): { resolved: Array<{ row: number, values: GuardianImportRowValues, studentId: string }>, errors: ImportRowError[] } {
  const errors: ImportRowError[] = []
  const resolved: Array<{ row: number, values: GuardianImportRowValues, studentId: string }> = []
  const seenInFile = new Set<string>()
  const studentIndex = new Map<string, string[]>()
  for (const student of deps.students) {
    const list = studentIndex.get(student.nameSearch) || []
    list.push(student.id)
    studentIndex.set(student.nameSearch, list)
  }
  const linkedByKey = new Set(deps.linkedByName.map(item => `${item.studentId}:${item.nameSearch}`))
  rows.forEach((raw, index) => {
    const line = index + 2
    const studentName = cell(raw, 'studentName')
    const name = cell(raw, 'name')
    const relation = cell(raw, 'relation')
    const phone = cell(raw, 'phone')
    const idCard = cell(raw, 'idCard').toUpperCase()
    const workUnit = cell(raw, 'workUnit')
    const relationValid = relation.length <= 40
    const workUnitValid = workUnit.length <= 200
    const phoneValid = !phone || /^1[3-9]\d{9}$/.test(phone)
    const idCardValid = !idCard || /^\d{17}[\dX]$/.test(idCard)
    if (!studentName) { addError(errors, line, 'REQUIRED_FIELD', '学生姓名为空'); return }
    if (!name) { addError(errors, line, 'REQUIRED_FIELD', '家长姓名为空'); return }
    if (name.length > 80) { addError(errors, line, 'INVALID_NAME', '家长姓名长度不能超过 80'); return }
    if (!relationValid) addError(errors, line, 'TOO_LONG', '与学生关系长度不能超过 40')
    if (!workUnitValid) addError(errors, line, 'TOO_LONG', '工作单位长度不能超过 200')
    if (!phoneValid) addError(errors, line, 'INVALID_PHONE', '电话格式不正确（需为 11 位手机号）')
    if (!idCardValid) addError(errors, line, 'INVALID_ID_CARD', '身份证号格式不正确（需为 18 位，末位可为 X）')
    const matches = studentIndex.get(nameSearchHash(studentName, deps.secret)) || []
    if (matches.length === 0) addError(errors, line, 'STUDENT_NOT_FOUND', `学生「${studentName}」不在您负责的学生中`)
    else if (matches.length > 1) addError(errors, line, 'STUDENT_AMBIGUOUS', `存在多个同名「${studentName}」，请核对或与学校管理员确认`)
    if (!relationValid || !workUnitValid || !phoneValid || !idCardValid || matches.length !== 1) return
    const studentId = matches[0]!
    const nameHash = nameSearchHash(name, deps.secret)
    const key = `${studentId}:${nameHash}`
    if (seenInFile.has(key)) addError(errors, line, 'DUPLICATE_IN_FILE', '文件内存在重复家长（同学生、同家长姓名）')
    else if (linkedByKey.has(key)) addError(errors, line, 'EXISTS', `该学生已存在同名家长「${name}」，请确认后重试`)
    else if (idCard && deps.idCards.includes(nameSearchHash(idCard, deps.secret))) addError(errors, line, 'ID_CARD_EXISTS', '该身份证号已存在家长档案，请勿重复导入')
    else {
      seenInFile.add(key)
      resolved.push({ row: line, values: { studentName, relation, name, phone, idCard, workUnit }, studentId })
    }
  })
  return { resolved, errors }
}

// ===== 家校沟通 / 学生事件记录（教师端信息中心 + 学校管理员导入管理共用）=====

/**
 * 学生匹配 deps：
 * - 教师范围 = 本人负责的 active 学生（`scope.kind === 'teacher'`）；
 * - 管理员范围 = 本校 active 学生（`scope.kind === 'school'`）。
 * `secret` 用于姓名搜索哈希，`studentScopeLabel` 只影响错误文案。
 */
export interface BusinessImportStudent {
  id: string
  nameSearch: string
  ownerUserId: string
  className: string | null
  grade: number | null
}

export interface BusinessImportDeps {
  students: BusinessImportStudent[]
  secret: string
  /** 错误文案里的范围说明，如「您负责的学生」「本校在读学生」 */
  studentScopeLabel: string
}

/** 导入时间列允许的最早时间：早于该时间视为填错年份或把年份误当成 Excel 序列号 */
const IMPORT_TIME_EARLIEST = new Date('2000-01-01T00:00:00+08:00')
/** Excel 日期序列号合理区间（2000-01-01 ~ 2100-01-01），避免把「2026」这类年份数字当成序列号 */
const EXCEL_SERIAL_MIN = 36526
const EXCEL_SERIAL_MAX = 73051
const MS_PER_DAY = 86_400_000
/** Excel 1900 日期系统序列号 25569 = 1970-01-01（序列号均大于 36526，无需处理 1900 假闰日） */
const EXCEL_EPOCH_OFFSET = 25_569

type BeijingParts = { year: number, month: number, day: number, hour: number, minute: number, second: number }

/** 东八区墙上时间 → 绝对时刻（Date.UTC 会归一化越界分量，由 parseImportDateTime 回读校验） */
function beijingInstant(parts: BeijingParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour - 8, parts.minute, parts.second))
}

/** 绝对时刻 → 东八区墙上时间分量（用于回读校验日期真实存在，如 2026-02-30） */
function beijingWallClock(date: Date): BeijingParts {
  const shifted = new Date(date.getTime() + 8 * 3_600_000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  }
}

/** 时间列文本 → 墙上时间分量；Excel 日期单元格返回的数字按序列号处理 */
function textToBeijingParts(text: string): BeijingParts | null {
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text)
    if (serial < EXCEL_SERIAL_MIN || serial > EXCEL_SERIAL_MAX) return null
    const utc = new Date(Math.round((serial - EXCEL_EPOCH_OFFSET) * MS_PER_DAY))
    if (Number.isNaN(utc.getTime())) return null
    return {
      year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate(),
      hour: utc.getUTCHours(), minute: utc.getUTCMinutes(), second: utc.getUTCSeconds(),
    }
  }
  const matched = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/.exec(text)
  if (!matched) return null
  const [, year, month, day, hour, minute, second] = matched
  const parts: BeijingParts = {
    year: Number(year), month: Number(month), day: Number(day),
    hour: Number(hour ?? 0), minute: Number(minute ?? 0), second: Number(second ?? 0),
  }
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null
  if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null
  return parts
}

/**
 * 解析导入的时间列：支持「2026-10-08 15:30」「2026/10/8」「2026年10月8日 15:30」等写法，
 * 以及 Excel 把该列识别成日期单元格后返回的日期序列号（如 46303.645833）；
 * 只给日期时按当天 00:00（东八区）。
 * 缺失、格式不正确、日期不存在（2026-02-30）或超出合理区间（早于 2000 年、晚于明天）返回 null。
 */
export function parseImportDateTime(value: string, now = new Date()): Date | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const parts = textToBeijingParts(text)
  if (!parts) return null
  const instant = beijingInstant(parts)
  if (Number.isNaN(instant.getTime())) return null
  const wall = beijingWallClock(instant)
  if (wall.year !== parts.year || wall.month !== parts.month || wall.day !== parts.day
    || wall.hour !== parts.hour || wall.minute !== parts.minute || wall.second !== parts.second) return null
  if (instant.getTime() < IMPORT_TIME_EARLIEST.getTime()) return null
  if (instant.getTime() > now.getTime() + MS_PER_DAY) return null
  return instant
}

/** 绝对时刻 → 东八区「YYYY-MM-DD HH:mm」（预检示例与纠错提示共用） */
export function formatImportDateTime(date: Date): string {
  const parts = beijingWallClock(date)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`
}

export type StudentMatchReason = 'ok' | 'not_found' | 'class_mismatch' | 'ambiguous'

/**
 * 按姓名（搜索哈希）匹配学生；「班级」列在填写时用于消歧，也用于校验姓名与班级是否一致。
 * 只按姓名匹配、未填班级且命中多个同名 → ambiguous（提示填写班级列）。
 */
export function matchStudent(name: string, className: string, students: BusinessImportStudent[], secret: string): { student: BusinessImportStudent | null, reason: StudentMatchReason } {
  const nameHash = nameSearchHash(name, secret)
  let candidates = students.filter(item => item.nameSearch === nameHash)
  if (!candidates.length) return { student: null, reason: 'not_found' }
  if (className) {
    const exact = candidates.filter(item => item.className === className)
    const narrowed = exact.length ? exact : candidates.filter(item => (item.className ?? '').endsWith(className))
    if (!narrowed.length) return { student: null, reason: 'class_mismatch' }
    candidates = narrowed
  }
  if (candidates.length > 1) return { student: null, reason: 'ambiguous' }
  return { student: candidates[0]!, reason: 'ok' }
}

function addStudentMatchError(errors: ImportRowError[], line: number, name: string, className: string, result: { reason: StudentMatchReason }, scopeLabel: string) {
  if (result.reason === 'not_found') addError(errors, line, 'STUDENT_NOT_FOUND', `学生「${name}」不在${scopeLabel}中，请核对姓名`)
  else if (result.reason === 'class_mismatch') addError(errors, line, 'STUDENT_CLASS_MISMATCH', `学生「${name}」不在班级「${className}」中，请核对班级名称或留空该列`)
  else if (result.reason === 'ambiguous') addError(errors, line, 'STUDENT_AMBIGUOUS', `存在多个同名「${name}」，请填写「班级」列区分`)
}

/** 沟通渠道：中文标签与英文码都接受，落英文码；空值返回 null，无法识别返回 undefined */
export function normalizeCommunicationChannel(value: string): string | null | undefined {
  const text = value.trim()
  if (!text) return null
  const codes = Object.keys(communicationChannelLabels) as CommunicationChannel[]
  const lower = text.toLowerCase()
  return codes.find(code => code === lower) ?? codes.find(code => communicationChannelLabels[code] === text)
}

/** 风险等级：中文标签与英文码都接受，落英文码；空值/「无」返回 null，无法识别返回 undefined */
export function normalizeCommunicationRiskLevel(value: string): string | null | undefined {
  const text = value.trim()
  if (!text || text === '无' || text === '未标注') return null
  const codes = Object.keys(COMMUNICATION_RISK_LABELS)
  const lower = text.toLowerCase()
  return codes.find(code => code === lower) ?? codes.find(code => COMMUNICATION_RISK_LABELS[code] === text)
}

/** 容纳水平：空值返回 null，-4~4 整数返回数字，其余返回 undefined */
export function parseContainerLevel(value: string): number | null | undefined {
  const text = value.trim()
  if (!text) return null
  if (!/^[+-]?\d+$/.test(text)) return undefined
  const num = Number(text)
  return num >= -4 && num <= 4 ? num : undefined
}

/** 事件类型：中文类型名或 E1~E6（E1=学业纪律类…E6=其他）都接受；空值默认「其他」，无法识别返回 undefined */
export function normalizeStudentEventType(value: string): StudentEventType | undefined {
  const text = value.trim()
  if (!text) return '其他'
  const code = /^e([1-6])$/i.exec(text)
  if (code) return studentEventTypes[Number(code[1]) - 1]
  return (studentEventTypes as readonly string[]).includes(text) ? text as StudentEventType : undefined
}

/** 事件状态：中文标签与英文码都接受；空值默认 open，无法识别返回 undefined */
export function normalizeStudentEventStatus(value: string): 'open' | 'resolved' | 'closed' | undefined {
  const text = value.trim()
  if (!text) return 'open'
  if (text === 'open' || text === '待处理') return 'open'
  if (text === 'resolved' || text === '已解决') return 'resolved'
  if (text === 'closed' || text === '已关闭' || text === '关闭') return 'closed'
  return undefined
}

/** 沟通导入行的解析值（字符串均已 trim，空字符串表示未填写） */
export interface CommunicationImportRowValues {
  studentName: string
  className: string
  occurredAtText: string
  occurredAt: Date
  summary: string
  channel: string | null
  parentType: string | null
  attitudeType: string | null
  riskLevel: string | null
  containerLevel: number | null
}

export interface BusinessImportResolvedRow<TValues> {
  row: number
  studentId: string
  ownerUserId: string
  values: TValues
}

const COMMUNICATION_CHANNEL_OPTIONS = (Object.keys(communicationChannelLabels) as CommunicationChannel[])
  .map(code => `${communicationChannelLabels[code]}（${code}）`).join(' / ')

export function validateCommunicationRows(
  rows: Array<Record<string, string>>,
  deps: BusinessImportDeps,
  now = new Date(),
): { resolved: Array<BusinessImportResolvedRow<CommunicationImportRowValues>>, errors: ImportRowError[] } {
  const errors: ImportRowError[] = []
  const resolved: Array<BusinessImportResolvedRow<CommunicationImportRowValues>> = []
  const seenInFile = new Set<string>()
  rows.forEach((raw, index) => {
    const line = index + 2
    const studentName = cell(raw, 'studentName')
    const className = cell(raw, 'className')
    const occurredAtText = cell(raw, 'occurredAt')
    const summary = cell(raw, 'summary')
    const channelText = cell(raw, 'channel')
    const parentType = cell(raw, 'parentType')
    const attitudeType = cell(raw, 'attitudeType')
    const riskLevelText = cell(raw, 'riskLevel')
    const containerLevelText = cell(raw, 'containerLevel')

    if (!studentName) { addError(errors, line, 'REQUIRED_FIELD', '学生姓名为空'); return }
    if (studentName.length > 80) { addError(errors, line, 'INVALID_NAME', '学生姓名长度不能超过 80'); return }
    if (!summary) { addError(errors, line, 'REQUIRED_FIELD', '沟通摘要为空'); return }
    if (summary.length < 5) { addError(errors, line, 'SUMMARY_TOO_SHORT', '沟通摘要至少填写 5 个字符'); return }
    if (summary.length > 3000) { addError(errors, line, 'TOO_LONG', '沟通摘要长度不能超过 3000'); return }
    if (!occurredAtText) { addError(errors, line, 'REQUIRED_FIELD', '沟通时间为空'); return }
    const occurredAt = parseImportDateTime(occurredAtText, now)
    if (!occurredAt) {
      addError(errors, line, 'INVALID_TIME', '沟通时间格式不正确或超出合理范围（示例「2026-10-08 15:30」，不早于 2000 年、不晚于明天）')
      return
    }
    const channel = normalizeCommunicationChannel(channelText)
    const riskLevel = normalizeCommunicationRiskLevel(riskLevelText)
    const containerLevel = parseContainerLevel(containerLevelText)
    const parentTypeValid = parentType.length <= 20
    const attitudeTypeValid = attitudeType.length <= 20
    if (channel === undefined) addError(errors, line, 'INVALID_CHANNEL', `沟通渠道「${channelText}」无法识别，请填写：${COMMUNICATION_CHANNEL_OPTIONS}`)
    if (riskLevel === undefined) addError(errors, line, 'INVALID_RISK_LEVEL', `风险等级「${riskLevelText}」无法识别，请填写：安全关注 / 高风险 / 中风险 / 低风险`)
    if (containerLevel === undefined) addError(errors, line, 'INVALID_CONTAINER_LEVEL', '容纳水平必须是 -4 至 4 的整数')
    if (!parentTypeValid) addError(errors, line, 'TOO_LONG', '家长类型长度不能超过 20')
    if (!attitudeTypeValid) addError(errors, line, 'TOO_LONG', '态度类型长度不能超过 20')
    const matched = matchStudent(studentName, className, deps.students, deps.secret)
    if (matched.reason !== 'ok') addStudentMatchError(errors, line, studentName, className, matched, deps.studentScopeLabel)
    if (channel === undefined || riskLevel === undefined || containerLevel === undefined || !parentTypeValid || !attitudeTypeValid || !matched.student) return
    const student = matched.student
    const key = `${student.id}|${occurredAt.getTime()}|${summary.replace(/\s+/g, '')}`
    if (seenInFile.has(key)) { addError(errors, line, 'DUPLICATE_IN_FILE', '文件内存在重复沟通记录（同学生、同时间、同摘要）'); return }
    seenInFile.add(key)
    resolved.push({
      row: line,
      studentId: student.id,
      ownerUserId: student.ownerUserId,
      values: {
        studentName, className, occurredAtText, occurredAt, summary,
        channel: channel ?? null, parentType: parentType || null, attitudeType: attitudeType || null,
        riskLevel: riskLevel ?? null, containerLevel: containerLevel ?? null,
      },
    })
  })
  return { resolved, errors }
}

/** 学生事件导入行的解析值（字符串均已 trim，空字符串表示未填写） */
export interface StudentEventImportRowValues {
  studentName: string
  className: string
  title: string
  eventType: StudentEventType
  severity: string
  description: string | null
  resolution: string | null
  status: 'open' | 'resolved' | 'closed'
  occurredAt: Date
}

const STUDENT_EVENT_SEVERITIES = ['低', '中', '高', '严重'] as const
const STUDENT_EVENT_TYPE_OPTIONS = studentEventTypes.map((type, index) => `${type}（E${index + 1}）`).join(' / ')

export function validateStudentEventRows(
  rows: Array<Record<string, string>>,
  deps: BusinessImportDeps,
  now = new Date(),
): { resolved: Array<BusinessImportResolvedRow<StudentEventImportRowValues>>, errors: ImportRowError[] } {
  const errors: ImportRowError[] = []
  const resolved: Array<BusinessImportResolvedRow<StudentEventImportRowValues>> = []
  const seenInFile = new Set<string>()
  rows.forEach((raw, index) => {
    const line = index + 2
    const studentName = cell(raw, 'studentName')
    const className = cell(raw, 'className')
    const title = cell(raw, 'title')
    const occurredAtText = cell(raw, 'occurredAt')
    const eventTypeText = cell(raw, 'eventType')
    const severityText = cell(raw, 'severity')
    const description = cell(raw, 'description')
    const resolution = cell(raw, 'resolution')
    const statusText = cell(raw, 'status')

    if (!studentName) { addError(errors, line, 'REQUIRED_FIELD', '学生姓名为空'); return }
    if (studentName.length > 80) { addError(errors, line, 'INVALID_NAME', '学生姓名长度不能超过 80'); return }
    if (!title) { addError(errors, line, 'REQUIRED_FIELD', '事件标题为空'); return }
    if (title.length > 200) { addError(errors, line, 'INVALID_TITLE', '事件标题长度不能超过 200'); return }
    if (!occurredAtText) { addError(errors, line, 'REQUIRED_FIELD', '发生时间为空'); return }
    const occurredAt = parseImportDateTime(occurredAtText, now)
    if (!occurredAt) {
      addError(errors, line, 'INVALID_TIME', '发生时间格式不正确或超出合理范围（示例「2026-10-08 15:30」，不早于 2000 年、不晚于明天）')
      return
    }
    const eventType = normalizeStudentEventType(eventTypeText)
    const severity = severityText || '低'
    const status = normalizeStudentEventStatus(statusText)
    const severityValid = (STUDENT_EVENT_SEVERITIES as readonly string[]).includes(severity)
    const lengthValid = description.length <= 5000 && resolution.length <= 5000
    if (!eventType) addError(errors, line, 'INVALID_EVENT_TYPE', `事件类型「${eventTypeText}」无法识别，请填写：${STUDENT_EVENT_TYPE_OPTIONS}`)
    if (!severityValid) addError(errors, line, 'INVALID_SEVERITY', '严重程度只允许填写「低」「中」「高」「严重」或留空（默认低）')
    if (!status) addError(errors, line, 'INVALID_STATUS', '状态只允许填写「待处理」「已解决」「已关闭」或留空（默认待处理）')
    if (!lengthValid) addError(errors, line, 'TOO_LONG', '事件说明与处理结果长度不能超过 5000')
    const matched = matchStudent(studentName, className, deps.students, deps.secret)
    if (matched.reason !== 'ok') addStudentMatchError(errors, line, studentName, className, matched, deps.studentScopeLabel)
    if (!eventType || !severityValid || !status || !lengthValid || !matched.student) return
    const student = matched.student
    const key = `${student.id}|${occurredAt.getTime()}|${title.replace(/\s+/g, '')}`
    if (seenInFile.has(key)) { addError(errors, line, 'DUPLICATE_IN_FILE', '文件内存在重复事件（同学生、同时间、同标题）'); return }
    seenInFile.add(key)
    resolved.push({
      row: line,
      studentId: student.id,
      ownerUserId: student.ownerUserId,
      values: {
        studentName, className, title, eventType, severity,
        description: description || null, resolution: resolution || null, status, occurredAt,
      },
    })
  })
  return { resolved, errors }
}

/** 预检示例行（只投影非正文列，避免把摘要/说明整段回显到预检界面） */
export function buildCommunicationImportSample(resolved: Array<BusinessImportResolvedRow<CommunicationImportRowValues>>): Array<Record<string, string | number>> {
  return resolved.slice(0, 5).map(item => ({
    row: item.row,
    studentName: item.values.studentName,
    occurredAt: formatImportDateTime(item.values.occurredAt),
    summaryPreview: item.values.summary.length > 40 ? `${item.values.summary.slice(0, 40)}…` : item.values.summary,
  }))
}

export function buildStudentEventImportSample(resolved: Array<BusinessImportResolvedRow<StudentEventImportRowValues>>): Array<Record<string, string | number>> {
  return resolved.slice(0, 5).map(item => ({
    row: item.row,
    studentName: item.values.studentName,
    eventType: item.values.eventType,
    severity: item.values.severity,
    occurredAt: formatImportDateTime(item.values.occurredAt),
  }))
}

const TEMPLATE_NOTES: Record<InformationImportType, string[]> = {
  students: [
    '1. 第一行是表头，请勿修改表头名称；示例行为演示数据，导入前请删除或替换。',
    '2. 带 * 的列（姓名、班级）为必填项，其余选填。',
    '3. 年级支持 1-12 整数，或「七」「七年级」「初一」等写法，仅用于匹配班级，不直接入库。',
    '4. 班级请填写您负责班级的全名（如「七年级1班」），可在「信息中心 - 负责班级」查看。',
    '5. 性别只允许填写「男」「女」或留空。',
    '6. 同一班级内已存在同名学生时，本次整批导入会被拒绝，请先到学生列表确认。',
    '7. 单次最多 2,000 行，文件不超过 2 MB，仅支持 .xlsx。',
  ],
  guardians: [
    '1. 第一行是表头，请勿修改表头名称；示例行为演示数据，导入前请删除或替换。',
    '2. 带 * 的列（学生姓名、家长姓名）为必填项，其余选填。',
    '3. 学生姓名必须与「我负责的学生」中的姓名一致；存在多个同名时导入会被拒绝。',
    '4. 电话需为 11 位手机号；身份证号需为 18 位（末位可为 X），同一学校内身份证号不允许重复。',
    '5. 导入后家长会自动关联到对应学生，可在学生档案或家长档案中调整。',
    '6. 单次最多 2,000 行，文件不超过 2 MB，仅支持 .xlsx。',
  ],
  communications: [
    '1. 第一行是表头，请勿修改表头名称；示例行为演示数据，导入前请删除或替换。',
    '2. 带 * 的列（学生姓名、沟通时间、沟通摘要）为必填项，其余选填。',
    '3. 学生姓名必须与「我负责的学生」中的姓名一致；存在多个同名时请填写「班级」列区分。',
    '4. 沟通时间填写如「2026-10-08 15:30」，只填日期按当天 00:00 处理；不早于 2000 年、不晚于明天。',
    '5. 沟通渠道可填「电话 / 企微 / 面谈 / 家访 / 其他」；风险等级可填「安全关注 / 高风险 / 中风险 / 低风险」，留空表示未标注。',
    '6. 容纳水平为 -4 至 4 的整数，留空表示未填写。',
    '7. 导入的记录只会新增，不会覆盖或修改已有沟通记录；同一文件内的重复行会被拒绝。',
    '8. 单次最多 2,000 行，文件不超过 2 MB，仅支持 .xlsx。',
  ],
  student_events: [
    '1. 第一行是表头，请勿修改表头名称；示例行为演示数据，导入前请删除或替换。',
    '2. 带 * 的列（学生姓名、事件标题、发生时间）为必填项，其余选填。',
    '3. 学生姓名必须与「我负责的学生」中的姓名一致；存在多个同名时请填写「班级」列区分。',
    '4. 发生时间填写如「2026-10-08 15:30」，只填日期按当天 00:00 处理；不早于 2000 年、不晚于明天。',
    '5. 事件类型可填「学业纪律类 / 课堂秩序类 / 行为规范类 / 身心健康类 / 欺凌侵害类 / 其他」或 E1~E6，留空默认「其他」。',
    '6. 严重程度可填「低 / 中 / 高 / 严重」，留空默认「低」；状态可填「待处理 / 已解决 / 已关闭」，留空默认「待处理」。',
    '7. 导入的记录只会新增，不会覆盖或修改已有事件；同一文件内的重复行会被拒绝。',
    '8. 单次最多 2,000 行，文件不超过 2 MB，仅支持 .xlsx。',
  ],
}

/** 数据 sheet 名称（使用说明 sheet 由 GUIDE_SHEET_PATTERN 在解析时跳过） */
const DATA_SHEET_NAMES: Record<InformationImportType, string> = {
  students: '学生数据',
  guardians: '家长数据',
  communications: '沟通数据',
  student_events: '事件数据',
}

/** 生成导入模板 xlsx（数据 sheet + 使用说明 sheet） */
export function buildImportTemplate(type: InformationImportType): Buffer {
  const columns = IMPORT_TEMPLATE_COLUMNS[type]
  const headers = [...columns.map(item => (item.required ? `*${item.header}` : item.header))]
  const example = [...columns.map(item => item.example)]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  ws['!cols'] = columns.map(item => ({ wch: Math.max(item.header.length * 2 + 4, 14) }))
  XLSX.utils.book_append_sheet(wb, ws, DATA_SHEET_NAMES[type])
  const notes = XLSX.utils.aoa_to_sheet(TEMPLATE_NOTES[type].map(line => [line]))
  notes['!cols'] = [{ wch: 90 }]
  XLSX.utils.book_append_sheet(wb, notes, '使用说明')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
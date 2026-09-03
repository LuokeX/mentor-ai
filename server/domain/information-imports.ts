import { createHash } from 'node:crypto'
import XLSX from 'xlsx'
import { searchableHash as nameSearchHash } from '../utils/crypto'

/**
 * 信息中心教师端批量导入（学生 / 家长）——纯解析与校验逻辑。
 *
 * 与 school-imports（学校管理员 CSV 导入）不同：
 * - 文件格式为 .xlsx（与三库导入一致，服务端 xlsx 解析）；
 * - 权限边界是「当前教师负责的班级 / 学生」，不是全校；
 * - 学生重复（同班级同姓名）与家长重复采用严格模式：任一错误行 → 整批不写入。
 *
 * 本文件不依赖 h3 / 数据库，便于 Vitest 直接测试；
 * 查库和写入逻辑在 information-import-io.ts。
 */

export type InformationImportType = 'students' | 'guardians'
export type ImportRowError = { row: number, code: string, message: string }

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
}

/** xlsx 数据 sheet 里跳过名称含「说明/填写/示例/模板」的 sheet（模板说明页，不参与解析） */
const GUIDE_SHEET_PATTERN = /说明|填写|示例|模板/i

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
  const headerCells = raw[headerIndex]!.map(value => String(value ?? '').trim().toLowerCase())
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
}

/** 生成导入模板 xlsx（数据 sheet + 使用说明 sheet） */
export function buildImportTemplate(type: InformationImportType): Buffer {
  const columns = IMPORT_TEMPLATE_COLUMNS[type]
  const headers = [...columns.map(item => (item.required ? `*${item.header}` : item.header))]
  const example = [...columns.map(item => item.example)]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  ws['!cols'] = columns.map(item => ({ wch: Math.max(item.header.length * 2 + 4, 14) }))
  XLSX.utils.book_append_sheet(wb, ws, type === 'students' ? '学生数据' : '家长数据')
  const notes = XLSX.utils.aoa_to_sheet(TEMPLATE_NOTES[type].map(line => [line]))
  notes['!cols'] = [{ wch: 90 }]
  XLSX.utils.book_append_sheet(wb, notes, '使用说明')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
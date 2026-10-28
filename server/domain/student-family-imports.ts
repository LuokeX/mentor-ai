import { addError, matchClass, parseGrade, parseImportDate, parseWorkbookMatrix, type ImportRowError } from './information-imports'
import {
  detectStudentFamilySection,
  findStudentFamilyHeaderMismatch,
  STUDENT_FAMILY_COLUMNS,
  STUDENT_FAMILY_HEADERS,
  STUDENT_FAMILY_SECTION_LABELS,
  type StudentFamilyColumnSpec,
  type StudentFamilySection,
} from './student-family-templates'
import { schoolSectionOfGrade, normalizeSchoolSection } from '../../shared/school-section'
import { searchableHash } from '../utils/crypto'

/**
 * 学生+家长合表导入——纯解析与校验逻辑（不依赖 h3 / 数据库，便于 Vitest）。
 *
 * 与现有学生/家长导入的区别：
 * - 一份模板一行同时包含学生与父亲/母亲/其他监护人，列名存在重复（电话/身份证号/工作单位），
 *   因此按模板列位置解析，而不是按表头别名；
 * - 学生支持按学籍号/身份证号/班级+姓名匹配后更新；
 * - 家长支持按身份证号复用（兄弟姐妹共享），并写入 student_guardians.relation。
 */

export class StudentFamilyParseError extends Error {
  constructor(
    public code: string,
    message?: string,
    public detail?: { index: number, actual: string, expected: string }
  ) {
    super(message ?? code)
    this.name = 'StudentFamilyParseError'
  }
}

export interface StudentFamilyGuardianSlot {
  source: 'father' | 'mother' | 'other'
  name: string
  phone: string
  idCard: string
  occupation: string
  workUnit: string
  relation: string
}

export interface StudentFamilyParsedRow {
  rowNumber: number
  section: StudentFamilySection
  name: string
  className: string
  sectionText: string
  gradeText: string
  studentNo: string
  gender: string
  ethnicity: string
  birthDate: string
  enrolledAt: string
  boarding: string
  idCard: string
  residenceType: string
  address: string
  guardians: StudentFamilyGuardianSlot[]
  /** 未映射列，按原表头名保存，后续加密写入 students.extraEnc */
  extra: Record<string, string>
}

export interface StudentFamilyParseResult {
  section: StudentFamilySection
  rows: StudentFamilyParsedRow[]
  checksum: string
}

/** 解析合表 xlsx；学段由表头签名识别，expectedSection 只用于断言（防止 UI 选错学部）。 */
export function parseStudentFamilyWorkbook(
  contentBase64: string,
  expectedSection?: StudentFamilySection
): StudentFamilyParseResult {
  const matrix = parseWorkbookMatrix(contentBase64)
  if (matrix.merges > 0) throw new StudentFamilyParseError('MERGED_CELLS', '模板包含合并单元格，请使用一行表头的导入模板')
  const section = detectStudentFamilySection(matrix.header)
  if (!section) {
    const candidates = (['primary', 'junior'] as const)
      .map(item => ({ item, mismatch: findStudentFamilyHeaderMismatch(matrix.header, item) }))
      .sort((a, b) => (b.mismatch?.index ?? 0) - (a.mismatch?.index ?? 0))
    const best = candidates[0]?.mismatch ?? null
    throw new StudentFamilyParseError('TEMPLATE_HEADER_MISMATCH', '模板表头与小学/初中模板不一致，请下载对应学部模板', best ?? undefined)
  }
  if (expectedSection && expectedSection !== section) {
    throw new StudentFamilyParseError(
      'SECTION_MISMATCH',
      `上传的是${STUDENT_FAMILY_SECTION_LABELS[section]}模板，当前选择的是${STUDENT_FAMILY_SECTION_LABELS[expectedSection]}`
    )
  }
  const spec = STUDENT_FAMILY_COLUMNS[section]
  const headers = STUDENT_FAMILY_HEADERS[section]
  const rows: StudentFamilyParsedRow[] = []
  for (const row of matrix.rows) {
    const value = (index: number | null) => index === null ? '' : String(row.cells[index] ?? '').trim()
    const extra: Record<string, string> = {}
    for (const index of spec.extra) {
      const text = value(index)
      if (text) extra[headers[index]!] = text
    }
    const guardians = buildGuardianSlots(spec, value)
    const name = value(spec.student.name)
    const className = value(spec.student.className)
    const studentNo = value(spec.student.studentNo)
    const idCard = value(spec.student.idCard)
    if (!name && !className && !studentNo && !idCard && !guardians.length) continue
    rows.push({
      rowNumber: row.rowNumber,
      section,
      name,
      className,
      sectionText: value(spec.student.section),
      gradeText: value(spec.student.grade) || value(spec.student.sourceGrade),
      studentNo,
      gender: value(spec.student.gender),
      ethnicity: value(spec.student.ethnicity),
      birthDate: value(spec.student.birthDate),
      enrolledAt: value(spec.student.enrolledAt),
      boarding: value(spec.student.boarding),
      idCard: normalizeIdCard(idCard),
      residenceType: value(spec.student.residenceType),
      address: spec.student.address.map(value).filter(Boolean).join(''),
      guardians,
      extra,
    })
  }
  if (!rows.length) throw new StudentFamilyParseError('EMPTY_FILE', '文件为空')
  return { section, rows, checksum: matrix.checksum }
}

type GuardianColumn = { name: number, phone: number, idCard: number | null, occupation?: number | null, workUnit: number | null }

function buildGuardianSlots(
  spec: StudentFamilyColumnSpec,
  value: (index: number | null) => string
): StudentFamilyGuardianSlot[] {
  const slots: StudentFamilyGuardianSlot[] = []
  const add = (source: 'father' | 'mother' | 'other', column: GuardianColumn, relation: string) => {
    const name = value(column.name)
    const phone = value(column.phone)
    const idCard = value(column.idCard)
    const occupation = value(column.occupation ?? null)
    const workUnit = value(column.workUnit)
    if (!name && !phone && !idCard && !occupation && !workUnit) return
    slots.push({ source, name, phone, idCard: normalizeIdCard(idCard), occupation, workUnit, relation })
  }
  add('father', spec.father, '父亲')
  add('mother', spec.mother, '母亲')
  add('other', spec.other, value(spec.other.relation) || '其他监护人')
  return slots
}

export interface StudentFamilyClass {
  id: string
  name: string
  grade: number
  section: string | null
  ownerUserId: string
  status: string
}

export interface StudentFamilyExistingStudent {
  id: string
  classId: string | null
  ownerUserId: string
  nameSearch: string
  studentNoSearch: string | null
  idCardSearch: string | null
  status: string
}

export interface StudentFamilyExistingGuardian {
  id: string
  nameSearch: string
  idCardSearch: string | null
  relation: string | null
  ownerUserId: string
  status: string
}

export interface StudentFamilyLink {
  studentId: string
  guardianId: string
  relation: string | null
  status: string
}

export interface StudentFamilyValidateDeps {
  classes: StudentFamilyClass[]
  /** 全校学生（含归档），用于学籍号/身份证号冲突检测 */
  students: StudentFamilyExistingStudent[]
  /** 全校家长（含归档），用于身份证号复用/归档提示 */
  guardians: StudentFamilyExistingGuardian[]
  /** 全校学生-家长关联（含 removed），用于姓名复用与重新激活 */
  links: StudentFamilyLink[]
  scope: 'teacher' | 'school'
  /** 教师范围时的当前教师；学校范围为空 */
  userId: string
  secret: string
  now?: Date
}

export interface StudentFamilyGuardianPlan {
  key: string
  existingGuardianId: string | null
  /** 新建时的负责教师；复用已有家长时忽略 */
  ownerUserId: string
  name: string
  phone: string
  idCard: string
  occupation: string
  workUnit: string
  /** 新建时写入 guardians.relation；复用时只在原值为空时写入 */
  relation: string
}

export interface StudentFamilyGuardianLink {
  planKey: string
  relation: string
}

export interface StudentFamilyResolvedRow {
  rowNumber: number
  mode: 'create' | 'update'
  existingStudentId: string | null
  classId: string
  ownerUserId: string
  values: {
    name: string
    gender: string
    ethnicity: string
    birthDate: Date | null
    enrolledAt: Date | null
    boardingType: string | null
    address: string
    residenceType: string
    studentNo: string
    idCard: string
    extra: Record<string, string>
    profile: Record<string, string>
  }
  guardianLinks: StudentFamilyGuardianLink[]
}

export interface StudentFamilyStats {
  studentsToCreate: number
  studentsToUpdate: number
  guardiansToCreate: number
  guardiansToReuse: number
  linksToCreate: number
  linksToReactivate: number
}

export interface StudentFamilyValidateResult {
  resolved: StudentFamilyResolvedRow[]
  guardianPlans: StudentFamilyGuardianPlan[]
  errors: ImportRowError[]
  stats: StudentFamilyStats
}

const ID_CARD_PATTERN = /^\d{17}[\dX]$/
const PHONE_PATTERN = /^[0-9+\-\s]{6,20}$/
const EXTRA_VALUE_MAX = 2_000
const EXTRA_JSON_MAX = 64_000
const ENROLLED_EARLIEST = new Date('1990-01-01T00:00:00+08:00')
const ENROLLED_LATEST = new Date('2100-12-31T00:00:00+08:00')
const ENROLLED_SERIAL_MIN = 32_874

export function validateStudentFamilyRows(
  rows: readonly StudentFamilyParsedRow[],
  deps: StudentFamilyValidateDeps
): StudentFamilyValidateResult {
  const errors: ImportRowError[] = []
  const now = deps.now ?? new Date()
  const studentNoIndex = indexBy(deps.students, item => item.studentNoSearch)
  const studentIdCardIndex = indexBy(deps.students, item => item.idCardSearch)
  const studentClassIndex = new Map<string, StudentFamilyExistingStudent[]>()
  for (const item of deps.students) {
    if (!item.classId) continue
    pushIndex(studentClassIndex, `${item.classId}:${item.nameSearch}`, item)
  }
  const guardianById = new Map(deps.guardians.map(item => [item.id, item]))
  const guardianIdCardIndex = indexBy(deps.guardians, item => item.idCardSearch)
  const linksByStudent = new Map<string, StudentFamilyLink[]>()
  for (const link of deps.links) pushIndex(linksByStudent, link.studentId, link)

  const planByKey = new Map<string, StudentFamilyGuardianPlan>()
  const resolved: StudentFamilyResolvedRow[] = []
  const seenStudentKeys = new Set<string>()
  const seenStudentIds = new Set<string>()
  let linksToCreate = 0
  let linksToReactivate = 0

  for (const row of rows) {
    let rowFailed = false
    const fail = (code: string, message: string) => {
      addError(errors, row.rowNumber, code, message)
      rowFailed = true
    }

    if (!row.name) fail('REQUIRED_FIELD', '姓名为空')
    else if (row.name.length > 80) fail('TOO_LONG', '姓名长度不能超过 80')
    if (!row.className) fail('REQUIRED_FIELD', '班级为空')
    if (row.gender && row.gender !== '男' && row.gender !== '女') fail('INVALID_GENDER', '性别只允许填写「男」「女」或留空')
    if (row.ethnicity.length > 40) fail('TOO_LONG', '民族长度不能超过 40')

    if (row.section === 'primary' && row.sectionText) {
      const normalized = normalizeSectionText(row.sectionText)
      if (normalized !== 'primary') fail('SECTION_MISMATCH', `学部「${row.sectionText}」与小学部模板不一致`)
    }
    let grade: number | null = null
    if (row.section === 'primary' && row.gradeText) {
      grade = parseGrade(row.gradeText)
      if (grade !== null && schoolSectionOfGrade(grade) !== 'primary') {
        fail('SECTION_MISMATCH', `年级「${row.gradeText}」不属于小学部`)
      }
    }

    let classId: string | null = null
    let ownerUserId = deps.userId
    if (row.className) {
      const sectionClasses = deps.classes.filter(item => classBelongsToSection(item, row.section))
      const matched = matchClass(grade, row.className, sectionClasses)
      if (matched.ambiguous) {
        fail('CLASS_AMBIGUOUS', `班级「${row.className}」存在多个候选，请填写完整班级名称`)
      } else if (!matched.match) {
        const other = matchClass(grade, row.className, deps.classes.filter(item => !classBelongsToSection(item, row.section)))
        if (other.match) {
          fail('CLASS_SECTION_MISMATCH', `班级「${row.className}」属于其他学部，与当前${STUDENT_FAMILY_SECTION_LABELS[row.section]}模板不一致`)
        } else {
          fail('CLASS_NOT_FOUND', `班级「${row.className}」不存在，请先创建班级或核对班级名称`)
        }
      } else {
        const klass = deps.classes.find(item => item.id === matched.match)!
        if (deps.scope === 'teacher' && klass.ownerUserId !== deps.userId) {
          fail('CLASS_OUT_OF_SCOPE', `班级「${row.className}」不属于您负责的班级`)
        }
        classId = klass.id
        ownerUserId = deps.scope === 'teacher' ? deps.userId : klass.ownerUserId
      }
    }

    const nameHash = searchableHash(row.name, deps.secret)
    const studentNoHash = row.studentNo ? searchableHash(row.studentNo, deps.secret) : ''
    const idCardHash = row.idCard ? searchableHash(row.idCard, deps.secret) : ''
    const noCandidates = studentNoHash ? studentNoIndex.get(studentNoHash) ?? [] : []
    const idCandidates = idCardHash ? studentIdCardIndex.get(idCardHash) ?? [] : []
    const classCandidates = classId ? studentClassIndex.get(`${classId}:${nameHash}`) ?? [] : []
    if (noCandidates.length > 1) fail('STUDENT_NO_AMBIGUOUS', '学籍号匹配到多个学生，请核对学籍号')
    if (idCandidates.length > 1) fail('STUDENT_ID_CARD_AMBIGUOUS', '身份证号匹配到多个学生，请核对身份证号')
    if (noCandidates[0] && idCandidates[0] && noCandidates[0].id !== idCandidates[0].id) {
      fail('STUDENT_MATCH_CONFLICT', '学籍号与身份证号匹配到不同学生，请核对')
    }
    let matchedStudent = noCandidates[0] ?? idCandidates[0] ?? null
    if (!matchedStudent) {
      if (classCandidates.length > 1) fail('STUDENT_AMBIGUOUS', `班级内存在多个同名「${row.name}」，请补学籍号或身份证号`)
      else if (classCandidates.length === 1) matchedStudent = classCandidates[0]!
    }
    if (matchedStudent) {
      if (matchedStudent.status !== 'active') {
        fail('STUDENT_ARCHIVED', `学生「${row.name}」已归档，请先在学校后台恢复后再导入`)
      } else if (deps.scope === 'teacher' && matchedStudent.ownerUserId !== deps.userId) {
        fail('STUDENT_OUT_OF_SCOPE', `学生「${row.name}」不属于您负责的学生，无法更新`)
      }
    }

    const duplicateKey = row.idCard
      ? `id:${idCardHash}`
      : row.studentNo
        ? `no:${studentNoHash}`
        : `class:${classId ?? ''}:${nameHash}`
    let duplicateReported = false
    if (seenStudentKeys.has(duplicateKey)) {
      fail('DUPLICATE_STUDENT_IN_FILE', `学生「${row.name}」在文件中重复`)
      duplicateReported = true
    } else {
      seenStudentKeys.add(duplicateKey)
    }
    if (matchedStudent && !duplicateReported) {
      if (seenStudentIds.has(matchedStudent.id)) fail('DUPLICATE_STUDENT_IN_FILE', `学生「${row.name}」在文件中重复`)
      else seenStudentIds.add(matchedStudent.id)
    }

    if (row.studentNo.length > 40) fail('TOO_LONG', '学籍号长度不能超过 40')
    if (row.idCard && !ID_CARD_PATTERN.test(row.idCard)) fail('INVALID_ID_CARD', `学生身份证号「${row.idCard}」格式不正确`)
    const birthDate = row.birthDate ? parseImportDate(row.birthDate, { latest: now }) : null
    if (row.birthDate && !birthDate) fail('INVALID_BIRTH_DATE', `出生日期「${row.birthDate}」格式不正确`)
    const enrolledAt = row.enrolledAt
      ? parseImportDate(row.enrolledAt, { earliest: ENROLLED_EARLIEST, latest: ENROLLED_LATEST, serialMin: ENROLLED_SERIAL_MIN })
      : null
    if (row.enrolledAt && !enrolledAt) fail('INVALID_ENROLLED_AT', `入学时间「${row.enrolledAt}」格式不正确`)
    const boardingType = mapBoarding(row.boarding)
    if (boardingType === undefined) fail('INVALID_BOARDING', `走读/住宿「${row.boarding}」无法识别，请填写「是/否」或「走读/住校」`)
    if (row.address.length > 1000) fail('TOO_LONG', '地址长度不能超过 1000')
    if (row.residenceType.length > 80) fail('TOO_LONG', '户口类型长度不能超过 80')

    const extraText = JSON.stringify(row.extra)
    if (extraText.length > EXTRA_JSON_MAX) fail('EXTRA_TOO_LARGE', '未映射列内容过多，请拆分文件或删减列内容')
    for (const [key, value] of Object.entries(row.extra)) {
      if (value.length > EXTRA_VALUE_MAX) fail('EXTRA_TOO_LARGE', `「${key}」内容超过 2000 字，请精简`)
    }

    const localPlans: StudentFamilyGuardianPlan[] = []
    const localLinks: StudentFamilyGuardianLink[] = []
    const rowPlanKeys = new Set<string>()
    for (const slot of row.guardians) {
      if (!slot.name) {
        fail('GUARDIAN_NAME_REQUIRED', `${sourceLabel(slot.source)}姓名不能为空`)
        continue
      }
      if (slot.name.length > 80) fail('TOO_LONG', `${sourceLabel(slot.source)}姓名长度不能超过 80`)
      const relation = slot.relation || '其他监护人'
      if (relation.length > 40) fail('TOO_LONG', `${sourceLabel(slot.source)}关系长度不能超过 40`)
      if (slot.source === 'other' && (relation === '父亲' || relation === '母亲')) {
        fail('INVALID_OTHER_RELATION', '其他监护人的关系不能填写父亲/母亲')
      }
      if (slot.phone && !PHONE_PATTERN.test(slot.phone)) fail('INVALID_PHONE', `${sourceLabel(slot.source)}电话格式不正确`)
      if (slot.idCard && !ID_CARD_PATTERN.test(slot.idCard)) fail('INVALID_ID_CARD', `${sourceLabel(slot.source)}身份证号格式不正确`)
      if (slot.occupation.length > 80) fail('TOO_LONG', `${sourceLabel(slot.source)}职业长度不能超过 80`)
      if (slot.workUnit.length > 200) fail('TOO_LONG', `${sourceLabel(slot.source)}工作单位长度不能超过 200`)
      if (slot.idCard && row.idCard && slot.idCard === row.idCard) {
        fail('GUARDIAN_ID_CARD_SAME_AS_STUDENT', `${sourceLabel(slot.source)}身份证号不能与学生本人相同`)
      }

      const guardianNameHash = searchableHash(slot.name, deps.secret)
      const guardianIdCardHash = slot.idCard ? searchableHash(slot.idCard, deps.secret) : ''
      const planKey = guardianIdCardHash ? `card:${guardianIdCardHash}` : `name:${guardianNameHash}|phone:${normalizePhoneKey(slot.phone)}`
      if (rowPlanKeys.has(planKey)) {
        fail('DUPLICATE_GUARDIAN_IN_ROW', `同一行中「${slot.name}」重复出现，请核对父亲/母亲/其他监护人`)
        continue
      }
      rowPlanKeys.add(planKey)

      let existingGuardianId: string | null = null
      if (guardianIdCardHash) {
        const candidates = guardianIdCardIndex.get(guardianIdCardHash) ?? []
        if (candidates.length > 1) fail('GUARDIAN_AMBIGUOUS', `家长身份证号匹配到多个家长，请核对「${slot.name}」`)
        const candidate = candidates[0]
        if (candidate) {
          if (candidate.status !== 'active') fail('GUARDIAN_ARCHIVED', `家长「${slot.name}」已归档，请先恢复后再导入`)
          else existingGuardianId = candidate.id
        }
      } else if (matchedStudent) {
        const linked = (linksByStudent.get(matchedStudent.id) ?? [])
          .filter(link => link.status === 'active')
          .map(link => ({ link, guardian: guardianById.get(link.guardianId) }))
          .filter((item): item is { link: StudentFamilyLink, guardian: StudentFamilyExistingGuardian } => Boolean(item.guardian))
          .filter(item => item.guardian.status === 'active' && item.guardian.nameSearch === guardianNameHash
            && (item.link.relation || item.guardian.relation) === relation)
        if (linked.length > 1) fail('GUARDIAN_AMBIGUOUS', `学生已关联多个同名「${slot.name}」，请补身份证号区分`)
        else if (linked.length === 1) existingGuardianId = linked[0]!.guardian.id
      }

      const existingPlan = planByKey.get(planKey)
      if (existingPlan) {
        if (existingPlan.name !== slot.name) {
          fail('GUARDIAN_CONFLICT', `同一家长「${slot.name}」在文件中姓名不一致`)
        }
        localLinks.push({ planKey, relation })
      } else {
        localPlans.push({
          key: planKey,
          existingGuardianId,
          ownerUserId,
          name: slot.name,
          phone: slot.phone,
          idCard: slot.idCard,
          occupation: slot.occupation,
          workUnit: slot.workUnit,
          relation,
        })
        localLinks.push({ planKey, relation })
      }
    }

    if (rowFailed) continue

    for (const plan of localPlans) {
      if (!planByKey.has(plan.key)) planByKey.set(plan.key, plan)
    }
    const mergedLinks = localLinks.map(link => ({ planKey: link.planKey, relation: link.relation }))
    for (const link of mergedLinks) {
      const plan = planByKey.get(link.planKey)
      const existingLink = matchedStudent
        ? (linksByStudent.get(matchedStudent.id) ?? []).find(item => item.guardianId === plan?.existingGuardianId)
        : undefined
      if (existingLink?.status === 'active') continue
      if (existingLink?.status === 'removed') linksToReactivate++
      else linksToCreate++
    }

    resolved.push({
      rowNumber: row.rowNumber,
      mode: matchedStudent ? 'update' : 'create',
      existingStudentId: matchedStudent?.id ?? null,
      classId: classId!,
      ownerUserId,
      values: {
        name: row.name,
        gender: row.gender,
        ethnicity: row.ethnicity,
        birthDate,
        enrolledAt,
        boardingType: boardingType ?? null,
        address: row.address,
        residenceType: row.residenceType,
        studentNo: row.studentNo,
        idCard: row.idCard,
        extra: row.extra,
        profile: buildProfile(row, boardingType ?? null),
      },
      guardianLinks: mergedLinks,
    })
  }

  const guardianPlans = [...planByKey.values()]
  return {
    resolved,
    guardianPlans,
    errors,
    stats: {
      studentsToCreate: resolved.filter(item => item.mode === 'create').length,
      studentsToUpdate: resolved.filter(item => item.mode === 'update').length,
      guardiansToCreate: guardianPlans.filter(item => !item.existingGuardianId).length,
      guardiansToReuse: guardianPlans.filter(item => Boolean(item.existingGuardianId)).length,
      linksToCreate,
      linksToReactivate,
    },
  }
}

function buildProfile(row: StudentFamilyParsedRow, boardingType: string | null): Record<string, string> {
  const profile: Record<string, string> = {}
  if (row.ethnicity) profile.ethnicity = row.ethnicity
  if (row.residenceType) profile.residenceType = row.residenceType
  if (boardingType) profile.boardingStatus = boardingType === 'day' ? '走读' : '住宿'
  if (row.studentNo) profile.studentNo = row.studentNo
  if (row.birthDate) profile.birthDate = row.birthDate
  return profile
}

function classBelongsToSection(klass: StudentFamilyClass, section: StudentFamilySection): boolean {
  const explicit = normalizeSchoolSection(klass.section)
  if (explicit !== 'all') return explicit === section
  return schoolSectionOfGrade(klass.grade) === section
}

function normalizeSectionText(value: string): StudentFamilySection | null {
  const text = value.trim()
  if (!text) return null
  if (/小学|primary/i.test(text)) return 'primary'
  if (/初中|junior/i.test(text)) return 'junior'
  return null
}

function mapBoarding(value: string): 'day' | 'boarding' | null | undefined {
  const text = value.trim()
  if (!text) return null
  if (/^(是|走读|日读|day)$/i.test(text)) return 'day'
  if (/^(否|住宿|住校|寄宿|boarding)$/i.test(text)) return 'boarding'
  return undefined
}

function normalizeIdCard(value: string): string {
  return value.replace(/\s/g, '').toUpperCase()
}

function normalizePhoneKey(value: string): string {
  return value.replace(/[\s-]/g, '')
}

function sourceLabel(source: StudentFamilyGuardianSlot['source']): string {
  return source === 'father' ? '父亲' : source === 'mother' ? '母亲' : '其他监护人'
}

function indexBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const value = key(item)
    if (value) pushIndex(map, value, item)
  }
  return map
}

function pushIndex<T>(map: Map<string, T[]>, key: string, item: T) {
  const list = map.get(key)
  if (list) list.push(item)
  else map.set(key, [item])
}

/** 合并学生 profile：只覆盖非空值，空白单元格不清空已有内容。 */
export function mergeStudentProfile(existing: unknown, planned: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {}
  if (isRecord(existing)) {
    for (const [key, value] of Object.entries(existing)) {
      if (typeof value === 'string' && value) base[key] = value
    }
  }
  for (const [key, value] of Object.entries(planned)) {
    if (value) base[key] = value
  }
  return base
}

/** 合并学生扩展信息：按 section 命名空间保存，重复导入同一学部时合并表头字段。 */
export function mergeStudentExtra(
  existing: unknown,
  section: StudentFamilySection,
  extra: Record<string, string>,
  importedAt: string
): Record<string, unknown> {
  const base = isRecord(existing) ? JSON.parse(JSON.stringify(existing)) as Record<string, unknown> : {}
  const root = isRecord(base.studentFamilyImport) ? base.studentFamilyImport as Record<string, unknown> : {}
  const sections = isRecord(root.sections) ? root.sections as Record<string, unknown> : {}
  const current = isRecord(sections[section]) ? sections[section] as Record<string, unknown> : {}
  const headers = isRecord(current.headers) ? current.headers as Record<string, unknown> : {}
  sections[section] = { ...current, version: 1, headers: { ...headers, ...extra }, importedAt }
  base.studentFamilyImport = { ...root, version: 1, sections }
  return base
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

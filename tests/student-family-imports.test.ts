import { describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import {
  mergeStudentExtra,
  mergeStudentProfile,
  parseStudentFamilyWorkbook,
  validateStudentFamilyRows,
  type StudentFamilyValidateDeps,
} from '../server/domain/student-family-imports'
import { parseImportDate } from '../server/domain/information-imports'
import { STUDENT_FAMILY_HEADERS, type StudentFamilySection } from '../server/domain/student-family-templates'
import { searchableHash } from '../server/utils/crypto'

const SECRET = 'test-encryption-key'
const NOW = new Date('2026-10-28T00:00:00+08:00')
const FATHER_ID = '110101198001011234'
const MOTHER_ID = '110101198201011234'
const STUDENT_ID = '110101201809011234'

function buildBase64(section: StudentFamilySection, rows: string[][], options: { merges?: XLSX.Range[] } = {}): string {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([[...STUDENT_FAMILY_HEADERS[section]], ...rows])
  if (options.merges) sheet['!merges'] = options.merges
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1')
  return XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' })
}

function cells(values: Record<number, string>, length: number): string[] {
  const row = Array.from({ length }, () => '')
  for (const [index, value] of Object.entries(values)) row[Number(index)] = value
  return row
}

function primaryRow(overrides: Record<number, string> = {}): string[] {
  return cells({
    2: '一年级',
    3: '一年级1班',
    4: '张三',
    9: '男',
    10: '汉族',
    11: '2018-09-01',
    12: STUDENT_ID,
    25: '王强',
    26: '13800000001',
    27: FATHER_ID,
    28: '单位A',
    29: '李梅',
    30: '13800000002',
    31: MOTHER_ID,
    32: '单位B',
    ...overrides,
  }, STUDENT_FAMILY_HEADERS.primary.length)
}

function juniorRow(overrides: Record<number, string> = {}): string[] {
  return cells({
    1: '六年级',
    2: '七年级1班',
    3: '李四',
    4: '女',
    5: '汉族',
    6: '2013-05-06',
    7: '110101201305061234',
    8: '本地',
    16: '天津市',
    17: '天津市',
    18: '南开区',
    19: '某路1号',
    20: '李强',
    21: FATHER_ID,
    22: '13800000001',
    23: '工程师',
    24: '单位A',
    25: '赵梅',
    26: MOTHER_ID,
    27: '13800000002',
    28: '教师',
    29: '单位B',
    ...overrides,
  }, STUDENT_FAMILY_HEADERS.junior.length)
}

function baseDeps(overrides: Partial<StudentFamilyValidateDeps> = {}): StudentFamilyValidateDeps {
  return {
    classes: [
      { id: 'class-primary', name: '一年级1班', grade: 1, section: 'primary', ownerUserId: 'teacher-1', status: 'active' },
      { id: 'class-junior', name: '七年级1班', grade: 7, section: 'junior', ownerUserId: 'teacher-1', status: 'active' },
    ],
    students: [],
    guardians: [],
    links: [],
    scope: 'teacher',
    userId: 'teacher-1',
    secret: SECRET,
    now: NOW,
    ...overrides,
  }
}

function parsed(section: StudentFamilySection, rows: string[][]) {
  return parseStudentFamilyWorkbook(buildBase64(section, rows)).rows
}

describe('合表解析与学段识别', () => {
  it('小学模板解析出学生与家长槽位', () => {
    const result = parseStudentFamilyWorkbook(buildBase64('primary', [primaryRow()]))
    expect(result.section).toBe('primary')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.name).toBe('张三')
    expect(result.rows[0]!.guardians.map(item => item.source)).toEqual(['father', 'mother'])
    expect(result.rows[0]!.guardians[0]!.idCard).toBe(FATHER_ID)
  })

  it('初中模板解析出地址、来源年级与家长职业', () => {
    const result = parseStudentFamilyWorkbook(buildBase64('junior', [juniorRow()]))
    expect(result.section).toBe('junior')
    expect(result.rows[0]!.gradeText).toBe('六年级')
    expect(result.rows[0]!.address).toBe('天津市天津市南开区某路1号')
    expect(result.rows[0]!.guardians[0]!.occupation).toBe('工程师')
  })

  it('选择学段与文件不一致时报错', () => {
    expect(() => parseStudentFamilyWorkbook(buildBase64('primary', [primaryRow()]), 'junior')).toThrow(/小学部模板/)
  })

  it('表头不一致时报 TEMPLATE_HEADER_MISMATCH', () => {
    const workbook = XLSX.utils.book_new()
    const header = [...STUDENT_FAMILY_HEADERS.primary]
    header[4] = '学生姓名'
    const sheet = XLSX.utils.aoa_to_sheet([header, primaryRow()])
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1')
    const content = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' })
    expect(() => parseStudentFamilyWorkbook(content)).toThrow(/表头/)
  })

  it('合并单元格直接拒绝', () => {
    const content = buildBase64('primary', [primaryRow()], { merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }] })
    expect(() => parseStudentFamilyWorkbook(content)).toThrow(/合并单元格/)
  })
})

describe('合表校验：学生与班级', () => {
  it('小学有效行创建学生与家长', () => {
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow()]), baseDeps())
    expect(result.errors).toEqual([])
    expect(result.resolved).toHaveLength(1)
    expect(result.resolved[0]!.mode).toBe('create')
    expect(result.resolved[0]!.classId).toBe('class-primary')
    expect(result.resolved[0]!.guardianLinks.map(item => item.relation)).toEqual(['父亲', '母亲'])
    expect(result.stats.studentsToCreate).toBe(1)
    expect(result.stats.guardiansToCreate).toBe(2)
  })

  it('初中按班级名称匹配，来源年级不参与匹配', () => {
    const result = validateStudentFamilyRows(parsed('junior', [juniorRow()]), baseDeps())
    expect(result.errors).toEqual([])
    expect(result.resolved[0]!.classId).toBe('class-junior')
    expect(result.resolved[0]!.values.extra['来源年级']).toBe('六年级')
  })

  it('班级属于其他学段时报 CLASS_SECTION_MISMATCH', () => {
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow({ 3: '七年级1班', 2: '七年级' })]), baseDeps())
    expect(result.errors.some(item => item.code === 'CLASS_SECTION_MISMATCH')).toBe(true)
  })

  it('班级不存在时报 CLASS_NOT_FOUND', () => {
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow({ 3: '不存在班' })]), baseDeps())
    expect(result.errors.some(item => item.code === 'CLASS_NOT_FOUND')).toBe(true)
  })

  it('初中短班级名多候选时报 CLASS_AMBIGUOUS', () => {
    const deps = baseDeps({
      classes: [
        { id: 'class-junior', name: '七年级1班', grade: 7, section: 'junior', ownerUserId: 'teacher-1', status: 'active' },
        { id: 'class-junior-2', name: '八年级1班', grade: 8, section: 'junior', ownerUserId: 'teacher-1', status: 'active' },
      ],
    })
    const result = validateStudentFamilyRows(parsed('junior', [juniorRow({ 2: '1班' })]), deps)
    expect(result.errors.some(item => item.code === 'CLASS_AMBIGUOUS')).toBe(true)
  })

  it('按学籍号匹配到已有学生时更新', () => {
    const deps = baseDeps({
      students: [{
        id: 'stu-1',
        classId: 'class-primary',
        ownerUserId: 'teacher-1',
        nameSearch: searchableHash('张三', SECRET),
        studentNoSearch: searchableHash('S001', SECRET),
        idCardSearch: null,
        status: 'active',
      }],
    })
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow({ 8: 'S001' })]), deps)
    expect(result.errors).toEqual([])
    expect(result.resolved[0]!.mode).toBe('update')
    expect(result.resolved[0]!.existingStudentId).toBe('stu-1')
  })

  it('学籍号与身份证号匹配到不同学生时报冲突', () => {
    const deps = baseDeps({
      students: [
        {
          id: 'stu-no',
          classId: 'class-primary',
          ownerUserId: 'teacher-1',
          nameSearch: searchableHash('张三', SECRET),
          studentNoSearch: searchableHash('S001', SECRET),
          idCardSearch: null,
          status: 'active',
        },
        {
          id: 'stu-card',
          classId: 'class-primary',
          ownerUserId: 'teacher-1',
          nameSearch: searchableHash('张三', SECRET),
          studentNoSearch: null,
          idCardSearch: searchableHash(STUDENT_ID, SECRET),
          status: 'active',
        },
      ],
    })
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow({ 8: 'S001' })]), deps)
    expect(result.errors.some(item => item.code === 'STUDENT_MATCH_CONFLICT')).toBe(true)
  })

  it('他人负责的学生不允许教师更新', () => {
    const deps = baseDeps({
      students: [{
        id: 'stu-other',
        classId: 'class-primary',
        ownerUserId: 'teacher-2',
        nameSearch: searchableHash('张三', SECRET),
        studentNoSearch: searchableHash('S001', SECRET),
        idCardSearch: null,
        status: 'active',
      }],
    })
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow({ 8: 'S001' })]), deps)
    expect(result.errors.some(item => item.code === 'STUDENT_OUT_OF_SCOPE')).toBe(true)
  })

  it('归档学生报 STUDENT_ARCHIVED', () => {
    const deps = baseDeps({
      students: [{
        id: 'stu-archived',
        classId: 'class-primary',
        ownerUserId: 'teacher-1',
        nameSearch: searchableHash('张三', SECRET),
        studentNoSearch: searchableHash('S001', SECRET),
        idCardSearch: null,
        status: 'archived',
      }],
    })
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow({ 8: 'S001' })]), deps)
    expect(result.errors.some(item => item.code === 'STUDENT_ARCHIVED')).toBe(true)
  })

  it('文件内重复学生报 DUPLICATE_STUDENT_IN_FILE', () => {
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow(), primaryRow()]), baseDeps())
    expect(result.errors.some(item => item.code === 'DUPLICATE_STUDENT_IN_FILE')).toBe(true)
  })

  it('已存在学生重复行只报一条重复错误', () => {
    const deps = baseDeps({
      students: [{
        id: 'stu-existing',
        classId: 'class-primary',
        ownerUserId: 'teacher-1',
        nameSearch: searchableHash('张三', SECRET),
        studentNoSearch: null,
        idCardSearch: searchableHash(STUDENT_ID, SECRET),
        status: 'active',
      }],
    })
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow(), primaryRow()]), deps)
    expect(result.errors.filter(item => item.code === 'DUPLICATE_STUDENT_IN_FILE')).toHaveLength(1)
  })
})

describe('合表校验：家长复用与关系', () => {
  it('兄弟姐妹共用同一父亲（同身份证）时只建一条家长', () => {
    const sibling = primaryRow({ 4: '张四', 12: '110101201809011235' })
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow(), sibling]), baseDeps())
    expect(result.errors).toEqual([])
    const fathers = result.guardianPlans.filter(item => item.idCard === FATHER_ID)
    expect(fathers).toHaveLength(1)
    expect(result.resolved[1]!.guardianLinks.find(item => item.relation === '父亲')).toBeTruthy()
  })

  it('复用校内已有家长（按身份证）', () => {
    const deps = baseDeps({
      guardians: [{
        id: 'guardian-1',
        nameSearch: searchableHash('王强', SECRET),
        idCardSearch: searchableHash(FATHER_ID, SECRET),
        relation: '父亲',
        ownerUserId: 'teacher-2',
        status: 'active',
      }],
    })
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow()]), deps)
    expect(result.errors).toEqual([])
    expect(result.guardianPlans.find(item => item.idCard === FATHER_ID)?.existingGuardianId).toBe('guardian-1')
    expect(result.stats.guardiansToReuse).toBe(1)
  })

  it('复用时保留家长级关系，链接关系按学生写入', () => {
    const deps = baseDeps({
      guardians: [{
        id: 'guardian-1',
        nameSearch: searchableHash('王强', SECRET),
        idCardSearch: searchableHash(FATHER_ID, SECRET),
        relation: '父亲',
        ownerUserId: 'teacher-2',
        status: 'active',
      }],
    })
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow()]), deps)
    expect(result.guardianPlans.find(item => item.existingGuardianId === 'guardian-1')?.relation).toBe('父亲')
    expect(result.resolved[0]!.guardianLinks.find(item => item.relation === '父亲')).toBeTruthy()
  })

  it('归档家长报 GUARDIAN_ARCHIVED', () => {
    const deps = baseDeps({
      guardians: [{
        id: 'guardian-archived',
        nameSearch: searchableHash('王强', SECRET),
        idCardSearch: searchableHash(FATHER_ID, SECRET),
        relation: '父亲',
        ownerUserId: 'teacher-1',
        status: 'archived',
      }],
    })
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow()]), deps)
    expect(result.errors.some(item => item.code === 'GUARDIAN_ARCHIVED')).toBe(true)
  })

  it('电话/身份证格式错误', () => {
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow({ 26: 'abc', 31: '123' })]), baseDeps())
    expect(result.errors.some(item => item.code === 'INVALID_PHONE')).toBe(true)
    expect(result.errors.some(item => item.code === 'INVALID_ID_CARD')).toBe(true)
  })

  it('同一行父亲与其他监护人重复时报 DUPLICATE_GUARDIAN_IN_ROW', () => {
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow({ 33: '王强', 34: '叔叔', 35: '13800000003', 36: FATHER_ID })]), baseDeps())
    expect(result.errors.some(item => item.code === 'DUPLICATE_GUARDIAN_IN_ROW')).toBe(true)
  })

  it('其他监护人关系不能填父亲/母亲', () => {
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow({ 33: '王叔', 34: '父亲', 35: '13800000003', 36: '110101197001011234' })]), baseDeps())
    expect(result.errors.some(item => item.code === 'INVALID_OTHER_RELATION')).toBe(true)
  })
})

describe('合表校验：扩展字段与日期', () => {
  it('未映射列进入 extra，映射列不重复', () => {
    const result = validateStudentFamilyRows(parsed('primary', [primaryRow({ 7: '301', 15: '足球' })]), baseDeps())
    expect(result.resolved[0]!.values.extra['宿舍号']).toBe('301')
    expect(result.resolved[0]!.values.extra['兴趣与特长']).toBe('足球')
    expect(result.resolved[0]!.values.extra['身份证号']).toBeUndefined()
  })

  it('出生日期支持字符串与 Excel 序列号，拒绝非法日期', () => {
    const expected = new Date('2018-09-01T00:00:00+08:00').getTime()
    expect(parseImportDate('2018-09-01')?.getTime()).toBe(expected)
    expect(parseImportDate('43344')?.getTime()).toBe(expected)
    expect(parseImportDate('2026-02-30')).toBeNull()
    expect(parseImportDate('2026')).toBeNull()
  })

  it('合并 profile / extra 时保留旧键，只覆盖非空值', () => {
    expect(mergeStudentProfile({ ethnicity: '汉族', notes: '旧备注' }, { ethnicity: '回族', residenceType: '本地' })).toMatchObject({
      ethnicity: '回族',
      notes: '旧备注',
      residenceType: '本地',
    })
    const merged = mergeStudentExtra({ studentFamilyImport: { version: 1, sections: { primary: { version: 1, headers: { 宿舍号: '301' } } } } }, 'primary', { 兴趣与特长: '足球' }, '2026-10-28T00:00:00.000Z')
    const headers = (merged.studentFamilyImport as any).sections.primary.headers
    expect(headers).toMatchObject({ 宿舍号: '301', 兴趣与特长: '足球' })
  })
})

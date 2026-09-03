import { describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import {
  matchClass,
  parseGrade,
  parseWorkbookRows,
  validateGuardianRows,
  validateStudentRows,
} from '../server/domain/information-imports'
import { searchableHash } from '../server/utils/crypto'

const SECRET = 'test-encryption-key'

function xlsxBase64(rows: unknown[][], sheetName = '数据'): string {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
}

describe('parseGrade 年级解析', () => {
  it('纯数字 1-12', () => {
    expect(parseGrade('7')).toBe(7)
    expect(parseGrade('12')).toBe(12)
    expect(parseGrade('0')).toBeNull()
    expect(parseGrade('13')).toBeNull()
  })
  it('中文数字与「X年级」', () => {
    expect(parseGrade('七')).toBe(7)
    expect(parseGrade('七年级')).toBe(7)
    expect(parseGrade('7年级')).toBe(7)
    expect(parseGrade('三年级')).toBe(3)
  })
  it('初一~初三、高一~高三 映射', () => {
    expect(parseGrade('初一')).toBe(7)
    expect(parseGrade('初三')).toBe(9)
    expect(parseGrade('高一')).toBe(10)
    expect(parseGrade('高三')).toBe(12)
  })
  it('空值与非年级值', () => {
    expect(parseGrade('')).toBeNull()
    expect(parseGrade('一班')).toBeNull()
    expect(parseGrade('高考班')).toBeNull()
  })
})

describe('matchClass 班级匹配', () => {
  const classes = [
    { id: 'c1', name: '七年级1班', grade: 7 },
    { id: 'c2', name: '七年级2班', grade: 7 },
    { id: 'c3', name: '八年级1班', grade: 8 },
  ]
  it('班级全名精确匹配', () => {
    expect(matchClass(7, '七年级1班', classes)).toEqual({ match: 'c1', ambiguous: false })
  })
  it('年级 + 名称后缀匹配（忽略年级前缀）', () => {
    expect(matchClass(7, '1班', classes)).toEqual({ match: 'c1', ambiguous: false })
    expect(matchClass(8, '1班', classes)).toEqual({ match: 'c3', ambiguous: false })
  })
  it('同年级同名后缀多个 → 歧义', () => {
    expect(matchClass(7, '班', classes).ambiguous).toBe(true)
  })
  it('无法匹配返回 null', () => {
    expect(matchClass(7, '九年级1班', classes)).toEqual({ match: null, ambiguous: false })
  })
})

describe('parseWorkbookRows xlsx 解析', () => {
  it('解析中文表头并归一化列名，跳过使用说明 sheet', () => {
    const base64 = xlsxBase64([
      ['姓名', '年级', '班级', '性别', '民族', '备注', '现住址', '户籍'],
      ['张三', 7, '七年级1班', '男', '汉族', '备注1', '某市某街道', '本地'],
    ])
    const { rows, checksum } = parseWorkbookRows('students', base64)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: '张三', grade: '7', className: '七年级1班', gender: '男', ethnicity: '汉族', notes: '备注1', address: '某市某街道', residence: '本地' })
    expect(checksum).toMatch(/^[a-f0-9]{64}$/)
  })
  it('忽略说明 sheet，仅取数据 sheet', () => {
    const base64 = xlsxBase64([
      ['姓名', '班级'],
      ['李四', '八年级1班'],
    ], '使用说明')
    expect(() => parseWorkbookRows('students', base64)).toThrow('NO_DATA_SHEET')
  })
  it('家长表头解析', () => {
    const base64 = xlsxBase64([
      ['学生姓名', '与学生关系', '家长姓名', '电话', '身份证号', '工作单位'],
      ['张三', '母亲', '王五', '13800000001', '110101199001011234', '某医院'],
    ])
    const { rows } = parseWorkbookRows('guardians', base64)
    expect(rows[0]).toMatchObject({ studentName: '张三', relation: '母亲', name: '王五', phone: '13800000001', idCard: '110101199001011234', workUnit: '某医院' })
  })
  it('空文件与超行数报错', () => {
    expect(() => parseWorkbookRows('students', '')).toThrow('EMPTY_FILE')
    expect(() => parseWorkbookRows('students', xlsxBase64([['姓名', '班级']]))).toThrow('EMPTY_FILE')
  })
})

describe('validateStudentRows 学生行校验', () => {
  const deps = {
    classes: [
      { id: 'c1', name: '七年级1班', grade: 7 },
      { id: 'c2', name: '七年级2班', grade: 7 },
    ],
    existing: [{ classId: 'c1', nameSearch: 'hash-existing' }],
    secret: SECRET,
  }
  const validRow = { name: '张三', gradeText: '7', className: '七年级1班', gender: '男', ethnicity: '汉族', notes: '', address: '', residence: '' }

  it('合法行通过并解析出班级 id', () => {
    const { errors, resolved } = validateStudentRows([{ ...validRow }], deps)
    expect(errors).toHaveLength(0)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.classId).toBe('c1')
  })
  it('姓名/班级必填', () => {
    const { errors } = validateStudentRows([{ ...validRow, name: '' }], deps)
    expect(errors[0]?.code).toBe('REQUIRED_FIELD')
  })
  it('性别非法值报错', () => {
    const { errors } = validateStudentRows([{ ...validRow, gender: '未知' }], deps)
    expect(errors.some(item => item.code === 'INVALID_GENDER')).toBe(true)
  })
  it('班级不在负责范围报错', () => {
    const { errors } = validateStudentRows([{ ...validRow, className: '九年级1班' }], deps)
    expect(errors.some(item => item.code === 'CLASS_NOT_FOUND')).toBe(true)
  })
  it('班级歧义（同年级同名后缀）报错', () => {
    const { errors } = validateStudentRows([{ ...validRow, className: '班' }], deps)
    expect(errors.some(item => item.code === 'CLASS_AMBIGUOUS')).toBe(true)
  })
  it('文件内重复（同班同姓名）报错', () => {
    const { errors } = validateStudentRows([{ ...validRow }, { ...validRow }], deps)
    expect(errors.some(item => item.code === 'DUPLICATE_IN_FILE')).toBe(true)
  })
})

describe('validateGuardianRows 家长行校验', () => {
  const deps = {
    students: [{ id: 's1', nameSearch: searchableHash('张三', SECRET) }],
    linkedByName: [],
    idCards: [] as string[],
    secret: SECRET,
  }
  const validRow = { studentName: '张三', relation: '母亲', name: '王五', phone: '13800000001', idCard: '110101199001011234', workUnit: '某医院' }

  it('合法行通过', () => {
    const { errors, resolved } = validateGuardianRows([{ ...validRow }], deps)
    expect(errors).toHaveLength(0)
    expect(resolved[0]?.studentId).toBe('s1')
  })
  it('学生姓名不存在报错', () => {
    const { errors } = validateGuardianRows([{ ...validRow, studentName: '不存在的人' }], deps)
    expect(errors.some(item => item.code === 'STUDENT_NOT_FOUND')).toBe(true)
  })
  it('电话格式非法报错', () => {
    const { errors } = validateGuardianRows([{ ...validRow, phone: '123' }], deps)
    expect(errors.some(item => item.code === 'INVALID_PHONE')).toBe(true)
  })
  it('身份证格式非法报错', () => {
    const { errors } = validateGuardianRows([{ ...validRow, idCard: '123' }], deps)
    expect(errors.some(item => item.code === 'INVALID_ID_CARD')).toBe(true)
  })
  it('身份证已存在报错', () => {
    const { errors } = validateGuardianRows([{ ...validRow }], {
      ...deps,
      idCards: [searchableHash('110101199001011234', SECRET)],
    })
    expect(errors.some(item => item.code === 'ID_CARD_EXISTS')).toBe(true)
  })
  it('同学生已有同名家长报错', () => {
    const { errors } = validateGuardianRows([{ ...validRow, name: '李雷' }], {
      ...deps,
      linkedByName: [{ studentId: 's1', nameSearch: searchableHash('李雷', SECRET) }],
    })
    expect(errors.some(item => item.code === 'STUDENT_NOT_FOUND')).toBe(false)
    expect(errors.some(item => item.code === 'EXISTS')).toBe(true)
  })
  it('文件内重复（同学生同家长姓名）报错', () => {
    const { errors } = validateGuardianRows([{ ...validRow }, { ...validRow }], deps)
    expect(errors.some(item => item.code === 'DUPLICATE_IN_FILE')).toBe(true)
  })
})
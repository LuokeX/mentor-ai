import { describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import {
  buildCommunicationImportSample,
  buildImportTemplate,
  buildStudentEventImportSample,
  formatImportDateTime,
  matchClass,
  matchStudent,
  normalizeCommunicationChannel,
  normalizeCommunicationRiskLevel,
  normalizeStudentEventStatus,
  normalizeStudentEventType,
  parseContainerLevel,
  parseGrade,
  parseImportDateTime,
  parseWorkbookRows,
  validateCommunicationRows,
  validateGuardianRows,
  validateStudentEventRows,
  validateStudentRows,
  type BusinessImportDeps,
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

describe('模板与解析一致性（回归）', () => {
  it('下载的学生模板能被直接解析出必填列', () => {
    const { rows } = parseWorkbookRows('students', buildImportTemplate('students').toString('base64'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: '张三', grade: '7', className: '七年级1班', gender: '男' })
  })
  it('下载的家长模板能被直接解析出必填列', () => {
    const { rows } = parseWorkbookRows('guardians', buildImportTemplate('guardians').toString('base64'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ studentName: '张三', relation: '母亲', name: '李四', phone: '13800000001' })
  })
  it('必填星号写在表头前后、含空格都能识别', () => {
    const base64 = xlsxBase64([
      ['*姓名', '班级*', ' 年 级 '],
      ['张三', '七年级1班', '7'],
    ])
    const { rows } = parseWorkbookRows('students', base64)
    expect(rows[0]).toMatchObject({ name: '张三', className: '七年级1班', grade: '7' })
  })
  it('下载模板 → 填写后预检通过（学生）', () => {
    const { rows } = parseWorkbookRows('students', buildImportTemplate('students').toString('base64'))
    const { errors, resolved } = validateStudentRows(rows, {
      classes: [{ id: 'c1', name: '七年级1班', grade: 7 }],
      existing: [],
      secret: SECRET,
    })
    expect(errors).toHaveLength(0)
    expect(resolved[0]?.classId).toBe('c1')
  })
  it('下载模板 → 填写后预检通过（家长）', () => {
    const { rows } = parseWorkbookRows('guardians', buildImportTemplate('guardians').toString('base64'))
    const { errors, resolved } = validateGuardianRows(rows, {
      students: [{ id: 's1', nameSearch: searchableHash('张三', SECRET) }],
      linkedByName: [],
      idCards: [],
      secret: SECRET,
    })
    expect(errors).toHaveLength(0)
    expect(resolved[0]?.studentId).toBe('s1')
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

// ===== 家校沟通 / 学生事件记录导入 =====

/** 固定的「现在」：2026-10-08 09:00（东八区），用于时间区间断言 */
const NOW = new Date('2026-10-08T09:00:00+08:00')

/** 张三重复出现在两个班级（用于班级消歧），李四唯一 */
const businessDeps: BusinessImportDeps = {
  students: [
    { id: 's1', nameSearch: searchableHash('张三', SECRET), ownerUserId: 'u1', className: '七年级1班', grade: 7 },
    { id: 's2', nameSearch: searchableHash('张三', SECRET), ownerUserId: 'u2', className: '七年级2班', grade: 7 },
    { id: 's3', nameSearch: searchableHash('李四', SECRET), ownerUserId: 'u1', className: '七年级1班', grade: 7 },
  ],
  secret: SECRET,
  studentScopeLabel: '您负责的学生',
}

describe('parseImportDateTime 导入时间解析', () => {
  it('常见文本写法都按东八区解析', () => {
    expect(parseImportDateTime('2026-10-08 15:30', NOW)?.toISOString()).toBe('2026-10-08T07:30:00.000Z')
    expect(parseImportDateTime('2026/10/8 15:30', NOW)?.toISOString()).toBe('2026-10-08T07:30:00.000Z')
    expect(parseImportDateTime('2026年10月8日 15:30', NOW)?.toISOString()).toBe('2026-10-08T07:30:00.000Z')
    expect(parseImportDateTime('2026-10-08T15:30:00', NOW)?.toISOString()).toBe('2026-10-08T07:30:00.000Z')
  })
  it('只填日期按当天 00:00（东八区）', () => {
    expect(parseImportDateTime('2026/10/7', NOW)?.toISOString()).toBe('2026-10-06T16:00:00.000Z')
  })
  it('Excel 日期序列号按墙上时间解析', () => {
    // 46303.645833333 = 2026-10-08 15:30（Excel 1900 日期系统）
    expect(parseImportDateTime('46303.645833333', NOW)?.toISOString()).toBe('2026-10-08T07:30:00.000Z')
  })
  it('空值、格式错误、不存在的日期、超出合理区间都返回 null', () => {
    expect(parseImportDateTime('', NOW)).toBeNull()
    expect(parseImportDateTime('昨天', NOW)).toBeNull()
    expect(parseImportDateTime('2026-02-30 10:00', NOW)).toBeNull()
    expect(parseImportDateTime('2026-13-01 10:00', NOW)).toBeNull()
    expect(parseImportDateTime('25:00', NOW)).toBeNull()
    // 年份被当成 Excel 序列号（2026 = 1905 年）
    expect(parseImportDateTime('2026', NOW)).toBeNull()
    expect(parseImportDateTime('1999-12-31 10:00', NOW)).toBeNull()
    expect(parseImportDateTime('2030-01-01 10:00', NOW)).toBeNull()
  })
  it('formatImportDateTime 输出东八区「YYYY-MM-DD HH:mm」', () => {
    expect(formatImportDateTime(new Date('2026-10-08T07:30:00.000Z'))).toBe('2026-10-08 15:30')
  })
})

describe('matchStudent 学生匹配', () => {
  it('姓名唯一直接命中', () => {
    expect(matchStudent('李四', '', businessDeps.students, SECRET)).toEqual({ student: businessDeps.students[2], reason: 'ok' })
  })
  it('同名未填班级 → 歧义', () => {
    expect(matchStudent('张三', '', businessDeps.students, SECRET).reason).toBe('ambiguous')
  })
  it('同名用班级列区分', () => {
    expect(matchStudent('张三', '七年级2班', businessDeps.students, SECRET).student?.id).toBe('s2')
    expect(matchStudent('张三', '2班', businessDeps.students, SECRET).student?.id).toBe('s2')
  })
  it('姓名与班级不匹配 → class_mismatch', () => {
    expect(matchStudent('李四', '七年级2班', businessDeps.students, SECRET).reason).toBe('class_mismatch')
  })
  it('姓名不存在 → not_found', () => {
    expect(matchStudent('王五', '', businessDeps.students, SECRET).reason).toBe('not_found')
  })
})

describe('渠道 / 风险等级 / 容纳水平归一化', () => {
  it('沟通渠道接受中文标签与英文码', () => {
    expect(normalizeCommunicationChannel('电话')).toBe('phone')
    expect(normalizeCommunicationChannel('wechat')).toBe('wechat')
    expect(normalizeCommunicationChannel('')).toBeNull()
    expect(normalizeCommunicationChannel('短信')).toBeUndefined()
  })
  it('风险等级接受中文标签与英文码，空值/「无」落 null', () => {
    expect(normalizeCommunicationRiskLevel('安全关注')).toBe('crisis')
    expect(normalizeCommunicationRiskLevel('HIGH')).toBe('high')
    expect(normalizeCommunicationRiskLevel('')).toBeNull()
    expect(normalizeCommunicationRiskLevel('无')).toBeNull()
    expect(normalizeCommunicationRiskLevel('很高')).toBeUndefined()
  })
  it('容纳水平只允许 -4~4 整数', () => {
    expect(parseContainerLevel('0')).toBe(0)
    expect(parseContainerLevel('-2')).toBe(-2)
    expect(parseContainerLevel('')).toBeNull()
    expect(parseContainerLevel('5')).toBeUndefined()
    expect(parseContainerLevel('1.5')).toBeUndefined()
  })
  it('事件类型接受 E 码与中文名，空值默认其他', () => {
    expect(normalizeStudentEventType('E1')).toBe('学业纪律类')
    expect(normalizeStudentEventType('e5')).toBe('欺凌侵害类')
    expect(normalizeStudentEventType('行为规范类')).toBe('行为规范类')
    expect(normalizeStudentEventType('')).toBe('其他')
    expect(normalizeStudentEventType('E7')).toBeUndefined()
    expect(normalizeStudentEventType('打架')).toBeUndefined()
  })
  it('事件状态接受中文标签与英文码，空值默认待处理', () => {
    expect(normalizeStudentEventStatus('')).toBe('open')
    expect(normalizeStudentEventStatus('待处理')).toBe('open')
    expect(normalizeStudentEventStatus('resolved')).toBe('resolved')
    expect(normalizeStudentEventStatus('已关闭')).toBe('closed')
    expect(normalizeStudentEventStatus('已归档')).toBeUndefined()
  })
})

describe('validateCommunicationRows 沟通行校验', () => {
  const validRow = {
    studentName: '李四',
    className: '',
    occurredAt: '2026-10-08 15:30',
    summary: '与家长沟通近期作业完成情况，家长表示会配合监督。',
    channel: '电话',
    parentType: '母亲',
    attitudeType: '配合',
    riskLevel: '低风险',
    containerLevel: '0',
  }

  it('合法行通过并归一化渠道、风险等级与时间', () => {
    const { errors, resolved } = validateCommunicationRows([{ ...validRow }], businessDeps, NOW)
    expect(errors).toHaveLength(0)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.studentId).toBe('s3')
    expect(resolved[0]?.ownerUserId).toBe('u1')
    expect(resolved[0]?.values).toMatchObject({ channel: 'phone', riskLevel: 'low', containerLevel: 0 })
    expect(resolved[0]?.values.occurredAt.toISOString()).toBe('2026-10-08T07:30:00.000Z')
  })
  it('选填列为空时落 null，不会报错', () => {
    const { errors, resolved } = validateCommunicationRows([{ ...validRow, channel: '', riskLevel: '', containerLevel: '', parentType: '', attitudeType: '' }], businessDeps, NOW)
    expect(errors).toHaveLength(0)
    expect(resolved[0]?.values).toMatchObject({ channel: null, riskLevel: null, containerLevel: null, parentType: null, attitudeType: null })
  })
  it('学生不存在 / 同名歧义 / 班级不符分别报错', () => {
    expect(validateCommunicationRows([{ ...validRow, studentName: '王五' }], businessDeps, NOW).errors[0]?.code).toBe('STUDENT_NOT_FOUND')
    expect(validateCommunicationRows([{ ...validRow, studentName: '张三' }], businessDeps, NOW).errors[0]?.code).toBe('STUDENT_AMBIGUOUS')
    expect(validateCommunicationRows([{ ...validRow, studentName: '张三', className: '七年级1班' }], businessDeps, NOW).resolved[0]?.studentId).toBe('s1')
    expect(validateCommunicationRows([{ ...validRow, className: '七年级2班' }], businessDeps, NOW).errors[0]?.code).toBe('STUDENT_CLASS_MISMATCH')
  })
  it('必填与格式校验', () => {
    expect(validateCommunicationRows([{ ...validRow, studentName: '' }], businessDeps, NOW).errors[0]?.code).toBe('REQUIRED_FIELD')
    expect(validateCommunicationRows([{ ...validRow, summary: '' }], businessDeps, NOW).errors[0]?.code).toBe('REQUIRED_FIELD')
    expect(validateCommunicationRows([{ ...validRow, summary: '太短' }], businessDeps, NOW).errors[0]?.code).toBe('SUMMARY_TOO_SHORT')
    expect(validateCommunicationRows([{ ...validRow, occurredAt: '' }], businessDeps, NOW).errors[0]?.code).toBe('REQUIRED_FIELD')
    expect(validateCommunicationRows([{ ...validRow, occurredAt: '前天' }], businessDeps, NOW).errors[0]?.code).toBe('INVALID_TIME')
    expect(validateCommunicationRows([{ ...validRow, channel: '短信' }], businessDeps, NOW).errors.some(item => item.code === 'INVALID_CHANNEL')).toBe(true)
    expect(validateCommunicationRows([{ ...validRow, riskLevel: '很高' }], businessDeps, NOW).errors.some(item => item.code === 'INVALID_RISK_LEVEL')).toBe(true)
    expect(validateCommunicationRows([{ ...validRow, containerLevel: '5' }], businessDeps, NOW).errors.some(item => item.code === 'INVALID_CONTAINER_LEVEL')).toBe(true)
    expect(validateCommunicationRows([{ ...validRow, parentType: 'x'.repeat(21) }], businessDeps, NOW).errors.some(item => item.code === 'TOO_LONG')).toBe(true)
  })
  it('文件内重复（同学生、同时间、同摘要）报错', () => {
    const { errors } = validateCommunicationRows([{ ...validRow }, { ...validRow }], businessDeps, NOW)
    expect(errors.some(item => item.code === 'DUPLICATE_IN_FILE')).toBe(true)
  })
  it('同学生不同时间或不同摘要不算重复', () => {
    const { errors } = validateCommunicationRows([
      { ...validRow },
      { ...validRow, occurredAt: '2026-10-08 16:00' },
      { ...validRow, summary: '与家长沟通课堂表现，家长表示会跟进。' },
    ], businessDeps, NOW)
    expect(errors).toHaveLength(0)
  })
})

describe('validateStudentEventRows 事件行校验', () => {
  const validRow = {
    studentName: '李四',
    className: '',
    title: '课间与同学发生口角',
    occurredAt: '2026-10-08 10:20',
    eventType: '行为规范类',
    severity: '中',
    description: '课间因座位问题争执，经劝解后平息。',
    resolution: '已与双方沟通并达成一致。',
    status: '已解决',
  }

  it('合法行通过', () => {
    const { errors, resolved } = validateStudentEventRows([{ ...validRow }], businessDeps, NOW)
    expect(errors).toHaveLength(0)
    expect(resolved[0]).toMatchObject({ studentId: 's3', ownerUserId: 'u1' })
    expect(resolved[0]?.values).toMatchObject({ eventType: '行为规范类', severity: '中', status: 'resolved' })
  })
  it('事件类型 / 严重程度 / 状态留空时取默认值', () => {
    const { errors, resolved } = validateStudentEventRows([{ ...validRow, eventType: '', severity: '', status: '' }], businessDeps, NOW)
    expect(errors).toHaveLength(0)
    expect(resolved[0]?.values).toMatchObject({ eventType: '其他', severity: '低', status: 'open' })
  })
  it('E 码事件类型可识别', () => {
    const { resolved } = validateStudentEventRows([{ ...validRow, eventType: 'E5' }], businessDeps, NOW)
    expect(resolved[0]?.values.eventType).toBe('欺凌侵害类')
  })
  it('必填与取值校验', () => {
    expect(validateStudentEventRows([{ ...validRow, title: '' }], businessDeps, NOW).errors[0]?.code).toBe('REQUIRED_FIELD')
    expect(validateStudentEventRows([{ ...validRow, occurredAt: '' }], businessDeps, NOW).errors[0]?.code).toBe('REQUIRED_FIELD')
    expect(validateStudentEventRows([{ ...validRow, eventType: '打架' }], businessDeps, NOW).errors.some(item => item.code === 'INVALID_EVENT_TYPE')).toBe(true)
    expect(validateStudentEventRows([{ ...validRow, severity: '轻微' }], businessDeps, NOW).errors.some(item => item.code === 'INVALID_SEVERITY')).toBe(true)
    expect(validateStudentEventRows([{ ...validRow, status: '已归档' }], businessDeps, NOW).errors.some(item => item.code === 'INVALID_STATUS')).toBe(true)
    expect(validateStudentEventRows([{ ...validRow, description: 'x'.repeat(5001) }], businessDeps, NOW).errors.some(item => item.code === 'TOO_LONG')).toBe(true)
    expect(validateStudentEventRows([{ ...validRow, title: 'x'.repeat(201) }], businessDeps, NOW).errors[0]?.code).toBe('INVALID_TITLE')
  })
  it('文件内重复（同学生、同时间、同标题）报错', () => {
    const { errors } = validateStudentEventRows([{ ...validRow }, { ...validRow }], businessDeps, NOW)
    expect(errors.some(item => item.code === 'DUPLICATE_IN_FILE')).toBe(true)
  })
})

describe('两类业务记录模板与预检示例', () => {
  it('下载的沟通模板能被解析出必填列，且示例行通过校验', () => {
    const { rows } = parseWorkbookRows('communications', buildImportTemplate('communications').toString('base64'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ studentName: '张三', occurredAt: '2026-10-08 15:30', channel: '电话', riskLevel: '低风险' })
    const { errors, resolved } = validateCommunicationRows(rows, businessDeps, NOW)
    expect(errors).toHaveLength(0)
    expect(resolved[0]?.studentId).toBe('s1')
  })
  it('下载的事件模板能被解析出必填列，且示例行通过校验', () => {
    const { rows } = parseWorkbookRows('student_events', buildImportTemplate('student_events').toString('base64'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ studentName: '张三', title: '课间与同学发生口角', occurredAt: '2026-10-08 15:30', severity: '中' })
    const { errors, resolved } = validateStudentEventRows(rows, businessDeps, NOW)
    expect(errors).toHaveLength(0)
    expect(resolved[0]?.studentId).toBe('s1')
  })
  it('预检示例只带非正文列，摘要在 40 字处截断', () => {
    const summary = '这是一条用于验证示例截断的较长沟通摘要，长度明显超过四十个字符，需要被截断展示（补充说明文字）。'
    const { resolved } = validateCommunicationRows([{
      studentName: '李四', className: '', occurredAt: '2026-10-08 15:30', summary,
      channel: '面谈', parentType: '', attitudeType: '', riskLevel: '', containerLevel: '',
    }], businessDeps, NOW)
    const sample = buildCommunicationImportSample(resolved)
    expect(Object.keys(sample[0]!).sort()).toEqual(['occurredAt', 'row', 'studentName', 'summaryPreview'])
    expect(sample[0]?.studentName).toBe('李四')
    expect(sample[0]?.occurredAt).toBe('2026-10-08 15:30')
    expect(String(sample[0]?.summaryPreview)).toBe(`${summary.slice(0, 40)}…`)
  })
  it('事件预检示例包含类型与严重程度，不含说明正文', () => {
    const { resolved } = validateStudentEventRows([{
      studentName: '张三', className: '七年级2班', title: '课堂秩序记录', occurredAt: '2026-10-08 09:20',
      eventType: 'E2', severity: '高', description: '细节正文', resolution: '', status: '',
    }], businessDeps, NOW)
    const sample = buildStudentEventImportSample(resolved)
    expect(Object.keys(sample[0]!).sort()).toEqual(['eventType', 'occurredAt', 'row', 'severity', 'studentName'])
    expect(sample[0]).toMatchObject({ studentName: '张三', eventType: '课堂秩序类', severity: '高', occurredAt: '2026-10-08 09:20' })
  })
})
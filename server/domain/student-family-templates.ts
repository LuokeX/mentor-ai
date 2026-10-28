import { normalizeHeaderCell } from './information-imports'

/**
 * 小学/初中「学生+家长」合表模板定义。
 *
 * 这两份模板由需求方提供并已确认（高中模板待定），表头顺序和列名是导入解析的
 * 唯一依据；模板里存在重复列名（电话/身份证号/工作单位），因此不能用
 * `information-imports.ts` 的「表头 → 唯一列键」别名表，必须按列位置解析。
 */
export type StudentFamilySection = 'primary' | 'junior'

export const STUDENT_FAMILY_SECTION_LABELS: Record<StudentFamilySection, string> = {
  primary: '小学部',
  junior: '初中部',
}

/** 需求附件中的表头顺序；小学模板 A1:AM1 尾部有一个空表头，这里不包含它。 */
export const STUDENT_FAMILY_HEADERS: Record<StudentFamilySection, readonly string[]> = {
  primary: [
    '序号', '学部', '年级', '班级', '姓名', '入学时间', '是/否走读', '宿舍号', '学籍号', '性别',
    '民族', '出生日期', '身份证号', '本人手机号', '共青团员/群众', '兴趣与特长', '身高', '体重',
    '是否独生子女', '户口类型', '生源毕业学校', '省', '市', '区', '具体位置（精确到门牌号）',
    '父亲姓名', '电话', '身份证号', '工作单位', '母亲姓名', '电话', '身份证号', '工作单位',
    '其他监护人姓名', '称谓', '电话', '身份证号', '工作单位',
  ],
  junior: [
    '序号', '来源年级', '班级', '姓名', '性别', '民族', '出生日期', '身份证号', '户籍类型', '政治面貌',
    '学生本人手机号', '兴趣特长', '是否独生子女', '小学毕业校名称', '来校前就读学校', '来校前就读省市',
    '省份', '城市', '区县', '详细地址', '父亲姓名', '父亲身份证号', '父亲联系方式', '父亲职业', '父亲工作单位',
    '母亲姓名', '母亲身份证号', '母亲联系方式', '母亲职业', '母亲工作单位', '其他监护人', '其他监护人联系方式',
    '有无重大疾病史', '重大疾病史说明', '是否特异体质', '特异体质说明', '身高', '体重', '校服尺码',
    '划片公办学校', '其他子女在六力就读', '其他子女就读年级', '主要联系人', '填写人', '填写时间', '来源文件',
    '原序号', '用户类型', '匹配来源', '年龄', '是否为六力小学直升', '孩子在校情况主要联系人', '衔接营报名',
    '所在部门', '家庭地址(插班)', '校服尺码(女)', '校服尺码(男)',
  ],
}

export interface StudentFamilyColumnSpec {
  student: {
    no: number
    section: number | null
    grade: number | null
    /** 初中模板的「来源年级」列；只保留到扩展信息，不参与班级匹配 */
    sourceGrade: number | null
    className: number
    name: number
    enrolledAt: number | null
    boarding: number | null
    studentNo: number | null
    gender: number
    ethnicity: number
    birthDate: number
    idCard: number
    residenceType: number | null
    address: number[]
  }
  father: { name: number, phone: number, idCard: number, occupation: number | null, workUnit: number }
  mother: { name: number, phone: number, idCard: number, occupation: number | null, workUnit: number }
  other: { name: number, relation: number | null, phone: number, idCard: number | null, workUnit: number | null }
  /** 未映射列的列下标；按原表头名写入学生的加密扩展信息 */
  extra: number[]
}

export const STUDENT_FAMILY_COLUMNS: Record<StudentFamilySection, StudentFamilyColumnSpec> = {
  primary: {
    student: {
      no: 0, section: 1, grade: 2, sourceGrade: null, className: 3, name: 4, enrolledAt: 5, boarding: 6,
      studentNo: 8, gender: 9, ethnicity: 10, birthDate: 11, idCard: 12,
      residenceType: 19, address: [21, 22, 23, 24],
    },
    father: { name: 25, phone: 26, idCard: 27, occupation: null, workUnit: 28 },
    mother: { name: 29, phone: 30, idCard: 31, occupation: null, workUnit: 32 },
    other: { name: 33, relation: 34, phone: 35, idCard: 36, workUnit: 37 },
    extra: [0, 1, 2, 7, 13, 14, 15, 16, 17, 18, 20],
  },
  junior: {
    student: {
      no: 0, section: null, grade: null, sourceGrade: 1, className: 2, name: 3, enrolledAt: null, boarding: null,
      studentNo: null, gender: 4, ethnicity: 5, birthDate: 6, idCard: 7,
      residenceType: 8, address: [16, 17, 18, 19],
    },
    father: { name: 20, phone: 22, idCard: 21, occupation: 23, workUnit: 24 },
    mother: { name: 25, phone: 27, idCard: 26, occupation: 28, workUnit: 29 },
    other: { name: 30, relation: null, phone: 31, idCard: null, workUnit: null },
    extra: [
      0, 1, 9, 10, 11, 12, 13, 14, 15,
      32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
    ],
  },
}

/** 合表表头归一化：在通用归一化基础上统一全/半角括号和斜杠。 */
export function normalizeStudentFamilyHeader(value: unknown): string {
  return normalizeHeaderCell(value)
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/／/g, '/')
}

/** 按表头签名识别人学段；无法识别返回 null（由调用方报 TEMPLATE_HEADER_MISMATCH）。 */
export function detectStudentFamilySection(header: readonly unknown[]): StudentFamilySection | null {
  const actual = trimTrailingEmpty(header.map(normalizeStudentFamilyHeader))
  for (const section of ['primary', 'junior'] as const) {
    const expected = trimTrailingEmpty(STUDENT_FAMILY_HEADERS[section].map(normalizeStudentFamilyHeader))
    if (actual.length === expected.length && actual.every((value, index) => value === expected[index])) return section
  }
  return null
}

/** 返回表头中第一处与期望模板不一致的列，供预检错误文案使用。 */
export function findStudentFamilyHeaderMismatch(
  header: readonly unknown[],
  section: StudentFamilySection
): { index: number, actual: string, expected: string } | null {
  const actual = header.map(normalizeStudentFamilyHeader)
  const expected = STUDENT_FAMILY_HEADERS[section].map(normalizeStudentFamilyHeader)
  const length = Math.max(actual.length, expected.length)
  for (let index = 0; index < length; index++) {
    const actualValue = actual[index] ?? ''
    const expectedValue = expected[index] ?? ''
    if (actualValue !== expectedValue) return { index: index + 1, actual: actualValue, expected: expectedValue }
  }
  return null
}

function trimTrailingEmpty(values: string[]): string[] {
  let end = values.length
  while (end > 0 && values[end - 1] === '') end--
  return values.slice(0, end)
}

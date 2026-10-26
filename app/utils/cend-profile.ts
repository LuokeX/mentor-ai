/**
 * C 端个人资料选项。
 *
 * 与产品原型 `临时文件/班助AI 注册+积分/班主任智能体-注册积分页面.html` 保持一致；
 * 完善资料弹窗与个人资料页共用同一份选项，避免两处字段漂移。
 */

export interface CendProfileForm {
  nickname: string
  subjects: string[]
  grades: number[]
  textbookVersion: string
  region: string
  teachingYears: string
  roles: string[]
}

export function emptyCendProfileForm(): CendProfileForm {
  return {
    nickname: '',
    subjects: [],
    grades: [],
    textbookVersion: '',
    region: '',
    teachingYears: '',
    roles: []
  }
}

export const CEND_SUBJECT_OPTIONS = ['语文', '数学', '英语', '道德与法治', '科学', '信息技术', '音乐', '体育', '美术', '综合实践', '物理', '化学', '生物', '历史', '地理', '其他']
  .map(value => ({ label: value, value }))

export const CEND_GRADE_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  label: index < 9 ? `${['一', '二', '三', '四', '五', '六', '七', '八', '九'][index]}年级` : `${['高一', '高二', '高三'][index - 9]}`,
  value: index + 1
}))

export const CEND_REGION_OPTIONS = ['城市', '县城', '乡镇', '农村'].map(value => ({ label: value, value }))

export const CEND_TEACHING_YEAR_OPTIONS = ['3年以内', '3-5年', '6-10年', '11-20年', '20年以上'].map(value => ({ label: value, value }))

export const CEND_ROLE_OPTIONS = ['任课教师', '班主任', '备课组长', '教研组长', '年级组长', '教务或教研员', '其他'].map(value => ({ label: value, value }))

/** 教材版本下拉选项；选择「其他」时补填全称。 */
export const CEND_TEXTBOOK_OTHER = '其他（手动填写全称）'

export const CEND_TEXTBOOK_VERSION_OPTIONS = [
  '人教版（统编版）',
  '部编版',
  '北师大版',
  '苏教版',
  '外研版',
  '沪教版',
  CEND_TEXTBOOK_OTHER
].map(value => ({ label: value, value }))

export const CEND_TEXTBOOK_VERSION_VALUES = CEND_TEXTBOOK_VERSION_OPTIONS.map(option => option.value)

import { describe, expect, it } from 'vitest'
import {
  CRISIS_GUIDE_FALLBACK,
  resolveCrisisGuide,
  TEACHER_FORBIDDEN_TEXT,
  teacherFacingTextAllowed
} from '../server/domain/safety'

describe('教师可见文案红线（安全转介卡片）', () => {
  it('六个禁用字样都会被拦截', () => {
    for (const word of ['危机', '红线', '预警', '立即', '110', '120']) {
      expect(teacherFacingTextAllowed(`请${word}处理`)).toBe(false)
    }
  })

  it('合规的学校指引通过校验', () => {
    expect(teacherFacingTextAllowed('请尽快联系校内心理专员，并按学校安全流程跟进。')).toBe(true)
  })

  it('默认指引本身不含任何禁用字样', () => {
    expect(TEACHER_FORBIDDEN_TEXT.test(CRISIS_GUIDE_FALLBACK)).toBe(false)
  })

  it('未配置或命中禁用字样时回退默认指引', () => {
    expect(resolveCrisisGuide(null)).toBe(CRISIS_GUIDE_FALLBACK)
    expect(resolveCrisisGuide(undefined)).toBe(CRISIS_GUIDE_FALLBACK)
    expect(resolveCrisisGuide('   ')).toBe(CRISIS_GUIDE_FALLBACK)
    expect(resolveCrisisGuide('请立即联系心理老师')).toBe(CRISIS_GUIDE_FALLBACK)
    expect(resolveCrisisGuide('请拨打 110 或 120')).toBe(CRISIS_GUIDE_FALLBACK)
  })

  it('合规的学校自定义指引原样返回', () => {
    const guide = '请先陪同学生到心理辅导室，并同步告知年级组长。'
    expect(resolveCrisisGuide(guide)).toBe(guide)
  })
})

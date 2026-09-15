import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_ACTIVE_PLAN_STATUSES,
  ASSISTANT_ATTENTION_RISK_LEVELS,
  ASSISTANT_READER_LIMITS,
  TEACHER_LEVEL_MODULES,
  assistantObjectKey,
  clampAssistantLimit,
  isTeacherLevelModule,
  outboundAssistantText,
  pickAssistantObjectLabel,
  pickContextObjectLabel,
  pickDimensions,
  pickPrimaryAttribution,
  pickResultString,
  toIsoOrNull,
  truncateAssistantText,
  type AssistantObjectLabel
} from '../server/domain/assistant-readers'

describe('助手读取层：限额与截断', () => {
  it('文本截断保留前缀并加省略号', () => {
    expect(truncateAssistantText('一二三四五', 3)).toBe('一二三…')
    expect(truncateAssistantText('一二三', 3)).toBe('一二三')
    expect(truncateAssistantText('   ', 3)).toBe('')
    expect(truncateAssistantText(null)).toBe('')
  })

  it('limit 夹到 [1, max]，非法值回退上限', () => {
    expect(clampAssistantLimit(undefined, 6)).toBe(6)
    expect(clampAssistantLimit(0, 6)).toBe(1)
    expect(clampAssistantLimit(-3, 6)).toBe(1)
    expect(clampAssistantLimit(99, 6)).toBe(6)
    expect(clampAssistantLimit(Number.NaN, 6)).toBe(6)
    expect(clampAssistantLimit(3.7, 6)).toBe(3)
  })

  it('限额常量保持在可外发的量级（避免工具结果超限被丢弃）', () => {
    expect(ASSISTANT_READER_LIMITS.plans).toBeLessThanOrEqual(6)
    expect(ASSISTANT_READER_LIMITS.communications).toBeLessThanOrEqual(8)
    expect(ASSISTANT_READER_LIMITS.textChars).toBeLessThanOrEqual(300)
    expect(ASSISTANT_READER_LIMITS.catalogPerType).toBeLessThanOrEqual(6)
  })
})

describe('助手读取层：外发脱敏', () => {
  const sample = '张老师反馈：家长电话 13812345678，邮箱 parent@example.com'

  it('默认按 redacted 处理手机号与邮箱', () => {
    const result = outboundAssistantText(sample, undefined)
    expect(result).not.toContain('13812345678')
    expect(result).not.toContain('parent@example.com')
  })

  it('full_context 原样返回', () => {
    expect(outboundAssistantText(sample, 'full_context')).toBe(sample)
  })
})

describe('助手读取层：确定性规则结果取值', () => {
  it('只取字符串字段，取不到返回 null', () => {
    expect(pickResultString({ level: 'L2' }, 'level')).toBe('L2')
    expect(pickResultString({ level: '  ' }, 'level')).toBeNull()
    expect(pickResultString({ level: 3 }, 'level')).toBeNull()
    expect(pickResultString(null, 'level')).toBeNull()
  })

  it('主归因取 attributions[0].name，结构不符返回 null', () => {
    expect(pickPrimaryAttribution({ attributions: [{ name: '教养方式冲突' }] })).toBe('教养方式冲突')
    expect(pickPrimaryAttribution({ attributions: [] })).toBeNull()
    expect(pickPrimaryAttribution({ attributions: ['x'] })).toBeNull()
    expect(pickPrimaryAttribution({})).toBeNull()
  })

  it('维度只保留有限数值并保留两位小数', () => {
    expect(pickDimensions({ dimensions: { a: 1.2345, b: 'x', c: 2 } })).toEqual({ a: 1.23, c: 2 })
    expect(pickDimensions({ dimensions: [1, 2] })).toEqual({})
    expect(pickDimensions(null)).toEqual({})
  })

  it('时间字段转 ISO，非法值返回 null', () => {
    expect(toIsoOrNull(new Date('2026-09-01T00:00:00.000Z'))).toBe('2026-09-01T00:00:00.000Z')
    expect(toIsoOrNull(null)).toBeNull()
    expect(toIsoOrNull('not-a-date')).toBeNull()
  })

  it('方案状态与风险等级口径固定', () => {
    expect([...ASSISTANT_ACTIVE_PLAN_STATUSES]).toContain('in_progress')
    expect([...ASSISTANT_ACTIVE_PLAN_STATUSES]).not.toContain('archived')
    expect([...ASSISTANT_ATTENTION_RISK_LEVELS]).toEqual(['crisis', 'high'])
  })
})

describe('助手读取层：咨询对象标签', () => {
  it('教师级模块与对象级模块按 shared 口径区分', () => {
    expect(TEACHER_LEVEL_MODULES).toEqual(['self_growth'])
    expect(isTeacherLevelModule('self_growth')).toBe(true)
    expect(isTeacherLevelModule('student_case')).toBe(false)
    expect(isTeacherLevelModule(null)).toBe(false)
    expect(isTeacherLevelModule(undefined)).toBe(false)
  })

  it('对象键只接受合法类型与 id，其余返回 null', () => {
    expect(assistantObjectKey('student', 'a')).toBe('student:a')
    expect(assistantObjectKey('guardian', 'a')).toBe('guardian:a')
    expect(assistantObjectKey('class', 'a')).toBe('class:a')
    expect(assistantObjectKey('teacher', 'a')).toBeNull()
    expect(assistantObjectKey('student', null)).toBeNull()
    expect(assistantObjectKey(null, 'a')).toBeNull()
  })

  it('方案标签取第一个关联对象，解析不到名称时不改标到其它对象', () => {
    const labels: Map<string, AssistantObjectLabel> = new Map([
      ['guardian:g1', { type: 'guardian', id: 'g1', label: '张三 · 父亲' }],
      ['class:c1', { type: 'class', id: 'c1', label: '三班' }]
    ])
    // 学生 id 存在但名称解析不到（越权或记录缺失）时返回 null，不改标成家长或班级、也不臆造名称
    expect(pickAssistantObjectLabel({ studentId: 's1', guardianId: 'g1' }, labels)).toBeNull()
    expect(pickAssistantObjectLabel({ guardianId: 'g1', classId: 'c1' }, labels)).toEqual({ type: 'guardian', id: 'g1', label: '张三 · 父亲' })
    expect(pickAssistantObjectLabel({ classId: 'c1' }, labels)).toEqual({ type: 'class', id: 'c1', label: '三班' })
    expect(pickAssistantObjectLabel({}, labels)).toBeNull()
    expect(pickAssistantObjectLabel({ studentId: null, guardianId: null, classId: null }, labels)).toBeNull()
  })

  it('评估组上下文按 context_type/context_id 解析，教师级或未进组返回 null', () => {
    const labels: Map<string, AssistantObjectLabel> = new Map([
      ['student:s1', { type: 'student', id: 's1', label: '李四' }]
    ])
    expect(pickContextObjectLabel('student', 's1', labels)?.label).toBe('李四')
    expect(pickContextObjectLabel('student', 's2', labels)).toBeNull()
    expect(pickContextObjectLabel(null, null, labels)).toBeNull()
    expect(pickContextObjectLabel('teacher', 's1', labels)).toBeNull()
  })
})

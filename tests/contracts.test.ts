import { describe, expect, it } from 'vitest'
import { adminAccessRequestSchema, chatMessageSchema, loginRequestSchema, parseInstrumentRole, routeDecisionSchema } from '../shared/contracts'
import { redactPii } from '../server/integrations/deepseek'

describe('instrument role parsing (③ 量表角色)', () => {
  it('maps template labels to canonical enums and keeps unknown values visible', () => {
    expect(parseInstrumentRole('入口筛查')).toBe('screening')
    expect(parseInstrumentRole('深度诊断')).toBe('deep_dive')
    expect(parseInstrumentRole('专项/情境')).toBe('situational')
    expect(parseInstrumentRole('红线检查')).toBe('red_line')
    expect(parseInstrumentRole('SCREENING')).toBe('screening')
    expect(parseInstrumentRole('')).toBeUndefined()
    // 无法识别的值原样保留，由导入校验报错，而不是静默当作没填
    expect(parseInstrumentRole('入口卷')).toBe('入口卷')
  })
})

describe('shared API contracts', () => {
  it('accepts a phone and password login without MFA fields', () => {
    const base = { phone: '13800000001', password: 'Mentor@2026' }
    expect(loginRequestSchema.parse(base)).toEqual({ ...base, phone: '13800000001' })
    // MFA 已移除：otp/recoveryCode 不再属于契约，会被剥离
    const withOtp = loginRequestSchema.parse({ ...base, otp: '123456' })
    expect('otp' in withOtp).toBe(false)
    const withRecovery = loginRequestSchema.parse({ ...base, recoveryCode: 'ABCDEF-123456' })
    expect('recoveryCode' in withRecovery).toBe(false)
  })

  it('requires a specific and meaningful administrator access reason', () => {
    const invalid = adminAccessRequestSchema.safeParse({
      targetType: 'assessment',
      targetId: 'd9c4988e-e585-4a69-8e83-a87b79b88827',
      reasonCategory: 'school_duty',
      reasonText: '看看'
    })
    expect(invalid.success).toBe(false)
  })

  it('rejects an unknown AI route even if the model returned valid JSON', () => {
    const invalid = routeDecisionSchema.safeParse({
      primaryModule: 'medical_diagnosis',
      secondaryModules: [], confidence: 1, needsClarification: false,
      rationale: 'model supplied route'
    })
    expect(invalid.success).toBe(false)
  })

  it('requires AI context type and id to be provided together', () => {
    expect(chatMessageSchema.safeParse({ message: '看看这个学生', contextType: 'student' }).success).toBe(false)
    expect(chatMessageSchema.safeParse({ message: '看看这个学生', contextId: 'd9c4988e-e585-4a69-8e83-a87b79b88827' }).success).toBe(false)
    expect(chatMessageSchema.safeParse({ message: '看看这个学生', contextType: 'student', contextId: 'd9c4988e-e585-4a69-8e83-a87b79b88827' }).success).toBe(true)
  })

  it('redacts phone, email and named teacher references before model calls', () => {
    const value = redactPii('张老师电话是13812345678，邮箱 zhang@example.com')
    expect(value).not.toContain('张老师')
    expect(value).not.toContain('13812345678')
    expect(value).not.toContain('zhang@example.com')
  })
})

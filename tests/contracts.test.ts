import { describe, expect, it } from 'vitest'
import { adminAccessRequestSchema, chatMessageSchema, loginRequestSchema, routeDecisionSchema } from '../shared/contracts'
import { redactPii } from '../server/integrations/deepseek'

describe('shared API contracts', () => {
  it('accepts an omitted or empty OTP for roles without MFA', () => {
    const base = { email: 'Teacher@Demo.Local', password: 'Mentor@2026' }
    expect(loginRequestSchema.parse(base)).toEqual({ ...base, email: 'teacher@demo.local' })
    expect(loginRequestSchema.parse({ ...base, otp: '' }).otp).toBeUndefined()
    expect(loginRequestSchema.safeParse({ ...base, otp: '123' }).success).toBe(false)
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

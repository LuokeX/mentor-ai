import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  loginRequestSchema,
  chatMessageSchema,
  adminAccessRequestSchema,
  attributionConfigSchema,
  libraryTypeSchema,
  moduleResourceDocumentImportSchema,
  moduleResourceLibraryCreateSchema,
  routeDecisionSchema,
  roleSchema,
  moduleIdSchema,
  targetTypeSchema,
  reasonCategorySchema
} from '../../shared/contracts'
import {
  planAcceptanceSchema,
  planActionExecutionSchema,
  planFeedbackCreateSchema,
  planReviewCreateSchema
} from '../../shared/reports'

// ---- Auth ----

describe('loginRequestSchema', () => {
  it('accepts valid login request', () => {
    const result = loginRequestSchema.parse({ phone: '13800000001', password: 'password123' })
    expect(result.phone).toBe('13800000001')
  })

  it('trims phone', () => {
    const result = loginRequestSchema.parse({ phone: ' 13800000001 ', password: 'password123' })
    expect(result.phone).toBe('13800000001')
  })

  it('accepts optional OTP code', () => {
    const result = loginRequestSchema.parse({ phone: '13800000001', password: '12345678', otp: '123456' })
    expect(result.otp).toBe('123456')
  })

  it('rejects empty OTP (treated as undefined)', () => {
    const result = loginRequestSchema.parse({ phone: '13800000001', password: '12345678', otp: '' })
    expect(result.otp).toBeUndefined()
  })

  it('rejects short password', () => {
    expect(() => loginRequestSchema.parse({ phone: '13800000001', password: '1234567' })).toThrow(ZodError)
  })

  it('rejects invalid phone', () => {
    expect(() => loginRequestSchema.parse({ phone: 'not-a-phone', password: '12345678' })).toThrow(ZodError)
  })

  it('rejects non-numeric OTP', () => {
    expect(() => loginRequestSchema.parse({ phone: '13800000001', password: '12345678', otp: 'abcdef' })).toThrow(ZodError)
  })
})

// ---- Chat ----

describe('chatMessageSchema', () => {
  it('accepts minimal message', () => {
    const result = chatMessageSchema.parse({ message: 'Hello' })
    expect(result.message).toBe('Hello')
  })

  it('accepts message with context', () => {
    const result = chatMessageSchema.parse({
      message: '你好',
      contextType: 'student',
      contextId: '550e8400-e29b-41d4-a716-446655440000'
    })
    expect(result.contextType).toBe('student')
  })

  it('accepts message with sessionId', () => {
    const result = chatMessageSchema.parse({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      message: '继续对话'
    })
    expect(result.sessionId).toBeDefined()
  })

  it('rejects contextType without contextId', () => {
    const result = chatMessageSchema.safeParse({
      message: '你好',
      contextType: 'student'
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.includes('contextId'))).toBe(true)
    }
  })

  it('rejects contextId without contextType', () => {
    const result = chatMessageSchema.safeParse({
      message: '你好',
      contextId: '550e8400-e29b-41d4-a716-446655440000'
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty message', () => {
    expect(() => chatMessageSchema.parse({ message: '' })).toThrow(ZodError)
  })

  it('rejects message over 4000 chars', () => {
    expect(() => chatMessageSchema.parse({ message: 'x'.repeat(4001) })).toThrow(ZodError)
  })
})

// ---- Assessments ----

describe('moduleIdSchema', () => {
  it('accepts all five module IDs', () => {
    expect(moduleIdSchema.parse('self_growth')).toBe('self_growth')
    expect(moduleIdSchema.parse('class_system')).toBe('class_system')
    expect(moduleIdSchema.parse('home_school')).toBe('home_school')
    expect(moduleIdSchema.parse('student_case')).toBe('student_case')
    expect(moduleIdSchema.parse('learning_problem')).toBe('learning_problem')
  })

  it('rejects unknown module', () => {
    expect(() => moduleIdSchema.parse('unknown')).toThrow(ZodError)
  })
})

describe('planReviewCreateSchema', () => {
  it('accepts valid review', () => {
    const result = planReviewCreateSchema.parse({
      effectScore: 4,
      progressNote: '本周完成了家访沟通，效果良好。',
      nextAction: '下周继续跟进学习状态'
    })
    expect(result.effectScore).toBe(4)
  })

  it('rejects score out of range', () => {
    expect(() => planReviewCreateSchema.parse({ effectScore: 0, progressNote: 'test', nextAction: 'test' })).toThrow(ZodError)
    expect(() => planReviewCreateSchema.parse({ effectScore: 6, progressNote: 'test', nextAction: 'test' })).toThrow(ZodError)
  })

  it('rejects too short progress note', () => {
    expect(() => planReviewCreateSchema.parse({ effectScore: 3, progressNote: 'ab', nextAction: 'cd' })).toThrow(ZodError)
  })

  it('accepts operational review decisions', () => {
    const result = planReviewCreateSchema.parse({
      effectScore: 2,
      progressNote: '执行后发现动作过难，需要调整。',
      nextAction: '降低动作难度后再跟进',
      decision: 'adjust_actions'
    })
    expect(result.decision).toBe('adjust_actions')
  })
})

describe('plan operation schemas', () => {
  it('requires reasons when a plan is deferred or not applicable', () => {
    expect(planAcceptanceSchema.safeParse({ decision: 'accepted' }).success).toBe(true)
    expect(planAcceptanceSchema.safeParse({ decision: 'deferred' }).success).toBe(false)
    expect(planAcceptanceSchema.safeParse({ decision: 'not_applicable', reason: '当前场景不适合执行' }).success).toBe(true)
  })

  it('requires a note when blocked reason is other', () => {
    expect(planActionExecutionSchema.safeParse({ blockReason: 'time_limited' }).success).toBe(true)
    expect(planActionExecutionSchema.safeParse({ blockReason: 'other' }).success).toBe(false)
    expect(planActionExecutionSchema.safeParse({ blockReason: 'other', blockNote: '特殊排期冲突' }).success).toBe(true)
  })

  it('allows feedback to carry rule and tool trace ids', () => {
    const result = planFeedbackCreateSchema.parse({
      ruleIds: ['hs-high'],
      toolCodes: ['HS-T1'],
      attributionAccuracy: 2,
      toolUsability: 4,
      scriptNaturalness: 4,
      actionDifficulty: 5,
      reviewUsefulness: 3,
      tags: ['场景不匹配']
    })
    expect(result.ruleIds).toEqual(['hs-high'])
    expect(result.toolCodes).toEqual(['HS-T1'])
  })
})

// ---- Admin Access ----

describe('adminAccessRequestSchema', () => {
  it('accepts valid request', () => {
    const result = adminAccessRequestSchema.parse({
      targetType: 'student_case',
      targetId: '550e8400-e29b-41d4-a716-446655440000',
      reasonCategory: 'risk_review',
      reasonText: '需要核查该学生的风险评估记录以确认转介依据。'
    })
    expect(result.reasonCategory).toBe('risk_review')
  })

  it('rejects short reason text', () => {
    expect(() => adminAccessRequestSchema.parse({
      targetType: 'student_case',
      targetId: '550e8400-e29b-41d4-a716-446655440000',
      reasonCategory: 'risk_review',
      reasonText: '短'
    })).toThrow(ZodError)
  })

  it('rejects invalid targetType', () => {
    expect(() => adminAccessRequestSchema.parse({
      targetType: 'invalid',
      targetId: '550e8400-e29b-41d4-a716-446655440000',
      reasonCategory: 'risk_review',
      reasonText: '足够长的理由文本用于测试验证。'
    })).toThrow(ZodError)
  })
})

// ---- Module Resource Libraries ----

describe('moduleResourceLibraryCreateSchema', () => {
  it('accepts global assessment library', () => {
    const result = moduleResourceLibraryCreateSchema.parse({ module: 'home_school', libraryType: 'assessment', name: '家校评估库', scope: 'global' })
    expect(result.scope).toBe('global')
  })

  it('accepts school-scoped tool library', () => {
    const result = moduleResourceLibraryCreateSchema.parse({
      module: 'home_school',
      libraryType: 'tool',
      name: '班级管理规范',
      scope: 'school',
      schoolId: '550e8400-e29b-41d4-a716-446655440000'
    })
    expect(result.schoolId).toBeDefined()
  })

  it('rejects school scope without schoolId', () => {
    const result = moduleResourceLibraryCreateSchema.safeParse({ module: 'home_school', libraryType: 'tool', name: 'test', scope: 'school' })
    expect(result.success).toBe(false)
  })

  it('rejects global scope with schoolId', () => {
    const result = moduleResourceLibraryCreateSchema.safeParse({
      module: 'home_school',
      libraryType: 'tool',
      name: 'test',
      scope: 'global',
      schoolId: '550e8400-e29b-41d4-a716-446655440000'
    })
    expect(result.success).toBe(false)
  })
})

describe('moduleResourceDocumentImportSchema', () => {
  it('requires confirmNoPersonalData to be true', () => {
    expect(() => moduleResourceDocumentImportSchema.parse({
      versionId: '550e8400-e29b-41d4-a716-446655440000',
      title: '文档标题',
      sourceType: 'markdown',
      content: '# Hello\n\n这是测试内容。',
      confirmNoPersonalData: false as any
    })).toThrow(ZodError)
  })

  it('accepts valid markdown import', () => {
    const result = moduleResourceDocumentImportSchema.parse({
      versionId: '550e8400-e29b-41d4-a716-446655440000',
      title: '校规第一章',
      sourceType: 'markdown',
      content: '# 第一章\n\n内容至少十个字才能通过校验。',
      confirmNoPersonalData: true
    })
    expect(result.title).toBe('校规第一章')
  })

  it('rejects content under 10 chars', () => {
    expect(() => moduleResourceDocumentImportSchema.parse({
      versionId: '550e8400-e29b-41d4-a716-446655440000',
      title: '短',
      sourceType: 'text',
      content: '123456789',
      confirmNoPersonalData: true
    })).toThrow(ZodError)
  })
})

describe('libraryTypeSchema', () => {
  it('accepts only the three business library types', () => {
    expect(libraryTypeSchema.parse('assessment')).toBe('assessment')
    expect(libraryTypeSchema.parse('attribution')).toBe('attribution')
    expect(libraryTypeSchema.parse('tool')).toBe('tool')
  })

  it('rejects removed knowledge and term library types', () => {
    expect(() => libraryTypeSchema.parse('term')).toThrow(ZodError)
    expect(() => libraryTypeSchema.parse('professional_knowledge')).toThrow(ZodError)
  })
})

describe('attributionConfigSchema', () => {
  it('requires deterministic attribution output fields', () => {
    const result = attributionConfigSchema.parse({
      module: 'student_case',
      version: '1.0.0',
      attributionItems: [{
        code: 'SC_AT_LEARNING',
        name: '学习支持不足',
        module: 'student_case',
        toolTags: ['learning_support']
      }],
      evidences: [{
        attributionCode: 'SC_AT_LEARNING',
        assessmentCode: 'SC_SCALE_A',
        evidenceCode: 'SC_EV_01',
        condition: '维度[D_LEARNING] >= 4',
        description: '量表显示学习支持维度需要关注'
      }],
      gradingRules: [{
        ruleId: 'student-case-learning',
        pri: 999,
        level: 'medium',
        severity: 'medium',
        blocked: false
      }]
    })
    expect(result.attributionItems[0]?.toolTags).toEqual(['learning_support'])
    // 权重与打分参数有默认值，业务不填也能跑
    expect(result.attributionItems[0]?.baseWeight).toBe(1)
    expect(result.evidences[0]?.weight).toBe(1)
    expect(result.scoring.maxAttributions).toBe(3)
  })
})

// ---- Route Decision ----

describe('routeDecisionSchema', () => {
  it('accepts valid route decision', () => {
    const result = routeDecisionSchema.parse({
      primaryModule: 'home_school',
      secondaryModules: [],
      confidence: 0.86,
      needsClarification: false,
      rationale: '主要困扰是家长沟通'
    })
    expect(result.primaryModule).toBe('home_school')
  })

  it('rejects confidence out of range', () => {
    expect(() => routeDecisionSchema.parse({
      primaryModule: 'self_growth',
      secondaryModules: [],
      confidence: 1.5,
      needsClarification: false,
      rationale: 'test'
    })).toThrow(ZodError)
  })

  it('rejects unknown module', () => {
    expect(() => routeDecisionSchema.parse({
      primaryModule: 'unknown',
      secondaryModules: [],
      confidence: 0.5,
      needsClarification: false,
      rationale: 'test'
    })).toThrow(ZodError)
  })
})

// ---- Enums ----

describe('enum schemas', () => {
  it('roleSchema accepts all roles', () => {
    expect(roleSchema.parse('teacher')).toBe('teacher')
    expect(roleSchema.parse('psychologist')).toBe('psychologist')
    expect(roleSchema.parse('school_admin')).toBe('school_admin')
    expect(roleSchema.parse('platform_admin')).toBe('platform_admin')
  })

  it('targetTypeSchema accepts all target types', () => {
    const types = ['teacher_profile', 'assessment', 'conversation', 'student_case', 'guardian_communication', 'plan']
    for (const t of types) expect(targetTypeSchema.parse(t)).toBe(t)
  })

  it('reasonCategorySchema accepts all categories', () => {
    const categories = ['risk_review', 'complaint_handling', 'data_correction_verification', 'school_duty', 'other']
    for (const c of categories) expect(reasonCategorySchema.parse(c)).toBe(c)
  })
})

// ---- Contracts integration ----

describe('chat → assessment flow schema compatibility', () => {
  it('chatMessageSchema contextType matches assessment context types', () => {
    // Both use the same entity types: student, class, guardian
    const chatCtx = chatMessageSchema.parse({
      message: 'test',
      contextType: 'student',
      contextId: '550e8400-e29b-41d4-a716-446655440000'
    })
    expect(chatCtx.contextType).toBe('student')
  })

  it('loginRequestSchema integrates with roleSchema', () => {
    const login = loginRequestSchema.parse({ phone: '13800000001', password: 'password123' })
    const role = roleSchema.parse('teacher')
    expect(login.phone).toMatch(/^1[3-9]\d{9}$/)
    expect(role).toBe('teacher')
  })
})

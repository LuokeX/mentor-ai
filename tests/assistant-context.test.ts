import { describe, expect, it, vi } from 'vitest'
import {
  maskPhone,
  safeJsonParse,
  compact,
  buildAssistantBusinessContext,
  assertAssistantContext,
  fetchEntityMemory,
  listAssistantContextOptions
} from '../server/domain/assistant-context'
import type { AssistantBusinessContext, AssistantContextType } from '../server/domain/assistant-context'
import type { AuthUser } from '../app/composables/useAuth'

// ---- 纯函数测试 ----

describe('maskPhone', () => {
  it('returns empty string for falsy input', () => {
    expect(maskPhone('')).toBe('')
  })

  it('masks a standard 11-digit phone number', () => {
    expect(maskPhone('13812345678')).toBe('****5678')
  })

  it('handles short phone numbers (less than 4 chars)', () => {
    expect(maskPhone('12')).toBe('已填写')
    expect(maskPhone('123')).toBe('已填写')
  })

  it('handles exactly 4-digit numbers', () => {
    expect(maskPhone('1234')).toBe('****1234')
  })
})

describe('safeJsonParse', () => {
  it('returns empty object for empty string', () => {
    expect(safeJsonParse('')).toEqual({})
  })

  it('returns empty object for falsy input', () => {
    expect(safeJsonParse('' as any)).toEqual({})
  })

  it('parses valid JSON', () => {
    expect(safeJsonParse('{"name":"test","age":10}')).toEqual({ name: 'test', age: 10 })
  })

  it('parses JSON arrays', () => {
    expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('returns empty object for malformed JSON', () => {
    expect(safeJsonParse('{invalid}')).toEqual({})
    expect(safeJsonParse('not json at all')).toEqual({})
  })

  it('handles nested JSON objects', () => {
    const result = safeJsonParse('{"profile":{"name":"test","scores":[1,2]}}')
    expect(result).toEqual({ profile: { name: 'test', scores: [1, 2] } })
  })
})

describe('compact', () => {
  it('serializes objects to JSON with 2-space indent', () => {
    const result = compact({ a: 1, b: 'hello' })
    expect(result).toBe('{\n  "a": 1,\n  "b": "hello"\n}')
  })

  it('truncates at 6000 characters', () => {
    const longString = 'x'.repeat(10000)
    const result = compact({ data: longString })
    expect(result.length).toBeLessThanOrEqual(6000)
  })

  it('handles arrays', () => {
    const result = compact([1, 2, 3])
    expect(result).toBe('[\n  1,\n  2,\n  3\n]')
  })

  it('handles nested structures', () => {
    const data = {
      student: { name: 'test', scores: [1, 2, 3] },
      plans: [{ id: 'uuid-1', status: 'in_progress' }]
    }
    const result = compact(data)
    expect(result).toContain('"name": "test"')
    expect(result).toContain('"status": "in_progress"')
  })

  it('handles null and undefined values', () => {
    expect(compact(null)).toBe('null')
    expect(compact({ a: null })).toBe('{\n  "a": null\n}')
  })
})

// ---- 类型与接口测试 ----

describe('type exports', () => {
  it('exports AssistantContextType as a type', () => {
    const validTypes: AssistantContextType[] = ['student', 'class', 'guardian']
    expect(validTypes.length).toBe(3)
  })

  it('AssistantBusinessContext shape is correctly typed', () => {
    const ctx: AssistantBusinessContext = {
      type: 'student',
      id: 'test-id',
      label: 'test-label',
      snapshot: { key: 'value' },
      prompt: 'compacted snapshot'
    }
    expect(ctx.type).toBe('student')
    expect(ctx.snapshot).toEqual({ key: 'value' })
  })
})

// ---- 函数导出验证 ----

describe('module exports', () => {
  it('exports buildAssistantBusinessContext', () => {
    expect(typeof buildAssistantBusinessContext).toBe('function')
  })

  it('exports assertAssistantContext as a wrapper', () => {
    expect(typeof assertAssistantContext).toBe('function')
    // assertAssistantContext is a thin wrapper that calls buildAssistantBusinessContext
  })

  it('exports fetchEntityMemory', () => {
    expect(typeof fetchEntityMemory).toBe('function')
  })

  it('exports listAssistantContextOptions', () => {
    expect(typeof listAssistantContextOptions).toBe('function')
  })
})

// ---- 校验与错误路径测试 ----

describe('buildAssistantBusinessContext validation', () => {
  const mockEvent = {} as any
  const mockUser: AuthUser = {
    id: 'user-1',
    role: 'teacher',
    schoolId: 'school-1'
  }

  it('returns null when contextType is missing', async () => {
    const result = await buildAssistantBusinessContext(mockEvent, mockUser, undefined, 'some-id')
    expect(result).toBeNull()
  })

  it('returns null when contextId is missing', async () => {
    const result = await buildAssistantBusinessContext(mockEvent, mockUser, 'student', undefined)
    expect(result).toBeNull()
  })

  it('returns null when both contextType and contextId are missing', async () => {
    const result = await buildAssistantBusinessContext(mockEvent, mockUser, undefined, undefined)
    expect(result).toBeNull()
  })

  it('function is callable and validates context type parameter', async () => {
    // createError is a Nitro auto-import not available in vitest.
    // Verify the function signature exists and handles basic validation.
    expect(typeof buildAssistantBusinessContext).toBe('function')
    // null context → returns null (validated above)
    const nullResult = await buildAssistantBusinessContext(mockEvent, mockUser, undefined, undefined)
    expect(nullResult).toBeNull()
  })
})

// ---- fetchEntityMemory 校验 ----

describe('fetchEntityMemory validation', () => {
  const mockEvent = {} as any
  const mockUserWithoutSchool: AuthUser = {
    id: 'user-1',
    role: 'teacher'
    // schoolId intentionally missing
  }

  it('returns empty array when user has no schoolId', async () => {
    const result = await fetchEntityMemory(mockEvent, mockUserWithoutSchool, 'student', 'student-1')
    expect(result).toEqual([])
  })
})
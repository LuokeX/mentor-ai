import { describe, expect, it } from 'vitest'
import { buildBusinessContextText, classifyAgentFailure, getSessionModuleScores } from '../server/domain/chat-stream'

describe('buildBusinessContextText（system 段业务上下文）', () => {
  it('绑定咨询对象时给出指针与按需查档要求', () => {
    const text = buildBusinessContextText({
      recordBinding: { type: 'guardian', label: '张三' },
      withoutRecord: false,
      hasBinding: true
    })
    expect(text).toContain('当前咨询对象：家长「张三」')
    expect(text).toContain('record_snapshot')
  })

  it('教师选择不带档案时只发脱敏说明', () => {
    expect(buildBusinessContextText({ recordBinding: null, withoutRecord: true, hasBinding: true }))
      .toContain('不引入档案数据')
    expect(buildBusinessContextText({ recordBinding: null, withoutRecord: false, hasBinding: false })).toBeNull()
  })

  it('会话换过对象时把换绑提示追加在业务上下文之后（不带档案时也要带）', () => {
    const note = '本会话中途切换过咨询对象：此前讨论的是学生「李四」，当前咨询对象是家长「张三」。'
    const bound = buildBusinessContextText({
      recordBinding: { type: 'guardian', label: '张三' },
      withoutRecord: false,
      hasBinding: true,
      contextSwitchNote: note
    })
    expect(bound?.startsWith('当前咨询对象：家长「张三」')).toBe(true)
    expect(bound?.endsWith(note)).toBe(true)
    const withoutRecord = buildBusinessContextText({
      recordBinding: null,
      withoutRecord: true,
      hasBinding: true,
      contextSwitchNote: note
    })
    expect(withoutRecord).toContain('不引入档案数据')
    expect(withoutRecord).toContain(note)
  })
})

describe('getSessionModuleScores（会话模块占比读取）', () => {
  it('读取当前结构 metadata.moduleScores', () => {
    expect(getSessionModuleScores({ moduleScores: { self_growth: 0.6 } })).toEqual({ self_growth: 0.6 })
  })

  it('兼容历史结构 metadata.clarificationState.moduleScores', () => {
    expect(getSessionModuleScores({ clarificationState: { moduleScores: { class_system: 0.8 } } }))
      .toEqual({ class_system: 0.8 })
  })

  it('空值与非法结构返回空对象', () => {
    expect(getSessionModuleScores(null)).toEqual({})
    expect(getSessionModuleScores(undefined)).toEqual({})
    expect(getSessionModuleScores({})).toEqual({})
    expect(getSessionModuleScores({ moduleScores: [] })).toEqual({})
    expect(getSessionModuleScores({ moduleScores: 'x' as unknown as Record<string, number> })).toEqual({})
  })
})

describe('classifyAgentFailure（失败分类，只写粗粒度错误码）', () => {
  it('超时类错误归为 timeout', () => {
    const abort = new Error('The operation was aborted')
    abort.name = 'AbortError'
    expect(classifyAgentFailure(abort)).toBe('timeout')
    expect(classifyAgentFailure(new Error('request timeout'))).toBe('timeout')
  })

  it('无回答产出归为 no_output', () => {
    expect(classifyAgentFailure(new Error('Agent 无回答产出'))).toBe('no_output')
  })

  it('其它异常归为 agent_error，不泄露错误细节', () => {
    const code = classifyAgentFailure(new Error('数据库连接串 postgres://secret'))
    expect(code).toBe('agent_error')
    expect(code).not.toContain('secret')
  })

  it('非 Error 输入也能分类', () => {
    expect(classifyAgentFailure('boom')).toBe('agent_error')
    expect(classifyAgentFailure(null)).toBe('agent_error')
  })
})

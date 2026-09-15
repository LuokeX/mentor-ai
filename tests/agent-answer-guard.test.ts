import { describe, expect, it } from 'vitest'
import { inspectAgentAnswer } from '../server/agent/answer-guard'

describe('answer-guard：清理类规则', () => {
  it('删除正文里的来源标注', () => {
    const result = inspectAgentAnswer({ answer: '先安抚情绪（来源：《家校沟通手册》），再谈规则。' })
    expect(result.cleaned).toBe('先安抚情绪，再谈规则。')
    expect(result.violations).toContain('source_citation_in_body')
  })

  it('删除只属于推荐卡的时长信息', () => {
    const result = inspectAgentAnswer({ answer: '可以先做这张量表（约 5 分钟）建立基线。' })
    expect(result.cleaned).not.toContain('约 5 分钟')
    expect(result.cleaned).toContain('建立基线')
    expect(result.violations).toContain('estimated_minutes_claim')
  })

  it('模块英文 ID 替换为中文模块名而不是直接删除', () => {
    const result = inspectAgentAnswer({ answer: '这个问题属于 student_case 模块。' })
    expect(result.cleaned).toContain('学生个体')
    expect(result.cleaned).not.toContain('student_case')
    expect(result.violations).toContain('module_id_leak')
  })

  it('删除内部字段名标注并清理空括号', () => {
    const result = inspectAgentAnswer({ answer: '推荐理由如下。ctaLabel：开始作答，module：student_case。' })
    expect(result.cleaned).not.toContain('ctaLabel')
    expect(result.violations).toContain('internal_field_name')
  })
})

describe('answer-guard：告警类规则（不改写正文）', () => {
  it('诊断性表述只告警', () => {
    const answer = '这个孩子可能已经确诊焦虑症，建议就医。'
    const result = inspectAgentAnswer({ answer })
    expect(result.violations).toContain('diagnostic_claim')
    expect(result.cleaned).toContain('就医')
  })

  it('没有引用来源时把内容说成平台规定要告警', () => {
    const result = inspectAgentAnswer({ answer: '平台规定这类情况必须三天内上报。', sources: [] })
    expect(result.violations).toContain('unbacked_policy_claim')
  })

  it('有引用来源时同样的表述不告警', () => {
    const result = inspectAgentAnswer({
      answer: '平台规定这类情况必须三天内上报。',
      sources: [{ chunkId: 'chunk-1' }]
    })
    expect(result.violations).not.toContain('unbacked_policy_claim')
  })

  it('疑似密钥或内部加密字段名要告警', () => {
    const result = inspectAgentAnswer({ answer: '上下文里的 phoneEnc 字段出现了一个长串 YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=。' })
    expect(result.violations).toContain('secret_like_token')
  })
})

describe('answer-guard：边界与兜底', () => {
  it('空回答原样返回且不报违规', () => {
    expect(inspectAgentAnswer({ answer: '' })).toEqual({ cleaned: '', violations: [] })
    expect(inspectAgentAnswer({ answer: '   ' })).toEqual({ cleaned: '   ', violations: [] })
  })

  it('清理后只剩标点时回退原文，绝不把回答清空', () => {
    const answer = '（来源：《手册》）'
    const result = inspectAgentAnswer({ answer })
    expect(result.cleaned).toBe(answer)
  })

  it('正常回答不被改动', () => {
    const answer = '先稳定情绪，再跟家长约定一次十五分钟的沟通，把焦点放在孩子的具体行为上。'
    const result = inspectAgentAnswer({ answer })
    expect(result.cleaned).toBe(answer)
    expect(result.violations).toEqual([])
  })

  it('传入非法输入不抛错', () => {
    expect(() => inspectAgentAnswer({ answer: undefined as unknown as string })).not.toThrow()
    expect(inspectAgentAnswer({ answer: undefined as unknown as string }).cleaned).toBe('')
    expect(() => inspectAgentAnswer({ answer: '正常回答', sources: null, toolCalls: null })).not.toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { PROMPT_BUILTINS, renderTemplate } from '../server/domain/ai-config'
import { aiRuntimeSettingsPatchSchema } from '../shared/contracts'

describe('PROMPT_BUILTINS 内置提示词基线', () => {
  it('覆盖全部 9 个 AI 调用点且 code 唯一', () => {
    const codes = PROMPT_BUILTINS.map(item => item.code)
    expect(codes).toEqual([
      'assistant_chat',
      'clarification_round',
      'clarification_summary',
      'assessment_report',
      'semantic_safety',
      'rule_expression',
      'module_router',
      'plan_update_extractor',
      'instrument_recommendation',
    ])
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('模板中的 {{占位符}} 与 placeholders 元数据一一对应', () => {
    for (const item of PROMPT_BUILTINS) {
      const inTemplate = [...item.template.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1])
      const declared = item.placeholders.map(ph => ph.key)
      expect(new Set(inTemplate)).toEqual(new Set(declared))
    }
  })

  it('分段标记格式正确：带 SYSTEM 标记的模板要么有 USER 段要么整段为 system', () => {
    for (const item of PROMPT_BUILTINS) {
      const rendered = renderTemplate(item.template, {})
      if (item.template.startsWith('###SYSTEM###\n')) {
        expect(rendered.system).toBeTruthy()
        // instrument_recommendation 无标记 = 整体 user 消息
      } else {
        expect(rendered.system).toBeNull()
        expect(rendered.user).toBeTruthy()
      }
    }
  })
})

describe('renderTemplate 占位符渲染', () => {
  const template = '###SYSTEM###\n你是助手。{{knowledgeContext}}\n###USER###\n用户说：{{userText}}'

  it('解析 system/user 分段并替换占位符', () => {
    const result = renderTemplate(template, { knowledgeContext: '知识', userText: '你好' })
    expect(result.system).toBe('你是助手。知识\n')
    expect(result.user).toBe('用户说：你好')
  })

  it('缺失的占位符替换为空字符串（不阻断调用）', () => {
    const result = renderTemplate(template, { userText: '你好' })
    expect(result.system).toBe('你是助手。\n')
    expect(result.user).toBe('用户说：你好')
  })

  it('无分段标记时整体作为 user 消息', () => {
    const result = renderTemplate('只返回 json。文本：{{userText}}', { userText: 'abc' })
    expect(result.system).toBeNull()
    expect(result.user).toBe('只返回 json。文本：abc')
  })
})

describe('aiRuntimeSettingsPatchSchema 运行时配置契约', () => {
  it('接受合法字段，null = 回落环境变量', () => {
    const parsed = aiRuntimeSettingsPatchSchema.safeParse({
      routerModel: 'deepseek-v4-flash',
      generatorModel: null,
      timeoutMs: 30000,
      embeddingModel: null,
      embeddingEnabled: false,
    })
    expect(parsed.success).toBe(true)
  })

  it('超时超出范围被拒绝', () => {
    expect(aiRuntimeSettingsPatchSchema.safeParse({ timeoutMs: 100 }).success).toBe(false)
    expect(aiRuntimeSettingsPatchSchema.safeParse({ timeoutMs: 200000 }).success).toBe(false)
  })
})
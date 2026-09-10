import { describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { AI_PROMPT_BASELINES, getPromptBaseline } from '../server/domain/ai-prompt-baselines'
import { PROMPT_REGISTRY, getAiRuntimeConfig, getPromptTemplate, isPromptPublished, listPromptRegistry, promptAvailable, renderPrompt, renderTemplate } from '../server/domain/ai-config'

const AI_CENTER_CODES = [
  'assistant_chat',
  'clarification_judge',
  'clarification_round',
  'clarification_summary',
  'assessment_report',
  'tool_step_polish',
  'semantic_safety',
  'rule_expression',
  'module_router',
  'plan_update_extractor',
  'instrument_recommendation',
]

/** 代码基线读取不查库，事件对象仅用于保持调用签名一致。 */
const fakeEvent = {} as H3Event

describe('PROMPT_REGISTRY 提示词注册表', () => {
  it('覆盖全部 11 个 AI 调用点且 code 唯一', () => {
    const codes = PROMPT_REGISTRY.map(item => item.code)
    expect(codes).toEqual(AI_CENTER_CODES)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('每条都带名称与用途说明', () => {
    for (const item of PROMPT_REGISTRY) {
      expect(item.name.length).toBeGreaterThan(0)
      expect(item.description.length).toBeGreaterThan(0)
    }
  })
})

describe('代码提示词基线（server/domain/ai-prompt-baselines.ts）', () => {
  it('11 条基线齐全、正文非空，且不与注册表多余/缺漏', () => {
    expect(Object.keys(AI_PROMPT_BASELINES).sort()).toEqual([...AI_CENTER_CODES].sort())
    for (const code of AI_CENTER_CODES) {
      const text = getPromptBaseline(code)
      expect(text, `${code} 缺少代码基线`).toBeTruthy()
      expect(text!.trim().length).toBeGreaterThan(0)
    }
  })

  it('未登记的编码返回 null（调用点据此降级）', () => {
    expect(getPromptBaseline('not_a_prompt')).toBeNull()
  })

  it('基线正文占位符都在注册表声明范围内', () => {
    for (const item of PROMPT_REGISTRY) {
      const template = getPromptBaseline(item.code)!
      const inTemplate = [...template.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1])
      const declared = item.placeholders.map(ph => ph.key)
      for (const key of inTemplate) expect(declared, `${item.code} 未声明占位符 ${key}`).toContain(key)
    }
  })

  it('listPromptRegistry 返回元数据 + 代码正文', () => {
    const listed = listPromptRegistry()
    expect(listed).toHaveLength(AI_CENTER_CODES.length)
    for (const item of listed) {
      expect(item.template).toBe(getPromptBaseline(item.code))
      expect(item.placeholders.length).toBeGreaterThan(0)
    }
  })

  it('getPromptTemplate / isPromptPublished 一律读代码基线（不查库）', async () => {
    expect(await getPromptTemplate(fakeEvent, 'assistant_chat')).toBe(getPromptBaseline('assistant_chat'))
    expect(await getPromptTemplate(fakeEvent, 'not_a_prompt')).toBeNull()
    expect(await isPromptPublished(fakeEvent, 'assessment_report')).toBe(true)
    expect(await isPromptPublished(fakeEvent, 'not_a_prompt')).toBe(false)
  })
})

describe('renderTemplate / renderPrompt 占位符渲染', () => {
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

  it('全部代码基线都能解析出可用正文', () => {
    for (const code of AI_CENTER_CODES) {
      const rendered = renderTemplate(getPromptBaseline(code)!, {})
      if (getPromptBaseline(code)!.startsWith('###SYSTEM###\n')) {
        expect(rendered.system, `${code} 应有 system 段`).toBeTruthy()
      } else {
        expect(rendered.system, `${code} 应整段为 user 消息`).toBeNull()
        expect(rendered.user, `${code} 应有 user 段`).toBeTruthy()
      }
      expect(promptAvailable(rendered), `${code} 渲染后应有可用正文`).toBe(true)
    }
  })

  it('renderPrompt 未登记编码返回空渲染（调用点降级）', async () => {
    const rendered = await renderPrompt(fakeEvent, 'not_a_prompt', {})
    expect(rendered).toEqual({ system: null, user: null })
  })
})

describe('getAiRuntimeConfig 不依赖数据库', () => {
  it('一律返回 null（无覆盖），由调用点回落环境变量与代码默认', async () => {
    const runtime = await getAiRuntimeConfig(fakeEvent)
    expect(Object.values(runtime).every(value => value === null)).toBe(true)
  })
})

import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PROMPT_REGISTRY, renderTemplate } from '../server/domain/ai-config'
import { aiRuntimeSettingsPatchSchema } from '../shared/contracts'

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

/** 从 drizzle/*.sql 中提取已初始化的提示词正文（$<code>_tpl$ ... $<code>_tpl$）。 */
function readSeededTemplates(): Map<string, string> {
  const dir = new URL('../drizzle/', import.meta.url)
  const seeded = new Map<string, string>()
  for (const file of readdirSync(dir).filter(name => name.endsWith('.sql'))) {
    const sql = readFileSync(new URL(file, dir), 'utf8')
    for (const match of sql.matchAll(/\$(\w+)_tpl\$([\s\S]*?)\$\1_tpl\$/g)) {
      if (!seeded.has(match[1]!)) seeded.set(match[1]!, match[2]!)
    }
  }
  return seeded
}

describe('PROMPT_REGISTRY 提示词注册表', () => {
  it('覆盖全部 11 个 AI 调用点且 code 唯一', () => {
    const codes = PROMPT_REGISTRY.map(item => item.code)
    expect(codes).toEqual(AI_CENTER_CODES)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('每条都带名称与用途说明（正文不在代码里）', () => {
    for (const item of PROMPT_REGISTRY) {
      expect(item.name.length).toBeGreaterThan(0)
      expect(item.description.length).toBeGreaterThan(0)
      expect(item).not.toHaveProperty('template')
    }
  })

  it('每条提示词都已由数据库迁移初始化（空库也有可发布正文）', () => {
    const seeded = readSeededTemplates()
    for (const code of AI_CENTER_CODES) {
      expect(seeded.get(code), `迁移里缺少 ${code}`).toBeTruthy()
      expect(seeded.get(code)!.trim().length).toBeGreaterThan(0)
    }
  })

  it('初始化的正文占位符都在注册表声明范围内', () => {
    const seeded = readSeededTemplates()
    for (const item of PROMPT_REGISTRY) {
      const template = seeded.get(item.code)!
      const inTemplate = [...template.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1])
      const declared = item.placeholders.map(ph => ph.key)
      for (const key of inTemplate) expect(declared, `${item.code} 未声明占位符 ${key}`).toContain(key)
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

  it('已初始化正文的分段标记可正常解析', () => {
    for (const [code, template] of readSeededTemplates()) {
      const rendered = renderTemplate(template, {})
      if (template.startsWith('###SYSTEM###\n')) {
        expect(rendered.system, `${code} 应有 system 段`).toBeTruthy()
      } else {
        expect(rendered.system, `${code} 应整段为 user 消息`).toBeNull()
        expect(rendered.user, `${code} 应有 user 段`).toBeTruthy()
      }
    }
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
      agentEnabled: true,
      agentMaxRounds: 6,
      agentTemperature: 0.35,
      agentTools: ['recommend_assessment', 'knowledge_search'],
      agentBehaviorNotes: '回答先行，只输出自然语言。',
    })
    expect(parsed.success).toBe(true)
  })

  it('超时超出范围被拒绝', () => {
    expect(aiRuntimeSettingsPatchSchema.safeParse({ timeoutMs: 100 }).success).toBe(false)
    expect(aiRuntimeSettingsPatchSchema.safeParse({ timeoutMs: 200000 }).success).toBe(false)
  })

  it('Agent 字段：tool 空数组合法（禁用全部工具），agentTools 为 null 合法（回落默认）', () => {
    expect(aiRuntimeSettingsPatchSchema.safeParse({ agentTools: [] }).success).toBe(true)
    expect(aiRuntimeSettingsPatchSchema.safeParse({ agentTools: null }).success).toBe(true)
  })

  it('Agent 字段：轮次上限与温度超出范围被拒绝', () => {
    expect(aiRuntimeSettingsPatchSchema.safeParse({ agentMaxRounds: 0 }).success).toBe(false)
    expect(aiRuntimeSettingsPatchSchema.safeParse({ agentMaxRounds: 21 }).success).toBe(false)
    expect(aiRuntimeSettingsPatchSchema.safeParse({ agentTemperature: -0.1 }).success).toBe(false)
    expect(aiRuntimeSettingsPatchSchema.safeParse({ agentTemperature: 2.5 }).success).toBe(false)
  })
})

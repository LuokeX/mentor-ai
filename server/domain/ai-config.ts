/**
 * AI 配置层（AI 管理中心）。
 *
 * 提示词正文的唯一来源是代码 `server/domain/ai-prompt-baselines.ts`：
 *  - 运行时读取代码基线（本文件只做渲染与降级），AI 中心仅做只读展示；
 *  - 本文件保留编码、名称、说明与占位符清单（PROMPT_REGISTRY）；
 *  - 某条正文缺失时调用点按「该 AI 能力不可用」降级到确定性路径。
 *
 * 提示词与运行时配置都没有库内来源：ai_prompt_templates、ai_runtime_settings
 * 两张历史表已随迁移删除；运行时参数来自环境变量与代码默认值。
 *
 * 模板语法：
 *  以 `###SYSTEM###\n` 开头的模板分为 system 段与 user 段（以 `###USER###\n` 分隔）；
 *  不含该标记的模板整体作为 user 消息。渲染后调用点自行决定消息 role。
 */
import type { H3Event } from 'h3'
import { getPromptBaseline } from './ai-prompt-baselines'

export interface PromptPlaceholder {
  key: string
  label: string
  description?: string
}

/** 提示词注册表（编码、名称、说明与占位符元数据；正文在代码基线 ai-prompt-baselines.ts）。 */
export interface PromptDefinition {
  /** 模板唯一编码，对应调用点 */
  code: string
  name: string
  description: string
  placeholders: PromptPlaceholder[]
}

export interface RenderedPrompt {
  system: string | null
  user: string | null
}

export interface AiRuntimeConfig {
  routerModel: string | null
  generatorModel: string | null
  timeoutMs: number | null
  embeddingModel: string | null
  embeddingEnabled: boolean | null
}

const SYSTEM_MARKER = '###SYSTEM###\n'
const USER_MARKER = '###USER###\n'

export const PROMPT_REGISTRY: PromptDefinition[] = [
  {
    code: 'assistant_chat',
    name: 'AI 助手系统提示词',
    description: '教师端统一 AI 助手（聊天流式与 JSON 模式共用）：身份、职责与硬约束。',
    placeholders: [
      { key: 'formatInstruction', label: '输出格式指令', description: '由调用点注入的输出约束（回答先行模式或经典 JSON/自然语言模式）。' },
      { key: 'knowledgeContext', label: '已审核知识片段', description: '检索到的已发布知识片段；无检索结果时为降级提示句。' },
      { key: 'businessContextText', label: '当前业务对象上下文', description: '咨询对象（学生/班级/家长）档案摘要；未指定时为固定提示句。' }
    ]
  },
  {
    code: 'assessment_report',
    name: '评估报告润色提示词',
    description: '确定性规则结果生成正式评估报告 JSON（AI 仅润色，约束字段不得改变）。',
    placeholders: [
      { key: 'facts', label: '规则事实 JSON', description: '规则执行结果：模块、等级、归因名称/强弱、原因、行动等（不含占比小数）。' },
      { key: 'jsonFormat', label: '报告 JSON 结构示例', description: '由代码按报告 schema 生成的完整示例。' }
    ]
  },
  {
    code: 'tool_step_polish',
    name: '工具步骤人话改写提示词',
    description: '把工具库机械的结构化步骤与归因建议/分级干预的一句话建议改写成教师可直接执行的口语化步骤；知识库检索片段（knowledgeChunks）为共同输入，只用于把专业术语解释成教师能懂的白话。tools 非空时工具名与步骤数量/顺序/关键事实不变、只优化表达；tools 为空且知识片段非空时仅依据知识片段自拟 1-3 条新工具，两者都为空时 tools 输出空数组。actions 逐条按「何时做 → 怎么做 → 话术示例 → 频率/周期 → 达标标准」扩写为可执行步骤，title 与条数必须与输入一致、保留原建议要点，为空时输出空数组。后台调用，格式校验失败自动重试（最多 3 次），未覆盖全部条目时不写入部分结果。',
    placeholders: [
      { key: 'facts', label: '规则事实 JSON', description: '模块、严重度、归因名称/强弱/原因、匹配工具标题与原文内容；另含 actions：归因建议/分级干预的一句话建议数组（每项含 title 与 content，title 须原样保留、content 为需扩写的一句话建议）。' },
      { key: 'jsonFormat', label: '输出 JSON 结构示例', description: '由代码生成的人话版示例（content 为改写后的效果，title 保持不变）。' },
      { key: 'feedback', label: '上次校验反馈', description: '重试时附带上次输出与校验错误摘要；首次为空。' }
    ]
  },
  {
    code: 'semantic_safety',
    name: '语义安全信号识别提示词',
    description: '安全链路的辅助信号识别：自杀/自伤/暴力/虐待/威胁。小超时（1500ms）由代码固定。',
    placeholders: [
      { key: 'userText', label: '脱敏后的教师输入', description: '已脱敏（电话/邮箱/人名）的原始文本。' }
    ]
  },
  {
    code: 'instrument_recommendation',
    name: '量表分诊提示词',
    description: '从模块量表白名单中推荐一张（AI 只挑入口，归因/分级仍确定性；边界与兜底规则在代码中）。',
    placeholders: [
      { key: 'instrumentOptions', label: '可选量表清单 JSON', description: '含业务触发条件判断（该做/暂不需要/已做过）的白名单。' },
      { key: 'userText', label: '脱敏后的教师描述', description: '已脱敏的教师困扰描述。' }
    ]
  }
]

const promptRegistryMap = new Map(PROMPT_REGISTRY.map(item => [item.code, item]))

/** 提示词注册表列表（AI 中心只读展示用）：元数据 + 代码正文。 */
export function listPromptRegistry(): Array<PromptDefinition & { template: string | null }> {
  return PROMPT_REGISTRY.map(item => ({ ...item, template: getPromptBaseline(item.code) }))
}

/** 是否为已注册的提示词编码 */
export function isPromptCode(code: string): boolean {
  return promptRegistryMap.has(code)
}

/**
 * 取运行时生效的提示词正文：来自代码基线。
 * 未登记的编码返回 null，由调用点降级；保留 async 签名以兼容既有调用点。
 */
export async function getPromptTemplate(event: H3Event, code: string): Promise<string | null> {
  void event
  return getPromptBaseline(code)
}

/** 模板渲染（纯函数）：解析 ###SYSTEM###/###USER### 分段并替换 {{占位符}}。 */
export function renderTemplate(template: string, vars: Record<string, string>): RenderedPrompt {
  let system: string | null = null
  let user = template
  if (template.startsWith(SYSTEM_MARKER)) {
    const rest = template.slice(SYSTEM_MARKER.length)
    const userIdx = rest.indexOf(USER_MARKER)
    if (userIdx !== -1) {
      system = rest.slice(0, userIdx)
      user = rest.slice(userIdx + USER_MARKER.length)
    } else {
      system = rest
      user = ''
    }
  }
  const substitute = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? '')
  return {
    system: system === null ? null : substitute(system),
    user: substitute(user)
  }
}

/**
 * 渲染提示词正文并替换 {{占位符}}。
 * 未登记的编码返回 { system: null, user: null }（不抛错、不阻断请求），调用点按
 * 「该 AI 能力不可用」走确定性降级；缺失的占位符替换为空字符串。
 */
export async function renderPrompt(event: H3Event, code: string, vars: Record<string, string>): Promise<RenderedPrompt> {
  const template = await getPromptTemplate(event, code)
  if (!template) {
    if (!promptRegistryMap.has(code)) console.warn(`[ai-config] 未注册的提示词编码: ${code}`)
    else console.warn(`[ai-config] 提示词正文缺失，调用点降级: ${code}`)
    return { system: null, user: null }
  }
  return renderTemplate(template, vars)
}

/**
 * 某条提示词是否有可用的代码正文。
 * 调用点需要在渲染前判断（例如尚未拿到占位符内容）时使用。
 */
export async function isPromptPublished(event: H3Event, code: string): Promise<boolean> {
  void event
  return Boolean(getPromptBaseline(code))
}

/**
 * 提示词是否已配置出可用内容。
 * 返回 false 表示该调用点的 AI 能力当前不可用（正文缺失），
 * 调用点应走自己的确定性降级分支。
 */
export function promptAvailable(prompt: RenderedPrompt): boolean {
  return Boolean(prompt.system?.trim() || prompt.user?.trim())
}

/**
 * 运行时 AI 配置（当前恒为「无覆盖」）。
 *
 * 一律返回 null，由调用点回落环境变量与代码默认值：
 *  - 模型名/超时/embedding：nuxt.config.ts 的 runtimeConfig（环境变量）；
 *  - Agent 轮次、温度、工具：代码常量（server/agent/graph.ts、server/integrations/models.ts）；
 *  - Agent 行为要点：已合并进代码（server/agent/prompts.ts 的 buildFormatInstruction）。
 */
export async function getAiRuntimeConfig(event: H3Event): Promise<AiRuntimeConfig> {
  void event
  return {
    routerModel: null,
    generatorModel: null,
    timeoutMs: null,
    embeddingModel: null,
    embeddingEnabled: null
  }
}

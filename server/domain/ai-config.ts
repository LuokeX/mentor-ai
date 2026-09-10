/**
 * AI 配置层（AI 管理中心）。
 *
 * 提示词唯一来源是数据库 ai_prompt_templates：
 *  - 运行时只读「已发布」文本（published），在 AI 中心发布即热生效；
 *  - 代码不再内置任何提示词正文，只维护编码、名称、说明与占位符清单（PROMPT_REGISTRY）；
 *  - 某条提示词未配置（库中无记录或未发布）时，调用点按「该 AI 能力不可用」降级到
 *    确定性路径，不回退到任何代码内置文本；
 *  - 全新环境的初始文本由数据库迁移 drizzle/0050_prompt_template_baseline.sql 写入，
 *    之后所有修改都在平台后台 AI 中心完成，不需要发版。
 *
 * 运行时配置：DB（ai_runtime_settings）优先，NULL 回落环境变量；内存缓存，写端点显式失效。
 *
 * 模板语法：
 *  以 `###SYSTEM###\n` 开头的模板分为 system 段与 user 段（以 `###USER###\n` 分隔）；
 *  不含该标记的模板整体作为 user 消息。渲染后调用点自行决定消息 role。
 *
 * 缓存为进程内单实例假设（当前容器部署单副本成立）；多实例部署时需换共享缓存。
 */
import type { H3Event } from 'h3'
import { schema, useDb } from '../utils/db'

export interface PromptPlaceholder {
  key: string
  label: string
  description?: string
}

/** 提示词注册表（只有元数据，不含正文；正文一律存在数据库里）。 */
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
  /** Agent（回答先行）启用：null = 回落环境变量。 */
  agentEnabled: boolean | null
  /** Agent 工具轮次上限：null = 回落代码默认。 */
  agentMaxRounds: number | null
  /** Agent 采样温度：null = 回落代码默认。 */
  agentTemperature: number | null
  /** Agent 启用的工具名数组：null = 回落全部默认工具；空数组 = 禁用全部工具。 */
  agentTools: string[] | null
  /** Agent 行为补充要点：null = 未配置（不再回退代码文本）。 */
  agentBehaviorNotes: string | null
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
    code: 'clarification_judge',
    name: '首轮信息充分度判定提示词',
    description: '按需追问的入口判定：教师描述是否已足够清晰，足够则直接总结，不足才进入追问轮。',
    placeholders: [
      { key: 'userText', label: '脱敏后的教师输入', description: '已脱敏（电话/邮箱/人名/密钥）的教师描述文本。' },
      { key: 'historyText', label: '近轮对话历史', description: '本会话最近消息与跨会话实体记忆（可选）。' }
    ]
  },
  {
    code: 'clarification_round',
    name: '澄清追问提示词',
    description: '首页分诊多轮追问：每轮一个问题 + 2~4 个选项 + 内部模块评分。',
    placeholders: [
      { key: 'roundNumber', label: '追问轮次', description: '当前第几轮（最多 3 轮）。' },
      { key: 'previousScores', label: '上一轮模块评分', description: '上一轮内部模块评分；首轮为固定提示句。' },
      { key: 'knowledgeContext', label: '已审核知识片段', description: '检索到的已发布知识片段（仅了解业务范围）。' },
      { key: 'teacherProfile', label: '教师身份画像', description: '班主任/学科/任教年级等最小画像；无画像时为空。' }
    ]
  },
  {
    code: 'clarification_summary',
    name: '澄清总结提示词',
    description: '多轮追问结束后的总结：完整分析回复 + 路由 JSON 元数据。',
    placeholders: [
      { key: 'scoresContext', label: '上一轮模块评分', description: '用于汇总最终占比；首轮无评分为空。' },
      { key: 'knowledgeContext', label: '已审核知识片段', description: '检索到的已发布知识片段（仅参考方法论）。' },
      { key: 'teacherProfile', label: '教师身份画像', description: '班主任/学科/任教年级等最小画像；无画像时为空。' }
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
    code: 'rule_expression',
    name: '规则结论改写提示词',
    description: '把确定性规则结论改写成温和的教师支持表达（不改等级/规则/行动）。小超时（1500ms）由代码固定。',
    placeholders: [
      { key: 'facts', label: '规则执行结果 JSON', description: '模块、等级、原因、动作标题。' }
    ]
  },
  {
    code: 'module_router',
    name: '模块路由提示词',
    description: '首页分诊的路由决策：从未命中关键词路由的输入中判断主模块。',
    placeholders: [
      { key: 'userText', label: '脱敏后的教师输入', description: '已脱敏的原始文本。' }
    ]
  },
  {
    code: 'plan_update_extractor',
    name: '方案更新提取提示词',
    description: '从 AI 回复中提取方案执行状态更新意图（非阻塞，失败静默返回空）。小超时（3000ms）由代码固定。',
    placeholders: [
      { key: 'plansSummary', label: '当前方案状态 JSON', description: '教师名下方案标题/状态/动作摘要。' },
      { key: 'aiResponse', label: 'AI 助手回复', description: '本次 AI 回答文本（截 2000 字）。' }
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

/** 提示词注册表列表（管理页展示编码与占位符元数据用） */
export function listPromptRegistry(): PromptDefinition[] {
  return PROMPT_REGISTRY.map(item => ({ ...item }))
}

/** 是否为已注册的提示词编码 */
export function isPromptCode(code: string): boolean {
  return promptRegistryMap.has(code)
}

/** 进程内缓存：已发布提示词正文（TTL 30s，写端点显式失效） */
let promptCache: { at: number; data: Map<string, string | null> } | null = null
/** 进程内缓存：运行时配置（TTL 30s，写端点显式失效） */
let runtimeCache: { at: number; data: AiRuntimeConfig } | null = null
const RUNTIME_CACHE_TTL_MS = 30_000

/** 提示词/运行时配置写端点调用后失效缓存 */
export function invalidateAiConfigCache() {
  runtimeCache = null
  promptCache = null
}

/** 读取全部已发布提示词文本（DB 失败时返回空表，调用点按未配置降级）。 */
async function loadPublishedPrompts(event: H3Event): Promise<Map<string, string | null>> {
  const now = Date.now()
  if (promptCache && now - promptCache.at <= RUNTIME_CACHE_TTL_MS) return promptCache.data
  try {
    const rows = await useDb(event)
      .select({ code: schema.aiPromptTemplates.code, published: schema.aiPromptTemplates.published })
      .from(schema.aiPromptTemplates)
    promptCache = { at: now, data: new Map(rows.map(row => [row.code, row.published])) }
  } catch (error) {
    console.error('[ai-config] 读取提示词失败，按未配置降级:', error instanceof Error ? error.message : error)
    promptCache = { at: now, data: new Map() }
  }
  return promptCache.data
}

/**
 * 取运行时生效的提示词定稿：只认数据库「已发布」内容。
 * 未配置（无记录 / 未发布 / 库不可用）返回 null，由调用点降级，不回退代码文本。
 */
export async function getPromptTemplate(event: H3Event, code: string): Promise<string | null> {
  const published = (await loadPublishedPrompts(event)).get(code)
  return published && published.trim() ? published : null
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
 * 渲染已发布提示词并替换 {{占位符}}。
 * 未配置的编码返回 { system: null, user: null }（不抛错、不阻断请求），调用点按
 * 「该 AI 能力不可用」走确定性降级；缺失的占位符替换为空字符串。
 */
export async function renderPrompt(event: H3Event, code: string, vars: Record<string, string>): Promise<RenderedPrompt> {
  const template = await getPromptTemplate(event, code)
  if (!template) {
    if (!promptRegistryMap.has(code)) console.warn(`[ai-config] 未注册的提示词编码: ${code}`)
    else console.warn(`[ai-config] 提示词未配置或未发布，调用点降级: ${code}`)
    return { system: null, user: null }
  }
  return renderTemplate(template, vars)
}

/**
 * 某条提示词是否已在库中发布。
 * 调用点需要在渲染前判断（例如尚未拿到占位符内容）时使用。
 */
export async function isPromptPublished(event: H3Event, code: string): Promise<boolean> {
  return Boolean(await getPromptTemplate(event, code))
}

/**
 * 提示词是否已配置出可用内容。
 * 返回 false 表示该调用点的 AI 能力当前不可用（未发布/未配置/数据库不可用），
 * 调用点应走自己的确定性降级分支，不再使用任何代码内置文本。
 */
export function promptAvailable(prompt: RenderedPrompt): boolean {
  return Boolean(prompt.system?.trim() || prompt.user?.trim())
}

/**
 * 获取运行时 AI 配置：DB 单行字段优先，NULL 回落环境变量默认值。
 * 返回的对象只含 DB 覆盖值（null = 使用环境变量），调用点与 env 兜底组合。
 */
export async function getAiRuntimeConfig(event: H3Event): Promise<AiRuntimeConfig> {
  const empty: AiRuntimeConfig = {
    routerModel: null,
    generatorModel: null,
    timeoutMs: null,
    embeddingModel: null,
    embeddingEnabled: null,
    agentEnabled: null,
    agentMaxRounds: null,
    agentTemperature: null,
    agentTools: null,
    agentBehaviorNotes: null
  }
  try {
    const now = Date.now()
    if (!runtimeCache || now - runtimeCache.at > RUNTIME_CACHE_TTL_MS) {
      const [row] = await useDb(event).select().from(schema.aiRuntimeSettings).limit(1)
      runtimeCache = {
        at: now,
        data: row
          ? {
              routerModel: row.routerModel,
              generatorModel: row.generatorModel,
              timeoutMs: row.timeoutMs,
              embeddingModel: row.embeddingModel,
              embeddingEnabled: row.embeddingEnabled,
              agentEnabled: row.agentEnabled,
              agentMaxRounds: row.agentMaxRounds,
              agentTemperature: row.agentTemperature,
              agentTools: row.agentTools,
              agentBehaviorNotes: row.agentBehaviorNotes
            }
          : empty
      }
    }
    return runtimeCache.data
  } catch (error) {
    console.error('[ai-config] 读取运行时配置失败，使用环境变量:', error instanceof Error ? error.message : error)
    return empty
  }
}

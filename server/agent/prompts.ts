/**
 * Agent（回答先行）系统提示词构建。
 *
 * 模板文本来自数据库已发布提示词（ai_prompt_templates.published，AI 中心维护）：
 * 'assistant_chat' 即 Agent 的 system 提示词，运行时替换 {{占位符}}。
 * 代码不再内置模板正文；该条未配置或未发布时直接抛错，由调用入口回退到澄清总结路径。
 *
 * assistant_chat 模板的实际占位符只有三个：formatInstruction / knowledgeContext /
 * businessContextText（teacherProfileText 无独立占位符，按身份前缀并入 formatInstruction）。
 * 模板整体以 ###SYSTEM### 开头（无 ###USER### 段），渲染产物即 system 消息。
 */
import type { H3Event } from 'h3'
import { renderPrompt } from '../domain/ai-config'

export interface AgentSystemPromptInput {
  /** 已审核知识片段文本（可为降级提示句）；由调用方按模板知识段约定组装。 */
  knowledgeContext: string
  /** 当前业务对象上下文文本；null/空 表示未指定咨询对象。 */
  businessContextText?: string | null
  /** 教师画像（班主任/学科/任教年级，不含 PII）；无画像可不传。 */
  teacherProfileText?: string
}

/** 「回答先行」行为要点：与平台硬约束一致（无诊断、不碰确定性规则结论、知识引用边界）。 */
function buildFormatInstruction(input: { teacherProfileText?: string }): string {
  const identityText = input.teacherProfileText?.trim() ? `您是${input.teacherProfileText}。` : ''
  const behaviors = [
    '回答先行：根据教师描述与已装载的上下文直接给出当下可执行的回应，不要先发起多轮澄清追问；确有必要补充关键信息时，最多自然地追问一个最影响建议方向的问题。',
    '只输出给班主任看的自然语言回答，不输出 JSON、不输出字段名。回答温和简洁，一般 500 字以内，优先给出 1-3 个可执行动作。',
    '不做精神、医学、法律诊断，不承诺效果，不替代心理专员、医生、警方或校方制度。',
    '不计算量表分数，不确定六色预警、四阶、P×A、L1-L3，不决定熔断；这些由代码规则执行。',
    '已审核知识与工具结果是业务依据而非逐字答案：引用知识片段与工具返回结果时必须基于实际内容并标注来源；未命中时只能给通用沟通与行动建议，不得编造平台手册、量表、SOP、等级、制度、数据或来源。',
    '需要引导量表评估时通过 action 事件输出 recommend_assessment 量表推荐卡（module/assessmentCode/title/reason/ctaLabel），不要生成看似正式的工具原文。',
    '不复述姓名、电话、邮箱等个人信息，不扩大到其他教师或学生数据。'
  ].join('\n')
  return identityText ? `${identityText}\n${behaviors}` : behaviors
}

/**
 * 构建 Agent 的 system 提示词。
 * 提示词未配置或未发布时抛错（不再回退代码内置文本），由调用入口回退到澄清总结路径。
 */
export async function buildAgentSystemPrompt(event: H3Event, input: AgentSystemPromptInput): Promise<string> {
  const knowledgeContext = input.knowledgeContext.trim() || '没有检索到已发布知识。'
  const contextText = input.businessContextText?.trim() || '未指定咨询对象。'
  const formatInstruction = buildFormatInstruction({ teacherProfileText: input.teacherProfileText })

  const prompt = await renderPrompt(event, 'assistant_chat', {
    formatInstruction,
    knowledgeContext,
    businessContextText: contextText
  })

  const systemText = prompt.system?.trim()
  if (systemText) return systemText
  const userText = prompt.user?.trim()
  if (userText) return userText

  throw new Error('AI 助手提示词未配置或未发布（assistant_chat）')
}
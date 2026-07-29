import type { H3Event } from 'h3'
import { z } from 'zod'
import { routeDecisionSchema, type ClarificationRound, type ClarificationSummary, type RouteDecision } from '../../shared/contracts'
import type { KeywordRouteEntry, ModuleId, OutputTemplateEntry, RuleExecResult } from '../../shared/contracts'
import { assessmentReportSchema, type AssessmentReport } from '../../shared/reports'
import { assessmentDefinitions, moduleMeta, type AssessmentDefinition } from '../../shared/assessments'
import type { RuleOutput } from '../domain/rules'
import type { AssistantBusinessContext } from '../domain/assistant-context'
import { createTemplateAssessmentReport, validateAssessmentReport } from '../domain/reports'
import { resolvePublishedModuleResource } from '../domain/module-resources'
import { schema, useDb } from '../utils/db'

export interface KnowledgeCitation {
  chunkId: string
  documentTitle: string
  heading?: string | null
  excerpt?: string
  knowledgeBase: string
  module?: ModuleId
  libraryType?: string
  resourceTitle?: string
  resourceVersionId?: string
}

const keywordRoutes: Array<[RouteDecision['primaryModule'], RegExp]> = [
  ['home_school', /(家长|投诉|家长群|家校|沟通)/i],
  ['class_system', /(班级|纪律|班干部|班规|班风|秩序)/i],
  ['student_case', /(学生|孩子|同学|打架|情绪|不合群|走神)/i],
  ['learning_problem', /(学不|学不会|不想学|成绩|作业|考试|偏科|补习|厌学|听不懂|记不住)/i],
  ['self_growth', /(我很累|疲惫|压力|倦怠|无力|委屈|崩溃)/i]
]
const routeModules: ModuleId[] = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']

export function localRoute(text: string): RouteDecision {
  const matches = keywordRoutes.filter(([, regex]) => regex.test(text)).map(([module]) => module)
  const primaryModule = matches[0] || 'self_growth'
  return {
    primaryModule,
    secondaryModules: matches.slice(1, 3).map((module, index) => ({ module, confidence: 0.55 - index * 0.1 })),
    confidence: matches.length ? 0.76 : 0.5,
    needsClarification: !matches.length,
    clarification: !matches.length ? '这件事目前最困扰您的是自己的状态、班级运行、家长沟通，还是某位学生的表现？' : undefined,
    rationale: matches.length ? '根据描述中的场景主体与困扰重点进行规则路由。' : '信息不足，建议先确认主要困扰领域。'
  }
}

const assistantResponseSchema = z.object({
  answer: z.string().trim().min(10).max(5000),
  route: routeDecisionSchema,
  suggestedActions: z.array(z.object({
    label: z.string().trim().min(2).max(80),
    type: z.enum(['clarify', 'open_module', 'record', 'tool']),
    module: z.enum(['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']).optional()
  })).max(4).default([]),
  citationIds: z.array(z.string().uuid()).max(6).default([])
})

export type AssistantResponse = z.infer<typeof assistantResponseSchema> & { mode: 'deepseek' | 'local_fallback' }

function localAssistantResponse(text: string, citations: KnowledgeCitation[], businessContext?: AssistantBusinessContext | null): AssistantResponse {
  const route = localRoute(text)
  const objectText = businessContext ? `我已参考当前咨询对象“${businessContext.label}”的档案、沟通和历史方案摘要。` : ''
  const sourceText = citations.length
    ? `我参考了已发布的业务知识：${citations.slice(0, 2).map(item => `《${item.documentTitle}》${item.heading ? `“${item.heading}”` : ''}中与这个场景相关的片段`).join('；')}。`
    : '当前没有检索到足够相关的已发布知识，我会先基于通用班主任工作方法帮您梳理方向，不下业务分级或制度性结论。'
  const clarification = route.needsClarification && route.clarification ? ` ${route.clarification}` : ''
  return {
    answer: `${objectText}${sourceText} ${route.rationale}${clarification} 您可以先记录事实、区分情绪与诉求，再选择一个最小动作推进；如果需要等级、量表或 SOP 结论，请进入对应模块完成规则评估。`,
    route,
    suggestedActions: [{ label: '进入建议模块继续评估', type: 'open_module', module: route.primaryModule }],
    citationIds: citations.map(item => item.chunkId),
    mode: 'local_fallback'
  }
}

function buildAssistantMessages(input: {
  message: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  businessContext?: AssistantBusinessContext | null
  dataMode?: 'redacted' | 'full_context'
}, outputMode: 'json' | 'text') {
  const knowledgeContext = input.citations.length
    ? input.citations.map(item => {
        const resourceMeta = item.module && item.libraryType
          ? `模块：${item.module}；资源类型：${item.libraryType}；资源库：${item.resourceTitle || item.knowledgeBase}${item.resourceVersionId ? `；资源版本：${item.resourceVersionId}` : ''}`
          : `知识库：${item.knowledgeBase}`
        return `[${item.chunkId}] ${resourceMeta}\n来源：${item.documentTitle}${item.heading ? ` / ${item.heading}` : ''}\n${item.excerpt}`
      }).join('\n\n')
    : '没有检索到已发布知识。此时可以基于通用班主任工作方法进行共情、澄清、问题拆解和非制度性行动建议；不得编造平台手册、量表、SOP、等级、制度或来源。'
  const businessContextText = input.businessContext
    ? `当前咨询对象：${input.businessContext.type} / ${input.businessContext.label}\n${input.businessContext.prompt}`
    : '未指定咨询对象。'
  const formatInstruction = outputMode === 'json'
    ? '输出严格 json。JSON 格式：{"answer":"...","route":{"primaryModule":"home_school","secondaryModules":[],"confidence":0.8,"needsClarification":false,"rationale":"..."},"suggestedActions":[{"label":"...","type":"open_module","module":"home_school"}],"citationIds":["知识片段UUID"]}'
    : '直接输出给班主任看的自然语言回答，不要输出 JSON，不要输出字段名。回答控制在 500 字以内，优先给 1–3 个可执行动作。'
  return [
    {
      role: 'system',
      content: `你是“教师赋能智能平台”的统一 AI 助手，服务班主任。业务模块只有 self_growth、class_system、home_school、student_case、learning_problem。
你的职责：理解教师自然语言、进行多轮澄清、结合已审核知识和通用班主任工作方法给出当下可执行建议，并建议进入合适模块。
硬约束：
1. 不做精神、医学、法律诊断，不承诺效果，不替代心理专员、医生、警方或校方制度。
2. 不计算量表分数，不确定六色预警、四阶、P×A、L1-L3，不决定熔断；这些由代码规则执行。
3. 知识片段是业务依据，不是逐字答案。可以根据教师问题自主组织回答、做场景分析、提出澄清问题和通用建议。
4. 涉及平台规则、量表、分级、SOP、红线、校内制度、工具卡原文或“平台要求”时，必须基于下方知识片段或建议进入模块评估；知识不足时明确说明“需要进入模块或补充业务知识后确认”。
5. 不能杜撰手册、SOP、等级、数据、来源或校方制度。引用来源时只能引用下方知识片段。
6. 回答温和、简洁；需要追问时每轮最多问一个关键问题。
7. 不复述姓名、电话、邮箱等个人信息，不扩大到其他教师或学生数据。
8. 上下文中的方案(recentPlans)包含执行动作(actions)及其状态。可引用方案进度，根据教师反馈在回答中建议更新方案状态。
9. 如果提供了“当前业务对象上下文”，可以结合其中的学生/班级/家长/沟通/历史方案摘要进行分析，但不能暴露完整电话等隐私字段，不能推断上下文之外的个人信息。
10. 工具、SOP、制度、分级、量表、红线和平台要求属于强约束资源：没有命中对应已发布资源时，只能给通用沟通建议，不能说“平台规定”“工具库要求”或生成看似正式的工具原文。
11. ${formatInstruction}

已审核知识：
${knowledgeContext}

当前业务对象上下文：
${businessContextText}`
    },
    ...input.history.slice(-8).map(item => ({ role: item.role, content: sanitizeModelText(item.content, input.dataMode).slice(0, 2500) })),
    { role: 'user', content: sanitizeModelText(input.message, input.dataMode) }
  ]
}

// ---- AI 追问与分类机制 ----

function buildClarificationPrompt(input: {
  message: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  clarificationRound: number
  previousModuleScores?: Record<string, number>
}) {
  const knowledgeContext = input.citations.length
    ? input.citations.map(item => `[${item.chunkId}] 来源：${item.documentTitle}${item.heading ? ` / ${item.heading}` : ''}\n${item.excerpt}`).join('\n\n')
    : '没有检索到已发布知识。'
  const previousScores = input.previousModuleScores
    ? `参考：上一轮内部模块评分 ${JSON.stringify(input.previousModuleScores)}（仅用于内部记录，不影响追问方向和选项设计。）`
    : '这是第一轮追问，暂无历史模块评分。'

  return [
    {
      role: 'system',
      content: `你是"教师赋能智能平台"的追问助手。当前处于**问题澄清阶段（第${input.clarificationRound}轮）**，系统最多允许 3 轮追问，你的唯一职责是通过追问帮助教师明确问题方向。

硬约束：
1. **禁止给出任何建议、诊断或解决方案**。这个阶段你只做追问和方向确认。
2. 每轮输出一个追问问题 + 2~4个选项。**提问优先用开放式场景问题**（如"最近一次是什么情况？""当时发生了什么？"），鼓励教师用自己的话描述具体场景。选项只是列举几种教师**可能遇到过的典型场景**作为参考，教师完全可以忽略选项、在输入框自由打字。
3. **选项必须是具体的场景或感受描述，而不是分类标签**。好的选项："连续几天睡不好，上课硬撑""被家长一句话说得心凉了半截"。坏的选项："自己的状态和感受""班级管理秩序"（这是把模块名翻译了一下，毫无意义）。
4. **禁止选项之间含义重叠**。每个选项应该指向明显不同的情况，不要出现"容易累"和"感觉很累"这种近义选项。
5. **后续轮次追问原则（最重要的一条）**。第2、3轮必须基于对话历史中教师在上一轮选择或输入的具体内容，像剥洋葱一样深入追问该方向的细节。**绝对不能**回到通用开放问题或模块分类。

   反例（第2、3轮禁止这样做）：
   - 问题又是"这件事给你带来最大的影响是什么？"（回到通用开放问题）
   - 问题又是"你自己觉得主要困扰哪个方面？"（回到分类）
   - 选项又是 ["睡眠和精力","班级管理","家长沟通","学生情况"] 这种分类标签（毫无意义，等于没问）

   正例（教师上一轮选了"连着几天睡不好"后的深入追问）：
   问题："这种睡不好的状态大概持续多久了？是入睡困难还是容易早醒？"
   选项：["最近一两周才开始的","已经持续一两个月了","入睡困难，躺床上脑子停不下来","半夜或凌晨醒，醒了就睡不着","睡眠很浅，一晚上醒好几次"]

   正例（教师上一轮选了"家长说话不客气"后的深入追问）：
   问题："当时家长是在什么场合跟你说的？"
   选项：["班级微信群里，当着其他家长的面","单独打电话给我，语气很冲","来学校当面找我谈的","通过班主任或孩子传话，没直接跟我说"]
6. 同时评估5个业务模块（self_growth/class_system/home_school/student_case/learning_problem）与当前问题的相关性，给出0-1评分。这个评分仅用于系统内部分析，不在追问中展示。
7. 模块评分基于教师所有轮次的回答综合判断，本轮评分在前一轮基础上调整。评分规则：0=无关，0.3=微弱关联，0.5=中等，0.7=明显相关，1.0=强相关。总分不要求为1。
8. 追问语气自然，像同事聊天。选项措辞口语化，用教师日常会说的话。
9. 若当前是第3轮（最后一轮），追问中体现收束总结的语气。

输出格式：先直接输出追问问题纯文本（10-40字，直接对教师发问），然后输出分隔符 <!--JSON-->，然后输出 JSON 元数据。

**重要：不要在问题文本后面追加"选项：..."开头的选项列表。用户可见的选项按钮由系统根据JSON元数据自动生成，你只需把选项写在JSON的options字段里。**

以上所有正例和反例仅供参考追问方向，不要逐字照抄，必须根据对话历史中教师的实际回答来生成追问。

示例（第1轮，教师说"最近工作压力很大"）：
最近一次让你觉得特别累或者特别烦的，是什么事？
<!--JSON-->
{"options":["连着几天睡不好，白天上课硬撑着","班上几个学生同时出问题，感觉应付不过来","刚开完家长会，有家长说话不太客气","有个学生情况特殊，越想越不知道怎么帮他","好像没有具体的事，就是整个人很疲惫"],"moduleScores":{"self_growth":0.5,"class_system":0.3,"home_school":0.4,"student_case":0.4,"learning_problem":0.2}}

示例（第2轮，教师上一轮描述了和家长沟通的问题）：
当时那位家长说了什么让你印象最深的话？或者做了什么让你觉得不太舒服？
<!--JSON-->
{"options":["在班级群里公开质疑我的做法","私下找我谈话时语气很冲","觉得我对他孩子不公平，反复提要求","倒没有具体冲突，就是每次沟通都很消耗我"],"moduleScores":{"self_growth":0.2,"class_system":0.1,"home_school":0.8,"student_case":0.3,"learning_problem":0.1}}

${previousScores}

（第3轮示例：若教师第2轮选了"入睡困难，躺床上脑子停不下来"，则需要收束追问——"听起来脑子里转的事不少。闭眼的时候最常想到的是什么？是某个具体的学生、某件事，还是整体的责任感？" 选项：["有个行为习惯特别难管的学生，天天都得跟他较劲","班上最近出了几次突发状况，心里总悬着","某个学生的学习成绩一直往下掉","倒不是具体哪个学生，就是总觉得自己做得不够好"] 模块评分示例：{"self_growth":0.3,"class_system":0.2,"home_school":0.1,"student_case":0.2,"learning_problem":0.2}）

已审核知识（仅供了解业务范围，不直接引用）：
${knowledgeContext}`
    },
    ...input.history.slice(-12).map(item => ({ role: item.role, content: item.content.slice(0, 2000) })),
    { role: 'user', content: input.message.slice(0, 2000) }
  ]
}

function buildSummaryPrompt(input: {
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  lastModuleScores?: Record<string, number>
}) {
  const knowledgeContext = input.citations.length
    ? input.citations.map(item => `[${item.chunkId}] 来源：${item.documentTitle}${item.heading ? ` / ${item.heading}` : ''}\n${item.excerpt}`).join('\n\n')
    : '没有检索到已发布知识。'
  const scoresContext = input.lastModuleScores
    ? `上一轮模块评分：${JSON.stringify(input.lastModuleScores)}。请在此基础上汇总最终占比。`
    : ''

  return [
    {
      role: 'system',
      content: `你是"教师赋能智能平台"的总结助手。现在是**问题澄清结束后的总结阶段**。教师已通过多轮追问明确了问题方向，现在你需要基于所有对话历史，生成一个完整的分析回复。

你需要输出两部分内容，**必须严格按照以下格式**：

第一部分：直接输出给教师的完整分析回复（纯文本，500-1500字），不要任何 JSON 包裹。结构如下：
1. 用1-2句话概括你理解到的教师的困扰和处境（表达共情）
2. 基于追问中收集的信息，对教师面临的问题做深入分析——这是最重要的部分。结合教师描述的具体情境，从多个维度剖析问题所在，不要泛泛而谈标签式的"压力大""沟通困难"
3. 给出3-5条具体、可执行的建议或思路。每条建议要基于教师的具体情况，结合知识库中的方法论但不照搬原文。建议中如果提到平台工具，用自然的方式引导（如"平台上有XX量表可以帮你系统梳理YY问题"），不要机械地说"请进入XX模块"

然后紧跟着输出分隔符 <!--JSON-->，然后输出用于系统路由的 JSON 元数据：
{"rationale":"一句话概括（50字内）","primaryModule":"self_growth","moduleProportions":{"self_growth":0.4,"class_system":0.2,"home_school":0.1,"student_case":0.2,"learning_problem":0.1},"suggestedActions":[{"label":"先做一次压力与应对资源评估","type":"open_module","module":"self_growth"}]}

硬约束：
1. answer 部分必须是一段完整的、可直接发给教师看的回复，语气温和、有共情、有实质内容
2. 不做精神、医学、法律诊断；不计算量表分数
3. 不照搬知识库原文，用自己的话组织
4. 不要在answer里反复说"建议进入XX模块"——这是系统内部的路由信息，已经放在JSON里了。answer要聚焦于分析教师的具体处境和给出可操作的建议。如果确实需要提及平台工具，用"平台上有XX评估可以帮你梳理YY问题"这种自然表述，而不是"请进入XX模块"
5. 分隔符必须是 <!--JSON-->（前后不带空格），JSON 必须严格有效、单行或紧凑多行均可
6. moduleProportions 总和必须为1

${scoresContext}

已审核知识（供参考方法论，不照搬原文）：
${knowledgeContext}`
    },
    ...input.history.slice(-10).map(item => ({ role: item.role, content: item.content.slice(0, 1200) }))
  ]
}

/**
 * 流式调用 DeepSeek 进行追问，实时推送 question 内容，返回解析后的 ClarificationRound。
 */
export async function streamClarificationRound(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  sessionId: string
  message: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  clarificationRound: number
  previousModuleScores?: Record<string, number>
  onDelta: (text: string) => void
}): Promise<{ data: ClarificationRound; fallback: boolean }> {
  const config = useRuntimeConfig(event)
  const defaultScores: Record<string, number> = { self_growth: 0.3, class_system: 0.3, home_school: 0.2, student_case: 0.1, learning_problem: 0.1 }
  const fallback: ClarificationRound = {
    type: 'clarification',
    round: input.clarificationRound,
    question: '根据您目前描述的情况，这件事最核心困扰您的是哪一个方面？',
    options: ['自己的状态和感受', '班级管理和秩序', '与家长的沟通', '某位学生的表现', '学生学业问题'],
    moduleScores: input.previousModuleScores || defaultScores as ClarificationRound['moduleScores']
  }

  if (!config.deepseekApiKey) {
    for (const chunk of fallback.question.match(/[\s\S]{1,18}/g) || [fallback.question]) input.onDelta(chunk)
    return { data: fallback, fallback: true }
  }

  const startedAt = Date.now()
  const messages = buildClarificationPrompt({
    message: input.message,
    history: input.history,
    citations: input.citations,
    clarificationRound: input.clarificationRound,
    previousModuleScores: input.previousModuleScores
  })

  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: config.deepseekGeneratorModel,
        messages,
        stream: true,
        thinking: { type: 'disabled' },
        temperature: 0.4
      }),
      signal: AbortSignal.timeout(Number(config.deepseekTimeoutMs) || 8000)
    })
    if (!response.ok || !response.body) throw new Error(`DeepSeek ${response.status}`)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') continue
        try {
          const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
          const token = parsed.choices?.[0]?.delta?.content
          if (!token) continue
          fullText += token
          const sepIdx = fullText.indexOf('<!--JSON-->')
          if (sepIdx === -1) {
            input.onDelta(token)
          } else {
            const tokenStartInFull = fullText.length - token.length
            if (tokenStartInFull < sepIdx) {
              const visiblePart = token.slice(0, Math.max(0, sepIdx - tokenStartInFull))
              if (visiblePart) input.onDelta(visiblePart)
            }
          }
        } catch { /* 跳过非 JSON 行 */ }
      }
    }

    const sepIndex = fullText.indexOf('<!--JSON-->')
    let question: string
    let jsonPart: string
    if (sepIndex !== -1) {
      question = fullText.slice(0, sepIndex).trim()
      jsonPart = fullText.slice(sepIndex + '<!--JSON-->'.length).trim()
    } else {
      question = fullText.trim()
      jsonPart = ''
      const lastBrace = fullText.lastIndexOf('{')
      if (lastBrace !== -1) {
        question = fullText.slice(0, lastBrace).trim()
        jsonPart = fullText.slice(lastBrace).trim()
      }
    }

    if (!question || question.length < 4) throw new Error('模型追问内容为空或过短')

    // 防止模型把选项列表写在问题文本里（应放在 JSON 元数据中）
    // 但模型有时仍然会把选项写在"选项："后面，此时保留剥离的文本用于兜底
    let strippedOptionsText = ''
    const optionDelimIdx = question.indexOf('选项：')
    if (optionDelimIdx !== -1) {
      strippedOptionsText = question.slice(optionDelimIdx + '选项：'.length).trim()
      question = question.slice(0, optionDelimIdx).trim()
    }

    let jsonMeta: { options?: string[]; moduleScores?: Record<string, number> } = {}
    if (jsonPart) {
      // 从 jsonPart 中提取 JSON 对象，容忍模型在 JSON 后附带多余文本
      const firstBrace = jsonPart.indexOf('{')
      if (firstBrace !== -1) {
        // 从第一个 { 开始找匹配的 }
        let depth = 0
        let endIdx = -1
        for (let i = firstBrace; i < jsonPart.length; i++) {
          if (jsonPart[i] === '{') depth++
          if (jsonPart[i] === '}') depth--
          if (depth === 0) { endIdx = i; break }
        }
        if (endIdx !== -1) {
          const jsonBlock = jsonPart.slice(firstBrace, endIdx + 1)
          try { jsonMeta = JSON.parse(jsonBlock) } catch (e) {
            console.error('[clarification_round] JSON 解析失败:', e instanceof Error ? e.message : e, '\n原始 jsonBlock 前300字符:', jsonBlock.slice(0, 300), '\n完整 fullText 后500字符:', fullText.slice(-500))
          }
        } else {
          console.error('[clarification_round] JSON 括号不匹配, jsonPart 前300字符:', jsonPart.slice(0, 300), '\n完整 fullText:', fullText)
        }
      } else {
        console.error('[clarification_round] jsonPart 中未找到 JSON 对象, jsonPart 前300字符:', jsonPart.slice(0, 300), '\n完整 fullText:', fullText)
      }
    }

    // 如果 JSON 中没有 options，尝试从问题文本中剥离的"选项："部分解析
    const parseOptionsFromText = (text: string): string[] => {
      if (!text) return []
      // 按顿号、逗号或中文逗号拆分
      const raw = text.split(/[、，,\n]/).map(s => s.trim()).filter(Boolean)
      // 限制每项长度，过滤明显不是选项的片段
      return raw.filter(s => s.length >= 2 && s.length <= 60)
    }
    const textOptions = parseOptionsFromText(strippedOptionsText)

    const parsed: ClarificationRound = {
      type: 'clarification',
      round: input.clarificationRound,
      question: question.slice(0, 200),
      options: (jsonMeta.options && jsonMeta.options.length ? jsonMeta.options : textOptions.length ? textOptions : fallback.options).slice(0, 6),
      moduleScores: (jsonMeta.moduleScores || input.previousModuleScores || defaultScores) as ClarificationRound['moduleScores']
    }

    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'clarification_round',
      status: 'success',
      latencyMs: Date.now() - startedAt
    }).catch(() => undefined)
    return { data: parsed, fallback: false }
  } catch (error) {
    console.error('[clarification_round] DeepSeek 调用失败:', error instanceof Error ? error.message : error)
    for (const chunk of fallback.question.match(/[\s\S]{1,18}/g) || [fallback.question]) input.onDelta(chunk)
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'clarification_round',
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown'
    }).catch(() => undefined)
    return { data: fallback, fallback: true }
  }
}

/**
 * 流式调用 DeepSeek 进行总结，实时推送 answer 内容，返回解析后的 ClarificationSummary。
 */
export async function streamClarificationSummary(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  sessionId: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  lastModuleScores?: Record<string, number>
  onDelta: (text: string) => void
}): Promise<{ data: ClarificationSummary; fallback: boolean }> {
  const config = useRuntimeConfig(event)
  const fallback: ClarificationSummary = {
    type: 'summary',
    answer: '从您描述的情况来看，作为教师您所承担的责任和压力是真实的，这些感受值得被认真对待。您目前遇到的困扰涉及多个层面，我们可以先梳理清楚这些困扰之间的关系，找到最需要优先应对的那个点。平台上有一套系统的评估和分析工具，可以帮助您更清晰地看见问题全貌，从而找到具体的应对方向。',
    rationale: '教师面临多方面困扰，需要先梳理优先级再深入评估。',
    primaryModule: 'self_growth',
    moduleProportions: { self_growth: 0.25, class_system: 0.2, home_school: 0.15, student_case: 0.25, learning_problem: 0.15 },
    suggestedActions: [{ label: '梳理当前困扰的优先级', type: 'open_module', module: 'self_growth' }]
  }

  if (!config.deepseekApiKey) {
    for (const chunk of fallback.answer.match(/[\s\S]{1,18}/g) || [fallback.answer]) input.onDelta(chunk)
    return { data: fallback, fallback: true }
  }

  const startedAt = Date.now()
  const messages = buildSummaryPrompt({
    history: input.history,
    citations: input.citations,
    lastModuleScores: input.lastModuleScores
  })

  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: config.deepseekGeneratorModel,
        messages,
        max_tokens: 4096,
        stream: true,
        thinking: { type: 'disabled' },
        temperature: 0.35
      }),
      signal: AbortSignal.timeout(Number(config.deepseekTimeoutMs) || 45000)
    })
    if (!response.ok || !response.body) throw new Error(`DeepSeek ${response.status}`)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') continue
        try {
          const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
          const token = parsed.choices?.[0]?.delta?.content
          if (!token) continue
          fullText += token
          // 遇到分隔符之前的内容实时推送为 answer_delta
          const sepIdx = fullText.indexOf('<!--JSON-->')
          if (sepIdx === -1) {
            input.onDelta(token)
          } else {
            // 分隔符已出现：只推送分隔符之前尚未发送的部分
            const beforeSep = fullText.slice(0, sepIdx)
            const alreadySent = fullText.length - token.length <= sepIdx
              ? beforeSep.length - (fullText.length - token.length)
              : 0
            // 简化处理：计算本次 token 中属于分隔符之前的部分
            const tokenStartInFull = fullText.length - token.length
            if (tokenStartInFull < sepIdx) {
              const visiblePart = token.slice(0, Math.max(0, sepIdx - tokenStartInFull))
              if (visiblePart) input.onDelta(visiblePart)
            }
          }
        } catch { /* 跳过非 JSON 行 */ }
      }
    }

    // 解析完整文本，提取 answer 和 JSON
    const sepIndex = fullText.indexOf('<!--JSON-->')
    let answer: string
    let jsonPart: string
    if (sepIndex !== -1) {
      answer = fullText.slice(0, sepIndex).trim()
      jsonPart = fullText.slice(sepIndex + '<!--JSON-->'.length).trim()
    } else {
      // 模型没有输出分隔符，把全文当 answer，尝试从末尾提取 JSON
      answer = fullText.trim()
      jsonPart = ''
      const lastBrace = fullText.lastIndexOf('{')
      if (lastBrace !== -1) {
        answer = fullText.slice(0, lastBrace).trim()
        jsonPart = fullText.slice(lastBrace).trim()
      }
    }

    if (!answer || answer.length < 20) {
      // 模型可能未输出分隔符或把 JSON 放在了前面，回退使用完整响应文本
      if (fullText.length >= 20) {
        answer = fullText.trim()
        console.warn('[clarification_summary] 解析出的 answer 过短 (length=%d)，退回到使用 fullText (length=%d)', answer.length, fullText.length)
      } else {
        throw new Error('模型总结回答为空或过短')
      }
    }

    let jsonMeta: { rationale?: string; primaryModule?: string; moduleProportions?: Record<string, number>; suggestedActions?: Array<{ label: string; type: string; module?: string }> } = {}
    if (jsonPart) {
      const firstBrace = jsonPart.indexOf('{')
      if (firstBrace !== -1) {
        let depth = 0
        let endIdx = -1
        for (let i = firstBrace; i < jsonPart.length; i++) {
          if (jsonPart[i] === '{') depth++
          if (jsonPart[i] === '}') depth--
          if (depth === 0) { endIdx = i; break }
        }
        if (endIdx !== -1) {
          const jsonBlock = jsonPart.slice(firstBrace, endIdx + 1)
          try { jsonMeta = JSON.parse(jsonBlock) } catch (e) {
            console.error('[clarification_summary] JSON 解析失败:', e instanceof Error ? e.message : e, '\n原始 jsonBlock 前200字符:', jsonBlock.slice(0, 200))
          }
        } else {
          console.error('[clarification_summary] JSON 括号不匹配, jsonPart 前200字符:', jsonPart.slice(0, 200))
        }
      } else {
        console.error('[clarification_summary] jsonPart 中未找到 JSON 对象, jsonPart 前200字符:', jsonPart.slice(0, 200))
      }
    }

    const parsed: ClarificationSummary = {
      type: 'summary',
      answer: answer.slice(0, 2000),
      rationale: jsonMeta.rationale || answer.slice(0, 50),
      primaryModule: (jsonMeta.primaryModule || 'self_growth') as ClarificationSummary['primaryModule'],
      moduleProportions: jsonMeta.moduleProportions || { self_growth: 0.25, class_system: 0.2, home_school: 0.15, student_case: 0.25, learning_problem: 0.15 },
      suggestedActions: (jsonMeta.suggestedActions || [{ label: '进入自我成长模块评估', type: 'open_module', module: 'self_growth' }]).slice(0, 4) as ClarificationSummary['suggestedActions']
    }

    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'clarification_summary',
      status: 'success',
      latencyMs: Date.now() - startedAt
    }).catch(() => undefined)
    return { data: parsed, fallback: false }
  } catch (error) {
    console.error('[clarification_summary] DeepSeek 调用失败:', error instanceof Error ? error.message : error)
    // 失败时也用流式推送 fallback
    for (const chunk of fallback.answer.match(/[\s\S]{1,18}/g) || [fallback.answer]) input.onDelta(chunk)
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'clarification_summary',
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown'
    }).catch(() => undefined)
    return { data: fallback, fallback: true }
  }
}

export async function streamAssistantResponse(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  sessionId: string
  message: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  businessContext?: AssistantBusinessContext | null
  dataMode?: 'redacted' | 'full_context'
  contextType?: string
  noticeVersion?: string
  forceLocal?: boolean
  onDelta: (text: string) => void | Promise<void>
}): Promise<AssistantResponse> {
  const config = useRuntimeConfig(event)
  const fallback = localAssistantResponse(input.message, input.citations, input.businessContext)
  const suggestedActions = [{ label: '进入建议模块继续评估', type: 'open_module' as const, module: localRoute(input.message).primaryModule }]
  if (!config.deepseekApiKey || input.forceLocal) {
    for (const chunk of fallback.answer.match(/[\s\S]{1,18}/g) || [fallback.answer]) await input.onDelta(chunk)
    return fallback
  }

  const startedAt = Date.now()
  let answer = ''
  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: config.deepseekGeneratorModel,
        messages: buildAssistantMessages(input, 'text'),
        stream: true,
        thinking: { type: 'disabled' },
        temperature: 0.35
      }),
      signal: AbortSignal.timeout(Number(config.deepseekTimeoutMs) || 12000)
    })
    if (!response.ok || !response.body) throw new Error(`DeepSeek ${response.status}`)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() || ''
      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
          const delta = parsed.choices?.[0]?.delta?.content || ''
          if (!delta) continue
          answer += delta
          await input.onDelta(delta)
        }
      }
    }
    if (answer.trim().length < 10) throw new Error('Empty streamed model output')
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'assistant_answer_stream',
      status: 'success',
      latencyMs: Date.now() - startedAt,
      dataMode: input.forceLocal ? 'local' : input.dataMode,
      contextType: input.contextType,
      noticeVersion: input.noticeVersion
    }).catch(() => undefined)
    const route = localRoute(input.message)
    return {
      answer: answer.trim(),
      route,
      suggestedActions,
      citationIds: input.citations.slice(0, 4).map(item => item.chunkId),
      mode: 'deepseek'
    }
  } catch (error) {
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'assistant_answer_stream',
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown',
      dataMode: input.dataMode,
      contextType: input.contextType,
      noticeVersion: input.noticeVersion
    }).catch(() => undefined)
    if (!answer) {
      for (const chunk of fallback.answer.match(/[\s\S]{1,18}/g) || [fallback.answer]) await input.onDelta(chunk)
      return fallback
    }
    const route = localRoute(input.message)
    return { answer: answer.trim(), route, suggestedActions, citationIds: input.citations.slice(0, 4).map(item => item.chunkId), mode: 'deepseek' }
  }
}

export async function generateAssistantResponse(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  sessionId: string
  message: string
  history: Array<{ role: 'user' | 'assistant', content: string }>
  citations: KnowledgeCitation[]
  businessContext?: AssistantBusinessContext | null
}): Promise<AssistantResponse> {
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return localAssistantResponse(input.message, input.citations, input.businessContext)

  const allowedCitationIds = new Set(input.citations.map(item => item.chunkId))
  const messages = buildAssistantMessages(input, 'json')

  for (let attempt = 0; attempt < 2; attempt++) {
    const startedAt = Date.now()
    try {
      const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: config.deepseekGeneratorModel,
          messages,
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          temperature: 0.25
        }),
        signal: AbortSignal.timeout(Number(config.deepseekTimeoutMs) || 8000)
      })
      if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
      const json = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number, completion_tokens?: number }
      }
      const content = json.choices?.[0]?.message?.content
      if (!content) throw new Error('Empty model output')
      const parsed = assistantResponseSchema.parse(JSON.parse(content))
      parsed.citationIds = parsed.citationIds.filter(id => allowedCitationIds.has(id))
      await useDb(event).insert(schema.aiModelCalls).values({
        schoolId: input.schoolId,
        ownerUserId: input.ownerUserId,
        sessionId: input.sessionId,
        provider: 'deepseek',
        model: config.deepseekGeneratorModel,
        purpose: 'assistant_answer',
        status: 'success',
        latencyMs: Date.now() - startedAt,
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens
      }).catch(() => undefined)
      return { ...parsed, mode: 'deepseek' }
    } catch (error) {
      await useDb(event).insert(schema.aiModelCalls).values({
        schoolId: input.schoolId,
        ownerUserId: input.ownerUserId,
        sessionId: input.sessionId,
        provider: 'deepseek',
        model: config.deepseekGeneratorModel,
        purpose: 'assistant_answer',
        status: 'failed',
        latencyMs: Date.now() - startedAt,
        errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown'
      }).catch(() => undefined)
      if (attempt === 1) return localAssistantResponse(input.message, input.citations, input.businessContext)
    }
  }
  return localAssistantResponse(input.message, input.citations, input.businessContext)
}

export function redactPii(text: string) {
  return text
    .replace(/1[3-9]\d{9}/g, '[PHONE]')
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]')
    .replace(/([\u4e00-\u9fa5]{1,4})(老师|同学|妈妈|爸爸|家长)/g, '[PERSON]$2')
}

function sanitizeModelText(text: string, mode: 'redacted' | 'full_context' = 'redacted') {
  const withoutContacts = text
    .replace(/1[3-9]\d{9}/g, '[PHONE]')
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[SYSTEM_ID]')
    .replace(/(?:密码|密钥|token|secret|totp)\s*[:：=]?\s*\S+/gi, '[SECRET]')
  return mode === 'full_context' ? withoutContacts : redactPii(withoutContacts)
}

const semanticRiskSchema = z.object({
  risks: z.array(z.enum(['suicide', 'self_harm', 'violence', 'abuse', 'threat'])).max(5)
})

const riskRuleIds: Record<z.infer<typeof semanticRiskSchema>['risks'][number], string> = {
  suicide: 'SAFE-SEMANTIC-SUICIDE',
  self_harm: 'SAFE-SEMANTIC-SELF-HARM',
  violence: 'SAFE-SEMANTIC-VIOLENCE',
  abuse: 'SAFE-SEMANTIC-ABUSE',
  threat: 'SAFE-SEMANTIC-THREAT'
}

export async function semanticSafetySignals(event: H3Event, text: string, forceLocal = false) {
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey || forceLocal) return []
  const redacted = redactPii(text)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: config.deepseekRouterModel,
          messages: [
            { role: 'system', content: '你只做安全信号辅助识别，不做诊断。只返回 JSON。' },
            { role: 'user', content: `识别文本是否明确或隐含涉及自杀、自伤、暴力、虐待或威胁。没有则 risks 为空。文本：${redacted}` }
          ],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' }, temperature: 0
        }),
        signal: AbortSignal.timeout(1500)
      })
      if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
      const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = json.choices?.[0]?.message?.content
      if (!content) throw new Error('Empty model output')
      return semanticRiskSchema.parse(JSON.parse(content)).risks.map(risk => riskRuleIds[risk])
    } catch {
      if (attempt === 1) return []
    }
  }
  return []
}

const expressionSchema = z.object({ summary: z.string().trim().min(10).max(500) })

export async function expressRuleResult(event: H3Event, module: string, result: RuleOutput) {
  const fallback = result.reasons.join('；')
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return fallback
  const facts = JSON.stringify({ module, level: result.level, reasons: result.reasons, actions: result.actions.map(item => item.title) })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: config.deepseekGeneratorModel,
          messages: [
            { role: 'system', content: '把确定性规则结论改写成温和、简洁、非诊断性的教师支持表达。不得改变等级、规则或行动，不得新增事实。只返回 JSON。' },
            { role: 'user', content: `${facts}\n返回格式：{"summary":"..."}` }
          ],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' }, temperature: 0.3
        }),
        signal: AbortSignal.timeout(1500)
      })
      if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
      const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = json.choices?.[0]?.message?.content
      if (!content) throw new Error('Empty model output')
      const summary = expressionSchema.parse(JSON.parse(content)).summary
      if (/(确诊|保证治愈|一定是|医学诊断)/i.test(summary)) throw new Error('Forbidden semantics')
      return summary
    } catch {
      if (attempt === 1) return fallback
    }
  }
  return fallback
}

export async function generateAssessmentReport(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  module: ModuleId
  result: RuleExecResult
  definition?: AssessmentDefinition
}): Promise<AssessmentReport> {
  const definition = input.definition || assessmentDefinitions[input.module]
  const outputTemplateResource = await resolvePublishedModuleResource<{ templates?: OutputTemplateEntry[] }>(event, {
    module: input.module,
    libraryType: 'output_template',
    schoolId: input.schoolId
  }).catch(() => null)
  const outputTemplates = Array.isArray(outputTemplateResource?.payload?.templates)
    ? outputTemplateResource.payload.templates
    : []
  const fallback = createTemplateAssessmentReport({ module: input.module, result: input.result, definition, outputTemplates })
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey || input.result.blocked) return fallback
  const facts = {
    module: input.module,
    moduleTitle: moduleMeta[input.module].title,
    assessmentVersion: `${definition.code}@${definition.version}`,
    level: input.result.level,
    levelName: input.result.levelName,
    severity: input.result.severity,
    // 归因构成只给名称、强弱和依据，不把占比小数交给模型，避免它在文案里编出百分比
    attributions: (input.result.attributions || []).map(attribution => ({
      name: attribution.name,
      strength: attribution.strength,
      reasons: attribution.reasons
    })),
    reasons: input.result.reasons,
    dimensions: input.result.dimensions,
    actions: input.result.actions,
    tools: input.result.tools,
    matchedRuleIds: input.result.matchedRuleIds
  }
  const format = JSON.stringify(assessmentReportSchema.parse({ ...fallback, printMeta: { ...fallback.printMeta, source: 'ai' } }))
  const startedAt = Date.now()
  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: config.deepseekGeneratorModel,
        messages: [
          {
            role: 'system',
            content: `你是教师赋能平台的报告撰写助手。只根据用户提供的规则事实生成正式评估报告 JSON。
硬约束：
1. 不得改变 module、level、matchedRuleIds、assessmentVersion。
1b. 归因由确定性规则算出，attributions 只能原样复述名称与强弱，不得新增、改名或写出任何百分比。
2. 不做精神、医学、法律诊断，不承诺效果，不写“确诊、治疗、治愈、一定、保证、医学诊断”等表述。
3. 可优化表达和行动安排，但不得新增规则事实、风险等级或制度结论。
4. 三天行动方案每天 1-3 个动作；七天跟进必须包含观察点、复盘问题和升级信号。
5. 输出必须是严格 JSON，字段结构与示例完全一致。`
          },
          { role: 'user', content: `规则事实：${JSON.stringify(facts)}\n\nJSON结构示例：${format}` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.35
      }),
      signal: AbortSignal.timeout(Number(config.deepseekTimeoutMs) || 8000)
    })
    if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number, completion_tokens?: number }
    }
    const content = json.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty model output')
    const report = validateAssessmentReport(JSON.parse(content), input.module, input.result)
    report.printMeta.source = 'ai'
    if (outputTemplates.length) {
      const deterministic = createTemplateAssessmentReport({ module: input.module, result: input.result, definition, outputTemplates })
      report.profile.summary = deterministic.profile.summary
      report.risk.description = deterministic.risk.description
      if (deterministic.supportGoal) report.supportGoal = deterministic.supportGoal
      report.firstAction = deterministic.firstAction
      report.escalationConditions = deterministic.escalationConditions
      report.sevenDayFollowUp.reviewQuestions = deterministic.sevenDayFollowUp.reviewQuestions
    }
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'assessment_report',
      status: 'success',
      latencyMs: Date.now() - startedAt,
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens
    }).catch(() => undefined)
    return report
  } catch (error) {
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: input.schoolId,
      ownerUserId: input.ownerUserId,
      provider: 'deepseek',
      model: config.deepseekGeneratorModel,
      purpose: 'assessment_report',
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown'
    }).catch(() => undefined)
    return fallback
  }
}

function splitRouteKeywords(value?: string) {
  return (value || '')
    .split(/[,，、;；\n]/)
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeRouteText(value: string) {
  return value.trim().toLowerCase()
}

function routeMatchesText(route: KeywordRouteEntry, text: string) {
  const normalizedText = normalizeRouteText(text)
  if ((route.temporalValidity || 'always') !== 'always') return false
  if ((route.exclusionKeywords || []).some(keyword => normalizedText.includes(normalizeRouteText(keyword)))) return false
  if (route.matchMode === 'regex') {
    try {
      return new RegExp(route.coreKeywords, 'i').test(text)
    } catch {
      return false
    }
  }
  const keywords = route.matchMode === 'exact'
    ? splitRouteKeywords(route.coreKeywords)
    : [...splitRouteKeywords(route.coreKeywords), ...splitRouteKeywords(route.expandedKeywords)]
  return keywords.some(keyword => normalizedText.includes(normalizeRouteText(keyword)))
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

async function routeWithPublishedKeywords(event: H3Event, text: string, schoolId?: string | null): Promise<RouteDecision | null> {
  const matches: Array<{ route: KeywordRouteEntry; score: number }> = []
  for (const module of routeModules) {
    const resource = await resolvePublishedModuleResource<{ routes?: KeywordRouteEntry[] }>(event, {
      module,
      libraryType: 'keyword_route',
      schoolId
    }).catch(() => null)
    const routes = Array.isArray(resource?.payload?.routes) ? resource.payload.routes : []
    for (const route of routes) {
      if (!routeMatchesText(route, text)) continue
      matches.push({
        route,
        score: (route.routeWeight ?? 0.7) + Math.max(0, 100 - route.matchPriority) / 1000
      })
    }
  }
  if (!matches.length) return null
  matches.sort((a, b) =>
    b.score - a.score || a.route.matchPriority - b.route.matchPriority || a.route.code.localeCompare(b.route.code)
  )
  const byModule = new Map<ModuleId, { route: KeywordRouteEntry; score: number }>()
  for (const match of matches) {
    const current = byModule.get(match.route.module)
    if (!current || match.score > current.score) byModule.set(match.route.module, match)
  }
  const ranked = Array.from(byModule.values()).sort((a, b) =>
    b.score - a.score || a.route.matchPriority - b.route.matchPriority || a.route.code.localeCompare(b.route.code)
  )
  const primary = ranked[0]!
  return routeDecisionSchema.parse({
    primaryModule: primary.route.module,
    secondaryModules: ranked.slice(1, 4).map(match => ({
      module: match.route.module,
      confidence: clamp(0.35 + (match.route.routeWeight ?? 0.7) * 0.4, 0.35, 0.86)
    })),
    confidence: clamp(0.55 + (primary.route.routeWeight ?? 0.7) * 0.4, 0.55, 0.95),
    needsClarification: false,
    rationale: `命中已发布关键词路由「${primary.route.semanticCategory || primary.route.code}」，建议先进入对应模块完成量表评估。`
  })
}

export async function routeWithDeepSeek(event: H3Event, text: string, schoolId?: string | null): Promise<RouteDecision> {
  const publishedRoute = await routeWithPublishedKeywords(event, text, schoolId)
  if (publishedRoute) return publishedRoute
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return localRoute(text)
  const redacted = redactPii(text)
  const prompt = `你是教师赋能平台的路由器。只返回 json。模块只能是 self_growth、class_system、home_school、student_case、learning_problem。\nJSON示例：{"primaryModule":"home_school","secondaryModules":[],"confidence":0.86,"needsClarification":false,"rationale":"主要困扰是家长沟通"}\n教师描述：${redacted}`

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: config.deepseekRouterModel,
          messages: [{ role: 'system', content: '输出严格 json，不进行心理或医学诊断。' }, { role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          temperature: 0.1
        }),
        signal: AbortSignal.timeout(Number(config.deepseekTimeoutMs) || 8000)
      })
      if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
      const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = json.choices?.[0]?.message?.content
      if (!content) throw new Error('Empty model output')
      return routeDecisionSchema.parse(JSON.parse(content))
    } catch {
      if (attempt === 1) return localRoute(text)
    }
  }
  return localRoute(text)
}

const planUpdateExtractionSchema = z.object({
  updates: z.array(z.object({
    planTitle: z.string().trim().min(1).max(200),
    actionTitle: z.string().optional(),
    newStatus: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
    progressNote: z.string().max(500).optional()
  })).max(5).default([])
})

export type PlanUpdateExtraction = z.infer<typeof planUpdateExtractionSchema>

/**
 * 从 AI 回复中提取方案更新意图。
 * 使用一次轻量 LLM 调用，非阻塞，失败时静默返回空数组。
 */
export async function extractPlanUpdates(
  event: H3Event,
  aiResponse: string,
  businessContext: { snapshot: Record<string, unknown> } | null | undefined,
  audit?: { schoolId: string, ownerUserId: string, sessionId: string, dataMode?: string, contextType?: string, noticeVersion?: string }
): Promise<PlanUpdateExtraction['updates']> {
  if (!businessContext?.snapshot) return []
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return []

  // 从 snapshot 中提取方案摘要供 LLM 参考
  const plansSummary = (businessContext.snapshot as any).recentPlans?.map((p: any) => ({
    title: p.title,
    status: p.status,
    actions: p.actions || []
  })) || []

  if (!plansSummary.length) return []

  const prompt = `你是教师赋能平台的方案更新提取器。根据 AI 助手的回复，提取其中明确的方案执行状态更新意图。

当前方案状态：
${JSON.stringify(plansSummary, null, 2)}

AI 助手回复：
${aiResponse.slice(0, 2000)}

规则：
1. 仅当 AI 回复中明确表达了"已完成"、"标记完成"、"更新进度"、"暂停"等意图时才提取
2. 不要猜测或推断未明确表达的更新
3. actionTitle 必须与方案中现有动作标题匹配（模糊匹配即可）
4. 如果没有明确的更新意图，返回空数组

返回严格 JSON：{"updates":[{"planTitle":"方案标题","actionTitle":"动作标题","newStatus":"completed","progressNote":"..."}]}
不得输出或猜测任何数据库 ID、UUID 或账号标识。`

  const startedAt = Date.now()
  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model: config.deepseekRouterModel,
        messages: [
          { role: 'system', content: '你只做方案更新提取，不做诊断。只返回 JSON。' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0
      }),
      signal: AbortSignal.timeout(3000)
    })
    if (!response.ok) return []
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = json.choices?.[0]?.message?.content
    if (!content) return []
    const parsed = planUpdateExtractionSchema.parse(JSON.parse(content))
    await useDb(event).insert(schema.aiModelCalls).values({
      schoolId: audit?.schoolId, ownerUserId: audit?.ownerUserId, sessionId: audit?.sessionId, provider: 'deepseek',
      model: config.deepseekRouterModel,
      purpose: 'plan_update_extraction',
      status: 'success',
      latencyMs: Date.now() - startedAt,
      dataMode: audit?.dataMode,
      contextType: audit?.contextType,
      noticeVersion: audit?.noticeVersion
    }).catch(() => undefined)
    return parsed.updates
  } catch {
    return []
  }
}

/**
 * AI 配置读取层（AI 管理中心）。
 *
 * 职责：
 *  - 维护 9 个 AI 调用点的内置提示词基线（PROMPT_BUILTINS），行为与硬编码时期完全一致
 *  - 提示词模板：DB 已发布（ai_prompt_templates.published）优先，无则内置；{{占位符}} 运行时替换
 *  - 运行时配置：DB（ai_runtime_settings）优先，NULL 回落环境变量；内存缓存，写端点显式失效
 *
 * 模板语法：
 *  以 `###SYSTEM###\n` 开头的模板分为 system 段与 user 段（以 `###USER###\n` 分隔）；
 *  不含该标记的模板整体作为 user 消息。渲染后调用点自行决定消息 role。
 *
 * 缓存为进程内单实例假设（当前容器部署单副本成立）；多实例部署时需换共享缓存。
 */
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { schema, useDb } from '../utils/db'

export interface PromptPlaceholder {
  key: string
  label: string
  description?: string
}

export interface PromptTemplate {
  /** 模板唯一编码，对应调用点 */
  code: string
  name: string
  description: string
  template: string
  placeholders: PromptPlaceholder[]
}

export interface RenderedPrompt {
  system: string | null
  user: string | null
  /** 模板来源：内置基线或 DB 已发布版本 */
  source: 'builtin' | 'published'
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

export const PROMPT_BUILTINS: PromptTemplate[] = [
  {
    code: 'assistant_chat',
    name: 'AI 助手系统提示词',
    description: '教师端统一 AI 助手（聊天流式与 JSON 模式共用）：身份、职责与硬约束。',
    placeholders: [
      { key: 'formatInstruction', label: '输出格式指令', description: '由代码按输出模式注入：严格 JSON 示例或 500 字自然语言约束。' },
      { key: 'knowledgeContext', label: '已审核知识片段', description: '检索到的已发布知识片段；无检索结果时为降级提示句。' },
      { key: 'businessContextText', label: '当前业务对象上下文', description: '咨询对象（学生/班级/家长）档案摘要；未指定时为固定提示句。' }
    ],
    template: `${SYSTEM_MARKER}你是"教师赋能智能平台"的统一 AI 助手，服务班主任。业务模块只有 self_growth、class_system、home_school、student_case、learning_problem。
你的职责：理解教师自然语言、进行多轮澄清、结合已审核知识和通用班主任工作方法给出当下可执行建议，并建议进入合适模块。
硬约束：
1. 不做精神、医学、法律诊断，不承诺效果，不替代心理专员、医生、警方或校方制度。
2. 不计算量表分数，不确定六色预警、四阶、P×A、L1-L3，不决定熔断；这些由代码规则执行。
3. 知识片段是业务依据，不是逐字答案。可以根据教师问题自主组织回答、做场景分析、提出澄清问题和通用建议。
4. 涉及平台规则、量表、分级、SOP、红线、校内制度、工具卡原文或"平台要求"时，必须基于下方知识片段或建议进入模块评估；知识不足时明确说明"需要进入模块或补充业务知识后确认"。
5. 不能杜撰手册、SOP、等级、数据、来源或校方制度。引用来源时只能引用下方知识片段。
6. 回答温和、简洁；需要追问时每轮最多问一个关键问题。
7. 不复述姓名、电话、邮箱等个人信息，不扩大到其他教师或学生数据。
8. 上下文中的方案(recentPlans)包含执行动作(actions)及其状态。可引用方案进度，根据教师反馈在回答中建议更新方案状态。
9. 如果提供了"当前业务对象上下文"，可以结合其中的学生/班级/家长/沟通/历史方案摘要进行分析，但不能暴露完整电话等隐私字段，不能推断上下文之外的个人信息。
10. 工具、SOP、制度、分级、量表、红线和平台要求属于强约束资源：没有命中对应已发布资源时，只能给通用沟通建议，不能说"平台规定""工具库要求"或生成看似正式的工具原文。
11. {{formatInstruction}}

已审核知识：
{{knowledgeContext}}

当前业务对象上下文：
{{businessContextText}}`
  },
  {
    code: 'clarification_round',
    name: '澄清追问提示词',
    description: '首页分诊多轮追问：每轮一个问题 + 2~4 个选项 + 内部模块评分。',
    placeholders: [
      { key: 'roundNumber', label: '追问轮次', description: '当前第几轮（最多 3 轮）。' },
      { key: 'previousScores', label: '上一轮模块评分', description: '上一轮内部模块评分；首轮为固定提示句。' },
      { key: 'knowledgeContext', label: '已审核知识片段', description: '检索到的已发布知识片段（仅了解业务范围）。' }
    ],
    template: `${SYSTEM_MARKER}你是"教师赋能智能平台"的追问助手。当前处于**问题澄清阶段（第{{roundNumber}}轮）**，系统最多允许 3 轮追问，你的唯一职责是通过追问帮助教师明确问题方向。

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

{{previousScores}}

（第3轮示例：若教师第2轮选了"入睡困难，躺床上脑子停不下来"，则需要收束追问——"听起来脑子里转的事不少。闭眼的时候最常想到的是什么？是某个具体的学生、某件事，还是整体的责任感？" 选项：["有个行为习惯特别难管的学生，天天都得跟他较劲","班上最近出了几次突发状况，心里总悬着","某个学生的学习成绩一直往下掉","倒不是具体哪个学生，就是总觉得自己做得不够好"] 模块评分示例：{"self_growth":0.3,"class_system":0.2,"home_school":0.1,"student_case":0.2,"learning_problem":0.2}）

已审核知识（仅供了解业务范围，不直接引用）：
{{knowledgeContext}}`
  },
  {
    code: 'clarification_summary',
    name: '澄清总结提示词',
    description: '多轮追问结束后的总结：完整分析回复 + 路由 JSON 元数据。',
    placeholders: [
      { key: 'scoresContext', label: '上一轮模块评分', description: '用于汇总最终占比；首轮无评分为空。' },
      { key: 'knowledgeContext', label: '已审核知识片段', description: '检索到的已发布知识片段（仅参考方法论）。' }
    ],
    template: `${SYSTEM_MARKER}你是"教师赋能智能平台"的总结助手。现在是**问题澄清结束后的总结阶段**。教师已通过多轮追问明确了问题方向，现在你需要基于所有对话历史，生成一个完整的分析回复。

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

{{scoresContext}}

已审核知识（供参考方法论，不照搬原文）：
{{knowledgeContext}}`
  },
  {
    code: 'assessment_report',
    name: '评估报告润色提示词',
    description: '确定性规则结果生成正式评估报告 JSON（AI 仅润色，约束字段不得改变）。',
    placeholders: [
      { key: 'facts', label: '规则事实 JSON', description: '规则执行结果：模块、等级、归因名称/强弱、原因、行动等（不含占比小数）。' },
      { key: 'jsonFormat', label: '报告 JSON 结构示例', description: '由代码按报告 schema 生成的完整示例。' }
    ],
    template: `${SYSTEM_MARKER}你是教师赋能平台的报告撰写助手。只根据用户提供的规则事实生成正式评估报告 JSON。
硬约束：
1. 不得改变 module、level、matchedRuleIds、assessmentVersion。
1b. 归因由确定性规则算出，attributions 只能原样复述名称与强弱，不得新增、改名或写出任何百分比。
2. 不做精神、医学、法律诊断，不承诺效果，不写"确诊、治疗、治愈、一定、保证、医学诊断"等表述。
3. 可优化表达和行动安排，但不得新增规则事实、风险等级或制度结论。
4. 三天行动方案每天 1-3 个动作；七天跟进必须包含观察点、复盘问题和升级信号。
5. 输出必须是严格 JSON，字段结构与示例完全一致。
###USER###
规则事实：{{facts}}

JSON结构示例：{{jsonFormat}}`
  },
  {
    code: 'semantic_safety',
    name: '语义安全信号识别提示词',
    description: '安全链路的辅助信号识别：自杀/自伤/暴力/虐待/威胁。小超时（1500ms）由代码固定。',
    placeholders: [
      { key: 'userText', label: '脱敏后的教师输入', description: '已脱敏（电话/邮箱/人名）的原始文本。' }
    ],
    template: `${SYSTEM_MARKER}你只做安全信号辅助识别，不做诊断。只返回 JSON。
###USER###
识别文本是否明确或隐含涉及自杀、自伤、暴力、虐待或威胁。没有则 risks 为空。文本：{{userText}}`
  },
  {
    code: 'rule_expression',
    name: '规则结论改写提示词',
    description: '把确定性规则结论改写成温和的教师支持表达（不改等级/规则/行动）。小超时（1500ms）由代码固定。',
    placeholders: [
      { key: 'facts', label: '规则执行结果 JSON', description: '模块、等级、原因、动作标题。' }
    ],
    template: `${SYSTEM_MARKER}把确定性规则结论改写成温和、简洁、非诊断性的教师支持表达。不得改变等级、规则或行动，不得新增事实。只返回 JSON。
###USER###
{{facts}}
返回格式：{"summary":"..."}`
  },
  {
    code: 'module_router',
    name: '模块路由提示词',
    description: '首页分诊的路由决策：从未命中关键词路由的输入中判断主模块。',
    placeholders: [
      { key: 'userText', label: '脱敏后的教师输入', description: '已脱敏的原始文本。' }
    ],
    template: `${SYSTEM_MARKER}输出严格 json，不进行心理或医学诊断。
###USER###
你是教师赋能平台的路由器。只返回 json。模块只能是 self_growth、class_system、home_school、student_case、learning_problem。
JSON示例：{"primaryModule":"home_school","secondaryModules":[],"confidence":0.86,"needsClarification":false,"rationale":"主要困扰是家长沟通"}
教师描述：{{userText}}`
  },
  {
    code: 'plan_update_extractor',
    name: '方案更新提取提示词',
    description: '从 AI 回复中提取方案执行状态更新意图（非阻塞，失败静默返回空）。小超时（3000ms）由代码固定。',
    placeholders: [
      { key: 'plansSummary', label: '当前方案状态 JSON', description: '教师名下方案标题/状态/动作摘要。' },
      { key: 'aiResponse', label: 'AI 助手回复', description: '本次 AI 回答文本（截 2000 字）。' }
    ],
    template: `${SYSTEM_MARKER}你只做方案更新提取，不做诊断。只返回 JSON。
###USER###
你是教师赋能平台的方案更新提取器。根据 AI 助手的回复，提取其中明确的方案执行状态更新意图。

当前方案状态：
{{plansSummary}}

AI 助手回复：
{{aiResponse}}

规则：
1. 仅当 AI 回复中明确表达了"已完成"、"标记完成"、"更新进度"、"暂停"等意图时才提取
2. 不要猜测或推断未明确表达的更新
3. actionTitle 必须与方案中现有动作标题匹配（模糊匹配即可）
4. 如果没有明确的更新意图，返回空数组

返回严格 JSON：{"updates":[{"planTitle":"方案标题","actionTitle":"动作标题","newStatus":"completed","progressNote":"..."}]}
不得输出或猜测任何数据库 ID、UUID 或账号标识。`
  },
  {
    code: 'instrument_recommendation',
    name: '量表分诊提示词',
    description: '从模块量表白名单中推荐一张（AI 只挑入口，归因/分级仍确定性；边界与兜底规则在代码中）。',
    placeholders: [
      { key: 'instrumentOptions', label: '可选量表清单 JSON', description: '含业务触发条件判断（该做/暂不需要/已做过）的白名单。' },
      { key: 'userText', label: '脱敏后的教师描述', description: '已脱敏的教师困扰描述。' }
    ],
    template: `你是教师赋能平台的量表分诊器。教师描述了自己的困扰，你要从给定的量表清单里挑最合适的一张。
只返回 json，不要解释。格式：{"code":"量表编码","rationale":"一句话说明为什么先做这张，40字以内"}

硬约束：
1. code 必须是清单里已有的量表编码，不得编造。
2. rationale 面向班主任，说清「为什么先做这张」，不要复述量表名称。
3. 不做任何诊断性判断，不要提及疾病、障碍等表述。
4. businessAdvice 是业务方按该教师的历史作答算出的确定性判断，优先级高于你的推测：
   · 有量表标着「现在该做这张」时，除非教师描述明确指向别的方向，否则就选它；
   · 标着「当前还不需要做」的量表，只有在教师描述强烈指向它时才选，并在 rationale 里说明理由；
   · 标着「已经做过」的量表，一般不重复推荐，除非教师明确说要重测。

可选量表清单：{{instrumentOptions}}

教师描述：{{userText}}`
  }
]

const promptTemplateMap = new Map(PROMPT_BUILTINS.map(item => [item.code, item]))

/** 进程内缓存：运行时配置（TTL 30s）+ 提示词模板（写端点显式失效） */
let runtimeCache: { at: number; data: AiRuntimeConfig } | null = null
let promptCache: { at: number; data: Map<string, string | null> } | null = null
const RUNTIME_CACHE_TTL_MS = 30_000
const PROMPT_CACHE_TTL_MS = 30_000

/** 写端点（提示词发布/保存、运行时配置更新）调用后失效全部缓存 */
export function invalidateAiConfigCache() {
  runtimeCache = null
  promptCache = null
}

/**
 * 获取运行时生效的提示词模板（DB published 优先，无则内置基线）。
 * DB 不可用时静默回退内置，不阻塞模型调用。
 */
export async function getPromptTemplate(event: H3Event, code: string): Promise<{ template: string; source: 'builtin' | 'published' }> {
  const builtin = promptTemplateMap.get(code)
  const fallback = { template: builtin?.template ?? '', source: 'builtin' as const }
  try {
    const now = Date.now()
    if (!promptCache || now - promptCache.at > PROMPT_CACHE_TTL_MS) {
      const rows = await useDb(event).select({ code: schema.aiPromptTemplates.code, published: schema.aiPromptTemplates.published }).from(schema.aiPromptTemplates)
      promptCache = { at: now, data: new Map(rows.map(row => [row.code, row.published])) }
    }
    const published = promptCache.data.get(code)
    return published ? { template: published, source: 'published' } : fallback
  } catch (error) {
    console.error('[ai-config] 读取提示词模板失败，使用内置基线:', error instanceof Error ? error.message : error)
    return fallback
  }
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
    user: substitute(user),
    source: 'builtin'
  }
}

/**
 * 渲染提示词模板：读取生效模板并替换 {{占位符}}。
 * 缺失的占位符替换为空字符串（管理员删除占位符 = 不注入动态内容，不阻断调用）。
 */
export async function renderPrompt(event: H3Event, code: string, vars: Record<string, string>): Promise<RenderedPrompt> {
  const { template, source } = await getPromptTemplate(event, code)
  const rendered = renderTemplate(template, vars)
  rendered.source = source
  return rendered
}

/** 内置基线提示词列表（管理页展示与「重置为内置」用） */
export function listBuiltinPrompts(): Array<{ code: string; name: string; description: string; placeholders: PromptPlaceholder[]; template: string }> {
  return PROMPT_BUILTINS.map(item => ({ ...item }))
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
    embeddingEnabled: null
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
              embeddingEnabled: row.embeddingEnabled
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
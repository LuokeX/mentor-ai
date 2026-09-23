import type { H3Event } from 'h3'
import { z } from 'zod'
import type { ModuleId, OutputTemplateEntry, RuleExecResult } from '../../shared/contracts'
import { assessmentReportSchema, type AssessmentReport } from '../../shared/reports'
import { assessmentDefinitions, moduleMeta, type AssessmentDefinition } from '../../shared/assessments'
import { createTemplateAssessmentReport, validateAssessmentReport } from '../domain/reports'
import { getAiRuntimeConfig, promptAvailable, renderPrompt } from '../domain/ai-config'
import { buildTermGlossary } from '../domain/term-glossary'
import { resolvePublishedModuleResource } from '../domain/module-resources'
import { trackProductEvent } from '../domain/product-events'
import type { SchoolSection } from '../../shared/school-section'
import {
  callJsonChatWithRetry,
  compactValidationError,
  type JsonChatMessage,
  type JsonChatToolSpec
} from './json-chat'

// compactValidationError 已随统一 JSON 调用层移到 json-chat.ts；
// 这里 re-export，保持既有引用（含 tests/reports.test.ts）不变。
export { compactValidationError }

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

/**
 * 常见单姓：只用来判断「称谓前的字串是不是姓名」。
 * 表里只排除「无法用词表兜住的虚词字」（和、向、都、那、家、师、从、由、为…），
 * 其余同形字的误伤交给下面的 NON_NAME_WORDS 兜底（如「全班」「安排」「初一」）。
 * 覆盖目标：百家姓常见单姓 + 本校实际在册姓名里出现过的姓氏（褚、盛、展、倪、靳、荆、翟…）。
 */
const COMMON_SURNAMES = new Set([
  ...'王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵钱严覃武戴莫孔汤'
  + '白花牛左米山松水车乐谷齐康温宁褚盛展倪靳荆翟俞焦辛帅穆安初季远梅云苗傅鲍滕殷毕邬伍卜湛祁禹狄臧计伏谈茅庞舒屈项祝阮蓝闵席麻强路娄危童颜刁骆樊凌霍虞支柯经房裘缪解宗宣郁单杭洪诸吉钮嵇滑裴荣翁荀羊惠甄曲封芮储汲糜井富巫乌巴弓牧隗宓蓬郗仰秋仲伊宫仇暴甘厉戎祖符景詹束幸司韶郜蓟薄印宿怀邰鄂索咸籍赖卓蔺屠蒙池乔阴胥苍双闻莘党贡劳姬申扶堵冉宰郦雍桑桂濮寿扈燕冀郏浦尚农庄晏柴瞿阎充慕茹习宦艾鱼容古易慎戈庾终暨居衡步耿满弘匡寇广禄阙欧殳沃利蔚越夔隆巩聂晁勾敖融冷訾阚简饶毋沙乜养鞠须丰巢蒯查红游竺权逯盖益桓'
  + '全安初成文通连相包公万明应平常国方干东'
])
/** 常见复姓。 */
const COMPOUND_SURNAMES = new Set([
  '欧阳', '司马', '上官', '诸葛', '端木', '东方', '独孤', '南宫', '夏侯',
  '皇甫', '尉迟', '公孙', '慕容', '司徒', '司空', '令狐', '宇文', '长孙', '轩辕', '百里', '呼延'
])
/** 小名/昵称前缀：小明、阿美、老张、大伟。 */
const NICKNAME_PREFIXES = new Set(['小', '老', '阿', '大'])
/** 名字里不会出现的虚词/量词：跟在姓氏后面命中即判为普通词（责任感、课程找、何跟这类…）。 */
const NAME_STOPCHARS = new Set([
  ...'的了们个这那些位名每各某是不都也就还再很太更最能要想说从向对给把跟让被在由等与及和或以时里来去找打虑先用抚值多数班校请感围'
])
/** 小名/昵称分支的额外虚词（大学生、大多数、大部分…）。 */
const NICKNAME_STOPCHARS = new Set([...NAME_STOPCHARS, '学', '生', '部', '分', '概'])
/**
 * 含姓氏字的常见词（结尾或开头恰好是姓氏字，如「值周老师」的周、「任课老师」的任）：
 * 窗口尾部命中就整条不替换，避免把岗位/关系/形容类词当成姓名。
 */
const NON_NAME_WORDS = new Set([
  '值周', '上周', '本周', '下周', '每周', '这周', '那周', '一周', '两周', '几周', '整周',
  '任课', '任何', '主任', '责任', '科任', '担任', '新任', '现任', '前任', '上任', '就任',
  '值日', '带班', '带队', '配班', '代班', '代课', '年级', '全班', '全校', '本班', '班里', '各班',
  '由于', '对于', '关于', '至于', '等于', '先于', '利于', '善于', '在于', '于是',
  '温柔', '温和', '温暖', '严厉', '严肃', '宽松', '轻松', '周围',
  // 从「姓氏字开头的普通词」里补的排除项（这些字的姓氏身份保留，误伤用词表兜住）
  '全部', '全都', '全身', '安排', '安全', '安心', '安静', '初一', '初二', '初三', '初次', '初步', '初中',
  '成为', '成长', '成绩', '成员', '成年', '文明', '文章', '作文', '课文', '文化',
  '通常', '通知', '交通', '沟通', '通过', '连续', '连接', '连忙', '相信', '相同', '相关', '相当', '相互',
  '包括', '包含', '公开', '公共', '公园', '万一', '万分', '明白', '说明', '明显', '明天', '聪明',
  '学校', '学生', '学习', '学期', '应该', '应当', '应用', '时间', '时候', '有时', '平时', '平常', '水平', '公平',
  '常常', '常见', '以后', '之后', '最后', '然后', '后悔', '全国', '国家', '国外', '对方', '双方', '方法', '方面',
  '干嘛', '干部', '干活', '利用', '利益', '顺利', '容易', '交易', '检查', '调查', '查询', '辛苦', '季节', '永远',
  '焦急', '焦点', '帅气', '儿童', '毕业', '解决', '了解', '解释', '理解', '单独', '简单', '单元', '厉害',
  '后续', '倾听', '个别', '焦虑', '及时', '明确', '告知', '经验', '依赖', '安抚',
  '东西', '东边', '东面'
])
/** 叠字小名（乐乐、兰兰、糖糖）的排除项：同形的副词与亲属称谓不是名字。 */
const REDUPLICATED_NON_NAMES = new Set([
  '刚刚', '常常', '天天', '好好', '慢慢', '轻轻', '悄悄', '渐渐', '多多', '看看', '想想', '说说', '试试',
  '快快', '早早', '远远', '紧紧', '连连', '纷纷', '匆匆', '默默', '静静', '偷偷', '狠狠', '偏偏', '白白',
  '妈妈', '爸爸', '爷爷', '奶奶', '哥哥', '姐姐', '弟弟', '妹妹', '宝宝', '娃娃', '叔叔', '阿姨', '姑姑', '舅舅', '婆婆', '公公'
])
const PERSON_TITLES = '老师|同学|妈妈|爸爸|家长'
/**
 * 称谓前 1-4 字的窗口里，取「最长的、看起来像姓名」的后缀长度（0 表示不是姓名）。
 * 逐层回退是因为正则窗口会连带普通词：如「跟李明的家长」窗口是「跟李明的」，姓名只占后 3 字。
 */
function nameSpanIn(prefix: string) {
  // 窗口尾部是「值周」「任课」「温柔」这类含姓氏字的普通词时，整个窗口都不替换
  const tail = prefix.endsWith('的') ? prefix.slice(0, -1) : prefix
  if (NON_NAME_WORDS.has(tail.slice(-2)) || NON_NAME_WORDS.has(tail.slice(-3))) return 0
  for (let length = Math.min(prefix.length, 4); length >= 1; length--) {
    const candidate = prefix.slice(prefix.length - length)
    if (looksLikeName(candidate)) return length
  }
  return 0
}

function looksLikeName(candidate: string) {
  // 单姓：张老师、李主任
  if (candidate.length === 1) return COMMON_SURNAMES.has(candidate)
  // 复姓：欧阳老师
  if (COMPOUND_SURNAMES.has(candidate.slice(0, 2))) return true
  // 叠字小名：乐乐妈妈、兰兰家长（排除「刚刚」「爸爸妈妈」这类同形普通词）
  if (candidate.length === 2 && candidate[0] === candidate[1] && !REDUPLICATED_NON_NAMES.has(candidate)) return true
  // 小名/昵称：小明妈妈、阿美家长（后面的字是虚词就判为普通词）
  if (NICKNAME_PREFIXES.has(candidate[0]!)) {
    return [...candidate.slice(1)].every(char => !NICKNAME_STOPCHARS.has(char))
  }
  // 单姓 + 名：张伟老师、李明的家长、王小明同学；
  // 单姓后面最多再跟 2 个字，避免把「明确告知」「时先倾听」这类四字词组当成姓名
  const core = candidate.endsWith('的') ? candidate.slice(0, -1) : candidate
  if (!COMMON_SURNAMES.has(core[0]!)) return false
  if (core.length > 3) return false
  return [...core.slice(1)].every(char => !NAME_STOPCHARS.has(char))
}

/**
 * 外发脱敏：手机号、邮箱，以及「姓名（单姓/复姓/小名）+ 称谓」。
 *
 * 姓名规则此前是「任意 1-4 个汉字 + 称谓」一律替换，会把普通词组一并替换（实测正式库 768 条消息
 * 有 260 条、约 689 处被误伤），模型读到的提示词变成「跟[PERSON]家长沟通」这种残缺中文，还会把
 * 占位符复读进回答。现在改为先判断窗口后缀是否像姓名，只替换姓名本身。
 */
export function redactPii(text: string) {
  return text
    .replace(/1[3-9]\d{9}/g, '[PHONE]')
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]')
    .replace(new RegExp(`([\\u4e00-\\u9fa5]{1,4})(${PERSON_TITLES})`, 'g'), (whole, prefix: string, title: string) => {
      const nameLength = nameSpanIn(prefix)
      if (!nameLength) return whole
      return `${prefix.slice(0, prefix.length - nameLength)}[PERSON]${title}`
    })
}

const semanticRiskSchema = z.object({
  risks: z.array(z.enum(['suicide', 'self_harm', 'violence', 'abuse', 'threat'])).max(5)
})

type SemanticRisk = z.infer<typeof semanticRiskSchema>['risks'][number]

const riskRuleIds: Record<SemanticRisk, string> = {
  suicide: 'SAFE-SEMANTIC-SUICIDE',
  self_harm: 'SAFE-SEMANTIC-SELF-HARM',
  violence: 'SAFE-SEMANTIC-VIOLENCE',
  abuse: 'SAFE-SEMANTIC-ABUSE',
  threat: 'SAFE-SEMANTIC-THREAT'
}

/** 复核提示词里的中英对照；模型输出仍是枚举键，由 strict 通道的 schema 约束。 */
const riskLabels: Record<SemanticRisk, string> = {
  suicide: '自杀(suicide)',
  self_harm: '自伤(self_harm)',
  violence: '暴力(violence)',
  abuse: '虐待(abuse)',
  threat: '威胁(threat)'
}

/** 语义安全信号：1.5s 单次超时、两次尝试（本地规则先跑，这里只是补充识别）。 */
const SEMANTIC_SAFETY_TIMEOUT_MS = 1500
const SEMANTIC_SAFETY_MAX_TOKENS = 128
const SEMANTIC_SAFETY_ATTEMPTS = 2

/** 首轮识别与复核共用同一份风险枚举，避免两轮输出契约分叉。 */
const semanticRiskParameters: Record<string, unknown> = {
  type: 'object',
  properties: {
    risks: {
      type: 'array',
      items: { type: 'string', enum: ['suicide', 'self_harm', 'violence', 'abuse', 'threat'] },
      maxItems: 5
    }
  },
  required: ['risks'],
  additionalProperties: false
}

/**
 * strict 结构化输出试点定义（仅当 AI_STRICT_JSON_PURPOSES 含对应 purpose 时启用）。
 * 已关思考，满足 tool_choice 具名形式对思考模式的要求；不可用时自动回退 json_object。
 */
const semanticSafetyTool: JsonChatToolSpec = {
  name: 'report_safety_risks',
  description: '上报教师消息里出现的危机风险类别；只有文本本身能看出对人身安全的现实威胁才上报，没有风险时返回空数组。',
  parameters: semanticRiskParameters
}

/** 复核通道的工具定义：输入是首轮命中的类别，输出只保留其中成立的。 */
const semanticSafetyReviewTool: JsonChatToolSpec = {
  name: 'confirm_safety_risks',
  description: '复核首轮识别出的风险类别，只返回在教师消息里找得到依据的类别；找不到依据时返回空数组。',
  parameters: semanticRiskParameters
}

export interface SemanticSafetyAudit {
  schoolId?: string | null
  ownerUserId?: string | null
  sessionId?: string | null
}

/**
 * 一次语义风险判定：渲染提示词 → 模型调用 → Zod 校验，返回命中的风险类别。
 * 任何失败（无密钥、超时、HTTP、解析、校验）返回 null，由调用方决定是
 * 「按无风险继续」还是「保留原判定」；失败元数据已由统一调用层写入 ai_model_calls。
 */
async function detectSemanticRisks(
  event: H3Event,
  promptCode: 'semantic_safety' | 'semantic_safety_review',
  promptVars: Record<string, string>,
  tool: JsonChatToolSpec,
  audit: SemanticSafetyAudit
): Promise<SemanticRisk[] | null> {
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return null
  const rt = await getAiRuntimeConfig(event)
  const routerModel = rt.routerModel || config.deepseekRouterModel
  const prompt = await renderPrompt(event, promptCode, promptVars)
  if (!promptAvailable(prompt)) return null
  const messages: JsonChatMessage[] = []
  if (prompt.system) messages.push({ role: 'system', content: prompt.system })
  if (prompt.user) messages.push({ role: 'user', content: prompt.user })
  const outcome = await callJsonChatWithRetry<SemanticRisk[]>({
    event,
    purpose: promptCode,
    model: routerModel,
    messages,
    // 关思考后只需回 5 个枚举值：128 token 足够，同时压掉 1.5s 超时下的长尾
    maxTokens: SEMANTIC_SAFETY_MAX_TOKENS,
    timeoutMs: SEMANTIC_SAFETY_TIMEOUT_MS,
    temperature: 0,
    thinking: 'disabled',
    attempts: SEMANTIC_SAFETY_ATTEMPTS,
    tool,
    audit,
    parse: content => ({ value: semanticRiskSchema.parse(JSON.parse(content)).risks })
  })
  if (!outcome.ok) return null
  return outcome.data ?? []
}

/** 两轮判定的结论：熔断用 matchedRules；detectedRules 与 review 供审计与评测观察误报率。 */
export interface SemanticSafetyVerdict {
  /** 需要交给熔断分支的规则编号（两轮都成立；本地硬规则不经过这里） */
  matchedRules: string[]
  /** 首轮识别到的规则编号（未复核） */
  detectedRules: string[]
  /** 复核结论：none 首轮无风险；confirmed 复核成立；cleared 复核清空；unavailable 复核不可用（按首轮判定） */
  review: 'none' | 'confirmed' | 'cleared' | 'unavailable'
}

/**
 * 两轮判定的语义安全信号（首页助手入口使用）：首轮命中的类别必须再由复核提示词逐条确认，
 * 只有两轮都成立的类别才交给熔断分支。
 *
 * 复核承担的是「去掉误报」：2026-09-17 测试环境出现过教师转述学生打架被首轮判成
 * 暴力（SAFE-SEMANTIC-VIOLENCE）并直接熔断；首轮提示词已补判定标准与反例，复核是第二道。
 * 复核调用失败（超时、HTTP、解析）时保留首轮判定——安全侧不因技术失败放行；本地硬规则
 * 不经过这里，任何情况下都不会被削弱。
 */
export async function confirmedSemanticSafetySignals(
  event: H3Event,
  text: string,
  forceLocal = false,
  audit: SemanticSafetyAudit = {}
): Promise<SemanticSafetyVerdict> {
  const none: SemanticSafetyVerdict = { matchedRules: [], detectedRules: [], review: 'none' }
  if (forceLocal) return none
  const redacted = redactPii(text)
  const detected = await detectSemanticRisks(event, 'semantic_safety', { userText: redacted }, semanticSafetyTool, audit)
  if (!detected?.length) return none
  const detectedRules = detected.map(risk => riskRuleIds[risk])
  const confirmed = await detectSemanticRisks(event, 'semantic_safety_review', {
    userText: redacted,
    candidateRisks: detected.map(risk => riskLabels[risk]).join('、')
  }, semanticSafetyReviewTool, audit)
  if (confirmed === null) return { matchedRules: detectedRules, detectedRules, review: 'unavailable' }
  if (!confirmed.length) {
    // 首轮命中、复核清空：记产品事件便于观察误报率，不产生安全事件与转介
    await trackProductEvent(event, {
      schoolId: audit.schoolId ?? null,
      userId: audit.ownerUserId ?? null,
      eventName: 'assistant_semantic_safety_cleared',
      targetType: 'chat_session',
      targetId: audit.sessionId ?? undefined,
      metadata: { detected: detectedRules.join(',') }
    })
    return { matchedRules: [], detectedRules, review: 'cleared' }
  }
  return { matchedRules: confirmed.map(risk => riskRuleIds[risk]), detectedRules, review: 'confirmed' }
}


/**
 * 报告输出上限：显式声明为思考模式的服务端默认上限（64K）。
 * 思考模式下 reasoning token 也计入 completion_tokens，按正文长度估算会误判截断；
 * 显式声明后，一旦被截断会由 finish_reason 判定为 truncated 而不是「JSON 解析失败」。
 */
const REPORT_MAX_TOKENS = 64_000

export async function generateAssessmentReport(event: H3Event, input: {
  schoolId: string
  ownerUserId: string
  module: ModuleId
  result: RuleExecResult
  definition?: AssessmentDefinition
  /** 教师任教年级折算的学段：术语片段按文档「适用学部」过滤（不传则不过滤） */
  sections?: readonly SchoolSection[] | null
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
  // 术语白话对照：报告正文里的专业词来源于归因名称与依据、行动建议、工具步骤，
  // 以及输出模板渲染出的摘要/风险说明；先去知识库检索解释，再交给模型讲成白话。
  // 失败即空片段（buildTermGlossary 内部已降级），不阻断报告生成。
  const termTexts = [
    ...(input.result.attributions || []).flatMap(attribution => [attribution.name, ...(attribution.reasons || [])]),
    ...(input.result.reasons || []),
    ...(input.result.actions || []).map(action => `${action.title}\n${action.detail}`),
    ...(input.result.tools || []).map(tool => `${tool.title}\n${tool.content}`),
    fallback.profile.summary,
    fallback.risk.description
  ].filter((text): text is string => typeof text === 'string' && Boolean(text.trim()))
  const termChunks = termTexts.length
    ? await buildTermGlossary(event, {
      schoolId: input.schoolId,
      module: input.module,
      sections: input.sections,
      texts: termTexts
    })
    : []
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
    matchedRuleIds: input.result.matchedRuleIds,
    // 术语解释片段：只用于把上面这些文本里的专业词讲成白话，不得据此新增规则/等级/结论
    termChunks: termChunks.map(chunk => ({
      term: chunk.term,
      documentTitle: chunk.documentTitle,
      heading: chunk.heading,
      content: chunk.content,
      similarity: Number(chunk.similarity.toFixed(4))
    }))
  }
  const format = (() => {
    const base = { ...fallback, printMeta: { ...fallback.printMeta, source: 'ai' as const } }
    try {
      return JSON.stringify(assessmentReportSchema.parse(base))
    } catch {
      // fallback 来自确定性模板，个别旧模板渲染内容可能越界（如工具正文超长）。
      // 降级为未校验的 JSON 示例，避免提交 500；模型输出仍会被 validate 校验，
      // 非法输出走重试、耗尽后抛错（不再回退模板）。
      return JSON.stringify(base)
    }
  })()
  const rt = await getAiRuntimeConfig(event)
  const generatorModel = rt.generatorModel || config.deepseekGeneratorModel
  const prompt = await renderPrompt(event, 'assessment_report', {
    facts: JSON.stringify(facts),
    jsonFormat: format
  })
  if (!promptAvailable(prompt)) return fallback
  const messages: JsonChatMessage[] = []
  if (prompt.system) messages.push({ role: 'system', content: prompt.system })
  if (prompt.user) messages.push({ role: 'user', content: prompt.user })
  // 报告是全场最长输出，模型偶发超时/输出非法。为满足「必须输出 AI 深度报告」，失败时
  // 带反馈重试（与 tool_step_polish 的 3 次策略一致）；安全类校验（改等级/未知归因/违禁词）
  // 同样触发重试。重试耗尽仍失败时不再回退模板报告——这里抛错交给后台任务收敛为 failed，
  // 由方案页提示重新生成；只有「未配置密钥」或「高危熔断」这类「AI 不适用」场景才在函数
  // 顶部直接返回 fallback（模板报告），两者不是同一含义。
  //
  // 2026-09 迁移到统一 JSON 调用层：重试编排、逐次审计、截断判定与前缀化 error_code
  // 由 callJsonChatWithRetry 承担，这里只保留报告的解析与确定性字段覆盖。
  const MAX_REPORT_ATTEMPTS = 3
  const REPORT_RETRY_DELAY_MS = 3000
  const outcome = await callJsonChatWithRetry<AssessmentReport>({
    event,
    purpose: 'assessment_report',
    model: generatorModel,
    messages,
    // 思考模式下 reasoning token 也计入 completion_tokens：显式声明为默认上限 64K，
    // 使截断由 finish_reason 判定，而不是表现为「JSON 解析失败」
    maxTokens: REPORT_MAX_TOKENS,
    // 全局 DEEPSEEK_TIMEOUT_MS（如 30000）对生成模型偏短，实测多次 60s 超时；
    // DB 显式配置优先，其余情况不低于 360s。
    timeoutMs: rt.timeoutMs || Math.max(Number(config.deepseekTimeoutMs) || 0, 360000),
    temperature: 0.35,
    attempts: MAX_REPORT_ATTEMPTS,
    retryDelayMs: REPORT_RETRY_DELAY_MS,
    audit: { schoolId: input.schoolId, ownerUserId: input.ownerUserId },
    buildFeedback: failure =>
      `\n\n上次输出未通过校验：${failure.message}\n\n请修正后重新输出严格 JSON，字段结构必须与示例完全一致，并把未通过的字段收敛到示例允许的数量或长度。`,
    parse: (content) => {
      const report = validateAssessmentReport(JSON.parse(content), input.module, input.result)
      report.printMeta.source = 'ai'
      if (outputTemplates.length) {
        const deterministic = createTemplateAssessmentReport({ module: input.module, result: input.result, definition, outputTemplates })
        report.profile.summary = deterministic.profile.summary
        report.risk.description = deterministic.risk.description
      }
      return { value: report }
    }
  })
  if (!outcome.ok || !outcome.data) {
    // 禁止失败回退模板：重试耗尽仍无法产出合法 AI 报告时抛错，由调用方（后台增强）收敛为
    // failed 并保留事务内已写入的确定性标准报告，教师端据此提示「深度报告暂不可用」。
    throw new Error(`AI 深度报告生成失败：已重试 ${outcome.attempts} 次仍无法产出合法报告，最后错误：${outcome.failure?.message || '未知'}`)
  }
  return outcome.data
}

/**
 * 用大模型为教师咨询对话提炼一句简短中文标题（约 12~16 字）。
 * 输入已脱敏；无 DeepSeek Key、模型不可用或解析失败时返回 null，
 * 由调用方降级到 buildChatTitle 的截断法。
 */
export async function generateChatTitle(event: H3Event, messages: string[]): Promise<string | null> {
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) return null
  const rt = await getAiRuntimeConfig(event)
  // 标题是短输出、低风险任务：用 router 模型（更快更省），回答生成仍用 generator 模型
  const model = rt.routerModel || config.deepseekRouterModel
  const text = messages
    .map((message) => redactPii(message))
    .filter(Boolean)
    .join('\n')
    .slice(0, 400)
  if (!text.trim()) return null
  const startedAt = Date.now()
  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.deepseekApiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是中文对话标题助手。请为下面的教师咨询对话生成一句 12 到 16 个字的中文标题，概括对话的核心对象与问题。要求：不出现姓名、电话、邮箱等个人信息；不用引号、冒号、省略号等标点；只输出标题本身，不要任何解释或多余文字。' },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        max_tokens: 40,
        thinking: { type: 'disabled' }
      }),
      signal: AbortSignal.timeout(rt.timeoutMs && rt.timeoutMs < 5000 ? rt.timeoutMs : 5000)
    })
    if (!response.ok) throw new Error(`DeepSeek ${response.status}`)
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = json.choices?.[0]?.message?.content
    if (!content) return null
    const title = content.trim().replace(/[。！？!?，,、；;：:""''“”]/g, '').slice(0, 16)
    if (title.length < 4) return null
    return title
  } catch {
    console.warn('[chat] 标题生成失败，降级截断法:', `${Date.now() - startedAt}ms`)
    return null
  }
}

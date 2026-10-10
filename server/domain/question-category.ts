/**
 * 教师提问分类与关键词抽取（分角色数据看板 W2/W3 的统计地基）。
 *
 * 背景：看板的「AI 问答分布」按提问条数统计 6 个分类，并要有一个关键词 Top 榜。
 * 提问正文是加密列，无法用 SQL 聚合，因此分类与关键词必须在提问明文仍可用的
 * 入口（`server/api/v1/chat/messages.post.ts` 刚落库时）写进 chat_messages 的
 * question_category / question_category_source / question_category_confidence /
 * question_keywords 四列；历史数据由 `scripts/backfill-question-category.ts` 回填。
 *
 * 口径与降级（与产品确认）：
 *  - 规则优先：本地规则词表命中即返回（source=rule），不调用任何外部模型；
 *  - 规则未命中且学校数据模式非 local 时，调用一次模型分类（source=model，
 *    模型给出分数才写 confidence）；
 *  - 未配置密钥、提示词未发布、调用失败或输出非法，一律降级为「其他类」+ source=unknown；
 *  - 学校数据模式为 local 时绝不外发（localMode=true 直接 unknown），这是硬约束。
 *
 * 关键词：规则命中时用命中的规则词；模型抽取时要求原样出现在提问里，否则丢弃
 * （防编造做法同 `term-extraction.ts` 的 normalizeTerms），并额外丢弃含姓名/电话
 * 等个人信息、或含换行的词，最多 5 个。
 */
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getAiRuntimeConfig, isPromptPublished, promptAvailable, renderPrompt } from './ai-config'
import { redactPii } from '../integrations/deepseek'
import { callJsonChat, type JsonChatAuditContext, type JsonChatMessage } from '../integrations/json-chat'
import { schema, useDb, type DbClient } from '../utils/db'

/** 学生学习问题（对应模块 learning_problem 口径）。 */
export const QUESTION_CATEGORY_STUDENT_LEARNING = '学生学习问题'
/** 学生个体问题（对应模块 student_case 口径）。 */
export const QUESTION_CATEGORY_STUDENT_INDIVIDUAL = '学生个体问题'
/** 班级系统建设（对应模块 class_system 口径）。 */
export const QUESTION_CATEGORY_CLASS_SYSTEM = '班级系统建设'
/** 自我成长赋能（对应模块 self_growth 口径，含教师技能与家校沟通话术类提问）。 */
export const QUESTION_CATEGORY_SELF_GROWTH = '自我成长赋能'
/** 德育类问题（行为规范 / 违纪 / 宿舍量化 / 文明礼仪 / 值周评比；W3 不含该类）。 */
export const QUESTION_CATEGORY_MORAL_EDUCATION = '德育类问题'
/** 其他类（平台使用、账号、通知事务，以及无法归类的兜底）。 */
export const QUESTION_CATEGORY_OTHER = '其他类'

/**
 * 6 个分类（顺序与看板 W2 图例一致）；取值必须是这 6 个中文词，
 * 写入 chat_messages.question_category（varchar(40)）。
 */
export const QUESTION_CATEGORIES = [
  QUESTION_CATEGORY_STUDENT_LEARNING,
  QUESTION_CATEGORY_STUDENT_INDIVIDUAL,
  QUESTION_CATEGORY_CLASS_SYSTEM,
  QUESTION_CATEGORY_SELF_GROWTH,
  QUESTION_CATEGORY_MORAL_EDUCATION,
  QUESTION_CATEGORY_OTHER
] as const

export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number]

/** 分类中文标签（枚举取值本身即中文；保留映射供看板/前端按分类取展示名）。 */
export const QUESTION_CATEGORY_LABELS: Record<QuestionCategory, string> = {
  [QUESTION_CATEGORY_STUDENT_LEARNING]: '学生学习问题',
  [QUESTION_CATEGORY_STUDENT_INDIVIDUAL]: '学生个体问题',
  [QUESTION_CATEGORY_CLASS_SYSTEM]: '班级系统建设',
  [QUESTION_CATEGORY_SELF_GROWTH]: '自我成长赋能',
  [QUESTION_CATEGORY_MORAL_EDUCATION]: '德育类问题',
  [QUESTION_CATEGORY_OTHER]: '其他类'
}

/** 分类来源（写入 chat_messages.question_category_source，varchar(20)）。 */
export const QUESTION_CATEGORY_SOURCES = ['rule', 'model', 'unknown'] as const
export type QuestionCategorySource = (typeof QUESTION_CATEGORY_SOURCES)[number]

/** 单条提问最多保留的关键词数（与提示词口径一致：1-5 个）。 */
export const MAX_QUESTION_KEYWORDS = 5
/** 单个关键词的长度上限（提示词要求 2-12 字，代码多留余量后截断丢弃）。 */
export const MAX_QUESTION_KEYWORD_LENGTH = 20
/** 送模型分类的提问正文截断长度（分类只看开头足够）。 */
const MODEL_TEXT_MAX = 1200
/** 分类调用是简单任务，输出上限小即可（关闭思考，避免 reasoning token 挤占）。 */
const MODEL_MAX_TOKENS = 1024
const MODEL_TIMEOUT_MIN_MS = 5_000
const MODEL_TIMEOUT_MAX_MS = 30_000
const MODEL_TIMEOUT_DEFAULT_MS = 20_000

/** 规则分类结果（纯函数返回值）。 */
export interface RuleClassification {
  category: QuestionCategory
  /** 命中的规则词（原样出现在提问里），最多 MAX_QUESTION_KEYWORDS 个。 */
  keywords: string[]
}

/** 分类结果（规则 / 模型 / unknown 兜底共用）。 */
export interface QuestionCategoryResult {
  category: QuestionCategory
  source: QuestionCategorySource
  keywords: string[]
  /** 0-100 整数；只有模型给出分数时才有值，规则与兜底为 null。 */
  confidence: number | null
}

/**
 * 规则词表（按优先级从上到下匹配，命中即返回）。
 *
 * 词表来源：数据看板 PRD / 二级子页面分类统计看板原型的六类子项
 * （作业提交、课堂听讲、考试焦虑、情绪低落、人际冲突、课堂纪律、班委、座位、
 * 早读、宿舍量化、文明礼仪、值周评比、系统使用、数据导出…），先覆盖高频表述。
 * 顺序即优先级：越靠上的分类词越「专有」，避免「成绩」这类通用词把明确的
 * 德育/班级问题抢走；同一分类内命中的词都作为关键词返回。
 * 覆盖度需在真实提问上迭代（回填脚本的干跑会打印分类分布，便于调整词表）。
 */
export const QUESTION_CATEGORY_RULES: ReadonlyArray<{ category: QuestionCategory, keywords: readonly string[] }> = [
  {
    category: QUESTION_CATEGORY_MORAL_EDUCATION,
    keywords: [
      '德育', '品德', '行为规范', '文明礼仪', '礼仪', '校服', '仪容', '仪表', '文明班级',
      '违纪', '违规', '校规', '校纪', '处分', '记过', '值周', '量化', '宿舍', '就寝',
      '抽烟', '吸烟', '喝酒', '打架', '斗殴', '欺凌', '霸凌', '辱骂', '骂人', '脏话',
      '顶撞', '不尊重', '撒谎', '说谎', '作弊', '抄袭', '偷东西', '偷窃', '勒索',
      '感恩', '诚信', '责任感', '集体荣誉'
    ]
  },
  {
    category: QUESTION_CATEGORY_CLASS_SYSTEM,
    keywords: [
      '课堂纪律', '上课纪律', '课堂秩序', '课堂管理', '班级纪律', '纪律', '班规', '班级公约', '公约',
      '班风', '学风', '班干部', '班委', '班长', '课代表', '班级活动', '班级建设', '班级文化',
      '班级氛围', '凝聚力', '早读', '自习', '课间', '排队', '路队', '座位', '调座位', '换座',
      '值日', '卫生', '黑板报', '板报', '考勤', '迟到', '旷课', '请假', '小组', '分组',
      '集体活动', '运动会', '上课说话', '上课讲话', '课堂讲话', '扰乱课堂'
    ]
  },
  {
    category: QUESTION_CATEGORY_STUDENT_LEARNING,
    keywords: [
      '作业', '交作业', '听讲', '专注', '走神', '分心', '注意力', '考试', '考前', '测验', '测试',
      '成绩', '分数', '排名', '复习', '预习', '错题', '知识点', '学习方法', '偏科', '听不懂',
      '跟不上', '做题', '答题', '背诵', '默写', '听写', '阅读理解', '作文', '阅读', '计算',
      '学业', '升学', '中考', '高考', '及格'
    ]
  },
  {
    category: QUESTION_CATEGORY_STUDENT_INDIVIDUAL,
    keywords: [
      '情绪', '心情', '心理', '自卑', '孤僻', '内向', '敏感', '抑郁', '易怒', '暴躁', '发脾气',
      '哭', '厌学', '人际', '同学关系', '同伴', '交朋友', '被孤立', '孤立', '排挤', '矛盾', '冲突',
      '早恋', '恋爱', '青春期', '叛逆', '家庭变故', '父母离异', '离异', '单亲', '留守', '手机',
      '游戏', '沉迷', '网瘾', '熬夜', '睡眠', '失眠', '睡不着', '性格', '脾气'
    ]
  },
  {
    category: QUESTION_CATEGORY_SELF_GROWTH,
    keywords: [
      '职业倦怠', '倦怠', '撑不住', '快崩溃', '干不下去', '不想干', '想辞职', '心累', '太累',
      '疲惫', '内耗', '自我怀疑', '不自信', '自我成长', '专业发展', '专业成长', '教师成长',
      '能力提升', '培训', '职称', '公开课', '赛课', '课题', '论文', '情绪管理', '自我调节',
      '心理调适', '压力', '倾诉', '委屈', '家校沟通', '家长沟通', '沟通话术', '话术',
      '沟通技巧', '怎么跟家长说', '怎么和家长说', '家长不配合', '家访', '班会', '班会设计',
      '班级管理', '时间管理'
    ]
  },
  {
    category: QUESTION_CATEGORY_OTHER,
    keywords: [
      '系统使用', '功能建议', '账号', '密码', '登录', '注册', '数据导出', '导出', '怎么用',
      '使用说明', '操作步骤', '平台', '软件', '表格', '模板', '通知', '会议', '值班', '食堂',
      '校车', '放假', '招生', '政策', '文件', '报销', '打卡'
    ]
  }
]

/** 分类取值是否是 6 个合法分类之一（读库/看板参数校验用）。 */
export function isQuestionCategory(value: unknown): value is QuestionCategory {
  return typeof value === 'string' && (QUESTION_CATEGORIES as readonly string[]).includes(value)
}

/**
 * 规则分类（纯函数）：按 QUESTION_CATEGORY_RULES 顺序找到第一个有命中的分类，
 * 返回该分类与命中的规则词（按在提问中首次出现的位置排序，最多 5 个）。
 * 未命中返回 null，由调用方决定走模型还是降级「其他类」。
 */
export function classifyByRules(text: string): RuleClassification | null {
  const source = typeof text === 'string' ? text : ''
  if (!source.trim()) return null
  for (const rule of QUESTION_CATEGORY_RULES) {
    const hits = rule.keywords.filter(keyword => source.includes(keyword))
    if (!hits.length) continue
    hits.sort((a, b) => {
      const diff = source.indexOf(a) - source.indexOf(b)
      return diff !== 0 ? diff : b.length - a.length
    })
    return { category: rule.category, keywords: hits.slice(0, MAX_QUESTION_KEYWORDS) }
  }
  return null
}

/**
 * 关键词清洗（纯函数，供单测）：只保留「原样来自输入文本、长度合规、不含个人信息、
 * 不重复」的词，最多 max 个，保持模型输出顺序。做法对齐 term-extraction.normalizeTerms。
 */
export function normalizeQuestionKeywords(keywords: unknown, sourceText: string, max = MAX_QUESTION_KEYWORDS): string[] {
  if (!Array.isArray(keywords)) return []
  const source = typeof sourceText === 'string' ? sourceText : ''
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of keywords) {
    if (typeof item !== 'string') continue
    const keyword = item.trim()
    if (keyword.length < 2 || keyword.length > MAX_QUESTION_KEYWORD_LENGTH) continue
    // 关键词是短词/短句，不跨行
    if (/[\r\n]/.test(keyword)) continue
    // 防编造：词必须原样出现在输入文本里
    if (!source.includes(keyword)) continue
    // 最小披露：关键词不进加密列，含电话/邮箱/姓名等个人信息的一律丢弃
    if (redactPii(keyword) !== keyword) continue
    if (seen.has(keyword)) continue
    seen.add(keyword)
    result.push(keyword)
    if (result.length >= max) break
  }
  return result
}

/** 置信度归一（纯函数）：接受 0-100 整数或 0-1 小数，非法/缺失返回 null（不写该列）。 */
export function normalizeQuestionConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const scaled = value > 0 && value <= 1 ? value * 100 : value
  const rounded = Math.round(scaled)
  return rounded >= 0 && rounded <= 100 ? rounded : null
}

/** 模型输出结构：只强约束 category；keywords/confidence 由纯函数清洗，避免一处格式偏差整条作废。 */
const modelOutputSchema = z.object({
  category: z.enum(QUESTION_CATEGORIES),
  keywords: z.unknown().optional(),
  confidence: z.unknown().optional()
})

export interface ClassifyQuestionInput {
  /** 提问明文（规则在本地匹配；送模型前会先经 redactPii）。 */
  text: string
  /** true = 学校数据模式为 local：绝不调用外部模型，规则未命中直接 unknown。 */
  localMode: boolean
  /** 模型调用审计上下文（只记元数据，不记提问正文）。 */
  audit?: JsonChatAuditContext
}

/**
 * 模型分类（单次调用）：未配置密钥、提示词未发布、调用失败或输出非法一律返回 null，
 * 由调用方降级为「其他类」+ source=unknown，不抛错、不阻断调用方。
 */
export async function classifyQuestionByModel(
  event: H3Event,
  input: { question: string, audit?: JsonChatAuditContext }
): Promise<QuestionCategoryResult | null> {
  try {
    const config = useRuntimeConfig(event)
    if (!config.deepseekApiKey) return null
    if (!(await isPromptPublished(event, 'assistant_question_category'))) return null

    // 合规硬要求：外发文本先脱敏（电话/邮箱/姓名）
    const question = redactPii(typeof input.question === 'string' ? input.question : '').trim().slice(0, MODEL_TEXT_MAX)
    if (!question) return null

    const prompt = await renderPrompt(event, 'assistant_question_category', {
      question,
      jsonFormat: JSON.stringify({ category: QUESTION_CATEGORY_STUDENT_LEARNING, keywords: ['作业', '成绩'], confidence: 85 })
    })
    if (!promptAvailable(prompt)) return null

    const rt = await getAiRuntimeConfig(event)
    const model = rt.generatorModel || config.deepseekGeneratorModel
    const timeoutMs = Math.max(
      MODEL_TIMEOUT_MIN_MS,
      Math.min(rt.timeoutMs || Number(config.deepseekTimeoutMs) || MODEL_TIMEOUT_DEFAULT_MS, MODEL_TIMEOUT_MAX_MS)
    )

    const messages: JsonChatMessage[] = []
    if (prompt.system) messages.push({ role: 'system', content: prompt.system })
    if (prompt.user) messages.push({ role: 'user', content: prompt.user })

    const outcome = await callJsonChat<z.infer<typeof modelOutputSchema>>({
      event,
      purpose: 'question_category',
      model,
      messages,
      maxTokens: MODEL_MAX_TOKENS,
      timeoutMs,
      temperature: 0,
      // 分类是简单任务：关闭思考，避免拖长耗时（与回答生成并行走，不阻塞 SSE）
      thinking: 'disabled',
      audit: input.audit,
      parse: content => ({ value: modelOutputSchema.parse(JSON.parse(content)) })
    })
    if (!outcome.ok || !outcome.data) return null
    return {
      category: outcome.data.category,
      source: 'model',
      keywords: normalizeQuestionKeywords(outcome.data.keywords, question),
      confidence: normalizeQuestionConfidence(outcome.data.confidence)
    }
  } catch (error) {
    console.warn('[question-category] 模型分类失败，降级为其他类:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * 完整分类（不写库）：规则优先 → 非 local 才调模型 → 模型不可用/失败降级「其他类」+ unknown。
 * 供回填脚本复用（脚本自行决定是否落库），聊天入口用下面的 classifyQuestionCategory。
 */
export async function classifyQuestion(event: H3Event, input: ClassifyQuestionInput): Promise<QuestionCategoryResult> {
  const rule = classifyByRules(input.text)
  if (rule) return { category: rule.category, source: 'rule', keywords: rule.keywords, confidence: null }
  if (!input.localMode) {
    const model = await classifyQuestionByModel(event, { question: input.text, audit: input.audit })
    if (model) return model
  }
  return { category: QUESTION_CATEGORY_OTHER, source: 'unknown', keywords: [], confidence: null }
}

/**
 * 按消息 id 写回四个分类列（租户 + 归属一起进 where，避免越权更新）。
 * 注意：question_keywords 是密文列的明文投影，只存清洗后的短词，不存正文。
 */
export async function persistQuestionCategory(db: DbClient, input: {
  messageId: string
  schoolId: string
  ownerUserId: string
  result: QuestionCategoryResult
}): Promise<void> {
  await db.update(schema.chatMessages).set({
    questionCategory: input.result.category,
    questionCategorySource: input.result.source,
    questionCategoryConfidence: input.result.confidence,
    questionKeywords: input.result.keywords
  }).where(and(
    eq(schema.chatMessages.id, input.messageId),
    eq(schema.chatMessages.schoolId, input.schoolId),
    eq(schema.chatMessages.ownerUserId, input.ownerUserId)
  ))
}

export interface ClassifyQuestionCategoryInput extends ClassifyQuestionInput {
  /** 刚落库的提问消息 id（role='user'）。 */
  messageId: string
  schoolId: string
  ownerUserId: string
  sessionId?: string | null
}

/**
 * 聊天入口用：分类 + 按消息 id 落库。提问正文是加密列，因此分类与关键词必须在
 * 入口明文仍可用时写库；调用方（messages.post.ts）不 await、不阻塞 SSE，
 * 失败只影响分类、不影响回答。
 */
export async function classifyQuestionCategory(
  event: H3Event,
  input: ClassifyQuestionCategoryInput
): Promise<QuestionCategoryResult> {
  const result = await classifyQuestion(event, {
    text: input.text,
    localMode: input.localMode,
    audit: { schoolId: input.schoolId, ownerUserId: input.ownerUserId, sessionId: input.sessionId ?? null }
  })
  await persistQuestionCategory(useDb(event), {
    messageId: input.messageId,
    schoolId: input.schoolId,
    ownerUserId: input.ownerUserId,
    result
  })
  return result
}

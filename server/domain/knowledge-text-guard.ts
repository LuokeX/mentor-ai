/**
 * 知识片段与教师正文的文本防线（纯函数）。
 *
 * 背景：向量知识库（module_resource_chunks）里的内容会被检索出来交给模型，
 * 再写进教师看到的方案正文。本地库实测：1036 篇独立文档里有 28 篇是
 *「输出模板·/分级规则·/红线·/路由·/禁忌·」前缀的内部规则文档（36 段切块），
 * 另有 139 段含「危机/预警/红线」、121 段含「六力/A-E/SOP/OTC」这类内部编码。
 * 这些内容属于平台内部运行规则或内部体系名，不得进入教师正文，因此在检索
 * 结果进入模型之前整段丢弃；改写/报告生成完成后，再用同一份规则检查输出正文。
 *
 * 两档出口口径：
 *  - findBannedTerms：知识片段过滤、字段过滤与出口检查基线共用（红线词 + 内部编码）；
 *  - findOutboundBannedTerms：只给「模型产出教师正文」的出口用，额外含技术编号
 *    （T1-T12）、流程编号（S0-S5）、响应分级（L1-L3）、维度字母与「六维」这类
 *    内部标注——它们夹在有效内容里，按整段丢弃会连带丢知识，改由出口重试纠正。
 *
 * 设计约束：
 *  - 纯函数：不访问数据库、不调用模型、不抛错；
 *  - 匹配口径「宽松识别、不误伤」——红线词容忍空格与分隔/拆写（「危 机」「红-线」），
 *    数字（110/120）按独立数字序列匹配，ASCII 内部编码按词边界匹配（避免 SOPHIA 误伤）；
 *  - 只做「丢弃/命中判定」，不改写片段正文。
 */

/** 三库自动生成的内部规则文档标题前缀（review 第 458 条：这些文档不得被 AI 当作知识外发）。 */
export const INTERNAL_DOC_TITLE_PREFIXES: readonly string[] = [
  '输出模板·',
  '分级规则·',
  '红线·',
  '路由·',
  '禁忌·'
] as const

/** 可按「去分隔符后包含」匹配的中文红线词（面向教师文本不得出现）。 */
const REDLINE_WORDS: readonly string[] = ['危机', '红线', '预警', '立即'] as const
/** 数字形态的红线词：必须按独立数字序列匹配，避免「1100 字」「2024 年」误伤。 */
const REDLINE_DIGITS: readonly string[] = ['110', '120'] as const
/** 内部编码（体系名 / 规则编码）：ASCII 项按词边界、大小写不敏感匹配。 */
const INTERNAL_CODES_ASCII: readonly string[] = ['A-E', 'ERG', 'SOP', 'OTC', 'CIPS', 'BPNSF', 'ACTR-M'] as const
/** 内部编码：中文项按去分隔符后的包含匹配。 */
const INTERNAL_CODES_CJK: readonly string[] = ['六力', 'R类', 'O类', 'Y类'] as const

/**
 * 出口专用内部标注（技术编号 / 流程编号 / 响应分级 / 维度字母 / 体系名）。
 *
 * 与 INTERNAL_CODES_* 同属「教师正文不得出现」的措辞，区别在处置方式：这些标注
 * 大量夹在承载有效内容的三库步骤与知识正文里（本地库实测 1053 段知识片段中，
 * 66 段含 T 编号、32 段含 S 编号、35 段含 L 编号、45 段含维度字母）。若并入
 * 知识片段过滤口径，会连同片段里的可用内容一起整段丢掉；它们只是引用写法，
 * 应该由改写/生成环节换成教师看得懂的中文名称，而不是删掉承载它的正文。
 *
 * 因此这些规则只参与「教师正文出口检查」（findOutboundBannedTerms）：
 * 方案改写、报告生成命中即带反馈重试或判失败，知识片段过滤（filterKnowledgeChunks）
 * 与字段过滤（findBannedTerms）保持原有口径不扩大。
 *
 * 匹配口径「按上下文、不误伤」：技术编号/流程编号/分级号要求前后不是字母数字
 * （T13、T1D、SOP、STM32、L4 不命中）；维度字母只在「维度 D」「D 级」「D、E 两维」
 * 「D/E 级」「A 到 E」这类明确语境命中，单个字母不命中。
 */
const OUTBOUND_MARKER_PATTERNS: readonly RegExp[] = [
  // 干预技术编号 T1-T12（含 T4+ / T11+ 变体）
  /(?<![A-Za-z0-9])T(?:1[0-2]|[1-9])\+?(?![0-9A-Za-z])/,
  // 诊疗流程编号 S0-S5（含 S0a / S0c 这类子步骤；SOP、S6、STM32 不命中）
  /(?<![A-Za-z0-9])S[0-5][a-d]?(?![0-9A-Za-z])/,
  // 三级响应编号 L1-L3（L1 班级自主 / L2 年级协同 / L3 中心会商；L4 不命中）
  /(?<![A-Za-z0-9])L[1-3](?![0-9A-Za-z])/,
  // 能力维度字母等级：只在明确语境命中，单个字母与「5A 级」这类写法不命中
  /维度\s*[A-E]/,
  /(?<![0-9A-Za-z])[A-E]\s*[、/]\s*[A-E][^\n。；]{0,4}维/,
  /(?<![0-9A-Za-z])[A-E]\s*级/,
  /[A-E]\s*到\s*[A-E]/,
  // 内部体系名：六维能力评估（教师侧表述为「六个方面」）
  /六维/
]

/** 片段丢弃原因（固定顺序，供日志与测试断言）。 */
export type KnowledgeGuardReason = 'internal_document' | 'redline_wording' | 'internal_code'
const REASON_ORDER: readonly KnowledgeGuardReason[] = ['internal_document', 'redline_wording', 'internal_code'] as const

/** 判定片段所需的最小形状（知识检索结果与术语片段都满足）。 */
export interface GuardableChunk {
  content: string
  documentTitle?: string | null
  heading?: string | null
}

/** 空白与常见分隔符：红线词/中文编码判定前先去掉，用于识别「危 机」「红-线」这类拆写。 */
const SEPARATORS = /[\s\u00a0·•*＊\-—–_/\\|、,，.。:：;；!！?？'"“”‘’()（）[\]【】{}<>《》]+/g

function stripSeparators(text: string): string {
  return text.replace(SEPARATORS, '')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 独立数字序列匹配：前后不能再是数字。 */
function hasStandaloneDigits(text: string, digits: string): boolean {
  return new RegExp(`(?<!\\d)${digits}(?!\\d)`).test(text)
}

/** 内部编码的 ASCII 词：前后不能是字母或数字，大小写不敏感。 */
function hasWholeAsciiToken(text: string, token: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(token)}(?![A-Za-z0-9])`, 'i').test(text)
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 命中红线词（去重、保持规则定义顺序）；无命中返回空数组。 */
function findRedlineHits(text: string): string[] {
  const source = toText(text)
  if (!source.trim()) return []
  const compact = stripSeparators(source)
  const hits: string[] = []
  for (const word of REDLINE_WORDS) {
    if (compact.includes(word)) hits.push(word)
  }
  for (const digits of REDLINE_DIGITS) {
    if (hasStandaloneDigits(source, digits)) hits.push(digits)
  }
  return hits
}

/** 命中内部编码（去重、保持规则定义顺序）；无命中返回空数组。 */
function findInternalCodeHits(text: string): string[] {
  const source = toText(text)
  if (!source.trim()) return []
  const compact = stripSeparators(source)
  const hits: string[] = []
  for (const code of INTERNAL_CODES_ASCII) {
    if (hasWholeAsciiToken(source, code)) hits.push(code)
  }
  for (const code of INTERNAL_CODES_CJK) {
    if (compact.includes(code)) hits.push(code)
  }
  return hits
}

/** 命中出口专用内部标注（技术编号/流程编号/分级号/维度字母/体系名），返回匹配到的原文片段。 */
function findOutboundMarkerHits(text: string): string[] {
  const source = toText(text)
  if (!source.trim()) return []
  const hits: string[] = []
  for (const pattern of OUTBOUND_MARKER_PATTERNS) {
    const match = source.match(pattern)
    if (match) hits.push(match[0].trim())
  }
  return hits
}

/**
 * 命中基线：面向教师的文本里不得出现的词与内部编码。返回顺序固定为
 * 红线词 → 内部编码的 ASCII 项 → 内部编码的中文项，各组内按规则定义顺序，去重。
 * 空输入、非法输入返回空数组，绝不抛错。
 * 用于改写/报告生成完成后的出口检查：命中即判该次输出不合格。
 * 注意：不含「出口专用内部标注」（T1-T12 / S0-S5 / L1-L3 / 维度字母 / 六维），
 * 那些只在 findOutboundBannedTerms 里检查，避免知识片段与字段过滤时误伤。
 */
export function findBannedTerms(text: string): string[] {
  try {
    return [...new Set([...findRedlineHits(text), ...findInternalCodeHits(text)])]
  } catch {
    return []
  }
}

/**
 * 教师正文出口检查的完整口径：在 findBannedTerms 基础上追加「出口专用内部标注」。
 *
 * 用于 AI 改写（tool-step-polish）、报告生成（reports）等「模型产出教师正文」的
 * 出口：命中即回传错误触发带反馈重试，覆盖不了则不落库/判失败。返回顺序固定为
 * 红线词 → 内部编码 → 内部标注（按 OUTBOUND_MARKER_RULES 定义顺序），去重。
 * 知识片段过滤（filterKnowledgeChunks）与字段过滤继续用 findBannedTerms。
 */
export function findOutboundBannedTerms(text: string): string[] {
  try {
    return [...new Set([...findBannedTerms(text), ...findOutboundMarkerHits(text)])]
  } catch {
    return []
  }
}

/** 判定单个片段应否丢弃；返回 null 表示保留。 */
function resolveDropReason(chunk: GuardableChunk | null | undefined): KnowledgeGuardReason | null {
  if (!chunk) return null
  const title = toText(chunk.documentTitle).trim()
  if (title && INTERNAL_DOC_TITLE_PREFIXES.some(prefix => title.startsWith(prefix))) return 'internal_document'
  const content = toText(chunk.content)
  if (findRedlineHits(content).length) return 'redline_wording'
  if (findInternalCodeHits(content).length) return 'internal_code'
  return null
}

/**
 * 过滤知识片段：标题命中内部规则文档前缀、或正文命中红线词/内部编码的整段丢弃。
 *
 * 返回保留顺序不变的 kept、丢弃条数 dropped，以及本次出现的丢弃原因种类
 * （按 REASON_ORDER 固定顺序、去重），便于日志观测与测试断言。
 * 极端情况下（例如传入非法结构）按「全部丢弃」处理并告警：宁可少给知识，
 * 也不能让内部规则或红线词进入教师正文。
 */
export function filterKnowledgeChunks<T extends GuardableChunk>(
  chunks: T[]
): { kept: T[], dropped: number, reasons: KnowledgeGuardReason[] } {
  const list = Array.isArray(chunks) ? chunks : []
  try {
    const kept: T[] = []
    const seen = new Set<KnowledgeGuardReason>()
    for (const chunk of list) {
      const reason = resolveDropReason(chunk)
      if (reason) {
        seen.add(reason)
        continue
      }
      kept.push(chunk)
    }
    return {
      kept,
      dropped: list.length - kept.length,
      reasons: REASON_ORDER.filter(reason => seen.has(reason))
    }
  } catch (error) {
    console.warn('[knowledge-text-guard] 片段过滤异常，本次全部丢弃:',
      error instanceof Error ? error.message : error)
    return { kept: [], dropped: list.length, reasons: [] }
  }
}

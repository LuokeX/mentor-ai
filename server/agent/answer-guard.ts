/**
 * 回答后确定性校验（answer guard）。
 *
 * 背景：提示词已经要求「不输出模块英文 ID、不输出字段名、不在正文写来源标注、不把无依据内容说成平台规定」，
 * 但这些约束此前只靠模型自觉——代码不做任何检查。本模块在回答落库前做一次确定性检查：
 *  - 清理类：确定能安全修正的（来源标注、时长信息、模块英文 ID、内部字段名、外发脱敏占位符）直接改掉；
 *  - 告警类：不能自动修正的（诊断性表述、无依据的规范性表述、疑似密钥/哈希）只记录，不改写正文，
 *    由产品事件与 AI 中心观察，避免为了一句措辞把整段回答重写一遍（成本与延迟都不划算）。
 *
 * 设计约束：
 *  - 纯函数：不访问数据库、不调用模型、不抛错；
 *  - 清理后若只剩空内容或标点，必须回退返回原文，绝不能把回答清空；
 *  - 只做「删除/替换」，不做改写，避免改变语义。
 */
import { moduleMeta } from '../../shared/assessments'
import type { ModuleId } from '../../shared/contracts'

export type AnswerViolationCode =
  | 'module_id_leak'
  | 'internal_field_name'
  | 'source_citation_in_body'
  | 'estimated_minutes_claim'
  | 'placeholder_leak'
  | 'diagnostic_claim'
  | 'unbacked_policy_claim'
  | 'secret_like_token'

export interface AnswerInspectionInput {
  answer: string
  sources?: Array<{ chunkId?: string }> | null
  toolCalls?: unknown[] | null
}

export interface AnswerInspectionResult {
  /** 清理后的正文；无需清理时为原文 */
  cleaned: string
  /** 命中项（可多条）；用于审计与观测，不面向教师展示 */
  violations: AnswerViolationCode[]
}

const MODULE_IDS: ModuleId[] = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']

/** 只属于界面组件的内部字段名：出现在正文里说明模型把内部结构说给了教师。 */
const INTERNAL_FIELD_NAMES = ['module', 'reason', 'ctaLabel', 'assessmentCode', 'actionCard', 'kind']

/** 诊断性表述（提示词已禁止，这里只告警不改写）。 */
const DIAGNOSTIC_PATTERNS = [
  /确诊/,
  /抑郁症|焦虑症|多动症|自闭症|孤独症/,
  /(治愈|根治)/,
  /(一定能|保证能?好|保证提升|百分百)/,
  /医学诊断/
]

/** 把无依据内容说成规范性要求的表述（只在没有引用来源时告警）。 */
const POLICY_PATTERNS = [/平台规定/, /平台要求/, /工具库要求/, /学校要求/, /制度要求/]

/** 疑似密钥/哈希：32 位以上连续无空白字符。 */
const SECRET_LIKE_PATTERNS = [/[A-Za-z0-9+/]{32,}={0,2}/, /[a-f0-9]{32,}/i, /[A-Za-z]+Enc\b/]

/** 脱敏占位符后可能跟随的称谓（与 `deepseek.ts` 的 redactPii 保持同一口径）。 */
const PERSON_TITLES = '老师|同学|妈妈|爸爸|家长'

/** 删除正文里的来源标注（界面会单独展示引用来源，正文重复标注属于内部结构外泄）。 */
function stripSourceCitations(text: string): { text: string, hit: boolean } {
  const stripped = text.replace(/[（(【\[]\s*来源\s*[：:][^）)】\]]*[）)】\]]/g, '')
  return { text: stripped, hit: stripped !== text }
}

/** 删除「约 N 分钟」这类只属于推荐卡的时长信息。 */
function stripEstimatedMinutes(text: string): { text: string, hit: boolean } {
  const stripped = text.replace(/(大约|预计|约)\s*\d+\s*(分钟|min\b|个小时|小时)/gi, '')
  return { text: stripped, hit: stripped !== text }
}

/** 模块英文 ID → 中文模块名（直接删会把句子拆断，替换更自然）。 */
function replaceModuleIds(text: string): { text: string, hit: boolean } {
  let result = text
  let hit = false
  for (const module of MODULE_IDS) {
    if (!result.includes(module)) continue
    const title = moduleMeta[module]?.title || module
    result = result.split(module).join(title)
    hit = true
  }
  return { text: result, hit }
}

/** 删除内部字段名（只处理明显的字段标注形态，避免误伤正常用词）。 */
function stripInternalFieldNames(text: string): { text: string, hit: boolean } {
  let result = text
  let hit = false
  const names = INTERNAL_FIELD_NAMES.join('|')
  const backticked = new RegExp('`(?:' + names + ')`', 'g')
  const labelled = new RegExp('(^|[\\s（(、,，。；;：!！?？])(?:' + names + ')\\s*[：:]', 'g')
  if (backticked.test(result) || labelled.test(result)) hit = true
  result = result.replace(backticked, '')
  result = result.replace(labelled, '$1')
  // 括号内只剩字段名的情况（如「（module）」）
  const bracketOnly = new RegExp('[（(]\\s*(?:' + names + ')\\s*[）)]', 'g')
  if (bracketOnly.test(result)) hit = true
  result = result.replace(bracketOnly, '')
  return { text: result, hit }
}

/**
 * 清理外发脱敏占位符：模型偶尔会复读上下文里见过的 [PERSON]/[PHONE]/[EMAIL]（见 deepseek.ts 的 redactPii），
 * 这些是内部记号，绝不该让教师看到。
 * 能确定自然说法的先补回量词（「两[PERSON]家长」→「两位家长」），其余删掉占位符、保留称谓。
 */
function stripPlaceholderLeaks(text: string): { text: string, hit: boolean } {
  let result = text
  let hit = false
  result = result.replace(
    new RegExp(`([两二三四五六七八九十各每])\\[PERSON\\](?=${PERSON_TITLES})`, 'g'),
    (_, quantifier: string) => {
      hit = true
      return `${quantifier}位`
    }
  )
  const beforeTitle = new RegExp(`\\[PERSON\\](?=${PERSON_TITLES})`, 'g')
  if (beforeTitle.test(result)) hit = true
  result = result.replace(beforeTitle, '')
  // 不带称谓的残留：用自然指代兜底，避免留下「跟说一声」这类残句
  if (/\[PERSON\]/.test(result)) hit = true
  result = result.replace(/\[PERSON\]/g, '对方')
  if (/\[(?:PHONE|EMAIL)\]/.test(result)) hit = true
  result = result.replace(/\[(?:PHONE|EMAIL)\]/g, '')
  return { text: result, hit }
}

/** 清理残留：空括号、标点前的空格、句首多余标点、连续空行。 */
function tidyWhitespace(text: string): string {
  return text
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/[ \t]+([，。；：！？、])/g, '$1')
    .replace(/([，、]){2,}/g, '$1')
    .replace(/^[\s，、；：]+/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 检查并清理一条模型回答。
 * 返回的 violations 只用于审计与观测；cleaned 是准备落库/展示的文本。
 */
export function inspectAgentAnswer(input: AnswerInspectionInput): AnswerInspectionResult {
  const violations: AnswerViolationCode[] = []
  try {
    const original = typeof input.answer === 'string' ? input.answer : ''
    if (!original.trim()) return { cleaned: original, violations }

    let text = original

    const citation = stripSourceCitations(text)
    text = citation.text
    if (citation.hit) violations.push('source_citation_in_body')

    const minutes = stripEstimatedMinutes(text)
    text = minutes.text
    if (minutes.hit) violations.push('estimated_minutes_claim')

    const modules = replaceModuleIds(text)
    text = modules.text
    if (modules.hit) violations.push('module_id_leak')

    const fields = stripInternalFieldNames(text)
    text = fields.text
    if (fields.hit) violations.push('internal_field_name')

    const placeholders = stripPlaceholderLeaks(text)
    text = placeholders.text
    if (placeholders.hit) violations.push('placeholder_leak')

    const hasSources = Array.isArray(input.sources) && input.sources.length > 0
    if (!hasSources && POLICY_PATTERNS.some(pattern => pattern.test(text))) {
      violations.push('unbacked_policy_claim')
    }
    if (DIAGNOSTIC_PATTERNS.some(pattern => pattern.test(text))) {
      violations.push('diagnostic_claim')
    }
    if (SECRET_LIKE_PATTERNS.some(pattern => pattern.test(text))) {
      violations.push('secret_like_token')
    }

    const cleaned = tidyWhitespace(text)
    // 兜底：清理后为空或只剩标点时必须回退原文，避免把回答清空
    if (!cleaned || !/[\u3400-\u9fffA-Za-z0-9]/.test(cleaned)) {
      return { cleaned: original, violations }
    }
    return { cleaned, violations }
  } catch (error) {
    console.error('[answer-guard] 校验失败，按原文返回:', error instanceof Error ? error.message : error)
    return { cleaned: typeof input.answer === 'string' ? input.answer : '', violations }
  }
}

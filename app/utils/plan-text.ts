/**
 * 方案正文的结构化排版（展示层纯函数）。
 *
 * 背景：方案页「具体实施方案」与「方案执行」里的正文，无论来自三库机械条目还是
 * AI 改写结果，都是「一行一句、句子之间用换行分隔」的纯文本。过去只用
 * `whitespace-pre-line` 原样铺开：行动标题、关键词、列举项和建议正文看起来完全一样，
 * 教师得自己从一大段文字里找重点。
 *
 * 这里只决定「怎么显示」——不改写、不增删任何文字内容，也不调用模型：
 *  - 行首序数（`一、` / `1.` / `①` / `•`）拆成行动小标题与列表项，标记单独成列；
 *  - `—— 配套工具：…` 作为子标题，与建议正文区分开；
 *  - 单条目方案块的裸标题行（`使用工具「…」` / `针对「…」`）同样按小标题渲染；
 *  - `提示：` `话术：` `达标：` `班级管理能力：` 这类短标签加粗；
 *  - 行内短「」引号内容（关键词）加粗，长「」引号内容（教师可直接用的话术）按引用着色；
 *  - 其余每行是一个正文段落，段落之间留出间距。
 *
 * 渲染层按段落输出文本节点，不使用 v-html：模型输出不会作为 HTML 执行。
 */

export type PlanTextBlockKind = 'heading' | 'subheading' | 'step' | 'paragraph'

export type PlanTextEmphasis = 'keyword' | 'quote' | 'label'

export interface PlanTextSegment {
  text: string
  /** keyword：关键词加粗；quote：整句引用/话术着色；label：行首短标签加粗 */
  emphasis?: PlanTextEmphasis
}

export interface PlanTextBlock {
  kind: PlanTextBlockKind
  /** 左侧序数标记（`一、` / `1.` / `①` / `•` / `——`），无标记时省略 */
  marker?: string
  segments: PlanTextSegment[]
}

/** 「」内不超过该字符数的内容按关键词加粗，更长的按整句引用着色（如可直接开口的话术）。 */
const KEYWORD_MAX_LENGTH = 14

/** 中文序号行动标题：`一、针对「任务过载」`（方案块多条目时的口径）。 */
const CN_HEADING = /^([一二三四五六七八九十]+)\s*[、.．]\s*(.+)$/
/** 阿拉伯数字列表项：`1. 结构化沟通三步法`（三库机械条目的步骤口径）。 */
const NUMBER_STEP = /^(\d{1,2})\s*[、.．)）]\s*(.+)$/
/** 带圈数字列表项：`①做老师以来…`（AI 改写偶尔用带圈序号列举）。 */
const CIRCLED_STEP = /^([\u2460-\u2473\u2488-\u249b])\s*(.+)$/
/** 圆点列表项：`• 先做一次提前说明`。 */
const BULLET_STEP = /^[-*•·▪]\s+(.+)$/
/** 并入归因动作正文的配套工具块：`—— 配套工具：同事深度对话卡`。 */
const TOOL_BLOCK = /^——\s*(.+)$/
/** 行首短标签：`话术：…`。先按宽度和标点筛，再由标签词汇表判定。 */
const LABEL_LINE = /^([^：:，。；！？、「」]{2,12})[：:]\s*(.+)$/
/** 无序号标题行：`使用工具「责任边界思维」`、`针对「任务过载」`——短、带引号、无句读。 */
const BARE_HEADING = /^[^，。！？；：、,]{0,22}「[^」]{1,40}」[^，。！？；：、,]{0,8}$/
/** 无序号标题行的总长度上限：超过这个长度是正文句子，不是标题。 */
const BARE_HEADING_MAX_LENGTH = 32
/** 行内强调：Markdown 粗体（模型偶尔残留）与中文引号。 */
const INLINE_PATTERN = /\*\*([^*\n]+)\*\*|「([^」\n]{1,80})」/g

/**
 * 标签词汇表：只有确实处在「标签：正文」位置的词才加粗。
 * 用后缀而不是「冒号前一律加粗」——`规则很简单：…` `三把刀依次用：…` 这类句子
 * 冒号前也是短句，加粗反而到处都是重点。
 */
const LABEL_SUFFIXES = [
  '能力', '指标', '标准', '要点', '信号', '方法', '步骤', '清单', '原则', '提示',
  '话术', '频率', '周期', '时间', '目标', '建议', '做法', '表现', '结果', '说明',
  '注意', '准备', '计划', '条件', '范围', '流程', '机制', '途径', '渠道', '场合',
  '时机', '对象', '原因', '目的', '内容', '方式', '材料', '地点', '评价', '观察',
  '技巧', '经验', '风险', '边界', '状态', '程度', '节奏',
]

const LABEL_EXACT = new Set([
  '何时做', '怎么做', '话术示例', '示例', '提示', '话术', '达标', '达标标准', '小结',
  '目标', '评估', '自评',
])

/**
 * 把一段方案正文拆成可渲染的块。空文本返回空数组（调用方据此整块不渲染）。
 * 纯函数：相同输入始终得到相同输出，可直接单测。
 */
export function parsePlanText(raw: unknown): PlanTextBlock[] {
  const text = typeof raw === 'string' ? raw : ''
  if (!text.trim()) return []
  const blocks: PlanTextBlock[] = []
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (line) pushPlanTextLine(blocks, line)
  }
  return blocks
}

/**
 * 解析行内强调。判定顺序：Markdown 粗体 → 中文引号。
 * 「」内容保留引号本身（产品里引号就是强调约定），只是短内容加粗、长内容着色。
 */
export function buildPlanTextSegments(text: string): PlanTextSegment[] {
  const segments: PlanTextSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) segments.push({ text: text.slice(cursor, index) })
    const markdownBold = match[1]
    if (markdownBold !== undefined) {
      segments.push({ text: markdownBold, emphasis: 'keyword' })
    } else {
      const quoted = match[2] ?? ''
      segments.push({
        text: `「${quoted}」`,
        emphasis: quoted.length <= KEYWORD_MAX_LENGTH ? 'keyword' : 'quote',
      })
    }
    cursor = index + match[0].length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments.filter(segment => segment.text.length > 0)
}

function pushPlanTextLine(blocks: PlanTextBlock[], line: string): void {
  const tool = line.match(TOOL_BLOCK)
  if (tool) {
    blocks.push({ kind: 'subheading', marker: '——', segments: buildPlanTextSegments(tool[1]!.trim()) })
    return
  }
  const heading = line.match(CN_HEADING)
  if (heading) {
    const { title, body } = splitHeadingBody(heading[2]!.trim())
    blocks.push({ kind: 'heading', marker: `${heading[1]}、`, segments: buildPlanTextSegments(title) })
    if (body) blocks.push({ kind: 'paragraph', segments: buildPlanTextSegments(body) })
    return
  }
  const numbered = line.match(NUMBER_STEP)
  if (numbered) {
    blocks.push({ kind: 'step', marker: `${numbered[1]}.`, segments: buildPlanTextSegments(numbered[2]!.trim()) })
    return
  }
  const circled = line.match(CIRCLED_STEP)
  if (circled) {
    blocks.push({ kind: 'step', marker: circled[1]!, segments: buildPlanTextSegments(circled[2]!.trim()) })
    return
  }
  const bullet = line.match(BULLET_STEP)
  if (bullet) {
    blocks.push({ kind: 'step', marker: '•', segments: buildPlanTextSegments(bullet[1]!.trim()) })
    return
  }
  const label = line.match(LABEL_LINE)
  if (label && isPlanTextLabel(label[1]!)) {
    blocks.push({
      kind: 'paragraph',
      segments: [
        { text: `${label[1]!.trim()}：`, emphasis: 'label' },
        ...buildPlanTextSegments(label[2]!.trim()),
      ],
    })
    return
  }
  // 放在标签判定之后：`话术：「…」` 这类带引号的标签行要按标签渲染，不能当标题
  if (line.length <= BARE_HEADING_MAX_LENGTH && BARE_HEADING.test(line)) {
    blocks.push({ kind: 'heading', segments: buildPlanTextSegments(line) })
    return
  }
  blocks.push({ kind: 'paragraph', segments: buildPlanTextSegments(line) })
}

/**
 * 标题行里的正文切分：`一、针对「意义感流失」：每周五下班前…` 这种拼在一行的，
 * 在引号后的冒号处切开，标题独占一行、正文另起一段。
 */
function splitHeadingBody(rest: string): { title: string, body?: string } {
  const quoted = rest.match(/^(.+?[」』】）)\]])[：:]\s*(.+)$/)
  if (quoted) return { title: quoted[1]!.trim(), body: quoted[2]!.trim() }
  const plain = rest.match(/^([^：:]{1,20})[：:]\s*(.+)$/)
  if (plain) return { title: plain[1]!.trim(), body: plain[2]!.trim() }
  return { title: rest }
}

/** 冒号前的内容是否属于标签词汇表（精确词或后缀词）。 */
function isPlanTextLabel(label: string): boolean {
  const value = label.trim()
  if (value.length < 2 || value.length > 12) return false
  if (LABEL_EXACT.has(value)) return true
  return LABEL_SUFFIXES.some(suffix => value.endsWith(suffix))
}

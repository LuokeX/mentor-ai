/**
 * 首页助手语音链路的共享纯函数。
 *
 * 为什么单独放 shared：回答正文以 Markdown 加密落库，朗读时服务端要在送语音合成前清洗成纯文本，
 * 前端也要用同一套口径判断「这条回答有没有可朗读的内容」。两端各写一份必然出现「有朗读按钮但读不出声」，
 * 因此这里只放无副作用纯函数，不依赖 Nitro / Vue / Node API。
 */

/** 围栏代码块起始/结束行（``` 或 ~~~，允许缩进与语言标记）。 */
const FENCE_LINE = /^[ \t]*(?:```|~~~)/

/** 引用式链接定义行（`[1]: https://…`）：整行都是元数据，朗读时直接丢弃（连同换行，避免留下空行）。 */
const REFERENCE_DEFINITION_LINE = /^[ \t]*\[[^\]]+\]:[ \t]*\S.*\n?/gm

/** 图片语法：保留 alt 文字（往往是对图的简短说明），丢掉地址。 */
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g

/** 行内链接：保留链接文字，丢掉 URL。 */
const INLINE_LINK = /\[([^\]]*)\]\([^)]*\)/g

/** 引用式链接：保留可见文字，丢掉引用键。 */
const REFERENCE_LINK = /\[([^\]]*)\]\[[^\]]*\]/g

/** 自动链接（`<https://…>`）：没有可保留的文字，整段丢弃。 */
const AUTOLINK = /<(?:https?|mailto):[^>\s]*>/g

/** 标题标记 `#`。 */
const HEADING_MARKER = /^[ \t]*#{1,6}[ \t]*/gm

/** 引用标记 `>`。 */
const BLOCKQUOTE_MARKER = /^[ \t]*>[ \t]?/gm

/**
 * 表格分隔行（`| --- | :---: |`、`--- | ---`）：整行丢弃（连同换行，避免表头与数据行之间多出空行）。
 * 判据：整行只由竖线/冒号/短横线/空格组成，且至少有一个竖线和一个短横线，避免误删普通文本行。
 */
const TABLE_SEPARATOR_ROW = /^[ \t]*[|: -]*-[|: -]*\|[|: -]*\n?/gm

/** 分割线（`---`、`***`、`___`）：纯排版符号，整行丢弃。 */
const THEMATIC_BREAK_ROW = /^[ \t]*(?:[-*_][ \t]*){3,}\n?/gm

/** 列表符号（有序与无序）：序号只是排版层级，朗读时不需要念出来。 */
const LIST_MARKER = /^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+/gm

/** 行内代码：去掉反引号，保留代码内容。 */
const INLINE_CODE = /`([^`]+)`/g

const BOLD_ASTERISK = /\*\*([^*]+)\*\*/g
const BOLD_UNDERSCORE = /__([^_]+)__/g
const STRIKETHROUGH = /~~([^~]+)~~/g
/** 单个 `*` 的斜体；用前后边界避免误伤 `2*3*4` 这类算式。 */
const ITALIC_ASTERISK = /(?<![\w*])\*([^*\n]+)\*(?![\w*])/g
/** 单个 `_` 的斜体；用前后边界避免把 `owner_user_id` 拆坏。 */
const ITALIC_UNDERSCORE = /(?<![\w_])_([^_\n]+)_(?![\w_])/g

/**
 * 把助手回答的 Markdown 清洗成可朗读纯文本。
 *
 * 清洗范围（按顺序）：围栏代码块整块丢弃（含未闭合的情况）→ 引用式链接定义行 → 图片/链接保留文字丢掉地址
 * → 标题/引用/表格分隔行/分割线/列表符号 → 行内代码反引号与各类强调标记 → 压缩多余空白与空行。
 * 清洗后为空（例如整条回答只有一个代码块）返回空串，由调用方决定是提示「没有可朗读内容」还是跳过朗读。
 */
export function speechTextOf(text: string): string {
  if (!text) return ''

  // 围栏代码块用状态机而不是正则：代码块里的 ``` 内容不会再被后续规则二次清洗，未闭合也能吃掉剩余内容
  const keptLines: string[] = []
  let inFence = false
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence
      continue
    }
    if (!inFence) keptLines.push(line)
  }

  const cleaned = keptLines.join('\n')
    .replace(REFERENCE_DEFINITION_LINE, '')
    .replace(IMAGE, '$1')
    .replace(INLINE_LINK, '$1')
    .replace(REFERENCE_LINK, '$1')
    .replace(AUTOLINK, '')
    .replace(HEADING_MARKER, '')
    .replace(BLOCKQUOTE_MARKER, '')
    .replace(TABLE_SEPARATOR_ROW, '')
    .replace(THEMATIC_BREAK_ROW, '')
    .replace(LIST_MARKER, '')
    .replace(INLINE_CODE, '$1')
    .replace(/`/g, '')
    .replace(BOLD_ASTERISK, '$1')
    .replace(BOLD_UNDERSCORE, '$1')
    .replace(STRIKETHROUGH, '$1')
    .replace(ITALIC_ASTERISK, '$1')
    .replace(ITALIC_UNDERSCORE, '$1')

  return cleaned
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 句末标点与换行：分片只在这些位置断开，保证朗读不会被截断在句子中间。 */
const SENTENCE_BOUNDARY = /[^。！？；!?;\n…]*[。！？；!?;\n…]+|[^。！？；!?;\n…]+/g

/**
 * 按句末标点与换行把朗读文本切成不超过 maxChars 的分片。
 *
 * 为什么按片调用语音合成：单次合成的文本越长，失败重试代价与首字节延迟越高；
 * 前端也按片播放/预取，单片失败只影响当前片。
 * 超长单句（例如没有标点的长列表）按 maxChars 硬切，保证任何请求都不会超过上限。
 */
export function splitSpeechChunks(text: string, maxChars = 300): string[] {
  if (!text) return []
  const limit = Math.max(1, Math.floor(maxChars))
  const chunks: string[] = []
  for (const part of text.replace(/\r\n?/g, '\n').match(SENTENCE_BOUNDARY) || []) {
    // 按码点而不是 UTF-16 码元切分：emoji 等代理对不会被切成半个字符
    let rest = Array.from(part.trim())
    while (rest.length > limit) {
      chunks.push(rest.slice(0, limit).join(''))
      rest = rest.slice(limit)
    }
    const tail = rest.join('').trim()
    if (tail) chunks.push(tail)
  }
  return chunks
}

/**
 * 会话标题领域函数（纯函数，不依赖数据库）。
 *
 * 目标：一句话概括「对象 + 问题」，约 12~16 字，保证侧边栏单行可读。
 * 取用户首条消息，先去掉问候/铺垫前缀与「我该怎么帮他」类提问尾缀，
 * 再按中英文标点（含逗号/顿号）切成短句，取靠前的核心短句拼到上限；
 * 仍不足时用后续消息的首句补齐。DeepSeek 可用时由 generateChatTitle 提供
 * 更精炼的语义标题，本函数作为无 Key/超时/解析失败时的降级路径，也承担
 * 会话创建瞬间的初始标题。
 *
 * 不使用澄清总结文本：总结开头常为共情/追问复述，不稳定。
 */
import { redactPii } from '../integrations/deepseek'
import { truncateByChars } from './plan-titles'

/** 会话标题最大长度（不含省略号），与侧边栏单行可读对齐，也与 DeepSeek 标题上限一致。 */
export const CHAT_TITLE_MAX = 16

/** 标题内容最小长度：低于该长度视为信息不足，继续拼接后续消息。 */
const MIN_TITLE_LENGTH = 6

/** 常见问候/铺垫前缀，标题中无意义，需去掉。 */
const GREETING_PREFIXES = ['老师您好', '老师你好', '老师好', '老师们好', '您好', '你好老师', '你好', '请问', '想问一下', '我想问', '想请教', '请教一下', '想咨询', '咨询一下', '麻烦老师']

/** 常见「我该怎么帮他」类提问尾缀，标题中应去掉（长尾缀靠前，避免被短尾缀先命中）。 */
const QUESTION_TAILS = ['我该怎么帮他呢', '我该怎么帮他', '我该如何帮他', '我该怎么帮助他', '该怎么帮他', '该如何帮他', '我该怎么办', '怎么帮他', '如何帮他', '该怎么办', '该如何解决', '怎么解决', '如何解决', '该怎么处理', '怎么处理', '该如何处理', '有什么办法', '有没有办法', '该怎么做', '该怎样做', '怎么应对', '该注意什么', '帮我分析一下', '帮我看看', '怎么办']

/** 去掉问候前缀、提问尾缀及首尾残留标点，只保留真正描述对象/问题的部分。 */
function stripFiller(text: string): string {
  let t = text.trim().replace(/[，。；;！？!?、：:,，\s]+$/, '')
  for (const p of GREETING_PREFIXES) {
    if (t.startsWith(p)) { t = t.slice(p.length).trim(); break }
  }
  for (const tail of QUESTION_TAILS) {
    if (t.endsWith(tail)) { t = t.slice(0, -tail.length).trim(); break }
  }
  return t
}

/** 按中文标点切成短句（句/问/叹/逗/分/顿均为句界），过滤空串，取前 max 句。 */
function splitClauses(text: string, max = 6): string[] {
  const parts = String(text || '').match(/[^。；;！？!?，,、\n]+[。；;！？!?，,、\n]?/g) || []
  return parts.map(s => s.trim()).filter(Boolean).slice(0, max)
}

/**
 * 依次拼接短句直到接近 maxLen。以「完整短句」为单位，避免把词/短语切半；
 * 当前已有内容且再加一句会溢出时停止，首句为空时允许放入较长内容再截断。
 */
function takeClauses(text: string, maxLen: number): string {
  let acc = ''
  for (const clause of splitClauses(text, 6)) {
    if (acc.length > 0 && acc.length + clause.length > maxLen) break
    acc += clause
    if (acc.length >= maxLen) break
  }
  return acc.trim()
}

/** 去掉尾部残留标点（如「课程走神，」→「课程走神」），避免标题以逗号收尾。 */
function stripTrailingPunct(text: string): string {
  return text.replace(/[，。；;！？!?、：:,，\s]+$/, '')
}

export function buildChatTitle(input: { messages: string[] }): string {
  const messages = (input.messages || [])
    .map((message) => redactPii(message))
    .map((message) => message.trim())
    .filter(Boolean)
  if (!messages.length) return '新对话'

  let joined = takeClauses(stripFiller(messages[0]!), CHAT_TITLE_MAX)
  if (joined.length < MIN_TITLE_LENGTH && messages[1]) {
    for (const clause of splitClauses(stripFiller(messages[1]!), 3)) {
      if (joined.length + clause.length > CHAT_TITLE_MAX) break
      joined += clause
      if (joined.length >= MIN_TITLE_LENGTH) break
    }
  }
  joined = stripTrailingPunct(joined)
  if (!joined) return '新对话'
  const cut = truncateByChars(joined, CHAT_TITLE_MAX)
  return joined.length > CHAT_TITLE_MAX ? `${cut}…` : cut
}

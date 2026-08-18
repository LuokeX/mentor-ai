/**
 * 会话标题领域函数（纯函数，不依赖数据库）。
 *
 * 标题取自用户消息序列：每条消息脱敏后按标点断句，优先取第一条消息的
 * 前几句直到达到最小长度（用户首条消息常为「寒暄 + 主题」，只取首句
 * 会丢失主题）；首条消息仍不足时拼接下一条消息的首句。统一截断并追加
 * 省略号，避免「原文前 40 字硬切」导致标题不自然或切在词中间。
 *
 * 不使用澄清总结文本：总结开头常为共情/追问复述，不稳定。
 */
import { redactPii } from '../integrations/deepseek'
import { splitSentences, truncateByChars } from './plan-titles'

/** 会话标题最大长度（不含省略号）。 */
export const CHAT_TITLE_MAX = 40

/** 标题内容最小长度：低于该长度视为信息不足，继续拼接后续句子。 */
const MIN_TITLE_LENGTH = 10

/** 依次拼接句首直到达到最小长度（句子用尽则返回全部）。 */
function takeSentencesUntil(message: string, minLength: number): string {
  let acc = ''
  for (const sentence of splitSentences(message, 6)) {
    acc += sentence
    if (acc.length >= minLength) break
  }
  return acc.trim()
}

export function buildChatTitle(input: { messages: string[] }): string {
  const messages = (input.messages || [])
    .map((message) => redactPii(message))
    .map((message) => message.trim())
    .filter(Boolean)
  if (!messages.length) return '新对话'

  let joined = takeSentencesUntil(messages[0]!, MIN_TITLE_LENGTH)
  if (joined.length < MIN_TITLE_LENGTH && messages[1]) {
    const secondFirst = splitSentences(messages[1], 1)[0]?.trim() || ''
    joined = (joined + secondFirst).trim()
  }
  if (!joined) return '新对话'
  const cut = truncateByChars(joined, CHAT_TITLE_MAX)
  return joined.length > CHAT_TITLE_MAX ? `${cut}…` : cut
}
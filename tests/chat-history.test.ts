import { describe, expect, it } from 'vitest'
import {
  MESSAGE_OVERHEAD_TOKENS,
  estimateHistoryTokens,
  estimateTokens,
  isAppendOnlyPrefix,
  selectHistoryWindow,
  toHistoryMessages
} from '../server/domain/chat-history'
import type { HistoryMessage } from '../server/domain/chat-history'

function msg(role: 'user' | 'assistant', content: string): HistoryMessage {
  return { role, content }
}

/** 'abcd' = 1 token（4 字符）+ 角色开销，便于精确断言。 */
const SHORT = 'abcd'
const SHORT_COST = 1 + MESSAGE_OVERHEAD_TOKENS

describe('estimateTokens', () => {
  it('CJK 字按 1 token，其余按 4 字符 1 token', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('你好世界')).toBe(4)
    expect(estimateTokens(SHORT)).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })

  it('混合文本按两类字符相加', () => {
    expect(estimateTokens('你好 abcd')).toBe(2 + 2)
  })

  it('历史估算含每条消息的角色开销', () => {
    expect(estimateHistoryTokens([msg('user', SHORT), msg('assistant', SHORT)])).toBe(SHORT_COST * 2)
  })
})

describe('selectHistoryWindow', () => {
  const conversation: HistoryMessage[] = [
    msg('user', SHORT), msg('assistant', SHORT),
    msg('user', SHORT), msg('assistant', SHORT),
    msg('user', SHORT)
  ]

  it('空历史返回空窗口', () => {
    expect(selectHistoryWindow([], 100)).toEqual({ selected: [], droppedCount: 0, estimatedTokens: 0 })
  })

  it('按预算保留尾部并丢弃更早的整段', () => {
    const window = selectHistoryWindow(conversation, SHORT_COST * 3)
    expect(window.selected).toHaveLength(3)
    expect(window.selected[0]).toEqual(msg('user', SHORT))
    expect(window.droppedCount).toBe(2)
    expect(window.estimatedTokens).toBe(SHORT_COST * 3)
  })

  it('窗口起点对齐到 user 消息，不出现以 assistant 开头的历史', () => {
    const window = selectHistoryWindow(conversation, SHORT_COST * 2)
    expect(window.selected).toHaveLength(1)
    expect(window.selected[0]!.role).toBe('user')
    expect(window.droppedCount).toBe(4)
  })

  it('预算极小也至少保留最后一条消息，不返回空窗口', () => {
    const window = selectHistoryWindow(conversation, 1)
    expect(window.selected).toEqual([msg('user', SHORT)])
    expect(window.droppedCount).toBe(4)
  })

  it('预算极大时返回全部历史', () => {
    const window = selectHistoryWindow(conversation, 10_000)
    expect(window.selected).toEqual(conversation)
    expect(window.droppedCount).toBe(0)
  })
})

describe('isAppendOnlyPrefix（前缀稳定性不变量）', () => {
  const first = [msg('user', SHORT), msg('assistant', SHORT)]

  it('只追加时成立', () => {
    expect(isAppendOnlyPrefix(first, [...first, msg('user', 'efgh')])).toBe(true)
  })

  it('滑窗丢弃最早消息时不成立', () => {
    expect(isAppendOnlyPrefix(first, [msg('user', 'efgh')])).toBe(false)
  })

  it('窗口内容被改写时不成立', () => {
    expect(isAppendOnlyPrefix(first, [msg('user', SHORT), msg('assistant', '改写后的回答')])).toBe(false)
  })

  it('两轮窗口选择在未触发丢弃时保持前缀关系', () => {
    const full = [msg('user', SHORT), msg('assistant', SHORT), msg('user', SHORT), msg('assistant', SHORT)]
    const budget = SHORT_COST * 5
    const before = selectHistoryWindow(full, budget)
    const after = selectHistoryWindow([...full, msg('user', 'efgh')], budget)
    expect(before.droppedCount).toBe(0)
    expect(isAppendOnlyPrefix(before.selected, after.selected)).toBe(true)
  })

  it('两轮窗口选择在发生丢弃时打破前缀关系（说明丢弃必须是低频事件）', () => {
    const full = [msg('user', SHORT), msg('assistant', SHORT), msg('user', SHORT), msg('assistant', SHORT)]
    const budget = SHORT_COST * 4
    const before = selectHistoryWindow(full, budget)
    const after = selectHistoryWindow([...full, msg('user', 'efgh')], budget)
    expect(before.droppedCount).toBe(0)
    expect(after.droppedCount).toBe(2)
    expect(isAppendOnlyPrefix(before.selected, after.selected)).toBe(false)
  })
})

describe('toHistoryMessages', () => {
  it('过滤非法角色并保留顺序', () => {
    expect(toHistoryMessages([
      { role: 'user', content: 'a' },
      { role: 'system', content: 'b' },
      { role: 'assistant', content: 'c' }
    ])).toEqual([msg('user', 'a'), msg('assistant', 'c')])
  })
})

import { describe, expect, it } from 'vitest'
import { estimateHistoryTokens } from '../server/domain/chat-history'
import type { HistoryMessage } from '../server/domain/chat-history'
import { formatCompactionTranscript, planCompaction } from '../server/domain/chat-compaction'

function msg(role: 'user' | 'assistant', content: string): HistoryMessage {
  return { role, content }
}

/** 'abcd' = 1 token，加角色开销 4 = 5。 */
const SHORT = 'abcd'
const SHORT_COST = 5

describe('planCompaction', () => {
  it('历史未超过保留预算时不需要压缩', () => {
    const messages = [msg('user', SHORT), msg('assistant', SHORT)]
    const plan = planCompaction(messages, SHORT_COST * 10, 0.5)
    expect(plan.required).toBe(false)
    expect(plan.keepMessages).toEqual(messages)
  })

  it('历史超过保留预算时把较旧前缀划入压缩范围', () => {
    const messages = [
      msg('user', SHORT), msg('assistant', SHORT),
      msg('user', SHORT), msg('assistant', SHORT),
      msg('user', SHORT), msg('assistant', SHORT)
    ]
    // 预算 30 token，保留比例 0.5 → 保留预算 15 token = 3 条
    const plan = planCompaction(messages, SHORT_COST * 6, 0.5)
    expect(plan.required).toBe(true)
    expect(plan.keepTokens).toBeLessThanOrEqual(SHORT_COST * 3)
    expect(plan.compactMessages.length).toBeGreaterThan(0)
    expect(plan.compactTokens).toBeGreaterThan(0)
    expect([...plan.compactMessages, ...plan.keepMessages]).toEqual(messages)
  })

  it('保留边界对齐到 user 消息，不保留以 assistant 开头的尾巴', () => {
    const messages = [
      msg('user', SHORT), msg('assistant', SHORT),
      msg('user', SHORT), msg('assistant', SHORT),
      msg('user', SHORT), msg('assistant', SHORT)
    ]
    const plan = planCompaction(messages, SHORT_COST * 6, 0.5)
    expect(plan.keepMessages[0]!.role).toBe('user')
  })

  it('压缩范围覆盖全部历史时返回不需要压缩（避免把整段历史压成摘要）', () => {
    const messages = [msg('user', SHORT), msg('assistant', SHORT)]
    const plan = planCompaction(messages, 1, 0.5)
    expect(plan.required).toBe(false)
  })

  it('空历史返回不需要压缩', () => {
    const plan = planCompaction([], 100, 0.5)
    expect(plan.required).toBe(false)
    expect(plan.keepMessages).toEqual([])
  })

  it('压缩与保留的 token 统计与历史总量一致', () => {
    const messages = Array.from({ length: 8 }, (_, index) => msg(index % 2 === 0 ? 'user' : 'assistant', SHORT))
    const total = estimateHistoryTokens(messages)
    const plan = planCompaction(messages, SHORT_COST * 4, 0.5)
    expect(plan.compactTokens + plan.keepTokens).toBe(total)
  })
})

describe('formatCompactionTranscript', () => {
  it('按教师/助手标注并逐字节稳定（重复调用结果一致）', () => {
    const messages = [msg('user', '午休很吵'), msg('assistant', '先记录三天')]
    const text = formatCompactionTranscript(messages)
    expect(text).toBe('教师：午休很吵\n助手：先记录三天')
    expect(formatCompactionTranscript(messages)).toBe(text)
  })
})

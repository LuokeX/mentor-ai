import { describe, expect, it } from 'vitest'
import {
  appendContextSwitch,
  buildContextSwitchNote,
  CONTEXT_SWITCH_LIMIT,
  contextTypeLabel,
  isMessageAfterBindingSwitch,
  readContextLabel,
  readContextSwitches,
  toContextRef
} from '../server/domain/chat-context-switch'

describe('会话内换绑咨询对象', () => {
  it('toContextRef 只接受白名单类型并保留展示名', () => {
    expect(toContextRef('guardian', 'g1', '张三 · 母子')).toEqual({ type: 'guardian', id: 'g1', label: '张三 · 母子' })
    expect(toContextRef('student', 's1', '  ')).toEqual({ type: 'student', id: 's1', label: null })
    expect(toContextRef('none', 'x1', 'X')).toBeNull()
    expect(toContextRef('student', '', 'X')).toBeNull()
  })

  it('readContextSwitches 丢弃不合法条目，不抛错', () => {
    expect(readContextSwitches(null)).toEqual([])
    expect(readContextSwitches({ contextSwitches: 'x' })).toEqual([])
    expect(readContextSwitches({
      contextSwitches: [
        { at: '2026-09-14T07:00:00.000Z', to: { type: 'student', id: 's2', label: '李四' } },
        { at: '2026-09-14T07:10:00.000Z', to: { type: 'unknown', id: 's3', label: '王五' } },
        { to: { type: 'student', id: 's4' } }
      ]
    })).toEqual([
      {
        at: '2026-09-14T07:00:00.000Z',
        from: null,
        to: { type: 'student', id: 's2', label: '李四' }
      }
    ])
  })

  it('appendContextSwitch 保留其他元数据并更新 contextLabel', () => {
    const metadata = { moduleScores: { home_school: 0.6 }, contextLabel: '张三' }
    const next = appendContextSwitch(metadata, {
      at: '2026-09-14T07:20:00.000Z',
      from: { type: 'guardian', id: 'g1', label: '张三' },
      to: { type: 'student', id: 's2', label: '李四' }
    })
    expect(next.moduleScores).toEqual({ home_school: 0.6 })
    expect(next.contextLabel).toBe('李四')
    expect(readContextLabel(next)).toBe('李四')
    expect(readContextSwitches(next)).toHaveLength(1)
    // 原元数据不被修改
    expect(metadata.contextLabel).toBe('张三')
    expect(readContextSwitches(metadata)).toHaveLength(0)
  })

  it('换绑记录超过上限时丢弃最早的条目', () => {
    let metadata: Record<string, unknown> = {}
    for (let index = 0; index < CONTEXT_SWITCH_LIMIT + 3; index += 1) {
      metadata = appendContextSwitch(metadata, {
        at: `2026-09-14T07:${String(index).padStart(2, '0')}:00.000Z`,
        from: null,
        to: { type: 'student', id: `s${index}`, label: `学生${index}` }
      })
    }
    const entries = readContextSwitches(metadata)
    expect(entries).toHaveLength(CONTEXT_SWITCH_LIMIT)
    expect(entries[0]!.to.id).toBe('s3')
  })

  it('没有换绑记录时不生成提示（常见路径不增加 token）', () => {
    expect(buildContextSwitchNote([])).toBeNull()
    expect(contextTypeLabel('guardian')).toBe('家长')
    expect(contextTypeLabel(null)).toBe('咨询对象')
  })

  it('提示同时声明旧对象与当前对象，且同一份元数据每轮结果一致', () => {
    const metadata = appendContextSwitch({ contextLabel: '张三' }, {
      at: '2026-09-14T07:20:00.000Z',
      from: { type: 'guardian', id: 'g1', label: '张三' },
      to: { type: 'student', id: 's2', label: '李四' }
    })
    const entries = readContextSwitches(metadata)
    const note = buildContextSwitchNote(entries)
    expect(note).toContain('家长「张三」')
    expect(note).toContain('学生「李四」')
    expect(note).toContain('不要把两者的信息混用')
    // 前缀稳定：同一份元数据反复生成的结果必须逐字相同
    expect(buildContextSwitchNote(readContextSwitches(metadata))).toBe(note)
  })

  it('换绑后的实体记忆只保留换绑到该对象之后的消息', () => {
    const entries = [{
      at: '2026-09-14T08:00:00.000Z',
      from: null,
      to: { type: 'student' as const, id: 's1', label: '李四' }
    }]
    const binding = { type: 'student', id: 's1' }
    expect(isMessageAfterBindingSwitch(entries, binding, new Date('2026-09-14T07:59:00.000Z'))).toBe(false)
    expect(isMessageAfterBindingSwitch(entries, binding, new Date('2026-09-14T08:00:00.000Z'))).toBe(true)
    // 别的对象与从未换绑的会话都算数
    expect(isMessageAfterBindingSwitch(entries, { type: 'student', id: 's9' }, new Date('2026-09-14T07:00:00.000Z'))).toBe(true)
    expect(isMessageAfterBindingSwitch([], binding, new Date('2026-09-14T07:00:00.000Z'))).toBe(true)
  })

  it('多次换绑到同一对象时以最后一次为准', () => {
    const entries = [
      { at: '2026-09-14T08:00:00.000Z', from: null, to: { type: 'student' as const, id: 's1', label: '李四' } },
      { at: '2026-09-14T09:00:00.000Z', from: null, to: { type: 'guardian' as const, id: 'g1', label: '张三' } },
      { at: '2026-09-14T10:00:00.000Z', from: null, to: { type: 'student' as const, id: 's1', label: '李四' } }
    ]
    const binding = { type: 'student', id: 's1' }
    expect(isMessageAfterBindingSwitch(entries, binding, new Date('2026-09-14T08:30:00.000Z'))).toBe(false)
    expect(isMessageAfterBindingSwitch(entries, binding, new Date('2026-09-14T10:30:00.000Z'))).toBe(true)
  })

  it('多次换绑时列出此前对象，并只保留最近三个', () => {
    let metadata: Record<string, unknown> = { contextLabel: null }
    const targets = ['A', 'B', 'C', 'D', 'E']
    targets.forEach((label, index) => {
      metadata = appendContextSwitch(metadata, {
        at: `2026-09-14T07:2${index}:00.000Z`,
        from: index === 0 ? null : { type: 'student', id: `s${index - 1}`, label: targets[index - 1]! },
        to: { type: 'student', id: `s${index}`, label }
      })
    })
    const note = buildContextSwitchNote(readContextSwitches(metadata))
    // 当前对象是最新的 E；此前的 A 因超出最近三个不再列出
    expect(note).toContain('学生「E」')
    expect(note).toContain('学生「B」')
    expect(note).toContain('学生「D」')
    expect(note).not.toContain('学生「A」')
  })
})

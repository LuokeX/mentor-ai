import { describe, expect, it } from 'vitest'
import { isSameContextSet, mergeSessionContexts, normalizeSessionContexts } from '../server/domain/chat-session-contexts'
import { deriveRecordTitle, pickPrefillObjects, truncateRecordText } from '../app/composables/useChatRecordPrefill'

describe('会话对象集的归一化（@ 多名学生）', () => {
  it('按 (type, id) 去重、过滤非法项、保持传入顺序（首个为主对象）', () => {
    expect(normalizeSessionContexts([
      { type: 'student', id: 's2', label: '张小军' },
      { type: 'student', id: 's1', label: '张小明' },
      { type: 'student', id: 's2', label: '张小军' },
      { type: 'none', id: 'x1' },
      { type: 'guardian', id: '' }
    ]).map(item => `${item.type}:${item.id}`)).toEqual(['student:s2', 'student:s1'])
  })

  it('超过上限（含主对象 5 个）时截断', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ type: 'student', id: `s${index}`, label: `学生${index}` }))
    expect(normalizeSessionContexts(many)).toHaveLength(5)
  })

  it('对象集比较忽略顺序，只看集合', () => {
    expect(isSameContextSet(
      [{ type: 'student', id: 's1' }, { type: 'guardian', id: 'g1' }],
      [{ type: 'guardian', id: 'g1' }, { type: 'student', id: 's1' }]
    )).toBe(true)
    expect(isSameContextSet([{ type: 'student', id: 's1' }], [{ type: 'student', id: 's2' }])).toBe(false)
    expect(isSameContextSet([{ type: 'student', id: 's1' }], [])).toBe(false)
  })

  it('会话详情合并主对象与关联表：@ 多名学生后重新进入对话仍保留全部对象', () => {
    const merged = mergeSessionContexts(
      { type: 'student', id: 's1', label: '张小明' },
      [
        { type: 'student', id: 's2', label: '张小军' },
        { type: 'guardian', id: 'g1', label: '王五 · 母子' }
      ]
    )
    expect(merged.map(item => `${item.type}:${item.id}`)).toEqual(['student:s1', 'student:s2', 'guardian:g1'])
  })

  it('合并时主对象排在首位，且与关联表重复的对象只保留一份', () => {
    const merged = mergeSessionContexts(
      { type: 'student', id: 's2', label: '张小军' },
      [
        { type: 'student', id: 's1', label: '张小明' },
        { type: 'student', id: 's2', label: '张小军' }
      ]
    )
    expect(merged.map(item => `${item.type}:${item.id}`)).toEqual(['student:s2', 'student:s1'])
  })
})

describe('转存预填的文本处理', () => {
  it('标题取首个非空行、去掉 markdown 与列表前缀、超长截断', () => {
    expect(deriveRecordTitle('\n## 张三与李四的冲突\n后续内容')).toBe('张三与李四的冲突')
    expect(deriveRecordTitle('- 家长情绪激动，需要跟进')).toBe('家长情绪激动，需要跟进')
    expect(deriveRecordTitle('**今天课堂秩序问题**')).toBe('今天课堂秩序问题')
    const long = '这是一段很长的说明文字'.repeat(6)
    expect(deriveRecordTitle(long).length).toBe(40)
    expect(deriveRecordTitle(long).endsWith('…')).toBe(true)
    expect(deriveRecordTitle('')).toBe('')
  })

  it('正文按字符截断并补省略号', () => {
    expect(truncateRecordText('短文本', 10)).toBe('短文本')
    const text = 'a'.repeat(20)
    expect(truncateRecordText(text, 10)).toHaveLength(10)
    expect(truncateRecordText(text, 10).endsWith('…')).toBe(true)
  })
})

describe('转存预填的关联对象', () => {
  it('优先用消息里的本轮对象，并保留多个学生（@ 多名学生）', () => {
    const objects = pickPrefillObjects(
      { turnObjects: [{ type: 'student', id: 's1', label: '张小明' }, { type: 'student', id: 's2', label: '张小军' }] },
      [{ type: 'student', id: 's9', label: '会话绑定对象' }]
    )
    expect(objects).toEqual([
      { type: 'student', id: 's1', label: '张小明' },
      { type: 'student', id: 's2', label: '张小军' }
    ])
  })

  it('没有本轮对象时回退会话绑定对象集，并去掉重复与非法项', () => {
    const objects = pickPrefillObjects(
      { turnObject: { type: 'guardian', id: 'g1', label: '王五 · 母子' } },
      [{ type: 'student', id: 's1', label: '张小明' }, { type: 'student', id: 's1', label: '张小明' }, { type: 'none', id: 'x' }]
    )
    expect(objects).toEqual([{ type: 'guardian', id: 'g1', label: '王五 · 母子' }])
    expect(pickPrefillObjects(null, [{ type: 'student', id: 's1', label: '张小明' }, { type: 'student', id: 's1', label: '张小明' }]))
      .toEqual([{ type: 'student', id: 's1', label: '张小明' }])
  })
})

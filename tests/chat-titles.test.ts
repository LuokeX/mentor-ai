import { describe, expect, it } from 'vitest'
import { buildChatTitle, CHAT_TITLE_MAX } from '../server/domain/chat-titles'

describe('buildChatTitle', () => {
  it('取首句并按逗号切短，避免原文整段直引', () => {
    const title = buildChatTitle({ messages: ['我们班最近死气沉沉的，学生不愿意来学校。班委也形同虚设。'] })
    expect(title).toBe('我们班最近死气沉沉的')
  })

  it('剥离问候前缀，保留后面的核心主题', () => {
    const title = buildChatTitle({ messages: ['老师您好。班里的小明最近上课总走神，作业拖拉到半夜，说自己就是学不好。'] })
    expect(title).toBe('班里的小明最近上课总走神')
  })

  it('首句过短时拼接下一条消息首句', () => {
    const title = buildChatTitle({ messages: ['老师你好。', '小明最近上课总走神，作业也拖拉，成绩下滑明显。'] })
    expect(title).toBe('小明最近上课总走神')
  })

  it('首句足够长时取满两个短句', () => {
    const title = buildChatTitle({ messages: ['小明上课经常走神，作业拖拉到半夜。', '对，他考试前也特别紧张。'] })
    expect(title).toBe('小明上课经常走神，作业拖拉到半夜')
  })

  it('剥离「我该怎么帮他」类提问尾缀（含末尾问号）', () => {
    const title = buildChatTitle({ messages: ['我们班小明最近上课总走神，作业也一直拖拉，数学计算还总看错符号，我该怎么帮他？'] })
    expect(title).toBe('我们班小明最近上课总走神')
  })

  it('超过长度按码点截断并追加省略号', () => {
    const long = '问'.repeat(CHAT_TITLE_MAX + 10)
    const title = buildChatTitle({ messages: [long] })
    expect([...title]).toHaveLength(CHAT_TITLE_MAX + 1) // 16 + 省略号
    expect(title.endsWith('…')).toBe(true)
  })

  it('无标点长文本同样截断加省略号', () => {
    const title = buildChatTitle({ messages: ['学生最近上课总是走神作业拖拉成绩下滑家长也不配合班级管理也混乱需要尽快找到解决办法不然问题会越来越严重'] })
    expect([...title]).toHaveLength(CHAT_TITLE_MAX + 1)
    expect(title.endsWith('…')).toBe(true)
  })

  it('手机号被脱敏后才进入标题', () => {
    const title = buildChatTitle({ messages: ['李小明最近电话13800138000，总越级投诉。'] })
    expect(title).toContain('[PHONE]')
    expect(title).not.toContain('13800138000')
  })

  it('空输入兜底新对话', () => {
    expect(buildChatTitle({ messages: [] })).toBe('新对话')
    expect(buildChatTitle({ messages: ['   '] })).toBe('新对话')
  })
})

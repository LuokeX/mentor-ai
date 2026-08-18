import { describe, expect, it } from 'vitest'
import { buildChatTitle, CHAT_TITLE_MAX } from '../server/domain/chat-titles'

describe('buildChatTitle', () => {
  it('取首条消息首句', () => {
    const title = buildChatTitle({ messages: ['我们班最近死气沉沉的，学生不愿意来学校。班委也形同虚设。'] })
    expect(title).toBe('我们班最近死气沉沉的，学生不愿意来学校。')
  })

  it('首条消息内寒暄后继续取句（同一消息内补足主题）', () => {
    const title = buildChatTitle({ messages: ['老师您好。班里的小明最近上课总走神，作业拖拉到半夜，说自己就是学不好。'] })
    expect(title).toBe('老师您好。班里的小明最近上课总走神，作业拖拉到半夜，说自己就是学不好。')
  })

  it('首句过短且消息内不足时拼接下一条消息首句', () => {
    const title = buildChatTitle({ messages: ['老师你好。', '小明最近上课总走神，作业也拖拉，成绩下滑明显。'] })
    expect(title).toBe('老师你好。小明最近上课总走神，作业也拖拉，成绩下滑明显。')
  })

  it('首句足够长时忽略后续消息', () => {
    const title = buildChatTitle({
      messages: ['小明上课经常走神，作业拖拉到半夜。', '对，他考试前也特别紧张。']
    })
    expect(title).toBe('小明上课经常走神，作业拖拉到半夜。')
  })

  it('超出长度按码点截断并追加省略号', () => {
    const long = '问'.repeat(CHAT_TITLE_MAX + 10)
    const title = buildChatTitle({ messages: [long] })
    expect([...title]).toHaveLength(CHAT_TITLE_MAX + 1) // 40 + 省略号
    expect(title.endsWith('…')).toBe(true)
  })

  it('无标点长文本同样截断加省略号', () => {
    const title = buildChatTitle({ messages: ['学生最近上课总是走神作业拖拉成绩下滑家长也不配合班级管理也混乱需要尽快找到解决办法不然问题会越来越严重'] })
    expect([...title]).toHaveLength(CHAT_TITLE_MAX + 1)
    expect(title.endsWith('…')).toBe(true)
  })

  it('手机号与姓名被脱敏后才进入标题', () => {
    const title = buildChatTitle({ messages: ['李小明妈妈电话13800138000，最近经常越级投诉。'] })
    expect(title).toContain('[PHONE]')
    expect(title).not.toContain('13800138000')
  })

  it('空输入兜底新对话', () => {
    expect(buildChatTitle({ messages: [] })).toBe('新对话')
    expect(buildChatTitle({ messages: ['   '] })).toBe('新对话')
  })
})
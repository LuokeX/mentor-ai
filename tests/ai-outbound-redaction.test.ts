import { describe, expect, it } from 'vitest'
import { redactOutboundText } from '../server/domain/ai-governance'

describe('redactOutboundText（外发脱敏）', () => {
  const sample = '张老师电话是13812345678，邮箱 zhang@example.com，请家长配合。'

  it('full_context 原样发送', () => {
    expect(redactOutboundText(sample, 'full_context')).toBe(sample)
  })

  it('redacted 模式替换手机号、邮箱与称谓前姓名', () => {
    const redacted = redactOutboundText(sample, 'redacted')
    expect(redacted).not.toContain('13812345678')
    expect(redacted).not.toContain('zhang@example.com')
    expect(redacted).toContain('[PHONE]')
    expect(redacted).toContain('[EMAIL]')
    expect(redacted).toContain('[PERSON]老师')
  })

  it('local 模式同样脱敏（本地模式不应外发，此分支只做防御）', () => {
    expect(redactOutboundText(sample, 'local')).toBe(redactOutboundText(sample, 'redacted'))
  })

  it('确定性：同一输入重复调用结果一致（前缀缓存依赖）', () => {
    expect(redactOutboundText(sample, 'redacted')).toBe(redactOutboundText(sample, 'redacted'))
  })

  it('无敏感信息时保持不变', () => {
    const plain = '班上最近午休有点吵，我想先梳理一下处理思路。'
    expect(redactOutboundText(plain, 'redacted')).toBe(plain)
  })

  it('普通说法不再被误判成姓名（回归：正式库曾误伤「两位家长」「让家长」等）', () => {
    const plain = '跟两位家长说一声；对方家长来了；让家长知道；家长来找我；带队老师和值周老师都在；大多数老师会接；那孩子的家长也来了；男同学女同学都在。'
    expect(redactOutboundText(plain, 'redacted')).toBe(plain)
  })

  it('岗位/形容/关系类词不再被误判成姓名（回归：正式库曾误伤「温柔的老师」「责任感」等）', () => {
    const plain = '温柔的老师、严厉的老师、任课老师和班主任老师；说明你是一位有责任感的老师；安排家长会之前先明确告知家长；初一家长也要通知到；平时多跟同学聊聊。'
    expect(redactOutboundText(plain, 'redacted')).toBe(plain)
  })

  it('真实姓名仍然脱敏：单姓、复姓、小名、叠字小名与「的」字结构', () => {
    const redacted = redactOutboundText('张老师、欧阳老师、小明妈妈、阿美家长、乐乐妈妈、李明的家长、王小明同学', 'redacted')
    for (const name of ['张老师', '欧阳', '小明', '阿美', '乐乐', '李明', '王小明']) {
      expect(redacted).not.toContain(name)
    }
    expect(redacted).toContain('[PERSON]老师')
    expect(redacted).toContain('[PERSON]家长')
  })
})

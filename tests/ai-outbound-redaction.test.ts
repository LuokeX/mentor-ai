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
})

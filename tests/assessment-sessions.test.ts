import { describe, expect, it } from 'vitest'
import { shouldContinueRequestedSession } from '../server/domain/assessment-sessions'

const sessionId = '6cba5015-a6e8-4e93-8e7a-b22ecf0acd44'

describe('assessment session continuation', () => {
  it('requires the explicit continue flag, not just a session id', () => {
    expect(shouldContinueRequestedSession({ continueSession: true, requestedSessionId: sessionId })).toBe(true)
    // 只带组 id 的旧客户端行为（浏览器残留 id）不再续接：必须显式声明继续
    expect(shouldContinueRequestedSession({ requestedSessionId: sessionId })).toBe(false)
    expect(shouldContinueRequestedSession({ continueSession: false, requestedSessionId: sessionId })).toBe(false)
    // 没有组 id 时无从续接
    expect(shouldContinueRequestedSession({ continueSession: true })).toBe(false)
    expect(shouldContinueRequestedSession({ continueSession: true, requestedSessionId: null })).toBe(false)
  })

  it('never overrides context-based group resolution', () => {
    // 对话来源与咨询对象场景由服务端按上下文定位组，前端传的组 id 一律不生效
    expect(shouldContinueRequestedSession({
      continueSession: true, requestedSessionId: sessionId, hasChatSource: true
    })).toBe(false)
    expect(shouldContinueRequestedSession({
      continueSession: true, requestedSessionId: sessionId, hasContext: true
    })).toBe(false)
  })
})

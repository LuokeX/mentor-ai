import { beforeEach, expect, it, vi } from 'vitest'
const { run, writes } = vi.hoisted(() => ({ run: vi.fn(), writes: [] as unknown[] }))
vi.mock('../server/agent/graph', () => ({ runAgentGraph: run }))
vi.mock('../server/agent/prompts', () => ({ buildAgentSystemPrompt: async () => '测试系统提示' }))
vi.mock('../server/integrations/deepseek', () => ({ generateChatTitle: async () => null, redactPii: (text: string) => text }))
vi.mock('../server/domain/product-events', () => ({ trackProductEvent: async () => {} }))
vi.mock('../server/utils/crypto', () => ({ encryptSensitive: (text: string) => text, decryptSensitive: (text: string) => text }))
vi.mock('../server/utils/db', () => ({
  schema: { aiModelCalls: {}, chatMessages: {}, chatSessions: { id: 'id', metadata: 'metadata' } },
  useDb: () => ({ insert: () => ({ values: (value: unknown) => { writes.push(value); return { returning: async () => [{ id: 'answer' }], catch: async () => {} } } }), update: () => ({ set: () => ({ where: async () => {} }) }) })
}))
import { runAssistantTurn } from '../server/domain/chat-stream'
beforeEach(() => {
  writes.length = 0
  run.mockReset().mockResolvedValue({ answer: '可以先核实发生场景。', exitReason: 'done' })
  vi.stubGlobal('useRuntimeConfig', () => ({ encryptionKey: 'test' }))
})
const input = {
  event: {} as never, user: { id: 'u', schoolId: 's', name: '合成教师', role: 'teacher', phone: '', roleLabel: '教师' } as const,
  sessionId: 'c', message: '怎么调整？', withoutRecord: false, businessContext: null,
  governance: { effectiveMode: 'redacted', noticeVersion: 'v1' } as never,
  history: [{ role: 'user' as const, content: '试过了', toolTrace: [{ type: 'tool' as const, toolCallId: 'call1', content: '{"plans":[]}' }] }],
  contextSummary: null, lastModuleScores: {} as never, emit: () => {}, isAborted: () => false
}
it('共享流水线向图传递历史轨迹与取消信号', async () => {
  const controller = new AbortController()
  await runAssistantTurn({ ...input, signal: controller.signal })
  expect(run.mock.calls[0]![1].messages[0].toolTrace).toEqual(input.history[0]!.toolTrace)
  expect(run.mock.calls[0]![1].signal).toBe(controller.signal)
})
it('图失败不能把部分答案写入消息表', async () => {
  run.mockResolvedValue({ answer: '半截回答', exitReason: 'error' })
  await expect(runAssistantTurn(input)).rejects.toThrow('Agent 无回答产出')
  expect(writes).toEqual([])
})
it('客户端已经停止时不保存回答', async () => {
  await runAssistantTurn({ ...input, isAborted: () => true })
  expect(writes).toEqual([])
})
it('回答与消息 metadata 不携带任何安全预警痕迹（教师侧不显示）', async () => {
  const events: Array<[string, unknown]> = []
  await runAssistantTurn({ ...input, emit: (name, data) => events.push([name, data]) })
  const message = writes.find((row) => (row as { role?: string }).role === 'assistant') as {
    contentEnc: string
    metadata: Record<string, unknown>
  }
  expect(message.contentEnc).toBe('可以先核实发生场景。')
  expect(message.metadata.safetyAlert).toBeUndefined()
  expect(Object.keys(message.metadata)).not.toContain('safetyAlert')
  expect(events.find(([name]) => name === 'fuse')).toBeUndefined()
})

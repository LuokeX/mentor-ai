export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export function composeClarificationSummaryHistory(input: {
  entityMemory?: ChatHistoryMessage[]
  history: ChatHistoryMessage[]
  currentMessage?: string
  includeCurrentMessage: boolean
}): ChatHistoryMessage[] {
  const base = [...(input.entityMemory || []), ...input.history]
  if (!input.includeCurrentMessage) return base

  const currentMessage = input.currentMessage?.trim()
  if (!currentMessage) return base
  return [...base, { role: 'user', content: currentMessage }]
}

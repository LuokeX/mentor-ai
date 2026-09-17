import type { AgentMessage } from './types'

export interface AnswerEvidence {
  id: string
  kind: 'teacher' | 'record' | 'rule' | 'knowledge' | 'observation'
  content: string
  tool?: string
}

export function collectToolEvidence(tool: string, output: unknown): AnswerEvidence[] {
  let value = output
  if (value && typeof value === 'object' && 'content' in value) value = (value as { content: unknown }).content
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!value || typeof value !== 'object') return []
  const data = value as Record<string, unknown>
  if (data.error || ['error', 'timeout', 'empty'].includes(String(data.status))) {
    return [{ id: `${tool}:status`, kind: 'observation', tool, content: JSON.stringify({ status: data.status ?? 'error', message: '本次查询未获得可用内容；不能据此断言记录或制度不存在。' }) }]
  }
  if (tool === 'knowledge_search') {
    return (Array.isArray(data.items) ? data.items : []).flatMap((item: Record<string, unknown>) =>
      typeof item.chunkId === 'string' && typeof item.content === 'string'
        ? [{ id: item.chunkId, kind: 'knowledge' as const, tool, content: JSON.stringify(item) }] : [])
  }
  return [{ id: `${tool}:result`, kind: ['assessment_history', 'recommend_assessment'].includes(tool) ? 'rule' : 'record', tool, content: JSON.stringify(data) }]
}

/** 风险判定只决定展示策略，不计算业务风险等级。 */
export function needsEvidenceReview(text: string): boolean {
  return /制度|规定|平台要求|学校要求|工具库要求|SOP|量表|得分|总分|均分|分级|等级|归因|诊断|确诊|抑郁|焦虑症|多动症|自闭症|保证|治愈|L[123]|[红橙黄绿蓝紫]色/.test(text)
}

export function inspectEvidenceClaims(text: string, evidence: AnswerEvidence[]): string[] {
  const violations: string[] = []
  const policyAssertions = text.split(/[。！？\n]/).filter(sentence => /(平台规定|学校要求|制度要求|工具库要求|平台要求)/.test(sentence) && !/未|不|没有|无法|不能|是否|吗|？/.test(sentence))
  if (policyAssertions.length && !evidence.some(e => e.kind === 'knowledge')) violations.push('missing_policy_evidence')
  const resultClaim = /(?:得分|总分|均分|评分|等级|分级|归因)(?:为|是|：|:|达到|属于)?\s*([0-9]+(?:\.[0-9]+)?|L[123]|[红橙黄绿蓝紫]色)/g
  for (const match of text.matchAll(resultClaim)) {
    const token = match[1]!
    if (!evidence.some(e => e.kind === 'rule' && new RegExp(`(?<![0-9.])${token.replace('.', '\\.')} (?![0-9.])`.replace(' ', '')).test(e.content))) violations.push('rule_value_mismatch')
  }
  return [...new Set(violations)]
}

/** 校验必须看到教师前文；助手曾说过的话不作为事实证据。 */
export function teacherEvidence(history: AgentMessage[], current: string): AnswerEvidence[] {
  return [...history.filter(message => message.role === 'user').map((message, index) => ({
    id: `teacher:history:${index}`, kind: 'teacher' as const, content: message.content
  })), { id: 'teacher:current', kind: 'teacher' as const, content: current }]
}

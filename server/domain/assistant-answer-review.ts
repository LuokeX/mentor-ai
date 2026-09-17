import type { H3Event } from 'h3'
import { z } from 'zod'
import { createAgentLlm } from '../integrations/models'
import { inspectAgentAnswer } from '../agent/answer-guard'
import { inspectEvidenceClaims, needsEvidenceReview, type AnswerEvidence } from '../agent/evidence'
import { AI_PROMPT_BASELINES } from './ai-prompt-baselines'
import { schema, useDb } from '../utils/db'

const reviewSchema = z.object({ supported: z.boolean(), unsupportedClaims: z.array(z.string().max(500)).max(20) })

/** 检查仅验证表述是否有依据，不生成/改变确定性业务结果。 */
export async function reviewAssistantAnswer(event: H3Event, input: {
  answer: string; evidence: AnswerEvidence[]; systemPrompt: string; signal?: AbortSignal
  schoolId: string; userId: string; sessionId: string
  /** 仅合成评测替换审计落点，生产请求不接收。 */
  audit?: (row: typeof schema.aiModelCalls.$inferInsert) => Promise<void>
}): Promise<{ answer: string; repaired: boolean }> {
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)
  let answer = input.answer
  const llm = await createAgentLlm(event, { temperature: 0, maxTokens: 1800, thinking: 'disabled' })
  const audit = input.audit ?? (async (row: typeof schema.aiModelCalls.$inferInsert) => { await useDb(event).insert(schema.aiModelCalls).values(row).catch(() => undefined) })
  const call = async (purpose: string, messages: Array<{ role: 'system' | 'user'; content: string }>) => {
    const started = Date.now()
    try {
      const result = await llm.invoke(messages, { signal, ...(purpose === 'assistant_evidence_review' ? { response_format: { type: 'json_object' as const } } : {}) })
      await audit({ schoolId: input.schoolId, ownerUserId: input.userId, sessionId: input.sessionId,
        provider: 'deepseek', model: llm.model, purpose, status: 'success', latencyMs: Date.now() - started,
        promptTokens: result.usage_metadata?.input_tokens, completionTokens: result.usage_metadata?.output_tokens,
        cacheHitTokens: result.usage_metadata?.input_token_details?.cache_read })
      if (result.response_metadata?.finish_reason === 'length') throw new Error('回答检查输出未完整结束')
      if (typeof result.content !== 'string') throw new Error('Invalid review response')
      return result.content
    } catch {
      await audit({ schoolId: input.schoolId, ownerUserId: input.userId, sessionId: input.sessionId,
        provider: 'deepseek', model: llm.model, purpose, status: 'failed', latencyMs: Date.now() - started, errorCode: 'answer_review_failed' })
      throw new Error('回答校验失败')
    }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const check = inspectAgentAnswer({ answer })
    const violations = inspectEvidenceClaims(answer, input.evidence)
    if (check.violations.includes('secret_like_token')) violations.push('secret_like_token')
    if (needsEvidenceReview(answer)) {
      const raw = await call('assistant_evidence_review', [
        { role: 'system', content: AI_PROMPT_BASELINES.assistant_evidence_review! },
        { role: 'user', content: JSON.stringify({ answer, evidence: input.evidence }) }
      ])
      const checked = reviewSchema.safeParse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')))
      if (!checked.success) throw new Error('回答校验失败')
      if (!checked.data.supported || checked.data.unsupportedClaims.length) violations.push(...checked.data.unsupportedClaims, 'unsupported_claim')
    }
    if (!violations.length) return { answer: check.cleaned, repaired: attempt > 0 }
    if (attempt === 1) throw new Error('回答校验失败')
    answer = await call('assistant_answer_repair', [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: JSON.stringify({ instruction: '修正下列回答中的无依据表述，只依据证据给出完整回答；缺失信息明确说明，不新增事实、等级、制度或时限。不输出检查过程。', answer, violations, evidence: input.evidence }) }
    ])
  }
  throw new Error('回答校验失败')
}

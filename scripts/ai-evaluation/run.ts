import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { loadLocalEnv } from '../load-env'
import { scenarios } from './scenarios'
import { evaluationTools, FIXTURE_VERSION } from './fixtures'
import { AnswerDelivery } from '../../server/agent/answer-delivery'
import { needsEvidenceReview, teacherEvidence } from '../../server/agent/evidence'
import { reviewAssistantAnswer } from '../../server/domain/assistant-answer-review'
import type { AgentMessage } from '../../server/agent/types'

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const out = option('out', '/tmp/mentor-ai-evaluation')
await mkdir(out, { recursive: true })
await writeFile(`${out}/scenarios.json`, JSON.stringify(scenarios, null, 2))
await writeFile(`${out}/scores.csv`, 'scenario,repeat,reviewer,professional_1_5,actionable_1_5,multiturn_pass,correct_facts,total_facts,forbidden_behavior,notes\n')
if (!args.includes('--run')) {
  console.log(`已生成50个场景、评分表与10个演示案例（demo=true）：${out}。未调用模型。加 --run 执行，--repeats=3 为完整验收。`)
  process.exit(0)
}
process.env.ENV_FILE ??= '.env'
loadLocalEnv()
if (!process.env.DEEPSEEK_API_KEY) throw new Error('未配置模型密钥；未执行真实评测')
const runtime = {
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  deepseekGeneratorModel: process.env.DEEPSEEK_GENERATOR_MODEL || 'deepseek-flash',
  deepseekTimeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS) || 60000,
  agentMaxOutputTokens: Number(process.env.AI_AGENT_MAX_OUTPUT_TOKENS) || 4096,
  agentMaxToolRounds: Number(process.env.AI_AGENT_MAX_TOOL_ROUNDS) || 8
}
Object.assign(globalThis, { useRuntimeConfig: () => runtime })
const graphPath = option('graph', '../../server/agent/graph.ts')
const { runAgentGraph } = await import(graphPath) as typeof import('../../server/agent/graph')
const { buildAgentSystemPrompt } = await import('../../server/agent/prompts')
const systemPrompt = args.some(a => a.startsWith('--prompt=')) ? await readFile(option('prompt', ''), 'utf8') : await buildAgentSystemPrompt({} as never, { knowledgeContext: '查询合成知识工具，不得编造制度。', businessContextText: '未绑定档案。' })
const repeats = Math.max(1, Math.min(3, Number(option('repeats', '3'))))
const selected = scenarios.filter(s => !args.some(a => a.startsWith('--module=')) || s.module === option('module', '')).filter(s => !args.includes('--demo') || s.demo).filter(s => !args.some(a => a.startsWith('--case=')) || s.id === option('case', ''))
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
await writeFile(`${out}/manifest.json`, JSON.stringify({ at: new Date().toISOString(), model: runtime.deepseekGeneratorModel,
  timeoutMs: runtime.deepseekTimeoutMs, outputTokens: runtime.agentMaxOutputTokens, toolRounds: runtime.agentMaxToolRounds,
  knowledgeVersion: FIXTURE_VERSION, promptHash: hash(systemPrompt), graphHash: hash(await readFile(graphPath.startsWith('/') ? graphPath : 'server/agent/graph.ts', 'utf8')),
  scenariosHash: hash(JSON.stringify(scenarios)), fixtureHash: hash(await readFile('scripts/ai-evaluation/fixtures.ts', 'utf8')),
  reviewHash: hash(await readFile('server/domain/assistant-answer-review.ts', 'utf8')),
  repeats, scenarios: selected.length, scope: '真实模型+生产Agent图+合成工具；不包含数据库、HTTP、人工盲评' }, null, 2))
const jobs = selected.flatMap(s => Array.from({ length: repeats }, (_, i) => ({ s, repeat: i + 1 })))
let cursor = 0
await Promise.all(Array.from({ length: 4 }, async () => {
while (cursor < jobs.length) {
  const { s, repeat } = jobs[cursor++]!
  const history: AgentMessage[] = []
  const rounds = []
  for (const question of s.turns) {
    const started = Date.now()
    let firstTextMs: number | null = null
    const baseline = args.some(a => a.startsWith('--graph='))
    const delivery = new AnswerDelivery(question, () => { firstTextMs ??= Date.now() - started })
    const reviewCalls: unknown[] = []
    let failureStage: string | null = null
    const result = await runAgentGraph({} as never, { messages: [...history, { role: 'user', content: question }], systemPrompt,
      userCtx: { schoolId: 'synthetic-school', userId: 'synthetic-teacher', sessionId: s.id, currentQuestion: question },
      toolsForEvaluation: evaluationTools(s), onEvent: (name, data) => { if (name === 'answer_delta') { if (baseline) firstTextMs ??= Date.now() - started; else delivery.push(String((data as { text?: string }).text ?? '')) } } })
    if (!baseline && result.answer && (delivery.requiresReview || needsEvidenceReview(result.answer))) {
      try {
        const checked = await reviewAssistantAnswer({} as never, { answer: result.answer, evidence: [...teacherEvidence(history, question), ...(result.evidence ?? [])], systemPrompt,
          schoolId: 'synthetic-school', userId: 'synthetic-teacher', sessionId: s.id, audit: async row => { reviewCalls.push(row) } })
        result.answer = checked.answer
      } catch { result.answer = ''; result.exitReason = 'error'; failureStage = 'review' }
    }
    if (result.answer) firstTextMs ??= Date.now() - started
    rounds.push({ failureStage: failureStage ?? (result.exitReason === 'error' ? 'graph' : null), reviewed: delivery.requiresReview, reviewCalls, question, answer: result.answer, exitReason: result.exitReason, firstTextMs, latencyMs: Date.now() - started, tools: result.toolCalls, usage: result.modelCalls })
    history.push({ role: 'user', content: question, ...(result.answer ? { toolTrace: result.toolTrace } : {}) })
    if (result.answer) history.push({ role: 'assistant', content: result.answer })
  }
  await writeFile(`${out}/${s.id}-${repeat}.json`, JSON.stringify({ scenario: s, repeat, rounds, humanReview: null }, null, 2))
  console.log(`${s.id} 第${repeat}次完成；失败轮数${rounds.filter(r => r.exitReason === 'error').length}；人工评分待填写`)
}
}))

/**
 * 语义安全样例评测（真实模型）。
 *
 * 用法：
 *   pnpm ai:safety-eval                        # 只列出样例，不调用模型
 *   pnpm ai:safety-eval --run                  # 真实调用，逐条比对标签
 *   pnpm ai:safety-eval --run --kind=must_miss # 只看误报回归
 *   pnpm ai:safety-eval --run --repeats=3      # 每条重复 3 次，观察抖动
 *
 * 关注两个数字：首轮误报数（本次改造前会直接熔断的普通提问）与两轮误报数/漏检数。
 * 调用元数据（ai_model_calls，purpose=semantic_safety / semantic_safety_review）写入
 * DATABASE_URL 指向的库；未配置数据库时该写入静默失败，不影响评测本身。
 */
import { loadLocalEnv } from '../load-env'
import { safetySamples } from './safety-samples'

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const hits = (value: string[], expected: string[]) => expected.length === 0 ? value.length === 0 : value.some(rule => expected.includes(rule))

const selected = safetySamples
  .filter(sample => !option('kind', '') || sample.kind === option('kind', ''))
  .filter(sample => !option('id', '') || sample.id === option('id', ''))
const repeats = Math.max(1, Math.min(5, Number(option('repeats', '1'))))

if (!selected.length) throw new Error('没有匹配的样例；检查 --kind / --id')
if (!args.includes('--run')) {
  const mustHit = selected.filter(sample => sample.kind === 'must_hit').length
  console.log(`已选择 ${selected.length} 条语义安全样例（必命中 ${mustHit} / 不命中 ${selected.length - mustHit}），repeats=${repeats}。加 --run 调用真实模型。`)
  for (const sample of selected) {
    console.log(`${sample.kind === 'must_hit' ? '必命中' : '不命中'}  ${sample.id.padEnd(8)} ${sample.text}\n         ${sample.note}`)
  }
  process.exit(0)
}

process.env.ENV_FILE ??= '.env'
loadLocalEnv()
if (!process.env.DEEPSEEK_API_KEY) throw new Error('未配置模型密钥；未执行真实评测')

// 与 scripts/ai-evaluation/run.ts 同一套做法：先桩运行时配置，再动态导入被测模块。
const runtime = {
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  deepseekRouterModel: process.env.DEEPSEEK_ROUTER_MODEL || 'deepseek-flash',
  aiStrictJsonPurposes: process.env.AI_STRICT_JSON_PURPOSES || '',
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  databaseUrl: process.env.DATABASE_URL || 'postgres://invalid:invalid@127.0.0.1:1/none'
}
Object.assign(globalThis, { useRuntimeConfig: () => runtime })

const { confirmedSemanticSafetySignals } = await import('../../server/integrations/deepseek')

interface Row {
  id: string
  kind: string
  pass: boolean
  detail: string
  firstPassHit: boolean
  latencyMs: number
}
const rows: Row[] = []

for (const sample of selected) {
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const started = Date.now()
    const verdict = await confirmedSemanticSafetySignals({} as never, sample.text, false, {})
    const latencyMs = Date.now() - started
    const firstPassHit = verdict.detectedRules.length > 0
    const pass = sample.kind === 'must_hit'
      ? hits(verdict.matchedRules, sample.expect)
      : !firstPassHit && verdict.matchedRules.length === 0
    const detail = verdict.review === 'none'
      ? '两轮均未命中'
      : verdict.review === 'cleared'
        ? `首轮命中 ${verdict.detectedRules.join(',')} → 复核清空`
        : verdict.review === 'unavailable'
          ? `复核不可用，按首轮判定 ${verdict.matchedRules.join(',')}`
          : `两轮命中 ${verdict.matchedRules.join(',')}`
    const marks = [
      pass ? '✅' : '⛔',
      sample.kind === 'must_miss' && firstPassHit ? '首轮误报被复核纠正' : '',
      repeat > 1 ? `#${repeat}` : ''
    ].filter(Boolean).join(' ')
    console.log(`${marks} ${sample.id.padEnd(8)} ${detail}（${latencyMs}ms）`)
    rows.push({ id: sample.id, kind: sample.kind, pass, detail, firstPassHit, latencyMs })
  }
}

const mustHitRows = rows.filter(row => row.kind === 'must_hit')
const mustMissRows = rows.filter(row => row.kind === 'must_miss')
const missed = mustHitRows.filter(row => !row.pass)
const flagged = mustMissRows.filter(row => !row.pass)
const firstPassFlags = mustMissRows.filter(row => row.firstPassHit).length
const latency = rows.map(row => row.latencyMs).sort((a, b) => a - b)
const p95 = latency[Math.min(latency.length - 1, Math.floor(latency.length * 0.95))] ?? 0

console.log('\n=== 汇总 ===')
console.log(`必命中：${mustHitRows.length - missed.length}/${mustHitRows.length}${missed.length ? `　漏检：${missed.map(row => row.id).join('、')}` : ''}`)
console.log(`不应命中：${mustMissRows.length - flagged.length}/${mustMissRows.length}${flagged.length ? `　仍误报：${flagged.map(row => row.id).join('、')}` : ''}`)
console.log(`首轮误报（改造前会直接熔断）：${firstPassFlags}/${mustMissRows.length}　两轮误报：${flagged.length}/${mustMissRows.length}`)
console.log(`单条耗时 P95：${p95}ms（含首轮 + 命中后的复核；本地规则命中时不走这里）`)

if (missed.length || flagged.length) {
  console.error('\n存在不符合标签的样例，见上面 ⛔ 行。')
  process.exit(1)
}

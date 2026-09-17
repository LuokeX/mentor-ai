import { readdir, readFile, writeFile } from 'node:fs/promises'
import { scenarios } from './scenarios'

const dir = process.argv[2]
if (!dir) throw new Error('用法：node --import tsx scripts/ai-evaluation/report.ts <结果目录>')
type Round = { exitReason: string; reviewed: boolean; firstTextMs: number | null; latencyMs: number; failureStage: string | null; usage: Array<{ promptTokens?: number; completionTokens?: number }>; reviewCalls?: Array<{ promptTokens?: number; completionTokens?: number }> }
type Run = { scenario: { id: string; module: string }; repeat: number; rounds: Round[] }
const runs: Run[] = []
for (const name of await readdir(dir)) if (/^(self_growth|class_system|home_school|student_case|learning_problem)-\d+-\d+\.json$/.test(name)) runs.push(JSON.parse(await readFile(`${dir}/${name}`, 'utf8')))
const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8'))
const percentile = (values: number[]) => values.length ? values.sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] : null
const aggregate = (list: Run[]) => {
  const rounds = list.flatMap(r => r.rounds)
  const calls = rounds.flatMap(r => [...r.usage, ...(r.reviewCalls ?? [])])
  return { runs: list.length, rounds: rounds.length, failed: rounds.filter(r => r.exitReason !== 'done').length,
    graphFailures: rounds.filter(r => r.failureStage === 'graph').length, reviewFailures: rounds.filter(r => r.failureStage === 'review').length,
    ordinaryFirstTextP95Ms: percentile(rounds.filter(r => !r.reviewed && r.exitReason === 'done').flatMap(r => r.firstTextMs === null ? [] : [r.firstTextMs])),
    reviewedLatencyP95Ms: percentile(rounds.filter(r => r.reviewed).map(r => r.latencyMs)),
    inputTokens: calls.reduce((n, c) => n + (c.promptTokens ?? 0), 0), outputTokens: calls.reduce((n, c) => n + (c.completionTokens ?? 0), 0) }
}
const report = { manifest, total: aggregate(runs), byModule: Object.fromEntries([...new Set(scenarios.map(s => s.module))].map(m => [m, aggregate(runs.filter(r => r.scenario.module === m))])), humanReview: '待业务负责人和一线教师独立盲评；运行成功不等于行为达标' }
await writeFile(`${dir}/summary.json`, JSON.stringify(report, null, 2))
// 单独生成空白模板，不覆盖教师已填写的 scores.csv。
await writeFile(`${dir}/scores-template.csv`, 'scenario,repeat,reviewer,professional_1_5,actionable_1_5,multiturn_pass,correct_facts,total_facts,forbidden_behavior,notes\n' + runs.map(r => `${r.scenario.id},${r.repeat},,,,,,,,`).join('\n'))
console.log(JSON.stringify(report, null, 2))

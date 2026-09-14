/**
 * DeepSeek 前缀缓存探针（仅手动运行，不进 CI）。
 *
 * 目的：用同一段合成对话，分别按「现状滑窗布局」与「只追加布局」请求 DeepSeek，
 * 逐轮打印缓存命中/未命中 tokens、首字延迟、总耗时与按官方价目表估算的费用，
 * 用于判断「取消条数截断、改为 token 预算」是否真的带来命中率提升。
 *
 * 顺带确认三件事：
 *  1. 思考模式是否默认开启（usage.completion_tokens_details.reasoning_tokens 是否大于 0）；
 *  2. 是否返回 reasoning_content（思考模式开启时会出现）；
 *  3. usage 中缓存字段的真实名字（prompt_cache_hit_tokens 与/或 prompt_tokens_details.cached_tokens），
 *     决定 LangChain 的 usage_metadata.input_token_details.cache_read 能否直接读到。
 *
 * 安全约定：只发送合成文本，绝不使用真实业务数据；不打印密钥。
 *
 * 用法：
 *   pnpm tsx scripts/ai-cache-probe.ts --run                  # 默认模型取 DEEPSEEK_GENERATOR_MODEL
 *   pnpm tsx scripts/ai-cache-probe.ts --run --model=deepseek-flash
 *   pnpm tsx scripts/ai-cache-probe.ts --run --thinking=disabled
 *   pnpm tsx scripts/ai-cache-probe.ts --run --turns=6
 */
import { loadLocalEnv } from './load-env'

loadLocalEnv()

interface CliOptions {
  run: boolean
  model: string
  turns: number
  /** 是否显式传 thinking 参数（默认不传，观察服务端默认行为）。 */
  thinking?: 'enabled' | 'disabled'
  /** 输出上限：用于验证思考模式下 max_tokens 是否被接受。 */
  maxTokens?: number
  /** 工具消息回放场景（P3）：验证思考模式下回放 tool_calls/tool 消息是否被接受。 */
  toolReplay: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    run: argv.includes('--run'),
    model: process.env.DEEPSEEK_GENERATOR_MODEL || 'deepseek-flash',
    turns: 8,
    thinking: undefined,
    toolReplay: argv.includes('--tool-replay')
  }
  for (const arg of argv) {
    const turnMatch = /^--turns=(\d+)$/.exec(arg)
    if (turnMatch) options.turns = Math.max(2, Math.min(SYNTHETIC_TURNS.length, Number(turnMatch[1])))
    const modelMatch = /^--model=(.+)$/.exec(arg)
    if (modelMatch) options.model = modelMatch[1]!
    const thinkingMatch = /^--thinking=(enabled|disabled)$/.exec(arg)
    if (thinkingMatch) options.thinking = thinkingMatch[1] as 'enabled' | 'disabled'
    const maxTokensMatch = /^--max-tokens=(\d+)$/.exec(arg)
    if (maxTokensMatch) options.maxTokens = Math.max(64, Number(maxTokensMatch[1]))
  }
  return options
}

/** 官方价目表（元 / 百万 tokens）。价格会调整，运行前请核对官方页面。 */
const PRICE_TABLE: Record<string, { hitPeak: number, missPeak: number, outPeak: number }> = {
  'deepseek-v4-pro': { hitPeak: 0.30, missPeak: 9.0, outPeak: 27.0 },
  'deepseek-flash': { hitPeak: 0.04, missPeak: 2.0, outPeak: 8.0 },
  'deepseek-v4-flash': { hitPeak: 0.04, missPeak: 2.0, outPeak: 8.0 }
}

/** 北京时间周一至周五 9:00-12:00、14:00-18:00 为高峰时段，其余为空闲（半价）。 */
function isPeakNow(now = new Date()): boolean {
  const beijing = new Date(now.getTime() + 8 * 3600_000)
  const day = beijing.getUTCDay()
  if (day === 0 || day === 6) return false
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes()
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

function estimateCost(model: string, hit: number, miss: number, output: number, peak: boolean): number | null {
  const price = PRICE_TABLE[model]
  if (!price) return null
  const factor = peak ? 1 : 0.5
  return (hit * price.hitPeak * factor + miss * price.missPeak * factor + output * price.outPeak * factor) / 1_000_000
}

interface TurnUsage {
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cacheHitTokens: number | null
  cacheMissTokens: number | null
  rawUsageKeys: string[]
  hasCachedTokensField: boolean
  reasoningChars: number
  firstTokenMs: number | null
  totalMs: number
}

const SYNTHETIC_TURNS: Array<{ user: string, assistant: string }> = [
  {
    user: '我们班有个男生最近一周上课总是趴着，叫他起来回答问题也能答对，但明显没精神。我先找他聊过一次，他说是晚上睡不好，再问就不说了。我接下来该怎么谈？',
    assistant: '先别急着追问原因，把关注点放在可观察的事实上。可以再找一个安静的时段，用具体观察开场（“我注意到你这周有三节课趴着，是不是晚上有什么事”），给他一个不需要立刻解释的出口。同时留意他这两天的出勤和午饭情况，作为判断依据。如果两天内依然明显疲惫，再考虑与家长沟通，但沟通时只描述观察到的现象，不替孩子下结论。'
  },
  {
    user: '今天他又趴着了，我按你说的用观察开场，他说家里最近在搬家，晚上要帮忙收拾到很晚。我该怎么跟进？要不要联系家长？',
    assistant: '搬家是短期压力源，先按时间线处理：一是跟他约定一个可执行的作息底线，二是问清搬家大概还要持续几天，三是观察一周。联系家长可以暂缓，先让孩子知道你会在这周内继续关注；如果一周后仍无改善，再与家长沟通并把重点放在作息安排上，而不是追究原因。过程中尽量把每一次沟通的结论记下来，方便后续复盘。'
  },
  {
    user: '一周过去了，他说搬完了，这两天精神好一些，但作业交得还是不全。我担心他是借搬家这事掩盖别的问题。',
    assistant: '精神恢复是好信号，作业不全需要单独归因。建议把两件事拆开：先记录这两周缺交的科目和时间点，看看是否集中在某几科；再找一次他聊作业的具体困难（不会做、时间不够、还是不想做）。用数据说话比继续猜更有效，也能避免让孩子觉得被怀疑。记录时把“哪一科、哪一天、哪一课”写清楚，一两周后就能看出是偶发还是趋势。'
  },
  {
    user: '查了一下，缺交的都是数学，他说最近数学课讲的新内容听不懂，落下了就不想写。这个该怎么处理？',
    assistant: '方向清楚了：问题在数学学科的阶段性落差。可以分三步：先和数学老师对一下最近的知识点进度，确认他在哪一环掉队；再帮他补上那一环，哪怕只补两三个关键题；最后给一个两周内可完成的小目标，让他重新体验到“跟得上”。补的环节要具体到某几个知识点，不要泛泛地说“多练题”，否则孩子还是无从下手。'
  },
  {
    user: '数学老师说他课上不提问，我问他为什么，他说怕问的问题太简单被同学笑。',
    assistant: '这是典型的求助成本过高。可以给他一个低成本的求助通道，比如课后把不会的题写在便签上交给你转给数学老师，或者在作业本上标一个记号表示“这题需要讲”。先让提问变得不显眼，等他的信心回来，再鼓励课堂提问。同时跟数学老师打个招呼，让他在这段时间里对这类“小问题”给出明确、简短的肯定，帮助孩子建立安全感。'
  },
  {
    user: '便签法试了三天，他交了两张，数学老师也反馈有回应了。我该怎么把这个做法固定下来？',
    assistant: '这是一个可固化的约定：把它写成一条简单的班级惯例（“不会的题写在便签上放进作业本”），并明确反馈时间（比如第二天课前给答复）。两周后做一次小复盘，看看缺交是否下降，把有效做法保留下来。如果效果好，可以在班会上用不点名的方式说明这个通道对所有同学开放，让它不再像特殊照顾。'
  },
  {
    user: '同一周里还有两个女生因为座位问题闹别扭，互相不说话，我该怎么处理这两个孩子的关系？',
    assistant: '先分别了解，不急着把两人叫到一起对质。见面时只让他们各自讲事实和感受，不评价对方；再看看这次矛盾的起点是座位距离、还是之前积累的小摩擦。若只是座位摩擦，可以让他们自己提一个双方都能接受的调整方案，你只负责确认可执行；如果还牵涉到小团体，就要在一周内持续观察，避免扩大。'
  },
  {
    user: '聊完之后她们愿意换座位，但今天又有同学传话说其中一个在背后说她坏话，我怕又闹起来。',
    assistant: '这类“传话”最容易把小事放大。先跟传话的同学确认来源，不要在没核实前转述给任何一方；同时单独告诉当事的两个孩子：你只处理她们本人之间直接说清的事，不处理转述。给她们一个明确的动作（有事当面对你说，或者写下来给你），把处理权收回到你这里。观察三天，如果没有新的直接冲突，就不再主动翻旧账。'
  },
  {
    user: '这周班里整体上课发言的人数明显变少，点名才说，我也找不到具体原因。',
    assistant: '先用低成本的方式取证：连续三天记录每节课主动发言的人次，以及被点名后回答的人数，看是整体下降还是集中在几节课。同时找三四个平时愿意说话的学生分别聊一分钟，问“最近为什么不太想举手”，往往能听到关于题目难度、怕说错、或者最近气氛紧张的具体原因。拿到一两条线索后再决定是调整提问方式还是处理班级气氛。'
  },
  {
    user: '记录之后发现主要是下午第二节，那节课我讲得比较快，提问都是直接点名。',
    assistant: '原因比较清楚了：那节课的节奏和提问方式让学生不愿开口。可以做两个小调整：把那一节的内容拆成两段，中间插入一个不需要标准答案的开放问题（比如“这一步你觉得最容易错在哪”）；点名之前先给 10 秒思考时间，并允许“先说说思路、不要求说完整”。连续两周后再记录一次发言人次，用数据确认调整是否有效。'
  }
]

const SYSTEM_PROMPT_BASE = `你是面向班主任的校内助手，只做分析与建议，不做诊断，不替代量表结论。
回答要求：共情开场，回答先行，给出 1-3 个可执行动作，不超过 500 字；不要输出 JSON、代码块或“选项：”列表。
以下是你的行为约束与知识边界的完整说明，请始终遵守：
1. 只输出给班主任看的自然语言回答；
2. 不计算量表分数，不决定风险等级；
3. 引用知识时必须基于实际内容，不得编造制度、量表或数据；
4. 不复述姓名、电话、邮箱等个人信息；
5. 回答温和简洁，优先给可执行动作。
（本段为探针脚本使用的合成提示词，用于验证前缀缓存行为，与线上提示词无关。）`

interface ProbeResult {
  layout: string
  round: number
  usage: TurnUsage
}

async function callDeepSeek(input: {
  baseUrl: string
  apiKey: string
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant', content: string }>
  thinking?: 'enabled' | 'disabled'
  maxTokens?: number
}): Promise<TurnUsage> {
  const startedAt = Date.now()
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    stream: true,
    stream_options: { include_usage: true }
  }
  if (input.thinking) body.thinking = { type: input.thinking }
  if (input.maxTokens) body.max_tokens = input.maxTokens

  const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify(body)
  })
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(`DeepSeek 请求失败：HTTP ${response.status} ${text.slice(0, 300)}`)
  }

  const usage: TurnUsage = {
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    cacheHitTokens: null,
    cacheMissTokens: null,
    rawUsageKeys: [],
    hasCachedTokensField: false,
    reasoningChars: 0,
    firstTokenMs: null,
    totalMs: 0
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let sawAnyContent = false

  const consumeLine = (line: string) => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>
    } catch {
      return
    }
    const usageRaw = parsed.usage as Record<string, unknown> | undefined
    if (usageRaw) {
      usage.rawUsageKeys = Object.keys(usageRaw)
      if (typeof usageRaw.prompt_tokens === 'number') usage.promptTokens = usageRaw.prompt_tokens
      if (typeof usageRaw.completion_tokens === 'number') usage.completionTokens = usageRaw.completion_tokens
      if (typeof usageRaw.prompt_cache_hit_tokens === 'number') usage.cacheHitTokens = usageRaw.prompt_cache_hit_tokens
      if (typeof usageRaw.prompt_cache_miss_tokens === 'number') usage.cacheMissTokens = usageRaw.prompt_cache_miss_tokens
      const details = usageRaw.prompt_tokens_details as { cached_tokens?: unknown } | undefined
      if (typeof details?.cached_tokens === 'number') {
        usage.hasCachedTokensField = true
        usage.cacheHitTokens = details.cached_tokens
      }
      const completionDetails = usageRaw.completion_tokens_details as { reasoning_tokens?: unknown } | undefined
      if (typeof completionDetails?.reasoning_tokens === 'number') usage.reasoningTokens = completionDetails.reasoning_tokens
    }
    const choices = parsed.choices as Array<{ delta?: { content?: unknown, reasoning_content?: unknown } }> | undefined
    const delta = choices?.[0]?.delta
    if (!delta) return
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) usage.reasoningChars += delta.reasoning_content.length
    if (typeof delta.content === 'string' && delta.content) {
      if (!sawAnyContent) {
        sawAnyContent = true
        usage.firstTokenMs = Date.now() - startedAt
      }
    }
  }

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      consumeLine(buffer.slice(0, index).trim())
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
    }
  }
  if (buffer.trim()) consumeLine(buffer.trim())
  usage.totalMs = Date.now() - startedAt
  return usage
}

function flattenHistory(turns: Array<{ user: string, assistant: string }>): Array<{ role: 'user' | 'assistant', content: string }> {
  return turns.flatMap(turn => ([
    { role: 'user' as const, content: turn.user },
    { role: 'assistant' as const, content: turn.assistant }
  ]))
}

function formatUsage(label: string, round: number, usage: TurnUsage, model: string, peak: boolean, historyCount: number): string {
  const totalIn = usage.promptTokens || (usage.cacheHitTokens ?? 0) + (usage.cacheMissTokens ?? 0)
  const hit = usage.cacheHitTokens
  const miss = usage.cacheMissTokens ?? (typeof hit === 'number' && totalIn ? Math.max(0, totalIn - hit) : null)
  const cost = estimateCost(model, hit ?? 0, miss ?? totalIn, usage.completionTokens, peak)
  const parts = [
    `[${label}] 第 ${round} 轮（历史 ${historyCount} 条）`,
    `输入 ${totalIn}（命中 ${hit ?? '未返回'} / 未命中 ${miss ?? '未返回'}）`,
    `输出 ${usage.completionTokens}（推理 ${usage.reasoningTokens}）`,
    `首字 ${usage.firstTokenMs !== null ? `${usage.firstTokenMs}ms` : '—'}`,
    `总耗时 ${usage.totalMs}ms`
  ]
  if (cost !== null) parts.push(`约 ${cost.toFixed(4)} 元（${peak ? '高峰价' : '空闲价'}）`)
  return parts.join(' | ')
}

async function runLayout(input: {
  label: string
  marker: string
  windowMode: 'sliding' | 'append-only'
  baseUrl: string
  apiKey: string
  model: string
  turns: number
  thinking?: 'enabled' | 'disabled'
  maxTokens?: number
}): Promise<ProbeResult[]> {
  const results: ProbeResult[] = []
  const system = `${SYSTEM_PROMPT_BASE}\n（布局标记：${input.marker}）`
  for (let round = 1; round <= input.turns; round++) {
    const prior = flattenHistory(SYNTHETIC_TURNS.slice(0, round - 1))
    // 现状布局：只保留最近 8 条历史（对应 server/api/v1/chat/messages.post.ts 的 limit(8)）
    const history = input.windowMode === 'sliding' ? prior.slice(-8) : prior
    const messages = [
      { role: 'system' as const, content: system },
      ...history,
      { role: 'user' as const, content: SYNTHETIC_TURNS[round - 1]!.user }
    ]
    const usage = await callDeepSeek({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      messages,
      thinking: input.thinking,
      maxTokens: input.maxTokens
    })
    results.push({ layout: input.label, round, usage })
    process.stdout.write(`${formatUsage(input.label, round, usage, input.model, isPeakNow(), history.length)}\n`)
    if (usage.rawUsageKeys.length) {
      process.stdout.write(`    usage 字段：${usage.rawUsageKeys.join(', ')}${usage.hasCachedTokensField ? '（含 prompt_tokens_details.cached_tokens）' : '（无 prompt_tokens_details.cached_tokens）'}\n`)
    }
    if (usage.reasoningChars > 0) {
      process.stdout.write(`    收到 reasoning_content，共 ${usage.reasoningChars} 字符\n`)
    }
  }
  return results
}

function summarize(results: ProbeResult[], model: string) {
  const grouped = new Map<string, ProbeResult[]>()
  for (const item of results) grouped.set(item.layout, [...(grouped.get(item.layout) || []), item])
  for (const [label, items] of grouped) {
    const hit = items.reduce((sum, item) => sum + (item.usage.cacheHitTokens ?? 0), 0)
    const miss = items.reduce((sum, item) => sum + (item.usage.cacheMissTokens ?? 0), 0)
    const output = items.reduce((sum, item) => sum + item.usage.completionTokens, 0)
    const reasoning = items.reduce((sum, item) => sum + item.usage.reasoningTokens, 0)
    const total = hit + miss
    const cost = estimateCost(model, hit, miss, output, isPeakNow())
    const firstTokenSamples = items.map(item => item.usage.firstTokenMs).filter((value): value is number => value !== null)
    const avgFirstToken = firstTokenSamples.length ? Math.round(firstTokenSamples.reduce((a, b) => a + b, 0) / firstTokenSamples.length) : null
    process.stdout.write(
      `${label} 合计：命中 ${hit} / 未命中 ${miss} → 命中率 ${total ? Math.round((hit / total) * 100) : 0}%`
      + `${cost !== null ? `；费用约 ${cost.toFixed(4)} 元` : ''}`
      + `；输出中推理占 ${output ? Math.round((reasoning / output) * 100) : 0}%`
      + `${avgFirstToken !== null ? `；平均首字 ${avgFirstToken}ms` : ''}\n`
    )
  }
}

/**
 * P3 前置实验：思考模式下回放「助手 tool_calls + tool 结果」是否被接受。
 * 变体 A 带 reasoning_content，变体 B 不带（线上跨轮请求本来就不带）。
 */
async function probeToolReplay(input: { baseUrl: string, apiKey: string, model: string, thinking?: 'enabled' | 'disabled' }) {
  const tools = [{
    type: 'function',
    function: {
      name: 'record_snapshot',
      description: '读取当前咨询对象的档案快照',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  }]
  const system = '你是教师赋能平台的助手，回答前先调用 record_snapshot 查看档案。'
  const firstUser = '这个学生最近状态怎么样？'
  const secondUser = '那接下来我该怎么做？'
  const base = { baseUrl: input.baseUrl, apiKey: input.apiKey, model: input.model, thinking: input.thinking }

  const call = async (messages: unknown[], label: string) => {
    const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({
        model: input.model,
        messages,
        tools,
        ...(input.thinking ? { thinking: { type: input.thinking } } : {})
      })
    })
    const text = await response.text()
    process.stdout.write(`[${label}] HTTP ${response.status}\n`)
    if (!response.ok) {
      process.stdout.write(`    错误正文：${text.slice(0, 300)}\n`)
      return null
    }
    return JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string, reasoning_content?: string, tool_calls?: Array<{ id: string, function: { name: string, arguments: string } }> } }>
      usage?: Record<string, unknown>
    }
  }

  // 第一轮：拿到 tool_calls（以及可能的 reasoning_content）
  const first = await call([{ role: 'system', content: system }, { role: 'user', content: firstUser }], '第一轮')
  if (!first) return
  const assistant = first.choices?.[0]?.message
  const toolCall = assistant?.tool_calls?.[0]
  process.stdout.write(`    是否返回 tool_calls：${Boolean(toolCall)}；是否返回 reasoning_content：${Boolean(assistant?.reasoning_content)}\n`)
  if (!toolCall) return

  const assistantMessage: Record<string, unknown> = {
    role: 'assistant',
    content: assistant?.content ?? '',
    tool_calls: assistant?.tool_calls
  }
  const toolMessage = { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ label: '合成档案', note: '探针数据' }) }

  // 变体 A：带 reasoning_content 回放
  await call([
    { role: 'system', content: system },
    { role: 'user', content: firstUser },
    { ...assistantMessage, ...(assistant?.reasoning_content ? { reasoning_content: assistant.reasoning_content } : {}) },
    toolMessage,
    { role: 'user', content: secondUser }
  ], '第二轮（回放含 reasoning_content）')

  // 变体 B：不带 reasoning_content 回放（线上跨轮的真实形态）
  await call([
    { role: 'system', content: system },
    { role: 'user', content: firstUser },
    assistantMessage,
    toolMessage,
    { role: 'user', content: secondUser }
  ], '第二轮（回放不含 reasoning_content）')

  process.stdout.write('\n结论用法：两个变体都返回 200，说明可安全回放工具轨迹；仅变体 A 通过，则回放必须携带 reasoning_content。\n')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const apiKey = process.env.DEEPSEEK_API_KEY || ''
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  if (!options.run) {
    process.stdout.write('这是会真实调用 DeepSeek 的探针脚本（产生少量费用）。确认后加 --run 执行，例如：\n')
    process.stdout.write('  pnpm tsx scripts/ai-cache-probe.ts --run --turns=4\n')
    process.stdout.write('可选参数：--model=deepseek-flash --thinking=disabled --max-tokens=4096 --tool-replay\n')
    return
  }
  if (!apiKey) throw new Error('缺少 DEEPSEEK_API_KEY（读取 .env 或环境变量）')
  process.stdout.write(`模型：${options.model}；轮数：${options.turns}；思考参数：${options.thinking ?? '不传（观察默认）'}；输出上限：${options.maxTokens ?? '不传'}；时段：${isPeakNow() ? '高峰' : '空闲'}\n`)
  process.stdout.write('仅发送脚本内置的合成对话，不含任何真实业务数据。\n\n')

  if (options.toolReplay) {
    await probeToolReplay({ baseUrl, apiKey, model: options.model, thinking: options.thinking })
    return
  }

  const common = { baseUrl, apiKey, model: options.model, turns: options.turns, thinking: options.thinking, maxTokens: options.maxTokens }
  const sliding = await runLayout({ ...common, label: 'A 现状滑窗（最近 8 条）', marker: 'probe-layout-sliding-window-v1', windowMode: 'sliding' })
  process.stdout.write('\n')
  const appendOnly = await runLayout({ ...common, label: 'B 只追加（全量历史）', marker: 'probe-layout-append-only-v1', windowMode: 'append-only' })

  process.stdout.write('\n')
  summarize([...sliding, ...appendOnly], options.model)
  process.stdout.write('\n注意：缓存是尽力而为，命中率随负载与落盘时机浮动；价格请以官方价目表为准。\n')
}

await main()

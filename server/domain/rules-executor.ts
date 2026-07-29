import type { RuleConfig, RuleExecResult, ModuleId, AssessmentDimensionDef, RedLineConfig, AttributionOutcome } from '../../shared/contracts'
import { assessmentDefinitions } from '../../shared/assessments'
import type { AssessmentDefinition } from '../../shared/assessments'

// ---- 受限表达式求值器 ----
// tokenize → parse → evaluate
// 支持: 标识符、数字、字符串、比较/逻辑运算符、括号、函数调用(SUM/MAX/MIN/SCORE/RAW)

type Token =
  | { type: 'NUMBER'; value: number }
  | { type: 'STRING'; value: string }
  | { type: 'IDENT'; value: string }
  | { type: 'LPAREN'; value: '(' }
  | { type: 'RPAREN'; value: ')' }
  | { type: 'OP'; value: string }
  | { type: 'COMMA'; value: ',' }

/**
 * 把业务模板里的中文写法翻译成求值器认识的 DSL。
 *
 * 业务在 ⑤a 条件写法速查里填的是「题[q1] >= 4 且 维度[EMOTION] <= 2」这种形式，
 * 求值器只认 SCORE(q1) >= 4 && DIM(EMOTION) <= 2。没有这一层，模板里所有示例
 * 写法都会在导入时报「Unexpected character」，业务无从下手。
 */
export function normalizeExpression(expr: string): string {
  return expr
    // 全角符号
    .replace(/[＞>]\s*[＝=]/g, '>=')
    .replace(/[＜<]\s*[＝=]/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/＞/g, '>')
    .replace(/＜/g, '<')
    .replace(/＝/g, '=')
    .replace(/[，、]/g, ',')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    // 取值写法
    .replace(/题\s*\[\s*([^\]]+?)\s*\]/g, 'SCORE($1)')
    .replace(/原始\s*\[\s*([^\]]+?)\s*\]/g, 'RAW($1)')
    .replace(/维度\s*\[\s*([^\]]+?)\s*\]/g, 'DIM($1)')
    // 聚合写法。前后不能紧邻中文，否则会把业务自定义的变量名切坏
    //（例如计算变量叫「状态总分」时，不加边界会被替换成「状态SUM(scores)」）。
    .replace(/(?<![一-鿿])总分(?![一-鿿])/g, 'SUM(scores)')
    .replace(/(?<![一-鿿])均分(?![一-鿿])/g, 'AVG(scores)')
    .replace(/(?<![一-鿿])主导维度(?![一-鿿])/g, 'TOP_DIM()')
    .replace(/(?<![一-鿿])短板维度(?![一-鿿])/g, 'BOTTOM_DIM()')
    // 逻辑连接词放在最后处理，且必须两侧带空格才视为运算符，
    // 否则「疲惫且失意」这类变量名会被拆坏。
    .replace(/\s+且\s+/g, ' && ')
    .replace(/\s+或\s+/g, ' || ')
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]!
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue }
    if (ch === '(') { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue }
    if (ch === ')') { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue }
    if (ch === ',') { tokens.push({ type: 'COMMA', value: ',' }); i++; continue }
    // 字符串字面量
    if (ch === "'" || ch === '"') {
      const quote = ch
      let s = ''
      i++
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\') { i++; s += expr[i] || '' }
        else s += expr[i]
        i++
      }
      i++ // skip closing quote
      tokens.push({ type: 'STRING', value: s })
      continue
    }
    // 数字
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < expr.length && /[0-9]/.test(expr[i + 1]!))) {
      let num = ''
      while (i < expr.length && /[0-9.]/.test(expr[i]!)) { num += expr[i]!; i++ }
      tokens.push({ type: 'NUMBER', value: parseFloat(num) })
      continue
    }
    // 多字符运算符
    const twoChar = expr.slice(i, i + 2)
    if (twoChar === '>=' || twoChar === '<=' || twoChar === '!=' || twoChar === '==' || twoChar === '&&' || twoChar === '||') {
      tokens.push({ type: 'OP', value: twoChar })
      i += 2
      continue
    }
    // 单字符运算符
    if (ch === '>' || ch === '<' || ch === '!' || ch === '=') {
      tokens.push({ type: 'OP', value: ch })
      i++
      continue
    }
    // 标识符（含函数名和变量名，支持 a.b.c 点号分隔的嵌套变量）
    // 允许中文，因为 ⑤b 计算变量的变量名由业务用中文命名（如「情绪均分」）。
    // 关键词（且/或/总分/均分等）在 normalizeExpression 阶段已经被替换掉，不会走到这里。
    if (/[a-zA-Z_一-鿿]/.test(ch)) {
      let id = ''
      while (i < expr.length && /[a-zA-Z0-9_.一-鿿]/.test(expr[i]!)) { id += expr[i]!; i++ }
      // 不允许以点号开头或结尾，不允许连续点号
      if (id.startsWith('.') || id.endsWith('.') || id.includes('..')) {
        throw new Error(`Invalid identifier '${id}'`)
      }
      tokens.push({ type: 'IDENT', value: id })
      continue
    }
    throw new Error(`Unexpected character '${ch}' at position ${i}`)
  }
  return tokens
}

// ---- 解析器: 递归下降 ----
// expr     → or_expr
// or_expr  → and_expr ('||' and_expr)*
// and_expr → cmp_expr ('&&' cmp_expr)*
// cmp_expr → add_expr (('>=' | '<=' | '>' | '<' | '==' | '!=') add_expr)?
// add_expr → atom
// atom     → NUMBER | STRING | IDENT [ '(' (expr (',' expr)*)? ')' ] | '(' expr ')'

type ASTNode =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'var'; name: string }
  | { type: 'call'; name: string; args: ASTNode[] }
  | { type: 'cmp'; op: string; left: ASTNode; right: ASTNode }
  | { type: 'logic'; op: string; left: ASTNode; right: ASTNode }

class Parser {
  private pos = 0
  constructor(private tokens: Token[]) {}

  parse(): ASTNode { return this.expr() }

  private peek(): Token | undefined { return this.tokens[this.pos] }
  private consume(): Token {
    const t = this.tokens[this.pos]
    if (!t) throw new Error('Unexpected end of expression')
    this.pos++
    return t
  }
  private expect(type: Token['type'], value?: string): Token {
    const t = this.consume()
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new Error(`Expected ${type}${value ? ` '${value}'` : ''}, got ${t.type}${'value' in t ? ` '${t.value}'` : ''}`)
    }
    return t
  }

  private expr(): ASTNode { return this.orExpr() }

  private orExpr(): ASTNode {
    let left = this.andExpr()
    while (this.peek()?.type === 'OP' && this.peek()!.value === '||') {
      this.consume()
      left = { type: 'logic', op: '||', left, right: this.andExpr() }
    }
    return left
  }

  private andExpr(): ASTNode {
    let left = this.cmpExpr()
    while (this.peek()?.type === 'OP' && this.peek()!.value === '&&') {
      this.consume()
      left = { type: 'logic', op: '&&', left, right: this.cmpExpr() }
    }
    return left
  }

  private cmpExpr(): ASTNode {
    const left = this.atom()
    const next = this.peek()
    if (next?.type === 'OP' && ['>=', '<=', '>', '<', '==', '!='].includes(next.value)) {
      this.consume()
      return { type: 'cmp', op: next.value, left, right: this.atom() }
    }
    return left
  }

  private atom(): ASTNode {
    const t = this.peek()
    if (!t) throw new Error('Unexpected end of expression')
    if (t.type === 'NUMBER') { this.consume(); return { type: 'number', value: t.value } }
    if (t.type === 'STRING') { this.consume(); return { type: 'string', value: t.value } }
    if (t.type === 'LPAREN') {
      this.consume()
      const inner = this.expr()
      this.expect('RPAREN')
      return inner
    }
    if (t.type === 'IDENT') {
      this.consume()
      const name = t.value
      // 函数调用
      if (this.peek()?.type === 'LPAREN') {
        this.consume() // (
        const args: ASTNode[] = []
        if (this.peek()?.type !== 'RPAREN') {
          args.push(this.expr())
          while (this.peek()?.type === 'COMMA') { this.consume(); args.push(this.expr()) }
        }
        this.expect('RPAREN')
        return { type: 'call', name, args }
      }
      return { type: 'var', name }
    }
    throw new Error(`Unexpected token ${t.type}`)
  }
}

// ---- 求值器 ----
interface EvalContext {
  vars: Record<string, number>
  items: Array<{ id: string; dimension: string; raw: number; score: number }>
  ctx: Record<string, number>
  /** 维度均值。班级短板、家校 P×A、学生五类、学习三层的归因规则都建立在维度上。 */
  dimensions: Record<string, number>
}

function evaluate(node: ASTNode, env: EvalContext): number | string | boolean {
  switch (node.type) {
    case 'number': return node.value
    case 'string': return node.value
    case 'var': {
      // 支持 dotted identifier: ctx.previousConsecutiveLowMeaning → env.ctx['previousConsecutiveLowMeaning']
      const dotIdx = node.name.indexOf('.')
      if (dotIdx > 0) {
        const ns = node.name.slice(0, dotIdx)
        const key = node.name.slice(dotIdx + 1)
        const nsObj = ns === 'ctx' ? env.ctx : ns === 'vars' ? env.vars : undefined
        if (!nsObj) throw new Error(`Unknown namespace '${ns}'`)
        const val = nsObj[key]
        // ctx.* 变量可能未提供（外部上下文为空时）→ 返回 0，让比较自然为 false
        if (val === undefined) {
          if (ns === 'ctx') return 0
          throw new Error(`Unknown variable '${node.name}'`)
        }
        return val
      }
      const val = env.vars[node.name] ?? env.ctx[node.name]
      if (val === undefined) {
        // ctx_* 变量可能未提供（外部上下文为空时）→ 返回 0，让比较自然为 false
        if (node.name.startsWith('ctx_')) return 0
        throw new Error(`Unknown variable '${node.name}'`)
      }
      return val
    }
    case 'call': return evalBuiltin(node.name, node.args, env)
    case 'cmp': return evalCmp(node.op, evaluate(node.left, env), evaluate(node.right, env))
    case 'logic': {
      // 短路求值：&& 左边为假时不求值右边，|| 左边为真时不求值右边
      const leftVal = evaluate(node.left, env)
      if (node.op === '&&') {
        if (!Boolean(leftVal)) return false
      } else {
        if (Boolean(leftVal)) return true
      }
      const rightVal = evaluate(node.right, env)
      return node.op === '&&' ? Boolean(rightVal) : Boolean(rightVal)
    }
  }
}

/** 取函数实参里的维度名，支持 DIM('情绪状态') 与 DIM(情绪状态) 两种写法。 */
function dimensionArgName(args: ASTNode[], fnName: string): string {
  const arg0 = args[0]
  if (args.length !== 1 || !arg0) throw new Error(`${fnName} expects exactly one dimension name`)
  if (arg0.type === 'string') return arg0.value
  if (arg0.type === 'var') return arg0.name
  throw new Error(`${fnName} expects a dimension name`)
}

/** 按均值排序维度；并列时按名称排序，保证同样的作答永远得到同样的归因。 */
function rankedDimensions(env: EvalContext): Array<[string, number]> {
  return Object.entries(env.dimensions).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function evalBuiltin(name: string, args: ASTNode[], env: EvalContext): number | string {
  switch (name) {
    case 'SUM': {
      // SUM(scores) — 参数必须是标识符 "scores"
      const arg0 = args[0]
      if (args.length === 1 && arg0?.type === 'var' && arg0.name === 'scores') {
        return env.items.reduce((s, i) => s + i.score, 0)
      }
      throw new Error('SUM(scores) expects "scores" as argument')
    }
    case 'AVG': {
      const arg0 = args[0]
      if (args.length === 1 && arg0?.type === 'var' && arg0.name === 'scores') {
        return env.items.length ? Number((env.items.reduce((s, i) => s + i.score, 0) / env.items.length).toFixed(4)) : 0
      }
      throw new Error('AVG(scores) expects "scores" as argument')
    }
    case 'DIM': {
      const dimension = dimensionArgName(args, 'DIM')
      const value = env.dimensions[dimension]
      if (value === undefined) throw new Error(`DIM: unknown dimension '${dimension}'`)
      return value
    }
    // 主导维度／短板维度。用于“五类十五型的主类”“五系统的短板”这类归因。
    case 'TOP_DIM': {
      if (args.length) throw new Error('TOP_DIM() takes no argument')
      return rankedDimensions(env)[0]?.[0] ?? ''
    }
    case 'BOTTOM_DIM': {
      if (args.length) throw new Error('BOTTOM_DIM() takes no argument')
      const ranked = rankedDimensions(env)
      return ranked[ranked.length - 1]?.[0] ?? ''
    }
    case 'MAX': {
      const arg0 = args[0]
      if (args.length === 1 && arg0?.type === 'var' && arg0.name === 'scores') {
        return env.items.length ? Math.max(...env.items.map(i => i.score)) : 0
      }
      throw new Error('MAX(scores) expects "scores" as argument')
    }
    case 'MIN': {
      const arg0 = args[0]
      if (args.length === 1 && arg0?.type === 'var' && arg0.name === 'scores') {
        return env.items.length ? Math.min(...env.items.map(i => i.score)) : 0
      }
      throw new Error('MIN(scores) expects "scores" as argument')
    }
    case 'SCORE': {
      const arg0 = args[0]
      const qid = args.length === 1
        ? (arg0!.type === 'var' ? arg0!.name : String(evaluate(arg0!, env)))
        : ''
      const item = env.items.find(i => i.id === qid)
      if (!item) throw new Error(`SCORE: unknown question '${qid}'`)
      return item.score
    }
    case 'RAW': {
      const arg0 = args[0]
      const qid = args.length === 1
        ? (arg0!.type === 'var' ? arg0!.name : String(evaluate(arg0!, env)))
        : ''
      const item = env.items.find(i => i.id === qid)
      if (!item) throw new Error(`RAW: unknown question '${qid}'`)
      return item.raw
    }
    default:
      throw new Error(`Unknown built-in function '${name}'`)
  }
}

function evalCmp(op: string, a: number | string | boolean, b: number | string | boolean): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    switch (op) { case '==': return a === b; case '!=': return a !== b; default: throw new Error(`String comparison '${op}' not supported`) }
  }
  const na = Number(a), nb = Number(b)
  switch (op) { case '>': return na > nb; case '<': return na < nb; case '>=': return na >= nb; case '<=': return na <= nb; case '==': return na === nb; case '!=': return na !== nb; default: throw new Error(`Unknown comparison operator '${op}'`) }
}

function evalLogic(op: string, a: number | string | boolean, b: number | string | boolean): boolean {
  const ba = Boolean(a), bb = Boolean(b)
  return op === '&&' ? ba && bb : ba || bb
}

function evalWhen(expr: string | undefined, env: EvalContext): boolean {
  if (!expr) return true
  try {
    const tokens = tokenize(normalizeExpression(expr))
    const ast = new Parser(tokens).parse()
    const result = evaluate(ast, env)
    return Boolean(result)
  } catch (err) {
    throw new Error(`Failed to evaluate '${expr}': ${(err as Error).message}`)
  }
}

// ---- 主入口: 执行规则 ----

/** 维度计算：优先使用 payload.dimensionDefs，fallback 到旧分组逻辑 */
function computeDimensions(
  items: Array<{ id: string; dimension: string; raw: number; score: number }>,
  dimensionDefs?: AssessmentDimensionDef[]
): Record<string, number> {
  // V2: 使用 dimensionDefs 精确定义维度→题号映射和计算方式
  if (dimensionDefs && dimensionDefs.length > 0) {
    const dims: Record<string, number> = {}
    for (const def of dimensionDefs) {
      const matched = items.filter(item => def.questionIds.includes(item.id))
      if (matched.length === 0) continue
      const values = matched.map(item => item.score)
      let value: number
      switch (def.calcMethod) {
        case 'sum':
          value = Number(values.reduce((a, b) => a + b, 0).toFixed(1))
          break
        case 'weighted':
          value = Number((values.reduce((sum, v, idx) => sum + v * (def.weight || 1), 0) / matched.length).toFixed(1))
          break
        case 'mean':
        default:
          value = Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1))
      }
      dims[def.code] = value
    }
    return dims
  }

  // Fallback: 按 question.dimension 分组平均
  const buckets: Record<string, number[]> = {}
  for (const item of items) (buckets[item.dimension] ||= []).push(item.score)
  return Object.fromEntries(
    Object.entries(buckets).map(([key, values]) => [key, Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1))])
  )
}

/** 评估单条红线条件 */
function evalRedLine(redLine: RedLineConfig, env: EvalContext): boolean {
  try {
    return evalWhen(redLine.condition, env)
  } catch (err) {
    // 红线表达式求值失败不阻断规则执行，仅记录
    return false
  }
}

/**
 * 根据规则配置 DSL 执行评估。
 */
export function executeRules(
  config: RuleConfig,
  answers: Record<string, number>,
  definition: AssessmentDefinition,
  ctx: Record<string, number> = {}
): RuleExecResult {
  // 1. 计算 scored items
  const items = definition.questions.map(q => ({
    id: q.id,
    dimension: q.dimension,
    raw: Number(answers[q.id] || 0),
    score: q.reverse ? 6 - Number(answers[q.id] || 0) : Number(answers[q.id] || 0)
  }))

  if (items.some(item => item.raw < 1 || item.raw > 5)) throw new Error('所有题目都必须作答')

  // 2. 计算维度（V2：优先使用 dimensionDefs）
  const dimensions = computeDimensions(items, definition.dimensionDefs)

  // 3. 计算 computed 变量
  // 将 ctx 上下文变量也暴露到 vars 中（用 ctx_ 前缀，避免 tokenizer 点号问题）
  const ctxVars: Record<string, number> = {}
  for (const [k, v] of Object.entries(ctx)) { ctxVars[`ctx_${k}`] = v }
  const env: EvalContext = { vars: { ...ctxVars }, items, ctx, dimensions }
  // 计算变量是模块级的，但表达式可能引用只属于某一张量表的题号或维度。
  // 用另一张量表作答时这类变量算不出来，此时跳过而不是中断整场评估——
  // 真正引用了它的分级规则应当用「依据量表编码」限定到对应量表。
  const unavailableVariables: string[] = []
  for (const [name, expr] of Object.entries(config.computed)) {
    try {
      const tokens = tokenize(normalizeExpression(expr))
      const ast = new Parser(tokens).parse()
      const val = evaluate(ast, env)
      if (typeof val !== 'number') throw new Error(`Computed variable '${name}' must resolve to a number`)
      env.vars[name] = val
    } catch {
      unavailableVariables.push(name)
    }
  }

  // 4. 归因：只取适用于当前量表的证据规则，逐条求值后按权重累加到归因项。
  //    按量表过滤是必须的——否则会拿 A 量表的题号去求值 B 量表的作答。
  const instrumentCode = definition.instrumentCode || definition.code
  const scoring = {
    maxAttributions: config.scoring?.maxAttributions ?? 3,
    minShare: config.scoring?.minShare ?? 0.05,
    secondaryRankCutoff: config.scoring?.secondaryRankCutoff ?? 3
  }
  const itemByCode = new Map(config.attributionItems.map(item => [item.code, item]))
  const buckets = new Map<string, { rawScore: number, reasons: string[], evidenceCodes: string[] }>()

  for (const evidence of config.evidences) {
    if (evidence.assessmentCode !== instrumentCode) continue
    const attributionItem = itemByCode.get(evidence.attributionCode)
    // 引用了不存在的归因项属于数据错误，交叉校验会拦住；执行期跳过而不是中断评估。
    if (!attributionItem) continue

    let hit: boolean
    try {
      hit = evalWhen(evidence.condition, env)
    } catch (err) {
      const hint = unavailableVariables.length
        ? `（本次作答的量表无法计算这些变量：${unavailableVariables.join('、')}）`
        : ''
      throw new Error(`证据规则 '${evidence.evidenceCode}' 求值失败：${(err as Error).message}${hint}`)
    }
    if (!hit) continue

    const bucket = buckets.get(attributionItem.code) || { rawScore: 0, reasons: [], evidenceCodes: [] }
    bucket.rawScore += evidence.weight
    bucket.reasons.push(evidence.description)
    bucket.evidenceCodes.push(evidence.evidenceCode)
    buckets.set(attributionItem.code, bucket)
  }

  // 乘上归因项权重基数后归一化成占比。并列时按 code 排序，保证同样作答必得同样结果。
  const scored = [...buckets.entries()]
    .map(([code, bucket]) => {
      const attributionItem = itemByCode.get(code)!
      return {
        code,
        name: attributionItem.name,
        toolTags: attributionItem.toolTags || [],
        suggestedAction: attributionItem.suggestedAction,
        rawScore: Number((bucket.rawScore * attributionItem.baseWeight).toFixed(4)),
        reasons: bucket.reasons,
        evidenceCodes: bucket.evidenceCodes
      }
    })
    .filter(entry => entry.rawScore > 0)
    .sort((a, b) => b.rawScore - a.rawScore || a.code.localeCompare(b.code))

  const totalScore = scored.reduce((sum, entry) => sum + entry.rawScore, 0)
  const ranked = scored
    .map((entry, rank) => ({
      ...entry,
      rank,
      share: totalScore > 0 ? Number((entry.rawScore / totalScore).toFixed(4)) : 0
    }))
    // 首位无论占比多低都保留，否则弱信号作答会得到一个没有归因的方案
    .filter(entry => entry.rank === 0 || entry.share >= scoring.minShare)
    .slice(0, scoring.maxAttributions)

  const attributions: AttributionOutcome[] = ranked.map(entry => ({
    code: entry.code,
    name: entry.name,
    rawScore: entry.rawScore,
    share: entry.share,
    rank: entry.rank,
    strength: entry.rank === 0 ? 'primary' : entry.rank < scoring.secondaryRankCutoff ? 'secondary' : 'reference',
    reasons: entry.reasons,
    evidenceCodes: entry.evidenceCodes
  }))

  // 5. 分级：与归因解耦，只产出等级与严重度。同样按当前量表过滤，未标注量表的视为模块通用。
  const applicableGrading = config.gradingRules
    .filter(rule => !rule.assessmentCode || rule.assessmentCode === instrumentCode)
    .sort((a, b) => a.pri - b.pri)
  if (!applicableGrading.length) {
    throw new Error(`量表 '${instrumentCode}' 没有适用的分级规则`)
  }
  let matchedGrading = applicableGrading[applicableGrading.length - 1]!
  for (const rule of applicableGrading) {
    let hit: boolean
    try {
      hit = evalWhen(rule.when, env)
    } catch (err) {
      const hint = unavailableVariables.length
        ? `（本次作答的量表 '${instrumentCode}' 无法计算这些变量：${unavailableVariables.join('、')}；请给该规则填写「依据量表编码」把它限定到对应量表）`
        : ''
      throw new Error(`分级规则 '${rule.ruleId}' 求值失败：${(err as Error).message}${hint}`)
    }
    if (hit) {
      matchedGrading = rule
      break
    }
  }

  // 6. 检查 crisis 红线 + V2 redLines
  let blocked = matchedGrading.blocked
  const matchedRedLines: RedLineConfig[] = []

  if (config.crisis && evalWhen(config.crisis.when, env)) {
    blocked = true
  }

  // V2: 遍历多条独立红线
  if (config.redLines) {
    for (const redLine of config.redLines) {
      if (evalRedLine(redLine, env)) {
        blocked = true
        matchedRedLines.push(redLine)
      }
    }
  }

  // 7. 生成输出
  const reasons = attributions.flatMap(attribution => attribution.reasons)
  // 行动项优先由命中的归因推导——「归因→方案」这一跳的落点就在这里。
  // 归因项没填建议动作时才退回归因库里那份与归因无关的通用行动清单。
  const attributionActions = ranked
    .filter(entry => entry.suggestedAction)
    .map(entry => ({
      title: `针对「${entry.name}」`,
      detail: entry.suggestedAction!,
      status: 'pending' as const
    }))
  const actions = attributionActions.length ? attributionActions : config.actions
  return {
    level: matchedGrading.level,
    levelName: matchedGrading.levelName,
    severity: matchedGrading.severity,
    reasons: reasons.length
      ? reasons
      : [matchedGrading.resultDescription || '本次作答未命中任何归因证据，请结合观察补充判断。'],
    blocked,
    matchedRuleIds: [matchedGrading.ruleId, ...attributions.flatMap(attribution => attribution.evidenceCodes)],
    attributions,
    primaryAttribution: attributions[0]?.name || '',
    secondaryAttributions: attributions.filter(a => a.strength === 'secondary').map(a => a.name),
    toolTags: [...new Set(ranked.flatMap(entry => entry.toolTags))],
    dimensions,
    dimensionLabels: Object.fromEntries(
      (definition.dimensionDefs || []).map(def => [def.code, def.name])
    ),
    actions,
    tools: config.tools,
    matchedRedLines: matchedRedLines.length > 0 ? matchedRedLines : undefined
  }
}

// ---- Fallback 辅助 ----

import { evaluateAssessment } from './rules'

/**
 * 当 content_packages 中没有已发布的规则时，用硬编码 evaluateAssessment 作为 fallback。
 */
export function evaluateWithFallback(
  module: ModuleId,
  answers: Record<string, number>,
  ctx: Record<string, number> = {}
): RuleExecResult {
  const result = evaluateAssessment(module, answers, ctx)
  // 硬编码兜底只有单一归因，包成一条 share=1 的归因项以对齐新契约。
  const attributions: AttributionOutcome[] = result.primaryAttribution
    ? [{
        code: `fallback:${module}`,
        name: result.primaryAttribution,
        rawScore: 1,
        share: 1,
        rank: 0,
        strength: 'primary',
        reasons: result.reasons,
        evidenceCodes: result.matchedRuleIds
      }]
    : []
  return {
    level: result.level,
    severity: result.blocked ? 'crisis' : 'medium',
    reasons: result.reasons,
    blocked: result.blocked,
    matchedRuleIds: result.matchedRuleIds,
    attributions,
    primaryAttribution: result.primaryAttribution,
    secondaryAttributions: result.secondaryAttributions,
    toolTags: result.toolTags,
    dimensions: result.dimensions,
    // 硬编码兜底的维度本身就是中文名，映射到自身即可
    dimensionLabels: Object.fromEntries(Object.keys(result.dimensions).map(k => [k, k])),
    actions: result.actions,
    tools: result.tools
  }
}

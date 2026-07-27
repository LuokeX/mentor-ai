import type { RuleConfig, RuleExecResult, ModuleId, AssessmentDimensionDef, RedLineConfig } from '../../shared/contracts'
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
    if (/[a-zA-Z_]/.test(ch)) {
      let id = ''
      while (i < expr.length && /[a-zA-Z0-9_.]/.test(expr[i]!)) { id += expr[i]!; i++ }
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
    const tokens = tokenize(expr)
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
  for (const [name, expr] of Object.entries(config.computed)) {
    try {
      const tokens = tokenize(expr)
      const ast = new Parser(tokens).parse()
      const val = evaluate(ast, env)
      if (typeof val !== 'number') throw new Error(`Computed variable '${name}' must resolve to a number`)
      env.vars[name] = val
    } catch (err) {
      throw new Error(`Failed to compute '${name}' = '${expr}': ${(err as Error).message}`)
    }
  }

  // 4. 匹配分支（按 pri 升序，第一条命中即停止）
  const sorted = [...config.branches].sort((a, b) => a.pri - b.pri)
  let matchedBranch = sorted[sorted.length - 1] // fallback to last
  for (const branch of sorted) {
    if (evalWhen(branch.when, env)) {
      matchedBranch = branch
      break
    }
  }
  if (!matchedBranch) throw new Error('No rule branch matched')

  // 5. 检查 crisis 红线 + V2 redLines
  let blocked = matchedBranch.blocked
  const level = matchedBranch.level
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

  // 6. 生成输出
  return {
    level,
    reasons: matchedBranch.reasons,
    blocked,
    matchedRuleIds: [matchedBranch.ruleId],
    primaryAttribution: matchedBranch.primaryAttribution || matchedBranch.reasons[0] || level,
    secondaryAttributions: matchedBranch.secondaryAttributions || [],
    toolTags: matchedBranch.toolTags || [],
    dimensions,
    actions: config.actions,
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
  return {
    level: result.level,
    reasons: result.reasons,
    blocked: result.blocked,
    matchedRuleIds: result.matchedRuleIds,
    primaryAttribution: result.primaryAttribution,
    secondaryAttributions: result.secondaryAttributions,
    toolTags: result.toolTags,
    dimensions: result.dimensions,
    actions: result.actions,
    tools: result.tools
  }
}

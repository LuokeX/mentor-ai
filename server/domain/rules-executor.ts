import type { RuleConfig, RuleExecResult, ModuleId, AssessmentDimensionDef, RedLineConfig, AttributionOutcome } from '../../shared/contracts'
import { assessmentDefinitions } from '../../shared/assessments'
import type { AssessmentDefinition } from '../../shared/assessments'
import { findInvalidAnswers } from './assessment-answers'

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
    // 跨量表取值：引用该教师最近一次某张量表的结果。
    // 必须排在 题[]/维度[]/总分/均分 之前，否则「量表[X].维度[Y]」里的内层写法会先被替换掉。
    .replace(/量表\s*\[\s*([^\]]+?)\s*\]\s*\.\s*维度\s*\[\s*([^\]]+?)\s*\]/g, "PRIOR_DIM('$1','$2')")
    .replace(/量表\s*\[\s*([^\]]+?)\s*\]\s*\.\s*题\s*\[\s*([^\]]+?)\s*\]/g, "PRIOR_SCORE('$1','$2')")
    .replace(/量表\s*\[\s*([^\]]+?)\s*\]\s*\.\s*总分/g, "PRIOR_SUM('$1')")
    .replace(/量表\s*\[\s*([^\]]+?)\s*\]\s*\.\s*均分/g, "PRIOR_AVG('$1')")
    .replace(/量表\s*\[\s*([^\]]+?)\s*\]\s*\.\s*等级/g, "PRIOR_LEVEL('$1')")
    .replace(/量表\s*\[\s*([^\]]+?)\s*\]\s*\.\s*严重度/g, "PRIOR_SEVERITY('$1')")
    .replace(/量表\s*\[\s*([^\]]+?)\s*\]\s*\.\s*已完成/g, "PRIOR_DONE('$1')")
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
    // 业务习惯写英文 AND/OR，按同样的空格边界规则接受
    .replace(/\s+AND\s+/gi, ' && ')
    .replace(/\s+OR\s+/gi, ' || ')
    // 单个 = 当相等判断。写在所有比较运算符归一化之后，
    // 避免把 >= <= != == 里的 = 误伤，所以用「前后都不是比较符号」的边界。
    .replace(/(?<![<>=!])=(?!=)/g, ' == ')
}

/**
 * 反向计分。取值域来自题目自己的选项，不能写死 6 - value：
 * 对 0/1 二值选项组，6 - 1 = 5 完全不在值域内。
 */
function reverseScore(
  question: { reverse?: boolean, options?: Array<{ value: number }> },
  raw: number
): number {
  if (!question.reverse) return raw
  const values = (question.options || []).map(option => option.value)
  if (!values.length) return 6 - raw
  return Math.min(...values) + Math.max(...values) - raw
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
    if (ch === '>' || ch === '<' || ch === '!' || ch === '=' || ch === '+' || ch === '-' || ch === '*' || ch === '/') {
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
// add_expr → mul_expr (('+' | '-') mul_expr)*
// mul_expr → atom (('*' | '/') atom)*
// atom     → NUMBER | STRING | IDENT [ '(' (expr (',' expr)*)? ')' ] | '(' expr ')'

type ASTNode =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'var'; name: string }
  | { type: 'call'; name: string; args: ASTNode[] }
  | { type: 'arith'; op: string; left: ASTNode; right: ASTNode }
  | { type: 'cmp'; op: string; left: ASTNode; right: ASTNode }
  | { type: 'logic'; op: string; left: ASTNode; right: ASTNode }

class Parser {
  private pos = 0
  constructor(private tokens: Token[]) {}

  parse(): ASTNode {
    const node = this.expr()
    // 必须消费完所有 token。否则「A >= 1 AND B >= 99」这类写法会被静默截断成
    // 只判断前半段，条件看起来生效了但实际少判了一半，是最难发现的一类数据缺陷。
    const rest = this.tokens[this.pos]
    if (rest) {
      throw new Error(
        `表达式在 '${rest.value}' 处无法继续解析；`
        + `多个条件请用「且」「或」（或 && ||）连接，相等判断请用 == 而不是 =`
      )
    }
    return node
  }

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
    const left = this.addExpr()
    const next = this.peek()
    if (next?.type === 'OP' && ['>=', '<=', '>', '<', '==', '!='].includes(next.value)) {
      this.consume()
      return { type: 'cmp', op: next.value, left, right: this.addExpr() }
    }
    return left
  }

  /** 加减法：计算变量表达式（维度[沟通质量] + 题[2] - 3）的算术支持 */
  private addExpr(): ASTNode {
    let left = this.mulExpr()
    while (this.peek()?.type === 'OP' && (this.peek()!.value === '+' || this.peek()!.value === '-')) {
      const op = String(this.consume().value)
      left = { type: 'arith', op, left, right: this.mulExpr() }
    }
    return left
  }

  /** 乘除法 */
  private mulExpr(): ASTNode {
    let left = this.atom()
    while (this.peek()?.type === 'OP' && (this.peek()!.value === '*' || this.peek()!.value === '/')) {
      const op = String(this.consume().value)
      left = { type: 'arith', op, left, right: this.atom() }
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
  /**
   * 当前作答的量表编码。跨量表取值（PRIOR_*）在目标量表与当前作答一致时
   * 直接读本次作答，否则读历史（priors）。红线条件因此可以安全引用其他量表的题号。
   */
  instrumentCode?: string
  /**
   * 该教师最近一次各量表的结果，按量表编码索引。
   * 只用于 ③ 的「触发条件」——判断第 3 张量表要不要做，得看前两张测出了什么。
   * 归因和分级规则不读它，那两处只看当前这次作答。
   */
  priors?: Record<string, PriorAssessmentResult>
}

/** 一张量表最近一次作答的结果摘要，供跨量表触发条件使用 */
export interface PriorAssessmentResult {
  level: string | null
  severity: string | null
  dimensions: Record<string, number>
  scores: Record<string, number>
  sum: number
  avg: number
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
    case 'arith': {
      const left = Number(evaluate(node.left, env))
      const right = Number(evaluate(node.right, env))
      switch (node.op) {
        case '+': return left + right
        case '-': return left - right
        case '*': return left * right
        // 除零给 NaN：比较运算（NaN >= x）自然为 false，条件不命中，比 Infinity 安全
        case '/': return right === 0 ? NaN : left / right
        default: throw new Error(`Unknown arithmetic operator '${node.op}'`)
      }
    }
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

/** 取 PRIOR_* 的字符串字面量参数 */
function priorArgs(args: ASTNode[], fnName: string, count: number): string[] {
  if (args.length !== count) throw new Error(`${fnName} expects ${count} argument(s)`)
  return args.map(arg => {
    if (arg.type === 'string') return arg.value
    if (arg.type === 'var') return arg.name
    throw new Error(`${fnName} expects literal names`)
  })
}

/** 取某张量表的历史结果。没做过就抛错——由调用方决定「没做过」算不算命中。 */
function priorOf(env: EvalContext, code: string, fnName: string): PriorAssessmentResult {
  const prior = env.priors?.[code]
  if (!prior) throw new Error(`${fnName}: 量表 '${code}' 尚无已完成的作答`)
  return prior
}

function evalBuiltin(name: string, args: ASTNode[], env: EvalContext): number | string {
  switch (name) {
    // ---- 跨量表取值：读该教师最近一次某量表的结果 ----
    case 'PRIOR_DONE': {
      const [code] = priorArgs(args, 'PRIOR_DONE', 1)
      return env.priors?.[code!] ? 1 : 0
    }
    case 'PRIOR_SUM': {
      const [code] = priorArgs(args, 'PRIOR_SUM', 1)
      // 目标量表就是当前作答量表时直接算本次作答，否则读历史（红线条件依赖此语义）
      if (env.instrumentCode === code) return env.items.reduce((s, i) => s + i.score, 0)
      return priorOf(env, code!, 'PRIOR_SUM').sum
    }
    case 'PRIOR_AVG': {
      const [code] = priorArgs(args, 'PRIOR_AVG', 1)
      if (env.instrumentCode === code) {
        return env.items.length ? Number((env.items.reduce((s, i) => s + i.score, 0) / env.items.length).toFixed(4)) : 0
      }
      return priorOf(env, code!, 'PRIOR_AVG').avg
    }
    case 'PRIOR_LEVEL': {
      const [code] = priorArgs(args, 'PRIOR_LEVEL', 1)
      return priorOf(env, code!, 'PRIOR_LEVEL').level ?? ''
    }
    case 'PRIOR_SEVERITY': {
      const [code] = priorArgs(args, 'PRIOR_SEVERITY', 1)
      return priorOf(env, code!, 'PRIOR_SEVERITY').severity ?? ''
    }
    case 'PRIOR_DIM': {
      const [code, dimension] = priorArgs(args, 'PRIOR_DIM', 2)
      if (env.instrumentCode === code) {
        const value = env.dimensions[dimension!]
        if (value === undefined) throw new Error(`PRIOR_DIM: 量表 '${code}' 没有维度 '${dimension}'`)
        return value
      }
      const prior = priorOf(env, code!, 'PRIOR_DIM')
      const value = prior.dimensions[dimension!]
      if (value === undefined) throw new Error(`PRIOR_DIM: 量表 '${code}' 没有维度 '${dimension}'`)
      return value
    }
    case 'PRIOR_SCORE': {
      const [code, questionId] = priorArgs(args, 'PRIOR_SCORE', 2)
      if (env.instrumentCode === code) {
        const item = env.items.find(i => i.id === questionId)
        if (!item) throw new Error(`PRIOR_SCORE: 量表 '${code}' 没有题号 '${questionId}'`)
        return item.score
      }
      const prior = priorOf(env, code!, 'PRIOR_SCORE')
      const value = prior.scores[questionId!]
      if (value === undefined) throw new Error(`PRIOR_SCORE: 量表 '${code}' 没有题号 '${questionId}'`)
      return value
    }
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
  ctx: Record<string, number> = {},
  priors?: Record<string, PriorAssessmentResult>
): RuleExecResult {
  // 1. 计算 scored items
  const items = definition.questions.map(q => ({
    id: q.id,
    dimension: q.dimension,
    raw: Number(answers[q.id] || 0),
    score: reverseScore(q, Number(answers[q.id] ?? NaN))
  }))

  // 合法作答的判断基于题目自己的选项集合，实现见 assessment-answers.ts。
  // API 层（submit / draft）必须复用同一份判定，否则会出现「前端能提交、引擎算不出」的错位。
  const unanswered = findInvalidAnswers(definition.questions, answers)
  if (unanswered.length) {
    throw new Error(`所有题目都必须作答（缺失或超出选项范围：${unanswered.slice(0, 5).join('、')}）`)
  }

  // 2. 计算维度（V2：优先使用 dimensionDefs）
  const dimensions = computeDimensions(items, definition.dimensionDefs)

  // 3. 计算 computed 变量
  // 将 ctx 上下文变量也暴露到 vars 中（用 ctx_ 前缀，避免 tokenizer 点号问题）
  const ctxVars: Record<string, number> = {}
  for (const [k, v] of Object.entries(ctx)) { ctxVars[`ctx_${k}`] = v }
  const env: EvalContext = { vars: { ...ctxVars }, items, ctx, dimensions, instrumentCode: definition.instrumentCode || definition.code, priors }
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
        description: attributionItem.description,
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
    evidenceCodes: entry.evidenceCodes,
    description: entry.description,
    suggestedAction: entry.suggestedAction
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
  // 等级干预通道：命中等级配置的干预动作并入 actions，与归因通道并行（任一命中即出干预）。
  const baseActions = attributionActions.length ? attributionActions : config.actions
  const interventionActions = (matchedGrading.interventionActions || []).map(detail => ({
    title: `按「${matchedGrading.levelName || matchedGrading.level}」干预`,
    detail,
    status: 'pending' as const
  }))
  const actions = [...baseActions, ...interventionActions]
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
    // 暴露出去供运营台排查「这条规则为什么没命中」，以及 ⑪ 推演算例展示中间量
    computedValues: Object.fromEntries(
      Object.keys(config.computed)
        .flatMap(name => typeof env.vars[name] === 'number' ? [[name, env.vars[name] as number] as const] : [])
    ),
    unavailableVariables,
    dimensions,
    dimensionLabels: Object.fromEntries(
      (definition.dimensionDefs || []).map(def => [def.code, def.name])
    ),
    actions,
    tools: config.tools,
    escalationTarget: matchedGrading.escalationTarget || undefined,
    // 等级干预通道：命中等级直选的工具编码，由 API 层从工具库解析成正文
    interventionToolCodes: matchedGrading.interventionTools?.length ? matchedGrading.interventionTools : undefined,
    matchedRedLines: matchedRedLines.length > 0 ? matchedRedLines : undefined
  }
}

/**
 * 只做语法检查，不求值。用于导入期校验：表达式写错要在导入时报出来，
 * 而不是等到运行时被当作「条件未满足」静默吞掉。
 */
export function checkExpressionSyntax(expr: string): { ok: boolean, error?: string } {
  if (!expr?.trim()) return { ok: true }
  try {
    new Parser(tokenize(normalizeExpression(expr))).parse()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

/** 提取触发条件里引用的量表编码，供交叉校验检查它们是否存在 */
export function extractReferencedInstrumentCodes(expr: string): string[] {
  if (!expr?.trim()) return []
  const codes = new Set<string>()
  for (const match of expr.matchAll(/量表\s*\[\s*([^\]]+?)\s*\]/g)) {
    const code = match[1]?.trim()
    if (code) codes.add(code)
  }
  return [...codes]
}

/**
 * 求值 ③ 量表-清单 的「触发条件」。
 *
 * 与归因/分级条件的区别：它只看该教师的历史作答（跨量表），不看当前这次作答，
 * 因为要回答的是「这张量表现在需不需要做」，此时教师还没开始答。
 *
 * 语法示例：
 *   量表[SG_FIVE_Q].总分 >= 17
 *   量表[SG_FIVE_Q].维度[SG_EMOTION] >= 4 或 量表[SG_FIVE_Q].等级 == 'orange'
 *   量表[HS_QUICK].已完成 == 1
 *
 * 引用的量表尚无作答时求值会抛错，此处按「条件未满足」处理——
 * 前置关系由「前置量表编码」表达，触发条件不该越俎代庖去锁人。
 */
export function evaluateTriggerCondition(
  condition: string,
  priors: Record<string, PriorAssessmentResult>
): { met: boolean, error?: string } {
  if (!condition?.trim()) return { met: true }
  const env: EvalContext = { vars: {}, items: [], ctx: {}, dimensions: {}, priors }
  try {
    const tokens = tokenize(normalizeExpression(condition))
    const ast = new Parser(tokens).parse()
    return { met: Boolean(evaluate(ast, env)) }
  } catch (error) {
    return { met: false, error: (error as Error).message }
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
    // 兜底路径没有归因库，也就没有 ⑤b 计算变量
    computedValues: {},
    unavailableVariables: [],
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

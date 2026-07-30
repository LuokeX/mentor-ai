/**
 * 一次性脚本：验证 normalizeExpression → tokenize → Parser.parse 能否解析
 * v3 模板中的所有示例条件表达式（仅测试解析，不求值）。
 *
 * 用法: node --import tsx/esm scripts/test-rule-parsing.ts
 */

import { normalizeExpression } from '../server/domain/rules-executor'

// ---- 从 rules-executor.ts 复制的 tokenize 和 Parser（仅用于解析测试） ----

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
    if (ch === "'" || ch === '"') {
      const quote = ch
      let s = ''
      i++
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\') { i++; s += expr[i] || '' }
        else s += expr[i]
        i++
      }
      i++
      tokens.push({ type: 'STRING', value: s })
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < expr.length && /[0-9]/.test(expr[i + 1]!))) {
      let num = ''
      while (i < expr.length && /[0-9.]/.test(expr[i]!)) { num += expr[i]!; i++ }
      tokens.push({ type: 'NUMBER', value: parseFloat(num) })
      continue
    }
    const twoChar = expr.slice(i, i + 2)
    if (twoChar === '>=' || twoChar === '<=' || twoChar === '!=' || twoChar === '==' || twoChar === '&&' || twoChar === '||') {
      tokens.push({ type: 'OP', value: twoChar })
      i += 2
      continue
    }
    if (ch === '>' || ch === '<' || ch === '!' || ch === '=') {
      tokens.push({ type: 'OP', value: ch })
      i++
      continue
    }
    if (/[a-zA-Z_一-鿿]/.test(ch)) {
      let id = ''
      while (i < expr.length && /[a-zA-Z0-9_.一-鿿]/.test(expr[i]!)) { id += expr[i]!; i++ }
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
      if (this.peek()?.type === 'LPAREN') {
        this.consume()
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

// ---- 测试入口 ----

interface TestCase {
  label: string
  /** 原始表达式（可能是业务中文写法） */
  input: string
  /** 是否需要先 normalize。若已经确认是 DSL 可跳过 */
  normalize: boolean
  /** 预先定义的计算变量（模拟 ⑤b），key=变量名, value=表达式 */
  predefine?: Record<string, string>
}

const testCases: TestCase[] = [
  // ⑤d 证据规则 / ⑤e 分级规则 —— 条件表达式
  { label: '1', input: '维度[EMOTION] >= 4', normalize: true },
  { label: '2', input: '题[q1] >= 4 且 题[q3] <= 2', normalize: true },
  { label: '3', input: '题[q2] >= 4', normalize: true },
  { label: '4', input: '题[q5] >= 4', normalize: true },
  { label: '5', input: '维度[EMOTION] >= 3', normalize: true },
  { label: '6', input: '题[q1] >= 4 且 题[q3] >= 4', normalize: true },
  { label: '7', input: '总分 >= 17', normalize: true },
  { label: '8', input: '总分 >= 12', normalize: true },
  { label: '9', input: "TOP_DIM() == 'EMOTION'", normalize: false },
  { label: '10', input: "BOTTOM_DIM() == 'MEANING'", normalize: false },
  // 中文变量名（需要先定义计算变量）
  { label: '11', input: '情绪均分 >= 4', normalize: false, predefine: { '情绪均分': 'AVG(scores)' } },
  // ⑤b 计算变量表达式
  { label: '12', input: 'SUM(scores)', normalize: false },
  { label: '13', input: 'AVG(scores)', normalize: false },
]

function tryParse(expr: string): { ok: true; ast: ASTNode } | { ok: false; error: string } {
  try {
    const tokens = tokenize(expr)
    const ast = new Parser(tokens).parse()
    return { ok: true, ast }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

function runTests() {
  let passed = 0
  let failed = 0
  const results: string[] = []

  for (const tc of testCases) {
    // Step 1: 如果有预定义变量，先解析并记录变量表达式
    const definedVars: Record<string, string> = {}
    if (tc.predefine) {
      for (const [varName, varExpr] of Object.entries(tc.predefine)) {
        const normalizedVarExpr = normalizeExpression(varExpr)
        const parseResult = tryParse(normalizedVarExpr)
        if (!parseResult.ok) {
          results.push(`[${tc.label}] 预定义变量「${varName}」=「${varExpr}」解析失败: ${parseResult.error}`)
          failed++
          continue
        }
        definedVars[varName] = varExpr // 记录原始表达式即可，实际求值时会处理
      }
    }

    // Step 2: 解析主表达式
    let expr = tc.input
    if (tc.normalize) {
      expr = normalizeExpression(expr)
    }
    const parseResult = tryParse(expr)

    if (parseResult.ok) {
      results.push(`[${tc.label}] ✅ 通过 — ${tc.normalize ? `normalize 后: "${expr}"` : `直接解析: "${expr}"`}`)
      passed++
    } else {
      results.push(`[${tc.label}] ❌ 失败 — ${parseResult.error}${tc.normalize ? ` (normalize 后: "${expr}")` : ` (表达式: "${expr}")`}`)
      failed++
    }
  }

  console.log('='.repeat(70))
  console.log('规则引擎解析测试结果')
  console.log('='.repeat(70))
  for (const r of results) console.log(r)
  console.log('='.repeat(70))
  console.log(`通过: ${passed}/${testCases.length}  |  失败: ${failed}/${testCases.length}`)
  console.log('='.repeat(70))

  process.exit(failed > 0 ? 1 : 0)
}

runTests()
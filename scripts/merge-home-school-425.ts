/**
 * 家校沟通 4.2.5 合并版本生成。
 *
 * 量表取并集：4.2.1 的 5 张（六维评估/红线检查/依恋/BPS/PSTAR）+ 4.2.3 独有的 6 张
 * （双维与容器速查/家长分型/六维度诊断/触发条件筛查/九级情感容器/双维分类），共 11 张；
 * 归因运行体系以 4.2.3 为准（24 条归因/56 证据/5 级 E-D-C-B-A/20 工具/30 关键词/6 模板）。
 *
 * 4.2.3 的依恋/BPS/PSTAR（HS_S6/S7/S8）与 4.2.1 的 HS_S3/S4/S5 逐题一致，并集时只保留
 * 4.2.1 版本，4.2.3 归因中对 HS_S6/S7/S8 的引用翻译为 4.2.1 的量表名。
 *
 * 所有条件/计算变量/证据/等级规则中的编码引用（维度[HS_xDx]、量表[HS_S1] 等）翻译为
 * 中文业务输入，由 compileWizardInput 重新生成 4.2.5 的自洽编码体系。
 *
 * 运行：pnpm exec tsx scripts/merge-home-school-425.ts --dry-run   （只校验不写库）
 *       pnpm exec tsx scripts/merge-home-school-425.ts             （校验通过后事务写入并发布）
 */
import { loadLocalEnv } from './load-env'
import type { WizardCondition, WizardInput, WizardLevel } from '../shared/business-wizard'
import { wizardInputSchema } from '../shared/business-wizard'
import { HOME_SCHOOL_WIZARD_INPUT } from '../business-libraries/wizard-inputs/home_school'
import { compileWizardInput } from '../server/domain/business-wizard-compile'
import { parseModuleResourceFile } from '../server/domain/module-resource-file-import'
import { validateModuleResourcePayload } from '../server/domain/module-resource-validation'
import { checkCrossReferences } from '../server/domain/module-resource-cross-ref'
import { rebuildModuleResourceProjection } from '../server/domain/module-resource-projection'
import { useDb, schema } from '../server/utils/db'
import { and, eq, isNull } from 'drizzle-orm'

const DRY_RUN = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')
const MODULE = 'home_school'
const TARGET_VERSION = '4.2.5'
const SRC_421 = '4.2.1' // 量表来源
const SRC_423 = '4.2.3' // 归因体系来源

const LIBRARY_TYPES = ['assessment', 'attribution', 'tool', 'keyword_route', 'output_template'] as const
const LIBRARY_LABEL: Record<string, string> = {
  assessment: '量表库', attribution: '归因库', tool: '工具库',
  keyword_route: '关键词路由库', output_template: '输出模板库'
}

/** 4.2.3 中与 4.2.1 内容重复（逐题一致）的量表编码，并集时跳过 */
const DUP_423_SCALES = new Set(['HS_S6', 'HS_S7', 'HS_S8'])
/** 被 4.2.1 同名内容量表替代时，4.2.3 量表编码 → 4.2.5 量表名 */
const SCALE_423_TO_425: Record<string, string> = {
  HS_S6: '依恋模式识别评估（HS_ATTACH）',
  HS_S7: 'BPS快速归因筛查（HS_BPS_QUICK）',
  HS_S8: 'PSTAR聚焦定向评估（HS_PSTAR）'
}
/** 4.2.3 维度编码（HS_S6D2 等）→ 4.2.5 维度中文名（4.2.1 的量表名与维度名） */
function dimOf423(code: string, ctx421: ScaleContext): string {
  const m = code.match(/^HS_S([678])D(\d+)$/)
  if (m) {
    const scaleCode = `HS_S${Number(m[1]) - 3}`
    const target = ctx421.dimNameByCode.get(`${scaleCode}||${scaleCode}D${m[2]}`)
    if (target) return target
  }
  return code
}

/** 等级规则里的中文维度名 → 对应计算变量（运行期 DIM(中文名) 无法解析，变量可解析） */
const DIM_TO_COMPUTED: Record<string, string> = {
  生物层: '生物层均分', 心理层: '心理层均分', 社会层: '社会层均分', 紊乱型倾向: '紊乱型均分'
}

/** "总分" 型计算变量的语义归属量表（4.2.3 原数据无归属字段，按用途推断） */
const TOTAL_VAR_SCALE: Record<string, string> = {
  容器总分: '家校沟通双维与容器速查',
  六维度总分: '家校沟通六维度诊断评估量表',
  风险总分: '家校沟通触发条件筛查清单'
}
/** "题[qN]" 型计算变量（六维度诊断 6 题的维度分），4.2.3 原语义归属 */
const QUESTION_VAR_SCALE: Record<string, string> = {
  信任关系维度分: '家校沟通六维度诊断评估量表',
  危机响应维度分: '家校沟通六维度诊断评估量表',
  参与效能维度分: '家校沟通六维度诊断评估量表',
  沟通质量维度分: '家校沟通六维度诊断评估量表',
  角色边界维度分: '家校沟通六维度诊断评估量表',
  教育一致性维度分: '家校沟通六维度诊断评估量表'
}

// ---------- 数据读取 ----------

async function loadPayloads(db: ReturnType<typeof useDb>) {
  const rows = await db.select({
    version: schema.moduleResourceVersions.version,
    libraryType: schema.moduleResourceLibraries.libraryType,
    payload: schema.moduleResourceVersions.payload
  }).from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries,
      eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(and(
      eq(schema.moduleResourceLibraries.module, MODULE),
      eq(schema.moduleResourceLibraries.scope, 'global'),
      isNull(schema.moduleResourceLibraries.schoolId),
      eq(schema.moduleResourceVersions.version, SRC_423)
    ))

  const byType = new Map<string, Record<string, unknown>>()
  for (const r of rows) byType.set(r.libraryType, r.payload as Record<string, unknown>)

  const [a421] = await db.select({ payload: schema.moduleResourceVersions.payload })
    .from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries,
      eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(and(
      eq(schema.moduleResourceLibraries.module, MODULE),
      eq(schema.moduleResourceLibraries.scope, 'global'),
      isNull(schema.moduleResourceLibraries.schoolId),
      eq(schema.moduleResourceLibraries.libraryType, 'assessment'),
      eq(schema.moduleResourceVersions.version, SRC_421)
    ))

  if (!a421 || !byType.get('assessment') || !byType.get('attribution') || !byType.get('tool')) {
    console.error('DEBUG rows423:', rows.map(r => ({ t: r.libraryType, v: r.version })))
    throw new Error(`缺少 ${SRC_421} 量表库或 ${SRC_423} 五库数据`)
  }
  return { a421: a421.payload as { instruments: any[] }, a423: byType }
}

// ---------- 量表上下文（编码 → 中文名 / 维度名 / 题号） ----------

interface ScaleContext {
  nameByCode: Map<string, string>
  dimNameByCode: Map<string, string>
  dimCodeToName: Map<string, string>
  questionIndex: Map<string, number>
}

function buildContext(instruments: any[]): ScaleContext {
  const ctx: ScaleContext = {
    nameByCode: new Map(), dimNameByCode: new Map(), dimCodeToName: new Map(), questionIndex: new Map()
  }
  for (const inst of instruments) {
    ctx.nameByCode.set(inst.code, inst.title)
    for (const d of inst.dimensionDefs || []) {
      ctx.dimNameByCode.set(`${inst.code}||${d.code}`, d.name)
      if (!ctx.dimCodeToName.has(d.code)) ctx.dimCodeToName.set(d.code, d.name)
    }
    ;(inst.questions || []).forEach((q: any, i: number) => ctx.questionIndex.set(`${inst.code}||${q.id}`, i + 1))
  }
  return ctx
}

// ---------- 条件表达式解析 ----------

const OP_TO_COMPARATOR: Record<string, WizardCondition['comparator']> = {
  '>=': '达到或超过', '<=': '低于或等于', '==': '正好等于'
}

/**
 * 解析一条条件表达式（引擎语法）为向导结构化条件。
 * 支持：总分 / 均分 / 维度[编码或中文名] / 题[qN] / 计算变量裸名。
 */
function parseCondition(expr: string, scaleCode: string, ctx: ScaleContext, computedNames: Set<string>, ctx421?: ScaleContext): WizardCondition[] | null {
  const text = String(expr || '').trim()
  if (!text) return null
  const tokens = text.split(/\s+(且|或)\s+/)
  const conditions: WizardCondition[] = []
  for (let i = 0; i < tokens.length; i += 2) {
    const piece = (tokens[i] || '').trim()
    const join = i === 0 ? '且' : (tokens[i - 1] === '或' ? '或' : '且')
    const m = piece.match(/^(.+?)\s*(>=|<=|==)\s*(-?\d+(?:\.\d+)?)$/)
    if (!m) return null
    const [, rawLeft, op, rawValue] = m
    const left = (rawLeft || '').trim()
    const comparator = OP_TO_COMPARATOR[op!]
    if (!comparator) return null
    const value = Number(rawValue)

    let targetType: WizardCondition['targetType']
    let target = ''
    if (left === '总分') targetType = 'total'
    else if (left === '均分') targetType = 'average'
    else {
      const dim = left.match(/^维度\[\s*([^\]]+?)\s*\]$/)
      const qs = left.match(/^题\[\s*([^\]]+?)\s*\]$/)
      if (dim) {
        const raw = dim[1]!.trim()
        // 编码 → 4.2.5 中文名；中文名 → 计算变量（等级规则里跨量表引用维度名，运行期 DIM 解析不了）
        const name = /^HS_S[678]D/.test(raw) && ctx421
          ? dimOf423(raw, ctx421)
          : (ctx.dimNameByCode.get(`${scaleCode}||${raw}`) || raw)
        const mapped = DIM_TO_COMPUTED[name]
        if (mapped) {
          targetType = 'computed'
          target = mapped
        } else {
          targetType = 'dimension'
          target = name
        }
      } else if (qs) {
        const index = ctx.questionIndex.get(`${scaleCode}||${qs[1]}`)
        if (!index) return null
        targetType = 'question'
        target = String(index)
      } else if (computedNames.has(left)) {
        targetType = 'computed'
        target = left
      } else {
        return null
      }
    }
    conditions.push({ targetType, target, comparator, value, join })
  }
  return conditions.length ? conditions : null
}

/** 跨量表触发条件：量表[CODE].均分 >= 3 / 量表[CODE].维度[CODE] >= 3 */
function parseCrossScaleCondition(expr: string, ctx: ScaleContext): { sourceScale: string, conditions: WizardCondition[] } | null {
  const text = String(expr || '').trim()
  if (!text) return null
  const codes = [...text.matchAll(/量表\s*\[\s*([^\]]+?)\s*\]/g)].map(m => m[1]!.trim())
  if (!codes.length) return null
  if (new Set(codes).size > 1) return null
  const sourceCode = codes[0]!
  const stripped = text.replace(/量表\s*\[\s*[^\]]+?\s*\]\s*\./g, '')
  const conditions = parseCondition(stripped, sourceCode, ctx, new Set())
  if (!conditions) return null
  const sourceScale = ctx.nameByCode.get(sourceCode)
  if (!sourceScale) return null
  return { sourceScale, conditions }
}

/**
 * 把等级规则条件里的 computed 引用改写为「直引」类型（total/question/dimension）。
 *
 * 背景：4.2.3 的 E/D/C/B/A 规则挂在双维容器（HS_S1）上，条件用计算变量（容器总分=总分、
 * 信任关系维度分=题[q4]、冲突强度=维度[HS_S1D2] 等）。运行时 computed 按「当前作答量表」
 * 求值，这些变量在双维容器作答时可算且语义正确，但在其它量表作答时要么求值失败（
 * executeRules 对分级规则求值失败是直接抛错，4.2.3 双维容器提交必崩），要么总分错位
 * （六维评估 30 题总分 90 会误触发「容器总分 >= 40」红线）。
 *
 * 直引化后：等级规则在双维容器作答时语义与 4.2.3 逐项等价（同一作答下值与 computed
 * 相同）；编译端为红线生成跨量表 PRIOR 条件，submit 场景 priors 为空时求值失败被
 * evalRedLine 捕获为 false，不会误触发。引用其它量表维度/题号的变量（R类命中数、
 * 紊乱型均分、生物层均分等）无法直引，裁剪。
 */
function dereferenceComputed(
  c: WizardCondition,
  computed: Record<string, string>,
  ctx423: ScaleContext,
  mountCode: string
): WizardCondition | null {
  if (c.targetType !== 'computed') return c
  const expr = String(computed[c.target] || '')
  if (expr === '总分' || expr === '均分') {
    return { targetType: expr === '总分' ? 'total' : 'average', target: '', comparator: c.comparator, value: c.value, join: c.join }
  }
  const qMatch = expr.match(/^题\[\s*q(\d+)\s*\]$/)
  if (qMatch) {
    const mountCount = [...ctx423.questionIndex.keys()].filter(k => k.startsWith(`${mountCode}||`)).length
    if (Number(qMatch[1]) > mountCount) return null
    return { targetType: 'question', target: qMatch[1]!, comparator: c.comparator, value: c.value, join: c.join }
  }
  const dimMatch = expr.match(/^维度\[\s*([^\]]+?)\s*\]$/)
  if (dimMatch) {
    const dimCode = dimMatch[1]!.trim()
    let belongs = ''
    for (const [key] of ctx423.dimNameByCode) {
      if (key.endsWith(`||${dimCode}`)) { belongs = key.split('||')[0]!; break }
    }
    if (belongs !== mountCode) return null
    const name = ctx423.dimNameByCode.get(`${mountCode}||${dimCode}`)
    return { targetType: 'dimension', target: name || dimCode, comparator: c.comparator, value: c.value, join: c.join }
  }
  return null
}

// ---------- 选项组 ----------

const GROUP_BY_SIGNATURE = new Map<string, string>([
  ['几乎没有|很少|有时|经常|几乎每天', 'FREQ_5'],
  ['完全不符合|比较不符合|一般|比较符合|非常符合', 'AGREE_5'],
  ['否|是', 'YES_NO']
])

function collectOptionGroups(instruments: any[]): { id: string, name: string, options: Array<{ label: string, score?: number }> }[] {
  const customGroups = new Map<string, { id: string, name: string, options: Array<{ label: string, score?: number }> }>()
  const groupIdOf = (q: any): string => {
    const sig = (q.options || []).map((o: any) => o.label).join('|')
    const preset = GROUP_BY_SIGNATURE.get(sig)
    if (preset) return preset
    let g = customGroups.get(sig)
    if (!g) {
      const options = (q.options || []).map((o: any) => ({ label: String(o.label), score: Number(o.value) }))
      const first = options[0]?.label || '未命名'
      g = {
        id: `cg-${customGroups.size + 1}`,
        name: options.length > 1 ? `${first}…${options.length} 项` : first,
        options
      }
      customGroups.set(sig, g)
    }
    return g.id
  }
  for (const inst of instruments) for (const q of inst.questions || []) groupIdOf(q)
  return [...customGroups.values()]
}

// ---------- 量表构造 ----------

const ROLE_TO_LABEL: Record<string, string> = {
  screening: '入口筛查', deep_dive: '深度诊断', situational: '专项/情境', red_line: '红线检查'
}

function majority(sources: any[], key: string): string | undefined {
  const counts = new Map<string, number>()
  for (const s of sources) {
    const v = s?.[key]
    if (v === undefined || v === null || v === '') continue
    const k = String(v)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  if (!counts.size) return undefined
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
}

function scaleFromInstrument(inst: any, ctx: ScaleContext): Record<string, unknown> {
  const trigger = inst.triggerCondition ? parseCrossScaleCondition(inst.triggerCondition, ctx) : null
  return {
    name: inst.title,
    role: ROLE_TO_LABEL[inst.instrumentRole] || (inst.isRequired ? '入口筛查' : '深度诊断'),
    shortName: inst.shortName || undefined,
    description: inst.description || undefined,
    minutes: inst.estimatedMinutes || undefined,
    prerequisites: (inst.prerequisiteCodes || []).map((c: string) => ctx.nameByCode.get(c) || c),
    triggerConditions: trigger?.conditions || [],
    triggerNote: inst.triggerConditionNote || undefined,
    schoolSection: inst.applicableSchoolSection || undefined,
    targetAudience: inst.targetAudience || undefined,
    formType: inst.formType || undefined,
    triggerMethod: inst.triggerMethod || undefined,
    frequency: inst.frequency || undefined,
    resultVisibility: inst.resultVisibility || undefined,
    responsibleRole: inst.responsibleRole || undefined,
    dataSensitivity: inst.dataSensitivity || undefined,
    sourceType: inst.sourceType || undefined,
    dimensionDefs: (inst.dimensionDefs || []).map((dd: any) => ({
      name: dd.name,
      calcMethod: dd.calcMethod || 'mean',
      weight: dd.weight ?? 1,
      description: dd.description || undefined,
      highInterpretation: dd.highInterpretation || undefined,
      lowInterpretation: dd.lowInterpretation || undefined,
      normMean: dd.normMean ?? undefined,
      normStd: dd.normStd ?? undefined
    })),
    questions: (inst.questions || []).map((q: any) => ({
      text: q.text,
      dimension: ctx.dimCodeToName.get(q.dimension) || q.dimension,
      optionGroup: groupIdOf(q),
      reverse: Boolean(q.reverse),
      help: q.help || undefined
    }))
  }
}

// groupIdOf 需要先构建选项组集合，见 collectOptionGroups；这里用共享签名映射
let CUSTOM_GROUPS: ReturnType<typeof collectOptionGroups> = []
function groupIdOf(q: any): string {
  const sig = (q.options || []).map((o: any) => o.label).join('|')
  const preset = GROUP_BY_SIGNATURE.get(sig)
  if (preset) return preset
  const g = CUSTOM_GROUPS.find(g => g.options.map(o => o.label).join('|') === sig)
  return g ? g.id : 'FREQ_5'
}

// ---------- 计算变量 ----------

/** 表达式引擎语法 → 向导中文写法（维度[编码]→维度[中文名]，题[qN]→题[N]） */
function toBusinessExpression(expr: string, scaleCode: string, ctx: ScaleContext, ctx421?: ScaleContext): string {
  let text = String(expr || '').trim()
  const dim = text.replace(/维度\s*\[\s*([^\]\s]+?)\s*\]/g, (_, code: string) => {
    const c = code.trim()
    const name = /^HS_S[678]D/.test(c)
      ? (ctx421 ? dimOf423(c, ctx421) : c)
      : (ctx.dimNameByCode.get(`${scaleCode}||${c}`) || c)
    return `维度[${name}]`
  })
  return dim.replace(/题\s*\[\s*q(\d+)\s*\]/g, '题[$1]')
}

function buildComputedVariables(attr: any, ctx: ScaleContext, ctx421: ScaleContext): Array<{ name: string, scale: string, expression: string }> {
  const out: Array<{ name: string, scale: string, expression: string }> = []
  for (const [name, expr] of Object.entries<string>(attr.computed || {})) {
    if (expr === '总分' || expr === '均分') {
      out.push({ name, scale: TOTAL_VAR_SCALE[name] || ctx.nameByCode.get('HS_S1') || '', expression: expr })
      continue
    }
    if (QUESTION_VAR_SCALE[name] && !String(expr).includes('维度[')) {
      // 纯题号引用（六维度诊断 6 题），保持 4.2.3 原归属
      out.push({ name, scale: QUESTION_VAR_SCALE[name], expression: toBusinessExpression(String(expr), 'HS_S3', ctx, ctx421) })
      continue
    }
    const dimCodes = [...String(expr).matchAll(/维度\[\s*([^\]]+?)\s*\]/g)].map(m => m[1]!.trim())
    const qMatch = String(expr).match(/题\[\s*(q?\d+)\s*\]/)
    let scaleCode: string | undefined
    for (const inst of ctx.nameByCode.keys()) {
      if (scaleCode) break
      for (const d of dimCodes) {
        if (ctx.dimNameByCode.has(`${inst}||${d}`)) { scaleCode = inst; break }
      }
      if (!scaleCode && qMatch) {
        const qid = qMatch[1]!.replace(/^q/, '')
        if (ctx.questionIndex.has(`${inst}||q${qid}`) || ctx.questionIndex.has(`${inst}||${qid}`)) scaleCode = inst
      }
    }
    if (!scaleCode) throw new Error(`计算变量「${name}=${expr}」无法确定依赖量表`)
    const scale = SCALE_423_TO_425[scaleCode] || ctx.nameByCode.get(scaleCode) || scaleCode
    out.push({ name, scale, expression: toBusinessExpression(String(expr), scaleCode, ctx, ctx421) })
  }
  return out
}

// ---------- 主流程 ----------

async function main() {
  loadLocalEnv()
  const db = useDb()

  // 1. 读取源数据
  const { a421, a423 } = await loadPayloads(db)
  const inst421: any[] = a421.instruments
  const inst423: any[] = (a423.get('assessment') as any).instruments
  const attr423 = a423.get('attribution') as any
  const tool423 = a423.get('tool') as any
  const kw423 = a423.get('keyword_route') as any
  const tpl423 = a423.get('output_template') as any

  const ctx421 = buildContext(inst421)
  const ctx423 = buildContext(inst423)
  CUSTOM_GROUPS = collectOptionGroups([...inst421, ...inst423])

  // 2. 量表并集：4.2.1 的 5 张（顺序在前） + 4.2.3 独有的 6 张
  const extra423 = inst423.filter(i => !DUP_423_SCALES.has(i.code))
  const allScales = [...inst421, ...extra423]
  const titleOf = (code: string, ctx: ScaleContext) => SCALE_423_TO_425[code] || ctx.nameByCode.get(code) || code

  // 4.2.3 独有量表需要接在 4.2.1 入口量表之后：双维容器速查挂在六维评估后，其余挂在双维容器速查后
  const entry421 = ctx421.nameByCode.get('HS_S1')!
  const containerName = titleOf('HS_S1', ctx423) // 家校沟通双维与容器速查
  const scales = allScales.map((inst) => {
    const from423 = inst423.includes(inst)
    const ctx = from423 ? ctx423 : ctx421
    const scale = scaleFromInstrument(inst, ctx)
    if (from423 && DUP_423_SCALES.has(inst.code)) return null
    if (from423) {
      // 原 4.2.3 入口（HS_S1 双维容器速查）变深度量表：挂在六维评估后
      if (inst.code === 'HS_S1') {
        scale.role = '深度诊断'
        scale.prerequisites = [entry421]
        scale.triggerConditions = [{ targetType: 'average', target: '', comparator: '达到或超过', value: 3, join: '且' }]
        scale.triggerNote = scale.triggerNote || `《${entry421}》均分 ≥ 3（有沟通基础）时建议做双维与容器速查，快速定位关系容器状态`
      } else {
        // 原 4.2.3 深度量表：保持「双维容器速查均分 ≥ 3 后推荐」的语义
        scale.prerequisites = [containerName]
        scale.triggerConditions = [{ targetType: 'average', target: '', comparator: '达到或超过', value: 3, join: '且' }]
        scale.triggerNote = scale.triggerNote || `《${containerName}》均分 ≥ 3 时建议做《${inst.title}》`
      }
    }
    return scale
  }).filter(Boolean) as Record<string, unknown>[]

  // 3. 计算变量（4.2.3）
  const computedNames = new Set(Object.keys(attr423.computed || {}))
  const computedVariables = buildComputedVariables(attr423, ctx423, ctx421)

  // 4. 归因（4.2.3 的 24 条，编码顺序即编译顺序）
  const nameByAttrCode = new Map<string, string>((attr423.attributionItems || []).map((a: any) => [a.code, a.name]))
  const attributions = (attr423.attributionItems || [])
    .slice()
    .sort((a: any, b: any) => String(a.code).localeCompare(String(b.code)))
    .map((a: any) => ({
      name: a.name,
      description: a.description || undefined,
      highSign: a.highManifestation || undefined,
      typicalTrigger: a.typicalTrigger || undefined,
      action: a.suggestedAction || undefined,
      weight: Number(a.baseWeight) || 1,
      tags: a.toolTags || []
    }))

  // 5. 证据（4.2.3 的 56 条）
  const evidences: Array<Record<string, unknown>> = []
  for (const e of attr423.evidences || []) {
    const conditions = parseCondition(e.condition, e.assessmentCode, ctx423, computedNames, ctx421)
    if (!conditions) throw new Error(`证据 ${e.evidenceCode} 条件无法解析：${e.condition}`)
    evidences.push({
      attribution: nameByAttrCode.get(e.attributionCode) || e.attributionCode,
      scale: titleOf(e.assessmentCode, ctx423) || entry421,
      conditions,
      weight: Number(e.weight) || 2,
      description: e.description || undefined
    })
  }

  // 6. 分级规则（4.2.3 的 5 条业务规则 E/D/C/B/A 挂双维容器，E 级红线）
  //    + 4.2.1 体系的显式规则（修复 AUTO 均分阶梯对正向计分量表的计分方向颠倒）：
  //      5级·极重挂红线检查（任一题命中即熔断）、4级/3级/2级挂六维评估（均分低=风险高，
  //      与六维评估正向计分方向一致）、PSTAR 聚焦不足（聚焦度低=需引导）。
  //    前 5 条占用五色五档（red..green）；4.2.1 规则从第 6 条起复用同序五色
  //    （i=5→red、i=6→orange、i=7→yellow、i=8→blue、i=9→green），恰与各自严重度匹配；
  //    编译端会产生「等级超过五档」的提示性 warning，运行时按量表编码过滤互不干扰。
  const templateByLevel = new Map<string, string>(
    (tpl423.templates || []).filter((t: any) => t.type === 'summary').map((t: any) => [t.attributionLevel, t.content])
  )
  const redLines: any[] = attr423.redLines || []
  const red0 = redLines[0] || {}
  const toolCodeToName = new Map<string, string>((tool423.tools || []).map((t: any) => [t.code, t.name]))
  const rule421 = ctx423.nameByCode.get('HS_S1')! // 双维容器速查，等级规则原挂载量表
  const levels423 = (attr423.gradingRules || [])
    .filter((r: any) => !String(r.ruleId || '').includes('_GR_AUTO_') && r.when)
    .sort((a: any, b: any) => Number(a.pri || 0) - Number(b.pri || 0))
    .map((r: any) => {
      const rawConditions = parseCondition(r.when, r.assessmentCode || 'HS_S1', ctx423, computedNames, ctx421)
      if (!rawConditions) throw new Error(`等级「${r.levelName || r.level}」条件无法解析：${r.when}`)
      // 直引化 + 裁剪：computed 引用改写成当前量表上下文的直接条件，其余裁剪
      // （4.2.3 的运行时缺陷修复，见 dereferenceComputed 注释）
      const mountCode = r.assessmentCode || 'HS_S1'
      const conditions = rawConditions
        .map(c => dereferenceComputed(c, attr423.computed || {}, ctx423, mountCode))
        .filter((c): c is WizardCondition => c !== null)
      if (!conditions.length) throw new Error(`等级「${r.levelName || r.level}」条件裁剪后为空：${r.when}`)
      return {
        name: r.levelName || r.level,
        scale: titleOf(r.assessmentCode, ctx423) || rule421,
        conditions,
        redLine: Boolean(r.blocked),
        redLineAction: r.blocked ? (red0.requiredActions || undefined) : undefined,
        teacherMessage: templateByLevel.get(r.level) || undefined,
        resultNote: r.resultDescription || undefined,
        escalationCondition: r.escalationCondition || undefined,
        escalationTarget: r.escalationTarget || undefined,
        reAssessTrigger: r.reEvaluationTrigger || undefined,
        notificationTemplate: r.blocked ? (red0.notificationTemplate || undefined) : undefined,
        interventionTools: (r.interventionTools || []).map((code: string) => toolCodeToName.get(code) || code),
        interventionActions: (r.interventionActions || []).map((action: string) => action)
      }
    })
  // 4.2.1 体系等级（来自 4.2.0 业务向导输入，条件为中文直接引用，无编码依赖）
  const levels421: WizardLevel[] = HOME_SCHOOL_WIZARD_INPUT.levels
    .filter(lv => /^[5432]级/.test(lv.name))
    .map(lv => ({
      name: lv.name,
      scale: lv.scale,
      conditions: lv.conditions,
      redLine: Boolean(lv.redLine),
      redLineAction: lv.redLineAction || undefined,
      teacherMessage: lv.teacherMessage || undefined,
      resultNote: lv.resultNote || undefined,
      escalationCondition: lv.escalationCondition || undefined,
      escalationTarget: lv.escalationTarget || undefined,
      reAssessTrigger: lv.reAssessTrigger || undefined,
      notificationTemplate: lv.redLine ? (red0.notificationTemplate || undefined) : undefined,
      interventionTools: lv.interventionTools || [],
      interventionActions: lv.interventionActions || []
    }))
  // PSTAR 聚焦不足（5 点 sum 计分，满分 25；维度定义业务阈值「<=10 分：问题散乱、需帮助聚焦」）
  const levelsPSTAR: WizardLevel = {
    name: 'PSTAR聚焦不足（关注）',
    scale: 'PSTAR聚焦定向评估（HS_PSTAR）',
    conditions: [{ targetType: 'dimension', target: 'PSTAR聚焦度', comparator: '低于或等于', value: 10, join: '且' }],
    redLine: false,
    teacherMessage: '本次 PSTAR 聚焦评估显示聚焦度不足（总分 ≤ 10）：问题点未能清晰列出、排序或锁定核心靶点。建议先完成 BPS 快速归因筛查，明确各问题点的归因后，再回来重新聚焦，一次只锁定一个干预靶点。',
    resultNote: 'PSTAR 聚焦度不足，建议先补 BPS 归因再聚焦靶点。'
  }
  const levels = [...levels423, ...levels421, levelsPSTAR]

  // 7. 工具（4.2.3 的 20 个）
  const tools = (tool423.tools || []).map((t: any) => {
    const dimNames = (t.dimensions || []).map((c: string) =>
      /^HS_S[678]D/.test(c) ? dimOf423(c, ctx421) : (ctx423.dimCodeToName.get(c) || c))
    const attrCodes: string[] = t.attributionCode ? String(t.attributionCode).split(/[;,]/) : []
    const steps = (t.structuredSteps || []).length
      ? t.structuredSteps.map((s: any) => s.description || s.title)
      : String(t.steps || '').split(/[；\n]/).map((s: string) => s.trim()).filter(Boolean)
    const stepDetails = (() => {
      const details = (t.structuredSteps || []).map((s: any) => ({
        estimatedTime: s.estimatedTime || undefined,
        materials: s.materials || undefined,
        keyTip: s.keyTip || undefined,
        scriptTemplate: s.scriptTemplate || undefined,
        successCriteria: s.successCriteria || undefined,
        commonIssues: s.commonIssues || undefined
      }))
      return steps.map((_: string, i: number) => details[i] || {})
    })()
    return {
      name: t.name,
      attributions: attrCodes.map((c: string) => nameByAttrCode.get(c.trim()) || c.trim()).filter(Boolean),
      whenToUse: t.symptoms || '',
      steps: steps.length ? steps : ['（原内容未拆分步骤，请补充）'],
      stepDetails: steps.length ? stepDetails : [],
      form: ['exercise', 'script', 'checklist', 'framework', 'worksheet'].includes(t.form) ? t.form : 'framework',
      severity: ['low', 'medium', 'high', 'crisis'].includes(t.severity) ? t.severity : 'medium',
      schoolSection: t.applicableSchoolSection || undefined,
      targetUsers: t.targetUsers || undefined,
      evidenceLevel: t.evidenceLevel || undefined,
      script: t.scripts || undefined,
      prohibition: t.prohibitions || undefined,
      timePerSession: t.timePerSession || undefined,
      duration: t.duration || undefined,
      expectedEffect: t.expectedEffect || undefined,
      effectNote: t.effectNote || undefined,
      outputArtifact: t.outputArtifact || undefined,
      contraindicationNote: t.contraindicationNote || undefined,
      collaborativeTools: (t.collaborativeToolCodes || []).map((c: string) => toolCodeToName.get(c) || c),
      dimensions: dimNames,
      reAssessmentIntervalDays: t.reAssessmentIntervalDays || undefined,
      evidenceSource: t.evidenceSource || undefined,
      crossModuleTags: t.crossModuleTags || [],
      prerequisiteTools: [],
      alternativeTools: [],
      advancedTools: [],
      preparation: t.preparationNeeded || undefined,
      materials: t.materialsRequired || undefined,
      outcomeIndicator: t.outcomeIndicators || undefined,
      failureCriteria: t.failureCriteria || undefined,
      contraindications: (t.contraindicationRules || []).map((c: any) => ({
        condition: c.condition,
        type: c.type === 'block' ? 'block' : 'warn',
        description: c.description || undefined,
        alternative: c.alternativeSuggestion || undefined
      }))
    }
  })

  // 8. 关键词（4.2.3 的 30 条）
  const keywords = (kw423.routes || []).map((r: any) => ({
    core: String(r.coreKeywords || '').split(/[;,；、]/).map((s: string) => s.trim()).filter(Boolean),
    expanded: String(r.expandedKeywords || '').split(/[;,；、]/).map((s: string) => s.trim()).filter(Boolean),
    exclude: Array.isArray(r.exclusionKeywords) ? r.exclusionKeywords : [],
    category: r.semanticCategory || undefined,
    scale: r.linkedAssessmentCode ? (titleOf(r.linkedAssessmentCode, ctx423) || undefined) : undefined,
    tool: r.linkedToolCode ? (toolCodeToName.get(r.linkedToolCode) || undefined) : undefined,
    matchMode: ['exact', 'fuzzy'].includes(r.matchMode) ? r.matchMode : 'fuzzy',
    risk: ['red', 'orange', 'yellow', 'blue', 'green'].includes(r.riskLevel) ? r.riskLevel
      : (r.riskLevel === 'none' ? 'green' : 'yellow'),
    contextConstraint: r.contextConstraint || undefined,
    description: r.description || undefined
  }))

  // 9. 模块级默认
  const defaults = {
    schoolSection: majority(allScales, 'applicableSchoolSection') || 'all',
    targetAudience: majority(allScales, 'targetAudience') || 'teacher',
    formType: majority(allScales, 'formType') || 'self_report',
    triggerMethod: majority(allScales, 'triggerMethod') || 'manual',
    frequency: majority(allScales, 'frequency') || 'per_case',
    resultVisibility: majority(allScales, 'resultVisibility') || 'teacher_only',
    responsibleRole: majority(allScales, 'responsibleRole') || '班主任',
    dataSensitivity: majority(allScales, 'dataSensitivity') || 'sensitive',
    sourceType: majority(allScales, 'sourceType') || 'proprietary',
    evidenceLevel: majority(tool423.tools || [], 'evidenceLevel') || 'B',
    redLineScope: ['instrument', 'module', 'system'].includes(red0.scope) ? red0.scope : 'module',
    redLineActions: Array.isArray(red0.actions) && red0.actions.length ? red0.actions.join('；') : '暂停常规方案，转安全转介流程',
    redLineRecovery: red0.recoveryCondition || '专业评估确认风险解除后',
    redLineOwner: red0.responsibleRole || '班主任'
  }

  // 10. 兜底等级
  const fallback = (attr423.gradingRules || []).find((r: any) => !r.when)
  const defaultLevelName = fallback?.levelName || fallback?.level || '暂无明显信号'
  const defaultMessage = templateByLevel.get('green') || undefined

  const input: WizardInput = {
    module: MODULE,
    version: TARGET_VERSION,
    sourceRef: `合并 ${SRC_421} 量表（5 张）与 ${SRC_423} 归因体系（24 归因/56 证据/5 级/20 工具/30 关键词）`,
    defaults,
    computedVariables,
    optionGroups: CUSTOM_GROUPS.map(g => ({ id: g.id, name: g.name, options: g.options })),
    scales: scales as any,
    attributions: attributions as any,
    evidences: evidences as any,
    levels: levels as any,
    tools: tools as any,
    keywords: keywords as any,
    defaultLevelName,
    defaultMessage
  }

  // ---------- 校验链（与 wizard-import.post.ts 一致） ----------
  const parsed = wizardInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(`向导输入契约校验失败：${parsed.error.issues.slice(0, 5).map(i => i.message).join('；')}`)
  }

  const compiled = compileWizardInput(input)
  const blocking = compiled.issues.filter(i => i.severity === 'error')
  const payloads = new Map<string, Record<string, unknown>>()
  const libraries: Array<{ id: string, libraryType: string }> = []
  for (const lib of compiled.libraries) {
    let payload: Record<string, unknown>
    try {
      payload = parseModuleResourceFile({
        module: MODULE, libraryType: lib.libraryType,
        filename: `${lib.libraryType}.xlsx`, contentBase64: lib.buffer.toString('base64')
      })
    } catch (error: any) {
      throw new Error(`生成的${lib.label}无法解析：${error?.message || ''}`)
    }
    const validation = validateModuleResourcePayload({ module: MODULE, libraryType: lib.libraryType, payload })
    if (!validation.ok) {
      throw new Error(`${lib.label}校验未通过：${validation.errors.slice(0, 5).map(e => e.message).join('；')}`)
    }
    payloads.set(lib.libraryType, payload)
    libraries.push({ id: lib.libraryType, libraryType: lib.libraryType })
  }
  const crossRef = checkCrossReferences(MODULE, libraries, payloads)
  const crossRefErrors = crossRef.issues.filter(i => i.severity === 'error')

  // ---------- 输出汇总 ----------
  const countOf = (lib: string) => {
    const p = payloads.get(lib)
    if (!p) return 0
    if (lib === 'assessment') return (p.instruments || []).length
    if (lib === 'attribution') return (p.attributionItems || []).length
    if (lib === 'tool') return (p.tools || []).length
    if (lib === 'keyword_route') return (p.routes || []).length
    return (p.templates || []).length
  }
  console.log(`4.2.5 合并预览：`)
  console.log(`  量表 ${countOf('assessment')} 张（${scales.length} 张输入）| 归因 ${countOf('attribution')} 条 | 证据 ${(payloads.get('attribution') as any)?.evidences?.length || 0} 条 | 工具 ${countOf('tool')} 个 | 关键词 ${countOf('keyword_route')} 条 | 模板 ${countOf('output_template')} 个`)
  console.log(`  分级规则 ${(payloads.get('attribution') as any)?.gradingRules?.length || 0} 条（含编译端自动补齐阶梯）`)
  console.log(`  编译 issues：${compiled.issues.length} 条（error ${blocking.length} / warning ${compiled.issues.length - blocking.length}）`)
  for (const issue of compiled.issues) console.log(`    [${issue.severity}] ${issue.message}`)
  if (blocking.length || crossRefErrors.length) {
    console.error('编译或跨库检查存在 error，中止。')
    for (const e of crossRefErrors) console.error(`  [跨库] ${e.message}`)
    process.exit(1)
  }

  // ---------- 运行时冒烟：对每张量表模拟作答，执行规则引擎 ----------
  {
    const { executeRules } = await import('../server/domain/rules-executor')
    const attrPayload = payloads.get('attribution')!
    const assessmentPayload = payloads.get('assessment') as any
    const run = (inst: any, pick: (values: number[]) => number): { levelName: string, level: string, blocked: boolean, n: number } => {
      const answers: Record<string, number> = {}
      for (const q of inst.questions) {
        const values = (q.options || []).map((o: any) => Number(o.value)).filter((v: number) => Number.isFinite(v))
        answers[q.id] = pick(values)
      }
      const definition = {
        code: inst.code, instrumentCode: inst.code, version: '4.2.5', module: MODULE,
        title: inst.title, description: inst.description || '', estimatedMinutes: 10,
        questions: inst.questions, dimensionDefs: inst.dimensionDefs
      }
      const result = executeRules(attrPayload as any, answers, definition as any)
      return { levelName: result.levelName, level: result.level, blocked: result.blocked, n: result.attributions.length }
    }
    const middle = (v: number[]) => v[Math.floor(v.length / 2)] ?? 1
    const max = (v: number[]) => v[v.length - 1] ?? 1
    const min = (v: number[]) => v[0] ?? 1
    console.log('\n运行时冒烟（每张量表全选中间选项作答）：')
    for (const inst of assessmentPayload.instruments) {
      try {
        const r = run(inst, middle)
        console.log(`  《${inst.title}》→ ${r.levelName}（${r.level}）blocked=${r.blocked} 归因 ${r.n} 条`)
      } catch (error) {
        console.error(`  冒烟《${inst.title}》失败：${(error as Error).message}`)
        process.exit(1)
      }
    }
    // 关键场景（分级方向验证）：
    //  双维容器（reverse 计分）全选最低值 → E 级熔断
    //  六维评估（正向计分）满分 → 默认 A 级常规；全选最低 → 4级·重度
    //  红线检查任一命中 → 5级·极重熔断；六维评估满分不误触发红线
    const byTitle = (t: string) => assessmentPayload.instruments.find((i: any) => i.title === t)
    const container = byTitle('家校沟通双维与容器速查')
    const sixDim = byTitle('家校沟通六维评估')
    const redline = byTitle('家校沟通红线检查')
    const pstar = byTitle('PSTAR聚焦定向评估（HS_PSTAR）')
    if (container) {
      const r = run(container, min)
      console.log(`  场景《家校沟通双维与容器速查》全选最低值（reverse 后总分最高）→ ${r.levelName} blocked=${r.blocked}（期望 E级 blocked=true）`)
      if (r.level !== 'red' || !r.blocked) {
        console.error('  双维容器最低值作答未触发 E 级熔断，中止。')
        process.exit(1)
      }
    }
    if (sixDim) {
      const healthy = run(sixDim, max)
      console.log(`  场景《家校沟通六维评估》满分作答（正向计分=关系健康）→ ${healthy.levelName} blocked=${healthy.blocked}（期望默认 A级常规、不触发红线）`)
      if (healthy.blocked || ['red', 'orange'].includes(healthy.level)) {
        console.error('  六维评估满分作答被判为重风险或触发红线（分级方向颠倒），中止。')
        process.exit(1)
      }
      const risky = run(sixDim, min)
      console.log(`  场景《家校沟通六维评估》全选最低值（关系恶化）→ ${risky.levelName} blocked=${risky.blocked}（期望 4级·重度）`)
      if (risky.level !== 'orange') {
        console.error(`  六维评估最低值作答未判 4级·重度（实际 ${risky.levelName}），中止。`)
        process.exit(1)
      }
    }
    if (redline) {
      const r = run(redline, max)
      console.log(`  场景《家校沟通红线检查》全部命中 → ${r.levelName} blocked=${r.blocked}（期望 5级·极重 blocked=true）`)
      if (!r.blocked || r.level !== 'red') {
        console.error('  红线检查全部命中未触发 5级·极重熔断，中止。')
        process.exit(1)
      }
      const clear = run(redline, min)
      console.log(`  场景《家校沟通红线检查》全部未命中 → ${clear.levelName} blocked=${clear.blocked}（期望默认常规、不熔断）`)
      if (clear.blocked) {
        console.error('  红线检查未命中却熔断，中止。')
        process.exit(1)
      }
    }
    if (pstar) {
      const focused = run(pstar, max)
      console.log(`  场景《PSTAR聚焦定向评估》满分作答（聚焦良好）→ ${focused.levelName} blocked=${focused.blocked}（期望默认常规）`)
      if (focused.blocked || ['red', 'orange', 'yellow'].includes(focused.level)) {
        console.error('  PSTAR 满分作答被判中高风险（分级方向颠倒），中止。')
        process.exit(1)
      }
      const unfocused = run(pstar, min)
      console.log(`  场景《PSTAR聚焦定向评估》全选最低值（聚焦不足）→ ${unfocused.levelName} blocked=${unfocused.blocked}（期望 PSTAR聚焦不足）`)
      if (!unfocused.levelName.includes('PSTAR聚焦不足')) {
        console.error(`  PSTAR 聚焦不足未判出对应等级（实际 ${unfocused.levelName}），中止。`)
        process.exit(1)
      }
    }
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] 校验全部通过，未写库。')
    console.log('\n—— 回读稿 ——\n' + compiled.readback.join('\n'))
    return
  }

  // ---------- 事务写入并发布 ----------
  const [actor] = await db.select({ id: schema.users.id }).from(schema.users)
    .where(eq(schema.users.role, 'platform_admin'))
    .orderBy(schema.users.createdAt)
    .limit(1)
  if (!actor) throw new Error('未找到 platform_admin 账号，请先运行本地 seed 或创建平台管理员')

  const now = new Date()
  const written = await db.transaction(async (tx) => {
    const result: Array<{ libraryType: string, libraryId: string, versionId: string }> = []
    // --force：先删除已存在的 4.2.5 版本（投影表 version_id 外键级联删除），支持重新发布
    if (FORCE) {
      const stale = await tx.select({ id: schema.moduleResourceVersions.id }).from(schema.moduleResourceVersions)
        .innerJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
        .where(and(
          eq(schema.moduleResourceLibraries.module, MODULE),
          eq(schema.moduleResourceLibraries.scope, 'global'),
          isNull(schema.moduleResourceLibraries.schoolId),
          eq(schema.moduleResourceVersions.version, TARGET_VERSION)
        ))
      for (const s of stale) {
        await tx.delete(schema.moduleResourceVersions).where(eq(schema.moduleResourceVersions.id, s.id))
      }
      if (stale.length) console.log(`已删除 ${stale.length} 条旧 4.2.5 版本记录，重新发布。`)
    }
    for (const lib of compiled.libraries) {
      const [existing] = await tx.select().from(schema.moduleResourceLibraries).where(and(
        eq(schema.moduleResourceLibraries.module, MODULE),
        eq(schema.moduleResourceLibraries.libraryType, lib.libraryType),
        eq(schema.moduleResourceLibraries.scope, 'global'),
        isNull(schema.moduleResourceLibraries.schoolId)
      )).limit(1)
      const library = existing || (await tx.insert(schema.moduleResourceLibraries).values({
        module: MODULE, libraryType: lib.libraryType, scope: 'global', schoolId: null,
        name: `${MODULE}${LIBRARY_LABEL[lib.libraryType]}`,
        description: '业务填写向导生成（合并 4.2.1 量表 + 4.2.3 归因）',
        createdBy: actor.id
      }).returning())[0]

      // 停用旧的已发布版本必须排在插入之前（部分唯一索引）
      await tx.update(schema.moduleResourceVersions).set({ status: 'retired', updatedAt: now })
        .where(and(
          eq(schema.moduleResourceVersions.libraryId, library.id),
          eq(schema.moduleResourceVersions.status, 'published')
        ))

      const [version] = await tx.insert(schema.moduleResourceVersions).values({
        libraryId: library.id, version: TARGET_VERSION,
        payload: payloads.get(lib.libraryType)!,
        notes: '业务填写向导生成（合并 4.2.1 量表 + 4.2.3 归因）',
        status: 'published',
        createdBy: actor.id,
        publishedBy: actor.id,
        publishedAt: now,
        updatedAt: now
      }).returning()

      await rebuildModuleResourceProjection(tx, {
        libraryId: library.id, versionId: version.id, module: MODULE,
        libraryType: lib.libraryType, scope: 'global', schoolId: null
      }, payloads.get(lib.libraryType)!)
      result.push({ libraryType: lib.libraryType, libraryId: library.id, versionId: version.id })
    }
    return result
  })

  await db.insert(schema.auditLogs).values({
    actorId: actor.id,
    schoolId: null,
    action: 'platform_admin.module_resource.wizard_import',
    targetType: 'module_resource_library',
    targetId: written.find(w => w.libraryType === 'assessment')?.libraryId,
    metadata: {
      module: MODULE, version: TARGET_VERSION, publish: true,
      note: '合并 4.2.1 量表（5 张）与 4.2.3 归因体系（24 归因/56 证据/5 级/20 工具/30 关键词）',
      libraries: written.map(w => ({ libraryType: w.libraryType, versionId: w.versionId }))
    }
  })

  console.log('\n已发布 4.2.5：')
  for (const w of written) console.log(`  ${LIBRARY_LABEL[w.libraryType]}: ${w.versionId}`)
}

main().catch((error) => {
  console.error(`[失败] ${(error as Error).message}`)
  process.exit(1)
})
/**
 * 已发布的 5 库 → 业务填写向导的中文输入（反向编译）。
 *
 * 用途：让业务在向导里打开系统里已有的内容继续改，而不是只能从零开始填。
 *
 * 与编译器对称：compileWizardInput 产出的每一列，这里都要能还原成中文输入。
 * 库里手工 Excel 填的特殊内容（跨量表计算变量、函数调用、自定义选项组等）
 * 仍然收进 unsupported，由调用方在保存前明确告知「继续保存会丢这些」。
 */
import type { ModuleId } from '../../shared/contracts'
import {
  WIZARD_COMPARATORS,
  type WizardCondition,
  type WizardInput
} from '../../shared/business-wizard'

const OP_TO_COMPARATOR: Record<string, keyof typeof WIZARD_COMPARATORS> = {
  '>=': '达到或超过',
  '<=': '低于或等于',
  '==': '正好等于'
}

interface ScaleContext {
  /** 量表编码 → 量表名称 */
  nameByCode: Map<string, string>
  /** `${量表编码}||${维度编码}` → 维度中文名 */
  dimNameByCode: Map<string, string>
  /** 维度编码 → 维度中文名（跨量表取第一个，歧义时接受） */
  dimCodeToName: Map<string, string>
  /** `${量表编码}||${题号}` → 第几题（1 起） */
  questionIndex: Map<string, number>
}

/**
 * 把一条条件表达式还原成向导的结构化条件。
 * 只认向导自己能生成的那套语法，遇到别的（跨量表、函数、未知标识符）返回 null。
 */
function parseCondition(
  expr: string, scaleCode: string, ctx: ScaleContext,
  /** ⑤b 计算变量。真实数据里全都是「状态总分 = 总分」这类别名，先展开再解析。 */
  aliases: Record<string, string> = {},
  /** ⑤b 变量名集合：裸变量名命中的条件还原成 computed 目标 */
  computedNames: Set<string> = new Set()
): WizardCondition[] | null {
  let text = String(expr || '').trim()
  // 别名展开：把 状态总分 换成 总分，条件就变成向导能表达的形式了
  for (const [name, target] of Object.entries(aliases)) {
    if (target === '总分' || target === '均分') {
      text = text.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), target)
    }
  }
  if (!text) return null
  // 括号、逻辑符号混写、函数调用一律判为向导表达不了
  if (/[()&|]|SCORE|DIM|SUM|AVG|PRIOR_/i.test(text)) return null

  // 按「且 / 或」切开，保留连接词
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
        const name = ctx.dimNameByCode.get(`${scaleCode}||${dim[1]}`)
        if (!name) return null
        targetType = 'dimension'
        target = name
      } else if (qs) {
        const index = ctx.questionIndex.get(`${scaleCode}||${qs[1]}`)
        if (!index) return null
        targetType = 'question'
        target = String(index)
      } else if (computedNames.has(left)) {
        // 计算变量名：向导「条件目标」里的一项
        targetType = 'computed'
        target = left
      } else {
        // 未知标识符（手工 Excel 写的其他内容），向导表达不了
        return null
      }
    }
    conditions.push({ targetType, target, comparator, value, join })
  }
  return conditions.length ? conditions : null
}

/** 跨量表触发条件：量表[X].总分 >= 17 这种。
 *  注意：运行期触发条件求值的变量表是空的，引用计算变量会永远「不满足」，
 *  所以这里不认变量名——遇到就返回 null，由调用方报 unsupported。 */
function parseCrossScaleCondition(expr: string, ctx: ScaleContext): { sourceScale: string, conditions: WizardCondition[] } | null {
  const text = String(expr || '').trim()
  if (!text) return null
  const codes = [...text.matchAll(/量表\s*\[\s*([^\]]+?)\s*\]/g)].map(m => m[1]!)
  if (!codes.length) return null
  // 引用了多张量表的条件，向导只能挂到一张上，判为表达不了
  if (new Set(codes).size > 1) return null
  const sourceCode = codes[0]!
  const stripped = text.replace(/量表\s*\[\s*[^\]]+?\s*\]\s*\./g, '')
  const conditions = parseCondition(stripped, sourceCode, ctx, {}, new Set())
  if (!conditions) return null
  const sourceScale = ctx.nameByCode.get(sourceCode)
  if (!sourceScale) return null
  return { sourceScale, conditions }
}

/**
 * ⑤b 计算变量表达式：引擎语法 → 业务中文写法。
 * 只认 维度[CODE] / 题[qN] / 总分 / 均分 及运算符；遇到别的（跨量表、函数）返回 null。
 */
function toBusinessExpression(expr: string, scaleCode: string, ctx: ScaleContext): string | null {
  let text = String(expr || '').trim()
  if (!text) return null
  if (/PRIOR_|SCORE\(|DIM\(|RAW\(|SUM\(|AVG\(|TOP_DIM|BOTTOM_DIM/i.test(text)) return null
  // 维度[CODE] → 维度[中文名]，找不到说明不是向导生成的，判为表达不了
  const dim = text.replace(/维度\s*\[\s*([^\]\s]+?)\s*\]/g, (_, code: string) => {
    const name = ctx.dimNameByCode.get(`${scaleCode}||${code.trim()}`)
    if (!name) return `维度[${code.trim()}]`
    return `维度[${name}]`
  })
  if (/维度\[\s*[A-Za-z0-9_\-]+\s*\]/.test(dim)) return null
  return dim.replace(/题\s*\[\s*q(\d+)\s*\]/g, '题[$1]')
}

export interface DecompileResult {
  input: WizardInput
  /** 向导表达不了、保存后会丢失的内容。必须在保存前告知业务。 */
  unsupported: Array<{ where: string, detail: string }>
  /** 能表达但有细节被简化的地方 */
  notes: string[]
}

export function decompileToWizardInput(
  module: ModuleId,
  payloads: {
    assessment?: any
    attribution?: any
    tool?: any
    keyword_route?: any
    output_template?: any
  },
  /** 库里的实际版本号，用来进位。payload 内部那个 version 是业务填的，不一定同步。 */
  currentVersion?: string
): DecompileResult {
  const unsupported: DecompileResult['unsupported'] = []
  const notes: string[] = []
  const drop = (where: string, detail: string) => unsupported.push({ where, detail })

  const instruments: any[] = payloads.assessment?.instruments || []
  const ctx: ScaleContext = {
    nameByCode: new Map(), dimNameByCode: new Map(), dimCodeToName: new Map(),
    questionIndex: new Map()
  }
  for (const inst of instruments) {
    ctx.nameByCode.set(inst.code, inst.title)
    for (const d of inst.dimensionDefs || []) {
      ctx.dimNameByCode.set(`${inst.code}||${d.code}`, d.name)
      if (!ctx.dimCodeToName.has(d.code)) ctx.dimCodeToName.set(d.code, d.name)
    }
    ;(inst.questions || []).forEach((q: any, i: number) => ctx.questionIndex.set(`${inst.code}||${q.id}`, i + 1))
  }
  const toolCodeToName = new Map<string, string>(
    (payloads.tool?.tools || []).map((t: any) => [t.code, t.name])
  )
  // ⑤b 变量名集合：提前构建，量表触发条件/证据条件/等级条件都可能引用变量
  const attr = payloads.attribution || {}
  const computedNames = new Set(Object.keys(attr.computed || {}))

  const ROLE_TO_LABEL: Record<string, string> = {
    screening: '入口筛查', deep_dive: '深度诊断', situational: '专项/情境', red_line: '红线检查'
  }
  const GROUP_BY_SIGNATURE = new Map<string, string>([
    ['几乎没有|很少|有时|经常|几乎每天', 'FREQ_5'],
    ['完全不符合|比较不符合|一般|比较符合|非常符合', 'AGREE_5'],
    ['否|是', 'YES_NO']
  ])
  // 自定义选项组：按「选项文本签名」合并多题共用的组，id 按出现顺序生成（往返稳定）
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

  // ---------- 量表 ----------
  const scales = instruments.map((inst: any) => {
    const trigger = inst.triggerCondition
      ? parseCrossScaleCondition(inst.triggerCondition, ctx)
      : null
    if (inst.triggerCondition && !trigger) {
      drop(`量表《${inst.title}》的触发条件`, inst.triggerCondition)
    }
    const questions = (inst.questions || []).map((q: any) => {
      const group = groupIdOf(q)
      return {
        text: q.text,
        // 导入时题目维度已被解析成维度编码（matchedDimension.code），还原回中文名
        dimension: ctx.dimCodeToName.get(q.dimension) || q.dimension,
        optionGroup: group, reverse: Boolean(q.reverse), help: q.help || undefined
      }
    })
    return {
      name: inst.title,
      role: ROLE_TO_LABEL[inst.instrumentRole] || (inst.isRequired ? '入口筛查' : '深度诊断'),
      shortName: inst.shortName || undefined,
      description: inst.description || undefined,
      minutes: inst.estimatedMinutes || undefined,
      prerequisites: (inst.prerequisiteCodes || []).map((c: string) => ctx.nameByCode.get(c) || c),
      exclusives: (inst.exclusiveCodes || []).map((c: string) => ctx.nameByCode.get(c) || c),
      triggerConditions: trigger?.conditions || [],
      triggerNote: inst.triggerConditionNote || undefined,
      usageTiming: inst.usageTiming || undefined,
      timeLimitMinutes: inst.timeLimitMinutes || undefined,
      minQuestions: inst.minQuestions || undefined,
      reAssessmentIntervalDays: inst.reAssessmentIntervalDays || undefined,
      applicableGrades: inst.applicableGrades || [],
      applicableSubjects: inst.applicableSubjects || [],
      normReference: inst.normReference || undefined,
      reliabilityNote: inst.reliabilityNote || undefined,
      validityNote: inst.validityNote || undefined,
      privacyNotice: inst.privacyNotice || undefined,
      applicabilityPreconditions: inst.applicabilityPreconditions || undefined,
      contraindications: inst.contraindications || undefined,
      postAssessmentActions: inst.postAssessmentActions || undefined,
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
      questions
    }
  })
  if (!instruments.some((i: any) => i.instrumentRole === 'screening' || i.isRequired)) {
    notes.push('库里没有明确的「入口筛查」量表，已按「必做」推断，请在第 2 步确认。')
  }

  // ---------- 归因 ----------
  const nameByAttrCode = new Map<string, string>(
    (attr.attributionItems || []).map((a: any) => [a.code, a.name])
  )
  // 计算变量：能还原成中文写法的保留；只做「总分/均分」别名的展开成条件；
  // 真在做运算（或跨量表）的算丢失。
  const aliases: Record<string, string> = {}
  const computedVariables: Array<{ name: string, scale: string, expression: string }> = []
  const instCodeOfDim = (dimCode: string) =>
    instruments.find((inst: any) =>
      (inst.dimensionDefs || []).some((dd: any) => dd.code === dimCode))?.code
  for (const [name, expr] of Object.entries(attr.computed || {})) {
    if (expr === '总分' || expr === '均分') {
      aliases[name] = expr
      // 别名仍然还原成计算变量，业务能看到「状态总分 = 总分」
      computedVariables.push({
        name, scale: ctx.nameByCode.get(instruments[0]?.code) || scales[0]?.name || module,
        expression: expr
      })
      continue
    }
    // 找表达式里第一个维度/题号引用所属的量表，作为「依赖量表」
    const dimCodes = [...String(expr).matchAll(/维度\[\s*([^\]]+?)\s*\]/g)].map(m => m[1]!.trim())
    const scaleCode = dimCodes.map(instCodeOfDim).find(Boolean)
    const qScale = (() => {
      const qMatch = String(expr).match(/题\[\s*(q?\d+)\s*\]/)
      if (!qMatch) return undefined
      return instruments.find((inst: any) =>
        (inst.questions || []).some((q: any) => q.id === qMatch[1]))?.code
    })()
    const sourceCode = scaleCode || qScale
    if (!sourceCode) {
      drop('归因库的计算变量', `${name}=${expr}——表达式不引用任何量表的题或维度，向导无法确定它的归属`)
      continue
    }
    const business = toBusinessExpression(String(expr), sourceCode, ctx)
    if (!business) {
      drop('归因库的计算变量', `${name}=${expr}——向导只支持用题/维度/总分/均分和加减乘除写的表达式`)
      continue
    }
    computedVariables.push({ name, scale: ctx.nameByCode.get(sourceCode) || sourceCode, expression: business })
  }
  if (Object.keys(aliases).length) {
    notes.push(`计算变量 ${Object.keys(aliases).join('、')} 只是「总分/均分」的别名，已原样保留。`)
  }

  const attributions = (attr.attributionItems || []).map((a: any) => ({
    name: a.name,
    description: a.description || undefined,
    highSign: a.highManifestation || undefined,
    typicalTrigger: a.typicalTrigger || undefined,
    action: a.suggestedAction || undefined,
    weight: Number(a.baseWeight) || 1,
    // 不滤掉模块名：编译器总是把模块名追加在业务 tags 后面，滤掉再追加会改变顺序
    tags: a.toolTags || []
  }))

  const evidences: any[] = []
  for (const e of attr.evidences || []) {
    const conditions = parseCondition(e.condition, e.assessmentCode, ctx, aliases, computedNames)
    if (!conditions) {
      drop(`归因「${nameByAttrCode.get(e.attributionCode) || e.attributionCode}」的一条判定条件`, e.condition)
      continue
    }
    evidences.push({
      attribution: nameByAttrCode.get(e.attributionCode) || e.attributionCode,
      scale: ctx.nameByCode.get(e.assessmentCode) || e.assessmentCode,
      conditions, weight: Number(e.weight) || 2,
      description: e.description || undefined
    })
  }

  // ---------- 分级 + 输出模板 ----------
  const templates: any[] = payloads.output_template?.templates || []
  const messageByLevel = new Map<string, string>(
    templates.filter((t: any) => t.type === 'summary').map((t: any) => [t.attributionLevel, t.content])
  )
  const entryScale = scales.find((s: any) => s.role === '入口筛查')?.name || scales[0]?.name

  const rules = [...(attr.gradingRules || [])].sort((a: any, b: any) => (a.pri || 0) - (b.pri || 0))
  const fallback = rules.find((r: any) => !r.when)
  const levels: any[] = []
  for (const r of rules) {
    if (!r.when) continue
    // 向导自己生成的自动补齐规则不还原成业务填的等级，否则会越滚越多
    if (String(r.ruleId || '').includes('_GR_AUTO_')) continue
    const scaleName = r.assessmentCode ? (ctx.nameByCode.get(r.assessmentCode) || entryScale) : entryScale
    const conditions = parseCondition(r.when, r.assessmentCode || instruments[0]?.code, ctx, aliases, computedNames)
    if (!conditions) {
      drop(`等级「${r.levelName || r.level}」的判定条件`, r.when)
      continue
    }
    levels.push({
      name: r.levelName || r.level,
      scale: scaleName,
      conditions,
      redLine: Boolean(r.blocked),
      redLineAction: undefined,
      teacherMessage: messageByLevel.get(r.level) || undefined,
      resultNote: r.resultDescription || undefined,
      escalationCondition: r.escalationCondition || undefined,
      escalationTarget: r.escalationTarget || undefined,
      reAssessTrigger: r.reEvaluationTrigger || undefined
    })
  }
  // ⑥ 红线参数：向导按「每个红线等级一行」生成，这里把第一行的通知模板/处置要求挂到对应等级上
  const redLines: any[] = attr.redLines || []
  if (redLines.length) {
    const redLevel = levels.find((lv: any) => lv.redLine)
    if (redLevel) {
      if (redLines[0].notificationTemplate) redLevel.notificationTemplate = redLines[0].notificationTemplate
      if (redLines[0].requiredActions) redLevel.redLineAction = redLines[0].requiredActions
    }
  }
  for (const t of templates) {
    if (t.type !== 'summary') drop(`输出模板 ${t.code}`, `类型「${t.type}」——向导只生成 summary 类型`)
  }

  // ---------- 工具 ----------
  const WIZARD_TOOL_FIELDS = new Set([
    'code', 'name', 'form', 'symptoms', 'steps', 'severity', 'attributionCode', 'attributionCodes',
    'attributionLabel', 'toolTags', 'tags', 'scripts', 'prohibitions', 'duration', 'timePerSession',
    'structuredSteps', 'contraindicationRules', 'shortName', 'module', 'sourceRef', 'toolVersion',
    'expectedEffect', 'outputArtifact', 'applicableSchoolSection', 'targetUsers', 'dimensions', 'effectNote',
    // 下面这些是编译器填的默认值或向导已表达的业务字段，往返时不该报成「会丢失」
    'level', 'evidenceLevel', 'evidenceSource', 'reAssessmentIntervalDays',
    'preparationNeeded', 'materialsRequired', 'outcomeIndicators', 'failureCriteria',
    'prerequisiteToolCode', 'alternativeToolCode', 'advancedToolCode', 'crossModuleTags'
  ])
  const toolNameOf = (code: string | undefined) => (code && toolCodeToName.get(code)) || undefined
  const tools = (payloads.tool?.tools || []).map((t: any) => {
    const extra = Object.keys(t).filter(k => !WIZARD_TOOL_FIELDS.has(k) && t[k] !== undefined && t[k] !== '')
    if (extra.length) {
      drop(`工具《${t.name}》的附加字段`, extra.join('、'))
    }
    const attrCodes: string[] = t.attributionCodes?.length
      ? t.attributionCodes
      : (t.attributionCode ? String(t.attributionCode).split(/[;,]/) : [])
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
      // 与 steps 等长补齐：UI 按下标索引 stepDetails[si]，缺位会踩 undefined
      return steps.map((_: string, i: number) => details[i] || {})
    })()
    return {
      name: t.name,
      attributions: attrCodes.map(c => nameByAttrCode.get(c.trim()) || c.trim()).filter(Boolean),
      whenToUse: t.symptoms || '',
      steps: steps.length ? steps : ['（原内容未拆分步骤，请补充）'],
      stepDetails: steps.length ? stepDetails : [],
      form: ['exercise', 'script', 'checklist', 'framework', 'worksheet'].includes(t.form) ? t.form : 'framework',
      severity: ['low', 'medium', 'high', 'crisis'].includes(t.severity) ? t.severity : 'medium',
      script: t.scripts || undefined,
      prohibition: t.prohibitions || undefined,
      timePerSession: t.timePerSession || undefined,
      duration: t.duration || undefined,
      expectedEffect: t.expectedEffect || undefined,
      effectNote: t.effectNote || undefined,
      dimensions: (t.dimensions || []).map((c: string) => ctx.dimCodeToName.get(c) || c),
      reAssessmentIntervalDays: t.reAssessmentIntervalDays || undefined,
      evidenceSource: t.evidenceSource || undefined,
      crossModuleTags: t.crossModuleTags || [],
      prerequisiteTools: t.prerequisiteToolCode ? [toolNameOf(t.prerequisiteToolCode) || t.prerequisiteToolCode] : [],
      alternativeTools: t.alternativeToolCode ? [toolNameOf(t.alternativeToolCode) || t.alternativeToolCode] : [],
      advancedTools: t.advancedToolCode ? [toolNameOf(t.advancedToolCode) || t.advancedToolCode] : [],
      preparation: t.preparationNeeded || undefined,
      materials: t.materialsRequired || undefined,
      outcomeIndicator: t.outcomeIndicators || undefined,
      failureCriteria: t.failureCriteria || undefined,
      contraindications: (t.contraindicationRules || []).map((c: any) => ({
        condition: c.condition, type: c.type === 'block' ? 'block' : 'warn',
        description: c.description || undefined, alternative: c.alternativeSuggestion || undefined
      }))
    }
  })

  // ---------- 关键词 ----------
  const keywords = (payloads.keyword_route?.routes || []).map((r: any) => ({
    core: String(r.coreKeywords || '').split(/[;,；、]/).map((s: string) => s.trim()).filter(Boolean),
    expanded: String(r.expandedKeywords || '').split(/[;,；、]/).map((s: string) => s.trim()).filter(Boolean),
    exclude: Array.isArray(r.exclusionKeywords) ? r.exclusionKeywords : [],
    category: r.semanticCategory || undefined,
    scale: r.linkedAssessmentCode ? (ctx.nameByCode.get(r.linkedAssessmentCode) || undefined) : undefined,
    tool: r.linkedToolCode ? (toolCodeToName.get(r.linkedToolCode) || undefined) : undefined,
    matchMode: ['exact', 'fuzzy'].includes(r.matchMode) ? r.matchMode : 'fuzzy',
    risk: ['red', 'orange', 'yellow', 'none'].includes(r.riskLevel) ? r.riskLevel : 'yellow',
    contextConstraint: r.contextConstraint || undefined,
    description: r.description || undefined
  }))

  // ---------- 模块级默认（从库里第一份值推断，编译时应用到所有行） ----------
  const tool0: any = (payloads.tool?.tools || [])[0] || {}
  const red0: any = redLines[0] || {}
  const pick = (sources: any[], key: string): any =>
    sources.map(s => s?.[key]).find(v => v !== undefined && v !== null && v !== '')
  const defaults = {
    schoolSection: pick(instruments, 'applicableSchoolSection') || 'all',
    targetAudience: pick(instruments, 'targetAudience') || 'teacher',
    formType: pick(instruments, 'formType') || 'self_report',
    triggerMethod: pick(instruments, 'triggerMethod') || 'manual',
    frequency: pick(instruments, 'frequency') || 'per_case',
    resultVisibility: pick(instruments, 'resultVisibility') || 'teacher_only',
    responsibleRole: pick(instruments, 'responsibleRole') || '班主任',
    dataSensitivity: pick(instruments, 'dataSensitivity') || 'highly_sensitive',
    sourceType: pick(instruments, 'sourceType') || 'proprietary',
    evidenceLevel: (['A', 'B', 'C', 'D'].includes(tool0.evidenceLevel) ? tool0.evidenceLevel : 'B') as 'B',
    redLineScope: ['instrument', 'module', 'system'].includes(red0.scope) ? red0.scope : 'module',
    redLineActions: Array.isArray(red0.actions) && red0.actions.length ? red0.actions.join('；') : '暂停常规方案，转安全转介流程',
    redLineRecovery: red0.recoveryCondition || '专业评估确认风险解除后',
    redLineOwner: red0.responsibleRole || '班主任'
  }

  return {
    input: {
      module,
      version: bumpVersion(currentVersion || instruments[0]?.version || '1.0.0'),
      sourceRef: instruments[0]?.sourceRef || undefined,
      defaults,
      computedVariables,
      optionGroups: [...customGroups.values()],
      scales, attributions, evidences, levels, tools, keywords,
      defaultLevelName: fallback?.levelName || fallback?.level || '暂无明显信号',
      defaultMessage: messageByLevel.get(fallback?.level || 'none') || undefined
    } as WizardInput,
    unsupported,
    notes
  }
}

/** 载入后自动进一位，避免撞上版本唯一约束 */
function bumpVersion(v: string): string {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return '1.0.1'
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
}
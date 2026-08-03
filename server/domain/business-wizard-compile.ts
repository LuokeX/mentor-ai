/**
 * 业务填写向导 → 5 个标准库文件的编译逻辑。
 *
 * 边界：
 *   业务决定 —— 有哪几张量表、每题测什么、可能的原因、什么算命中、分几级、有哪些工具
 *   编译器补 —— 所有编码、所有默认值、维度的题号归属、选项组、优先级、严重度、条件表达式
 *
 * 产出 v4 精确列序的 sheet 行，再打包成 xlsx 走现有 parseModuleResourceFile。
 * 不新开导入路径，校验/投影/发布全部复用既有实现。
 *
 * 与 v4 模板完全对齐的约定：
 *   - 模块级重复列（适用学部/施测对象/证据等级/熔断参数等）取 input.defaults，按模板 ② 枚举取值；
 *   - ⑤e/⑩ 的「命中等级」用模板风险等级四档（red/orange/yellow/none），业务等级最多 4 个；
 *   - ⑤b 计算变量表达式按「依赖量表」的编码表把中文转成引擎语法；
 *   - 模板导入链不消费的死列（④ 题型/权重/是否必答/显示条件/数据用途/默认分值、③ 做完导向什么）
 *     不产生业务语义，保持模板能通过的最小占位。
 */
import XLSX from 'xlsx'
import type { LibraryType } from '../../shared/contracts'
import {
  DEFAULT_WIZARD_DEFAULTS,
  WIZARD_COMPARATORS,
  WIZARD_LEVEL_ENUM,
  WIZARD_MODULE_PREFIX,
  WIZARD_OPTION_GROUPS,
  type WizardCondition,
  type WizardInput
} from '../../shared/business-wizard'
import { V4_HEADERS } from './business-wizard'

const seq = (n: number) => String(n).padStart(2, '0')

interface CodeMap {
  scales: Map<string, string>
  /** key = `${量表名}||${维度中文名}` */
  dimensions: Map<string, string>
  /** key = `${量表名}||${题序号}` */
  questions: Map<string, string>
  attributions: Map<string, string>
  tools: Map<string, string>
}

/** 业务只写中文名，编码全部在这里生成。业务改名字时编码规则不变，跨版本能对上。 */
function buildCodeMap(input: WizardInput): CodeMap {
  const P = WIZARD_MODULE_PREFIX[input.module] || 'MOD'
  const map: CodeMap = {
    scales: new Map(), dimensions: new Map(), questions: new Map(),
    attributions: new Map(), tools: new Map()
  }
  input.scales.forEach((scale, i) => {
    map.scales.set(scale.name, `${P}_S${i + 1}`)
    const seen: string[] = []
    scale.questions.forEach((q, qi) => {
      map.questions.set(`${scale.name}||${qi + 1}`, `q${qi + 1}`)
      if (q.dimension && !seen.includes(q.dimension)) seen.push(q.dimension)
    })
    seen.forEach((dim, di) => map.dimensions.set(`${scale.name}||${dim}`, `${P}_S${i + 1}D${di + 1}`))
  })
  input.attributions.forEach((a, i) => map.attributions.set(a.name, `${P}_AT_${seq(i + 1)}`))
  input.tools.forEach((t, i) => map.tools.set(t.name, `${P}_RX_${seq(i + 1)}`))
  return map
}

/**
 * 把业务选的「看哪里 + 达到什么程度」拼成引擎认识的条件。
 * 业务全程不接触表达式语法，也就写不出方向相反或语法错误的条件。
 */
function toExpression(conditions: WizardCondition[], scaleName: string, codes: CodeMap): string {
  return conditions.map((c, index) => {
    let left: string
    if (c.targetType === 'total') left = '总分'
    else if (c.targetType === 'average') left = '均分'
    else if (c.targetType === 'computed') left = c.target
    else if (c.targetType === 'dimension') left = `维度[${codes.dimensions.get(`${scaleName}||${c.target}`) || c.target}]`
    else left = `题[${codes.questions.get(`${scaleName}||${c.target}`) || c.target}]`
    const piece = `${left} ${WIZARD_COMPARATORS[c.comparator] || '>='} ${c.value}`
    return index === 0 ? piece : `${c.join === '或' ? '或' : '且'} ${piece}`
  }).join(' ')
}

/** ③ 的触发条件引用的是「前一张量表的结果」，必须用跨量表语法 量表[X].xxx。
 *  运行期 evaluateTriggerCondition 的变量表是空的，触发条件引用计算变量会永远「不满足」，
 *  所以这里对 computed 目标直接返回 null，由调用方报错。 */
function toCrossScaleExpression(conditions: WizardCondition[], sourceScale: string, codes: CodeMap): string | null {
  const code = codes.scales.get(sourceScale) || sourceScale
  const parts = conditions.map((c, index) => {
    let left: string
    if (c.targetType === 'total') left = `量表[${code}].总分`
    else if (c.targetType === 'average') left = `量表[${code}].均分`
    else if (c.targetType === 'computed') return null
    else if (c.targetType === 'dimension') left = `量表[${code}].维度[${codes.dimensions.get(`${sourceScale}||${c.target}`) || c.target}]`
    else left = `量表[${code}].题[${codes.questions.get(`${sourceScale}||${c.target}`) || c.target}]`
    const piece = `${left} ${WIZARD_COMPARATORS[c.comparator] || '>='} ${c.value}`
    return index === 0 ? piece : `${c.join === '或' ? '或' : '且'} ${piece}`
  })
  return parts.includes(null) ? null : parts.join(' ')
}

/** ⑤b 计算变量：业务中文写法 → 引擎语法。维度[中文名]→维度[编码]，题[序号]→题[qN]。 */
function toEngineExpression(expr: string, scaleName: string, codes: CodeMap): string {
  const dim = expr.replace(/维度\s*\[\s*([^\]\s]+?)\s*\]/g, (_, raw: string) => {
    const name = raw.trim()
    const code = codes.dimensions.get(`${scaleName}||${name}`)
    return code ? `维度[${code}]` : `维度[${name}]`
  })
  return dim.replace(/题\s*\[\s*(\d+)\s*\]/g, '题[q$1]')
}

/** 维度中文名 → 编码（跨量表取第一个命中；同名歧义由调用方提示） */
function dimensionCodeByName(codes: CodeMap, name: string): string | undefined {
  for (const [key, code] of codes.dimensions) {
    if (key.split('||')[1] === name) return code
  }
  return undefined
}

/** 严重度按等级从重到轻分配。业务只需要把等级排好序。 */
const SEVERITY_LADDER = ['crisis', 'high', 'medium', 'low'] as const

export interface CompiledLibrary {
  libraryType: LibraryType
  label: string
  sheets: Array<{ name: string, rows: string[][] }>
  /** 可直接喂给 parseModuleResourceFile 的 xlsx */
  buffer: Buffer
}

export interface CompileResult {
  libraries: CompiledLibrary[]
  codes: Array<{ kind: string, name: string, code: string }>
  /** 给业务确认用的纯中文回读稿，不含任何编码 */
  readback: string[]
  /** 编译阶段就能发现的问题，用业务听得懂的话说 */
  issues: Array<{ severity: 'error' | 'warning', message: string }>
}

const LIBRARY_LABEL: Record<string, string> = {
  assessment: '量表库', attribution: '归因库', tool: '工具库',
  keyword_route: '关键词路由库', output_template: '输出模板库'
}

export function compileWizardInput(input: WizardInput): CompileResult {
  const P = WIZARD_MODULE_PREFIX[input.module] || 'MOD'
  // zod 的 default({}) 不深展开字段默认值，这里统一兜底
  const d = { ...DEFAULT_WIZARD_DEFAULTS, ...(input.defaults || {}) }
  const codes = buildCodeMap(input)
  const issues: CompileResult['issues'] = []
  const add = (severity: 'error' | 'warning', message: string) => issues.push({ severity, message })
  const ref = input.sourceRef || '业务填写向导'

  // ---------- 等级编码：模板风险等级四档，按从重到轻顺序分配 ----------
  if (input.levels.length > WIZARD_LEVEL_ENUM.length) {
    add('warning', `等级填了 ${input.levels.length} 个，超过了模板风险等级的四档（红/橙/黄/兜底）。`
      + `第 4 档之后的等级会和前面的共用等级编码，系统文案会互相覆盖，建议合并等级。`)
  }
  const levelEnum = input.levels.map((_, i) => WIZARD_LEVEL_ENUM[Math.min(i, WIZARD_LEVEL_ENUM.length - 1)]!)
  if (levelEnum.includes('none')) {
    add('warning', `第 ${levelEnum.indexOf('none') + 1} 档等级与「都不满足」的兜底共用 none 编码，`
      + `命中这一档时输出的是兜底文案，建议把等级合并到三档以内。`)
  }

  // ---------- ③ 量表-清单 ----------
  const entry = input.scales.filter(s => s.role === '入口筛查')
  if (entry.length !== 1) {
    add('error', `每个模块需要恰好一张「入口筛查」量表（老师进来先做的那张），现在有 ${entry.length} 张。`)
  }
  const s3: string[][] = []
  for (const scale of input.scales) {
    const code = codes.scales.get(scale.name)!
    const prereq = scale.prerequisites.map(n => codes.scales.get(n) || n)
    const source = scale.prerequisites[0] || entry[0]?.name
    const rawTrigger = scale.role === '入口筛查' || !scale.triggerConditions.length || !source
      ? ''
      : toCrossScaleExpression(scale.triggerConditions, source, codes)
    if (scale.role !== '入口筛查' && rawTrigger === null) {
      add('error', `量表《${scale.name}》的触发条件里引用了计算变量——` +
        `触发条件只看前一张量表的结果，变量在推荐环节算不出来，请改用维度或题目。`)
    }
    const trigger = rawTrigger || ''
    s3.push([
      code, scale.name, scale.shortName || scale.name.slice(0, 8), input.module,
      d.schoolSection, scale.applicableGrades.join(','), scale.applicableSubjects.join(','),
      d.targetAudience, d.formType, d.triggerMethod, d.frequency,
      scale.role === '入口筛查' ? '是' : '否',
      String(scale.minutes || Math.max(1, Math.ceil(scale.questions.length / 2))),
      String(scale.timeLimitMinutes || ''), String(scale.minQuestions || ''),
      scale.usageTiming || '', String(scale.reAssessmentIntervalDays || ''),
      prereq.join(','), scale.exclusives.map(n => codes.scales.get(n) || n).join(','),
      trigger, scale.triggerNote || '',
      d.resultVisibility, d.responsibleRole, d.dataSensitivity, d.sourceType, '',
      ref, input.version,
      scale.description || `${scale.name}（${scale.questions.length}题）`,
      scale.normReference || '', scale.reliabilityNote || '', scale.validityNote || '',
      scale.privacyNotice || '', scale.applicabilityPreconditions || '',
      scale.contraindications || '', scale.postAssessmentActions || '',
      scale.role, scale.role === '入口筛查' ? '决定要不要往下做深度诊断' : '定位薄弱维度，匹配对应工具'
    ])
    if (scale.role !== '入口筛查' && !prereq.length) {
      add('warning', `量表《${scale.name}》不是入口筛查，但没指定「要先做完哪张」。老师可能在没有基线的情况下直接做它。`)
    }
    if (scale.role !== '入口筛查' && !trigger) {
      add('warning', `量表《${scale.name}》没填「什么情况下才建议做」，它会对每位老师都显示「随时可做」，深度量表因此失去意义。`)
    }
  }

  // ---------- ④ / ④b / ④c ----------
  const s4: string[][] = []
  const s4b: string[][] = []
  const s4c: string[][] = []
  const groups = new Set<string>()
  // 自定义选项组的编码：按引用顺序分配，模板 S02 要求编码只用 ASCII
  const customGroupCodes = new Map<string, string>()
  let optSeq = 0
  const groupCodeOf = (id: string): string | null => {
    if ((WIZARD_OPTION_GROUPS as Record<string, any>)[id]) return id
    if (customGroupCodes.has(id)) return customGroupCodes.get(id)!
    const def = input.optionGroups.find(g => g.id === id)
    if (!def) return null
    optSeq++
    const code = `${P}_OPT_${seq(optSeq)}`
    customGroupCodes.set(id, code)
    return code
  }
  for (const scale of input.scales) {
    const code = codes.scales.get(scale.name)!
    const byDim = new Map<string, string[]>()
    scale.questions.forEach((q, qi) => {
      const qid = `q${qi + 1}`
      groups.add(q.optionGroup)
      const groupCode = groupCodeOf(q.optionGroup)
      if (!groupCode) {
        add('error', `量表《${scale.name}》第 ${qi + 1} 题引用的选项组不存在，请先在「自定义选项组」里定义它或改回预置选项。`)
      }
      s4.push([code, qid, 'single', q.dimension, '', q.text, '', groupCode || q.optionGroup,
        q.reverse ? '是' : '否', '1', '是', '', 'compute', q.help || '', '', ''])
      if (!byDim.has(q.dimension)) byDim.set(q.dimension, [])
      byDim.get(q.dimension)!.push(qid)
    })
    // ④c 的「所属题号列表」从题目反推，业务不用手工维护两处
    for (const [dim, qids] of byDim) {
      const def = scale.dimensionDefs.find(x => x.name === dim)
      s4c.push([code, codes.dimensions.get(`${scale.name}||${dim}`) || dim, dim,
        qids.join(','), def?.calcMethod || 'mean', String(def?.weight ?? 1),
        def?.description || '', def?.highInterpretation || '', def?.lowInterpretation || '',
        def?.normMean != null ? String(def.normMean) : '', def?.normStd != null ? String(def.normStd) : ''])
    }
    // 业务在 ④c 里声明了维度但题目里没有对应题目，属于笔误，明说
    for (const def of scale.dimensionDefs) {
      if (!byDim.has(def.name)) {
        add('warning', `量表《${scale.name}》给维度「${def.name}」填了属性，但没有题目属于这个维度，属性不会生效。`)
      }
    }
  }
  for (const g of groups) {
    const preset = (WIZARD_OPTION_GROUPS as Record<string, any>)[g]
    if (preset) {
      preset.options.forEach((label: string, i: number) => s4b.push([g, String(i + 1), label, String(preset.base + i)]))
      continue
    }
    // 自定义组：只有被题目引用且解析成功的组才会生成（未定义的已在上面报 error）
    const code = customGroupCodes.get(g)
    const def = input.optionGroups.find(x => x.id === g)
    if (!code || !def) continue
    def.options.forEach((o, i) => s4b.push([code, String(i + 1), o.label, String(o.score ?? i + 1)]))
  }

  // ---------- ⑤b 归因-计算变量 ----------
  const s5b: string[][] = []
  for (const v of input.computedVariables) {
    const scaleCode = codes.scales.get(v.scale)
    if (!scaleCode) {
      add('error', `计算变量「${v.name}」写的量表《${v.scale}》不存在，请检查名称是否一致。`)
      continue
    }
    const expression = toEngineExpression(v.expression, v.scale, codes)
    // 依赖量表编码供反向编译还原中文写法；依赖题号/维度编码是模板的可选说明列，留空
    s5b.push([v.name, input.module, expression, '', scaleCode, '', ''])
  }

  // ---------- ⑤c 归因项 ----------
  const s5c = input.attributions.map(a => [
    codes.attributions.get(a.name)!, a.name, input.module, String(a.weight),
    [...new Set([...a.tags, input.module])].join(','),
    a.description || '', a.highSign || '', a.typicalTrigger || '', a.action || '', ref
  ])

  // ---------- ⑤d 证据规则 ----------
  const s5d: string[][] = []
  input.evidences.forEach((e, i) => {
    const attr = codes.attributions.get(e.attribution)
    const scale = codes.scales.get(e.scale)
    if (!attr) add('error', `「什么算命中」里写的原因「${e.attribution}」不在原因清单里，请先添加它。`)
    if (!scale) add('error', `「什么算命中」里写的量表《${e.scale}》不存在，请检查名称是否一致。`)
    s5d.push([`${P}_EV_${seq(i + 1)}`, attr || e.attribution, scale || e.scale,
      toExpression(e.conditions, e.scale, codes), String(e.weight),
      e.description || `命中「${e.attribution}」的信号`, ref])
  })
  for (const a of input.attributions) {
    if (!input.evidences.some(e => e.attribution === a.name)) {
      add('error', `原因「${a.name}」没有填任何「什么算命中」，它永远不会被算出来，等于白填。`)
    }
  }

  // ---------- ⑤e 分级 + ⑥ 红线 + ⑩ 输出模板 ----------
  const s5e: string[][] = []
  const s6: string[][] = []
  const s10: string[][] = []
  const defaultScale = entry[0]?.name || input.scales[0]!.name
  const hasRedLine = input.levels.some(l => l.redLine)
  const templateCode = (level: string, seqNo: number) =>
    `TPL_${P}_${level === 'none' ? 'DEFAULT' : level.toUpperCase()}_${seqNo}`
  input.levels.forEach((lv, i) => {
    const levelCode = `L${i + 1}`
    const level = levelEnum[i]!
    const scaleName = lv.scale || defaultScale
    const severity = lv.redLine ? 'crisis' : SEVERITY_LADDER[Math.min(hasRedLine ? i : i + 1, 3)]!
    const cond = toExpression(lv.conditions, scaleName, codes)
    s5e.push([`${P}_GR_${seq(i + 1)}`, input.module, codes.scales.get(scaleName) || '',
      String((i + 1) * 10), cond, level, lv.name, severity,
      lv.redLine ? '是' : '否', lv.resultNote || lv.name,
      lv.escalationCondition || '', lv.escalationTarget || '', lv.reAssessTrigger || '', ref])
    if (lv.teacherMessage) {
      s10.push([templateCode(level, i + 1), input.module, level, 'summary', lv.teacherMessage,
        '可用占位符见 ⑩ 说明', String(i + 1)])
    } else {
      add('warning', `等级「${lv.name}」没填「系统跟老师怎么说」，判到这一级时只能用系统内置的通用文案。`)
    }
    if (lv.redLine) {
      s6.push([input.module, cond, lv.resultNote || `命中「${lv.name}」，需立即启动安全流程`, d.redLineScope,
        lv.redLineAction || '立即联系校内心理专员并同步年级组',
        d.redLineActions, d.redLineRecovery, d.redLineOwner, lv.notificationTemplate || '', ref])
    }
  })
  // 每张量表都必须有「能判出非兜底等级」的规则。
  // 业务通常只为入口量表定了等级，深度量表就只剩模块兜底——
  // 做完它无论怎么答都是同一个等级，归因说「对立严重」而等级永远是「常规」。
  // 这里为缺规则的量表补一套均分阶梯，并明确告诉业务这是系统补的、需要复核。
  const scopedScales = new Set(input.levels.map(lv => codes.scales.get(lv.scale || defaultScale)))
  const AUTO_THRESHOLDS = [4, 3.5, 3]
  let autoSeq = 0
  for (const scale of input.scales) {
    const code = codes.scales.get(scale.name)!
    if (scopedScales.has(code)) continue
    const ladder = input.levels.filter(lv => !lv.redLine)
    ladder.forEach((lv, i) => {
      const threshold = AUTO_THRESHOLDS[Math.min(i, AUTO_THRESHOLDS.length - 1)]!
      autoSeq++
      const idx = input.levels.indexOf(lv)
      s5e.push([`${P}_GR_AUTO_${seq(autoSeq)}`, input.module, code,
        String(500 + autoSeq), `均分 >= ${threshold}`, levelEnum[idx]!, lv.name,
        SEVERITY_LADDER[Math.min(hasRedLine ? idx : idx + 1, 3)]!,
        '否', lv.resultNote || lv.name, '', '', '', ref])
    })
    if (ladder.length) {
      add('warning', `量表《${scale.name}》没有自己的分级规则，系统按「平均分 ≥ ${AUTO_THRESHOLDS.slice(0, ladder.length).join(' / ')}」自动补了一套。`
        + '请确认这个阈值符合业务判断，不合适的话回到「分几级」那一步为它单独设定。')
    }
  }

  // 兜底：优先级必须是最大值，否则会吃掉全部作答让前面的规则永远执行不到
  s5e.push([`${P}_GR_DEFAULT`, input.module, '', '999', '', 'none',
    input.defaultLevelName, 'low', '否', '本次评估未发现需要重点干预的信号', '', '', '', ref])
  s10.push([`TPL_${P}_DEFAULT`, input.module, 'none', 'summary',
    input.defaultMessage || '本次评估未发现需要重点干预的信号，当前状态相对平稳，建议保持现有节奏。',
    '兜底模板：命中未覆盖等级时使用', '99'])

  // ---------- ⑦ / ⑦b / ⑧ ----------
  const s7: string[][] = []
  const s7b: string[][] = []
  const s8: string[][] = []
  input.tools.forEach((t) => {
    const code = codes.tools.get(t.name)!
    const attrCodes = t.attributions.map(n => {
      const c = codes.attributions.get(n)
      if (!c) add('error', `工具《${t.name}》对应的原因「${n}」不在原因清单里。`)
      return c || n
    })
    const tags = [...new Set([
      ...t.attributions.flatMap(n => input.attributions.find(a => a.name === n)?.tags || []),
      input.module
    ])]
    // 作用维度：中文名转编码；同名维度跨量表存在时取第一个并提示
    const dimCodes = t.dimensions.map(n => {
      const c = dimensionCodeByName(codes, n)
      if (!c) {
        add('warning', `工具《${t.name}》的作用维度「${n}」在现有量表的维度里找不到，已原样保留，可能匹配不上。`)
        return n
      }
      return c
    })
    const toolCodeOf = (names: string[]) => {
      if (!names.length) return ''
      if (names.length > 1) {
        add('warning', `工具《${t.name}》的前置/替代/进阶工具只支持填一个，已取第一个「${names[0]}」。`)
      }
      const c = codes.tools.get(names[0]!)
      if (!c) add('error', `工具《${t.name}》引用的工具「${names[0]}」不在工具清单里。`)
      return c || ''
    }
    s7.push([code, t.name, t.name.slice(0, 8), input.module, t.form, d.schoolSection, d.targetAudience,
      t.whenToUse, t.severity, attrCodes.join(';'), t.attributions.join(';'), tags.join(','),
      dimCodes.join(';'), t.effectNote || '', t.steps.join('；'), t.script || '',
      t.expectedEffect || '一次执行记录',
      t.timePerSession || '', t.duration || '',
      t.reAssessmentIntervalDays != null ? String(t.reAssessmentIntervalDays) : '',
      t.prohibition || '不用于替代危机处置', '', toolCodeOf(t.prerequisiteTools),
      toolCodeOf(t.alternativeTools), toolCodeOf(t.advancedTools),
      d.evidenceLevel, t.evidenceSource || '', t.outcomeIndicator || '', t.failureCriteria || '',
      t.preparation || '', t.materials || '', '执行记录', '', ref, input.version,
      t.crossModuleTags.join(';')])
    t.steps.forEach((s, si) => {
      const detail = t.stepDetails[si]
      s7b.push([code, String(si + 1), s.slice(0, 24), s,
        detail?.estimatedTime || '', detail?.materials || '', detail?.keyTip || '',
        detail?.scriptTemplate || '', detail?.successCriteria || '', detail?.commonIssues || ''])
    })
    for (const c of t.contraindications) {
      s8.push([code, c.condition, c.type, c.description || c.condition, c.alternative || '',
        d.responsibleRole, ref])
    }
  })

  // ---------- ⑨ 关键词-路由 ----------
  const s9: string[][] = []
  input.keywords.forEach((k, i) => {
    const scaleCode = k.scale ? (codes.scales.get(k.scale) || '') : ''
    if (k.scale && !scaleCode) add('error', `关键词「${k.core.join('、')}」关联的量表《${k.scale}》不存在。`)
    let toolCode = ''
    if (k.tool) {
      toolCode = codes.tools.get(k.tool) || ''
      if (!toolCode) add('error', `关键词「${k.core.join('、')}」关联的工具《${k.tool}》不存在。`)
    }
    s9.push([`${P}_KW_${seq(i + 1)}`, k.core.join(';'), k.expanded.join(';'), k.exclude.join(';'),
      input.module, String(i + 1), k.matchMode, k.risk, k.category || '',
      scaleCode, toolCode, k.contextConstraint || '', '0.8', 'always', k.description || ''])
  })

  const sheet = (name: string, rows: string[][]) => ({ name, rows: [V4_HEADERS[name]!, ...rows] })
  const pack = (libraryType: LibraryType, sheets: Array<{ name: string, rows: string[][] }>): CompiledLibrary => {
    const wb = XLSX.utils.book_new()
    for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name)
    return {
      libraryType, label: LIBRARY_LABEL[libraryType]!, sheets,
      buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    }
  }

  return {
    libraries: [
      pack('assessment', [sheet('③ 量表-清单', s3), sheet('④ 量表-题目', s4),
        sheet('④b 量表-选项组', s4b), sheet('④c 量表-维度定义', s4c)]),
      pack('attribution', [sheet('⑤b 归因-计算变量', s5b), sheet('⑤c 归因项', s5c),
        sheet('⑤d 证据规则', s5d), sheet('⑤e 分级规则', s5e), sheet('⑥ 归因-红线熔断', s6)]),
      pack('tool', [sheet('⑦ 工具-处方总表', s7), sheet('⑦b 工具-步骤明细', s7b), sheet('⑧ 工具-禁忌规则', s8)]),
      pack('keyword_route', [sheet('⑨ 关键词-路由', s9)]),
      pack('output_template', [sheet('⑩ 方案输出模板', s10)])
    ],
    codes: [
      ...[...codes.scales].map(([name, code]) => ({ kind: '量表', name, code })),
      ...[...codes.attributions].map(([name, code]) => ({ kind: '原因', name, code })),
      ...[...codes.tools].map(([name, code]) => ({ kind: '工具', name, code }))
    ],
    readback: buildReadback(input),
    issues
  }
}

/**
 * 回读稿：把系统将会怎么判断，用业务本来就在说的话复述一遍。
 * 业务读这段就能确认理解没跑偏，完全不需要看懂编码、表达式和权重。
 */
/** 把 ${主要归因} 这类占位符换成业务看得懂的说法 */
function humanizePlaceholders(text: string): string {
  return text
    .replace(/\$\{主要归因\}/g, '〔这里会自动填入算出来的主要原因〕')
    .replace(/\$\{次要归因\}/g, '〔这里会自动填入次要原因〕')
    .replace(/\$\{[^}]+\}/g, '〔自动填入〕')
}

/** 计算变量表达式转人话：「维度[配合度] + 题[2]」→「「配合度」维度的分 加 第 2 题的分」 */
function humanizeExpression(expr: string): string {
  return expr
    .replace(/维度\s*\[\s*([^\]\s]+?)\s*\]/g, '「$1」维度的分')
    .replace(/题\s*\[\s*q?(\d+)\s*\]/g, '第 $1 题的分')
    .replace(/\s*[+]\s*/g, ' 加 ')
    .replace(/\s*[-]\s*/g, ' 减 ')
    .replace(/\s*[*×]\s*/g, ' 乘 ')
    .replace(/\s*[/÷]\s*/g, ' 除 ')
}

function buildReadback(input: WizardInput): string[] {
  const out: string[] = []
  const describe = (c: WizardCondition) => {
    const where = c.targetType === 'total' ? '总分'
      : c.targetType === 'average' ? '平均分'
        : c.targetType === 'dimension' ? `「${c.target}」维度的分`
          : `第 ${c.target} 题的分`
    return `${where}${c.comparator} ${c.value} 分`
  }
  const chain = (list: WizardCondition[]) => list.length
    ? list.map((c, i) => (i === 0 ? '' : c.join === '或' ? '或者 ' : '并且 ') + describe(c)).join('')
    : '（未设条件）'

  out.push('老师进入这个模块后，系统会这样做：')
  out.push('')
  const entry = input.scales.find(s => s.role === '入口筛查')
  if (entry) out.push(`① 先让老师做《${entry.name}》（${entry.questions.length} 道题）。`)
  for (const scale of input.scales) {
    if (scale.role === '入口筛查') continue
    const pre = scale.prerequisites.join('》《') || entry?.name || '入口量表'
    out.push(`② 做完《${pre}》之后，如果 ${chain(scale.triggerConditions)}，`)
    out.push(`   系统才建议再做《${scale.name}》。不满足就标「当前不需要做」，老师仍可手动选。`)
  }
  if (input.computedVariables.length) {
    out.push('')
    out.push('另外，系统还会额外算这几个指标（计算变量）：')
    for (const v of input.computedVariables) {
      out.push(`   「${v.name}」= ${humanizeExpression(v.expression)}（按《${v.scale}》的作答计算）`)
    }
  }
  out.push('')
  out.push('③ 系统按下面的规则找原因：')
  for (const a of input.attributions) {
    out.push(`   「${a.name}」`)
    for (const e of input.evidences.filter(x => x.attribution === a.name)) {
      out.push(`      · 当 ${chain(e.conditions)} 时，算命中一次（分量 ${e.weight}）`)
    }
    if (a.action) out.push(`      · 命中后给老师的建议：${a.action}`)
  }
  out.push('   命中越多、分量越大的原因排得越前。老师看到的是「主要原因 / 次要原因」，看不到具体分数。')
  out.push('')
  out.push('④ 系统按下面的规则定等级（从上往下匹配，第一条命中就停）：')
  for (const lv of input.levels) {
    out.push(`   · 当 ${chain(lv.conditions)} → 判为「${lv.name}」${lv.redLine ? '【触发红线：不出方案，直接转安全流程】' : ''}`)
    // 占位符对业务是天书，回读稿里换成人话
    if (lv.teacherMessage) out.push(`     系统跟老师说：${humanizePlaceholders(lv.teacherMessage)}`)
  }
  out.push(`   · 以上都不满足 → 判为「${input.defaultLevelName}」`)
  out.push('')
  out.push('⑤ 系统按「命中的原因」推荐工具：')
  for (const t of input.tools) {
    out.push(`   《${t.name}》—— 命中「${t.attributions.join('、')}」时推荐。${t.whenToUse}`)
    const blocks = t.contraindications.filter(c => c.type === 'block')
    if (blocks.length) out.push(`     但 ${blocks.map(c => c.condition).join('、')} 时，这个工具会被直接排除。`)
  }
  if (input.keywords.length) {
    out.push('')
    out.push('⑥ 老师在对话里说到这些词时，系统会直接引导他进这个模块：')
    for (const k of input.keywords) {
      out.push(`   ${k.core.join('、')}${k.scale ? ` → 建议做《${k.scale}》` : ''}${k.tool ? `，推荐《${k.tool}》` : ''}`)
    }
  }
  return out
}
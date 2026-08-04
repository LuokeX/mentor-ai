#!/usr/bin/env node
/**
 * 生成《三库填写讲解与计算推演》工作簿。
 *
 * 设计要点：
 * 1. 不改 v4 模板的任何字段和填写规则——标准 sheet 的名称、列名、列序与
 *    business-libraries/templates/三库填写模板_v4.xlsx 完全一致。
 * 2. 用真实的「班主任状态五问」（scripts/test-data/modules.mjs 里 self_growth 的内容，
 *    也就是 business-libraries/test-data/self_growth/ 那份）把标准 sheet 填满，
 *    所以这个文件本身可以直接导入五次（每次选一个库类型）。
 * 3. 讲解 sheet 一律用「使用说明」前缀。两条导入路径都会跳过这类 sheet：
 *    - 后台上传：module-resource-file-import.ts 显式 filter 掉 /使用说明|字段映射/
 *    - CLI 导入：transformers 用 findSheet 按实义名匹配，不会命中
 * 4. 推演里的每个数字都由本脚本现场调用真实引擎算出，不是手写的常量，
 *    所以引擎逻辑一改，重跑本脚本演示就跟着更新，不会出现讲解与系统脱节。
 *
 * 用法：node scripts/build-filling-guide.mjs
 */

import XLSX from 'xlsx'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { MODULES, OPTION_GROUPS } from './test-data/modules.mjs'
import { executeRules } from '../server/domain/rules-executor.ts'
import { scoreTools } from '../server/domain/plan-actions.ts'

const OUT = resolve('business-libraries/templates/三库填写讲解与计算推演_班主任状态五问.xlsx')
const M = MODULES.find(m => m.code === 'self_growth')
const SCALE = M.scales.find(s => s.code === 'SG_FIVE_Q')

// ===================================================================
// 把 modules.mjs 的内容转成 v3 标准 sheet 的行（与 generate-test-data.mjs 同源逻辑）
// ===================================================================

const instrumentRows = M.scales.map(s => [
  s.code, s.title, s.shortName, M.code, 'all', 'teacher', 'self_report',
  'manual', s.frequency, s.required ? '是' : '否', String(s.minutes),
  'teacher_only', 'sensitive', 'proprietary', `${M.label}手册v1`, '1.0.0', s.description,
])

const questionRows = []
const dimRows = []
for (const s of M.scales) {
  for (const [id, dimCode, text, reverse] of s.questions) {
    const dim = s.dimensions.find(d => d.code === dimCode)
    questionRows.push([s.code, id, 'single', dim ? dim.name : dimCode, text,
      s.optionGroup, reverse ? '是' : '否', '1', '是', 'compute'])
  }
  for (const d of s.dimensions) {
    dimRows.push([s.code, d.code, d.name, d.questionIds.join(','), 'mean', '1',
      `${d.name}维度`, d.high, d.low])
  }
}

const attributionItemRows = M.attributions.map(a => [
  a.code, a.name, M.code, String(a.weight), a.tags, a.desc, a.high, a.trigger, a.action, `${M.label}手册v1`,
])
const evidenceRows = M.evidences.map(([code, at, scale, cond, weight, desc]) => [
  code, at, scale, cond, String(weight), desc, `${M.label}手册v1`,
])
const gradingRows = M.gradingRules.map(([id, scale, pri, when, level, levelName, severity, blocked, desc, esc, escTarget, reEval, ...rest]) => [
  id, M.code, scale, String(pri), when, level, levelName, severity,
  blocked ? '是' : '否', desc, esc, escTarget, reEval,
  rest[0] || '', rest[1] || '', `${M.label}手册v1`,
])
const redLineRows = M.redLines.map(([cond, desc, scope, required, actions, recovery, role, notice]) => [
  M.code, cond, desc, scope, required, actions, recovery, role, notice, `${M.label}手册v1`,
])
const toolRows = M.tools.map(t => [
  t.code, t.name, t.short, M.code, t.form, 'all', 'teacher',
  t.scene, t.severity, t.at, M.attributions.find(a => a.code === t.at)?.name || '',
  t.tags, t.dims, t.effect, t.steps.join('\n'), t.script, t.expect, t.time, t.cycle, '30',
  t.forbid, '', '', '', '', t.evidence, t.source, t.indicator, t.fail,
  '准备记录表', '记录表', '一次执行记录', '', `${M.label}手册v1`, '1.0.0', '',
])
const stepRows = []
for (const t of M.tools) {
  t.steps.forEach((step, i) => stepRows.push([
    t.code, String(i + 1), step.length > 12 ? step.slice(0, 12) : step, step,
    '', '', i === 0 ? '这一步决定后面能不能走下去' : '', i === 0 ? t.script : '',
    '完成本步骤描述的动作', '',
  ]))
}
const contraRows = []
for (const t of M.tools) {
  for (const [cond, type, desc, alt] of t.contra || []) {
    contraRows.push([t.code, cond, type, desc, alt, '班主任', `${M.label}手册v1`])
  }
}
const routeRows = M.routes.map(([code, core, expand, exclude, pri, mode, risk, cat, scale, tool, weight, desc]) => [
  code, core, expand, exclude, M.code, String(pri), mode, risk, cat, scale, tool, '', String(weight), 'always', desc,
])
const templateRows = M.templates.map(([level, type, content], i) => [
  `${M.code.toUpperCase()}_TPL_${level.toUpperCase()}_${type.toUpperCase()}`, M.code, level, type, content,
  '${主要归因} 替换为占比最高的归因名称；${次要归因} 替换为第 2-3 条归因名称', String(i + 1),
])

// ===================================================================
// 用真引擎算三位教师的推演
// ===================================================================

const attributionConfig = {
  module: M.code,
  version: '1.0.0',
  computed: Object.fromEntries(M.computed.map(([name, expr]) => [name, expr])),
  attributionItems: M.attributions.map(a => ({
    code: a.code, name: a.name, module: M.code, baseWeight: a.weight,
    toolTags: a.tags.split(',').map(s => s.trim()).filter(Boolean),
    suggestedAction: a.action,
  })),
  evidences: M.evidences.map(([code, at, scale, cond, weight, desc]) => ({
    evidenceCode: code, attributionCode: at, assessmentCode: scale,
    condition: cond, weight, description: desc,
  })),
  gradingRules: M.gradingRules.map(([id, scale, pri, when, level, levelName, severity, blocked, desc]) => ({
    ruleId: id, assessmentCode: scale || undefined, pri, when: when || undefined,
    level, levelName, severity, blocked, resultDescription: desc,
  })),
  scoring: { maxAttributions: 3, minShare: 0.05, secondaryRankCutoff: 3 },
  actions: [],
  tools: [],
  redLines: M.redLines.map(([cond, desc, scope, required, actions]) => ({
    module: M.code, condition: cond, description: desc, scope,
    requiredActions: required, actions: actions.split(',').map(s => s.trim()).filter(Boolean),
  })),
}

const optionsFor = (groupCode) => OPTION_GROUPS
  .filter(r => r[0] === groupCode)
  .map(r => ({ label: r[2], value: Number(r[3]) }))

const definition = {
  code: SCALE.code, instrumentCode: SCALE.code, version: '1.0.0', module: M.code,
  title: SCALE.title, description: SCALE.description, estimatedMinutes: SCALE.minutes,
  questions: SCALE.questions.map(([id, dimCode, text, reverse]) => ({
    id, text, dimension: SCALE.dimensions.find(d => d.code === dimCode)?.name || dimCode,
    reverse, options: optionsFor(SCALE.optionGroup),
  })),
  dimensionDefs: SCALE.dimensions.map(d => ({
    code: d.code, name: d.name, questionIds: d.questionIds, calcMethod: 'mean', weight: 1,
  })),
}

const CASES = [
  { who: '张老师', hint: '各项都处于高位', answers: { q1: 5, q2: 5, q3: 1, q4: 1, q5: 5 } },
  { who: '李老师', hint: '意义感和效能偏低，其余中等', answers: { q1: 3, q2: 3, q3: 2, q4: 2, q5: 2 } },
  { who: '王老师', hint: '整体状态平稳', answers: { q1: 2, q2: 1, q3: 4, q4: 3, q5: 1 } },
]

const toolPayload = M.tools.map(t => ({
  code: t.code, name: t.name, severity: t.severity,
  attributionCode: t.at,
  toolTags: t.tags.split(',').map(s => s.trim()).filter(Boolean),
  dimensions: t.dims.split(',').map(s => s.trim()).filter(Boolean),
  steps: t.steps, scripts: t.script, prohibitions: t.forbid,
}))

const results = CASES.map(cs => {
  const r = executeRules(attributionConfig, cs.answers, definition)
  const matched = scoreTools(toolPayload, {
    dimensions: r.dimensions, severity: r.severity,
    attributions: r.attributions.map(a => ({ code: a.code, share: a.share })),
    toolTags: r.toolTags,
  }).slice(0, 5)
  return { ...cs, r, matched }
})

const qIds = SCALE.questions.map(q => q[0])
const reverseOf = Object.fromEntries(SCALE.questions.map(([id, , , rev]) => [id, rev]))
const optVals = optionsFor(SCALE.optionGroup).map(o => o.value)
const OPT_MIN = Math.min(...optVals)
const OPT_MAX = Math.max(...optVals)
const scoreOf = (id, raw) => reverseOf[id] ? OPT_MIN + OPT_MAX - raw : raw

// ===================================================================
// 讲解 sheet
// ===================================================================

const guideOverview = [
  ['《三库填写讲解与计算推演》— 以「班主任状态五问」为例'],
  [''],
  ['这份文件有两个用途：'],
  ['  1. 教业务怎么填 v4 模板 —— 见「使用说明」开头的几张 sheet'],
  ['  2. 它本身就是一份可导入的完整数据 —— ③ 到 ⑩ 这些标准 sheet 已经按真实内容填满'],
  [''],
  ['字段和填写规则与 三库填写模板_v4.xlsx 完全一致，没有任何改动。'],
  ['「使用说明」开头的 sheet 在导入时会被系统自动跳过，不会污染数据。'],
  [''],
  ['【怎么用这份文件导入】'],
  ['  平台后台 → 三库运营台 → 导入资源，同一个文件上传 5 次，每次选一个库类型：'],
  ['  量表库 / 归因库 / 工具库 / 关键词路由库 / 方案输出模板库'],
  ['  系统各取所需的 sheet，互不干扰。'],
  [''],
  ['【五个库的关系】'],
  ['  量表库 ③④④b④c   测什么、怎么算分'],
  ['  归因库 ⑤c⑤d⑤e⑥   为什么是这个问题（归因项+证据规则）、属于什么等级（分级规则）'],
  ['  工具库 ⑦⑦b⑧       用什么方法处理'],
  ['  关键词路由 ⑨        教师随口一说时，该去哪个模块、做哪张量表'],
  ['  方案输出模板 ⑩      最终给教师看的那张纸怎么写'],
  [''],
  ['【填写顺序：上一步没锁定，不要开始下一步】'],
  ['  第1步  ③ 量表-清单        量表编码用英文大写下划线，不要用中文名当编码'],
  ['  第2步  ④ / ④b / ④c        每道题都要有维度；每个维度都要在 ④c 定义且题号列表非空'],
  ['  第3步  ⑤c 归因项          模块级词表，先把「这个模块可能的原因」穷举出来'],
  ['  第4步  ⑤d 证据规则        每条归因至少 1 条证据，否则该归因永远算不出分'],
  ['  第5步  ⑤e 分级规则 / ⑥ 红线   兜底规则的优先级必须是全表最大值'],
  ['  第6步  ⑦ / ⑦b / ⑧         对应归因编码取自 ⑤c；作用维度编码取自 ④c'],
  ['  第7步  ⑩ 方案输出模板      每个等级至少一套，且必须有兜底'],
  ['  第8步  ⑨ 关键词-路由       关联的量表编码和工具编码必须已存在'],
  [''],
  ['【三条硬约束：违反会被导入校验直接拦下】'],
  ['  A. 兜底分级规则（触发条件留空）的优先级必须是全表最大值，不是 0。'],
  ['     引擎按优先级从小到大匹配、第一条命中就停。优先级最小又没有条件的规则'],
  ['     会吃掉全部作答，让其余规则永远执行不到。业务的直觉是「兜底=第0条」，这里正好相反。'],
  ['  B. 每条归因项至少要有一条证据规则；每个工具至少要填一个对应归因编码。'],
  ['  C. 编码列只用 ASCII。编码列留空时系统会拿名称兜底，'],
  ['     导致归因库引用 SG_FIVE_Q 而量表库实际叫「班主任状态五问」，两边对不上。'],
  [''],
  ['【还有一条不会报错但会让方案变空的坑】'],
  ['  证据规则的触发条件要覆盖整个分数区间。如果所有证据都写 >= 4，'],
  ['  那么中等分数的作答会算不出任何归因，教师拿到的方案里「归因」一栏就是空的。'],
  ['  建议每条归因至少配一条中等阈值（>= 3）的低权重证据 —— 本文件的 ⑤d 就是这么设计的。'],
]

const guideColumns = [
  ['Sheet', '列名', '必填', '怎么填', '取值来源 / 值域', '填错的后果'],
  ['③ 量表-清单', '量表编码', '是', '英文大写+下划线，如 SG_FIVE_Q', '自己定，模块内唯一', '留空会拿量表名称兜底，导致 ⑤d/⑨ 引用不到'],
  ['③', '所属模块', '是', '五个固定值之一', '见 ② 枚举字典', '与导入时选的模块不一致会报错'],
  ['③ ', '施测形式 / 触发方式 / 作答频次', '是', '填英文枚举值，不要填中文', '见 ② 枚举字典', '非枚举值会被拒绝'],
  ['③  ', '是否必做', '是', '是 / 否', '', '影响教师端量表列表的排序与提示'],
  ['③   ', '预计用时分钟', '是', '整数', '', '只用于教师端展示'],
  ['④ 量表-题目', '量表编码', '是', '必须等于 ③ 里的某个量表编码', '③ 的量表编码列', '对不上这道题不属于任何量表，等于没填'],
  ['④', '题号', '是', '同一量表内唯一，建议 q1/q2… 或 coop1/att1 这种有语义的', '自己定', '重复题号会互相覆盖'],
  ['④ ', '维度', '是', '填维度的中文名称', '④c 的维度名称列', '仅用于展示；真正参与计算的是 ④c 的维度编码'],
  ['④  ', '选项组编码', '是', '必须等于 ④b 里的某个选项组编码', '④b', '对不上这道题没有选项，教师无法作答'],
  ['④   ', '反向计分', '是', '是 / 否。题干是正向表述（「家长能及时回应」）就填「是」', '', '填反了会让高分低分整体颠倒，等级和归因全错'],
  ['④b 量表-选项组', '分值', '是', '整数，可以不是 1-5。二值题用 0/1', '自己定', '引擎按这里的取值集合校验作答合法性'],
  ['④c 量表-维度定义', '维度编码', '是', '英文大写+下划线，如 SG_EMOTION', '自己定', '⑤d 的 维度[...] 和 ⑦ 的作用维度编码都引用它，写错则条件永远不命中'],
  ['④c', '所属题号列表', '是', '逗号分隔的题号，如 q1,q2,q3', '④ 的题号列', '题号不存在则该维度算不出分'],
  ['④c ', '计算方式', '是', 'mean 均值 / sum 求和 / weighted 加权', '见 ② 枚举字典', 'mean 模式下「权重系数」列不生效，别指望靠它加权'],
  ['⑤b 归因-计算变量', '变量名', '否', '中文名可以，但不要包含「且」「或」「总分」「均分」这些关键词', '自己定', '包含关键词会被表达式归一化切坏'],
  ['⑤b', '计算表达式', '否', '只支持取值和聚合，不支持加减乘除', '见 ⑤a 条件写法速查', '算不出来的变量会被跳过，引用它的规则会报错'],
  ['⑤b ', '依赖量表编码', '否', '强烈建议填', '③ 的量表编码列', '变量引用了某张量表专属的题号时，引用它的分级规则必须限定到同一张量表'],
  ['⑤c 归因项', '归因编码', '是', '英文大写+下划线，如 SG_AT_EXHAUST', '自己定，模块内唯一', '⑤d 和 ⑦ 都引用它'],
  ['⑤c', '权重基数', '是', '小数，1 表示中性。越大表示同样强度的证据下这条归因越该被优先处理', '建议 0.8 - 1.5', '直接影响归因排序和占比'],
  ['⑤c ', '工具标签', '是', '逗号分隔。工具匹配时与 ⑦ 的工具标签求交集', '自己定', '留空则工具匹配少一路加分'],
  ['⑤c  ', '建议动作', '否', '一句话、可当天执行。会直接成为方案里的行动项', '', '留空则退回归因库里那份与归因无关的通用行动清单'],
  ['⑤d 证据规则', '归因编码', '是', '必须等于 ⑤c 里的某条归因编码', '⑤c', '对不上这条证据永远不生效（交叉校验会报错）'],
  ['⑤d', '依据量表编码', '是', '这条证据依据哪张量表', '③', '引擎按当前作答量表过滤证据；填错则永不触发'],
  ['⑤d ', '触发条件', '是', '见 ⑤a。维度[...] 里填维度编码，题[...] 里填题号', '④c 维度编码 / ④ 题号', '写成题号当维度编码是最常见的错误，会让整张量表报错'],
  ['⑤d  ', '证据权重', '是', '小数。高阈值证据给大权重，中阈值给小权重', '建议 1 - 3', '决定归因得分'],
  ['⑤d   ', '证据说明', '是', '一句话说清「为什么这条命中说明有这个归因」', '', '会成为方案里「依据」栏的文案，留空则教师看不到理由'],
  ['⑤e 分级规则', '优先级', '是', '整数，越小越先匹配。兜底规则必须是全表最大值', '自己定', '兜底优先级填小了会吃掉全部作答'],
  ['⑤e', '触发条件', '否', '留空即兜底。每张量表都要有能覆盖到的兜底', '见 ⑤a', '无兜底时作答落不到任何规则'],
  ['⑤e ', '命中等级', '是', '本模块的等级体系，如六色 green/blue/yellow/orange/red/purple', '与 ⑩ 的命中归因等级一致', '⑩ 里没有对应等级的模板，方案文案会空缺'],
  ['⑤e  ', '严重度', '是', 'low / medium / high / crisis', '见 ② 枚举字典', '与 ⑦ 的严重度共用同一套值，这是二者能对上的唯一键'],
  ['⑤e   ', '依据量表编码', '否', '留空表示模块内所有量表通用', '③', '条件引用了某张量表专属变量时必须限定，否则别的量表作答会报错'],
  ['⑤e    ', '是否红线熔断', '是', '是 / 否', '', '填「是」则命中后不生成方案，转走转介流程'],
  ['⑤e     ', '干预工具', '否', '命中该等级直接进方案的工具编码，多个用 ; 分隔', '⑦ 工具编码', '须存在于本模块工具库（导入会校验）；与归因匹配出的工具并存去重'],
  ['⑤e      ', '干预动作', '否', '命中该等级直接进方案的动作文案，多个用 ；分隔', '', '归因通道与等级通道任一命中即出干预，两者都命中则合并'],
  ['⑥ 归因-红线熔断', '红线条件', '是', '独立于分级规则，任一命中即熔断', '见 ⑤a', '表达式写错不会报错、只当作没命中，所以要单独人工复核'],
  ['⑦ 工具-处方总表', '对应归因编码', '是', '必须等于 ⑤c 里的某条归因编码', '⑤c', '留空则这个工具永远不会被任何归因推荐出来（校验会报错）'],
  ['⑦', '严重度', '是', 'low / medium / high / crisis', '与 ⑤e 同一套枚举', '与分级规则的严重度相同时加 2 分'],
  ['⑦ ', '作用维度编码', '否', '填 ④c 的维度编码，不是维度名称也不是题号', '④c', '填自由描述则维度这一路加分永远拿不到'],
  ['⑦  ', '效果说明', '否', '工具功效的自由描述，不参与匹配', '', '纯展示'],
  ['⑦   ', '工具标签', '是', '与 ⑤c 的工具标签求交集', '自己定', '留空则少一路加分'],
  ['⑧ 工具-禁忌规则', '禁忌类型', '是', 'block 硬禁忌 / warn 软禁忌', '见 ② 枚举字典', 'block 是唯一的一票否决，会让工具被直接排除'],
  ['⑨ 关键词-路由', '关联量表编码 / 关联工具编码', '否', '必须是已存在的编码', '③ / ⑦', '对不上会有交叉校验警告'],
  ['⑩ 方案输出模板', '命中归因等级', '是', '必须能对上 ⑤e 的命中等级；另外要留一条 none/default 兜底', '⑤e', '缺对应等级的模板，该等级的方案文案会空缺'],
  ['⑩', '模板内容', '是', '可用 ${主要归因} ${次要归因} ${命中等级} ${等级中文名} ${严重度} ${薄弱维度} ${优势维度}', '', '写了不支持的占位符会被替换成空字符串'],
]

const guideJoints = [
  ['从', '到', '连接键', '必须一致的原因'],
  ['③ 量表-清单', '④ 量表-题目', '量表编码', '决定这道题属于哪张量表'],
  ['④ 量表-题目', '④b 选项组', '选项组编码', '决定这道题有哪些选项、每个选项几分'],
  ['④ 量表-题目', '④c 维度定义', '题号 ↔ 所属题号列表', '决定这道题参与哪个维度的计算'],
  ['④c 维度定义', '⑤d 证据规则', '维度编码 ↔ 维度[...]', '证据条件靠维度编码取维度分。这是最容易填错的一处'],
  ['④ 量表-题目', '⑤d 证据规则', '题号 ↔ 题[...]', '证据条件靠题号取单题得分'],
  ['③ 量表-清单', '⑤d 证据规则', '量表编码 ↔ 依据量表编码', '引擎按当前作答量表过滤证据，避免拿 A 量表的题号去算 B 量表'],
  ['③ 量表-清单', '⑤e 分级规则', '量表编码 ↔ 依据量表编码', '同上。留空表示模块通用'],
  ['⑤c 归因项', '⑤d 证据规则', '归因编码', '证据命中后把权重累加到哪条归因'],
  ['⑤c 归因项', '⑦ 工具-处方总表', '归因编码 ↔ 对应归因编码', '工具匹配的主通路，权重最高（×10）'],
  ['⑤c 归因项', '⑦ 工具-处方总表', '工具标签', '标签交集，加分 ×3'],
  ['⑤e 分级规则', '⑦ 工具-处方总表', '严重度', '同一套枚举，相同时加分 ×2'],
  ['④c 维度定义', '⑦ 工具-处方总表', '维度编码 ↔ 作用维度编码', '工具作用维度命中薄弱维度时加分 ×2'],
  ['⑤e 分级规则', '⑩ 方案输出模板', '命中等级 ↔ 命中归因等级', '按等级挑方案文案模板'],
  ['⑦ 工具-处方总表', '⑦b / ⑧', '工具编码', '步骤明细和禁忌规则挂在哪个工具上'],
  ['③ / ⑦', '⑨ 关键词-路由', '关联量表编码 / 关联工具编码', '教师随口一说时推荐做哪张量表、用哪个工具'],
]

// ---- 计算推演 ----
const walk = []
walk.push(['计算推演：从一份作答推到最终方案'])
walk.push([''])
walk.push(['本 sheet 里的每一个数字都由生成脚本现场调用系统真实引擎算出，不是手写的。'])
walk.push(['引擎逻辑一改，重跑 node scripts/build-filling-guide.mjs 演示就跟着更新。'])
walk.push([''])
walk.push(['【第 0 步】校验作答合法性'])
walk.push(['', `本量表用选项组 ${SCALE.optionGroup}，合法取值 = ${JSON.stringify(optVals)}。不在这个集合里直接报错。`])
walk.push([''])
walk.push(['【第 1 步】反向计分：把作答值折算成得分'])
walk.push(['', `正向题：得分 = 作答值`])
walk.push(['', `反向题：得分 = 选项最小值 + 选项最大值 − 作答值 = ${OPT_MIN} + ${OPT_MAX} − 作答值 = ${OPT_MIN + OPT_MAX} − 作答值`])
walk.push(['', '反向题的含义：得分越高 = 状态越差。题干是正向表述的题都要标反向。'])
walk.push([''])
walk.push(['题号', '维度', '反向?', ...results.flatMap(x => [`${x.who}-作答`, `${x.who}-得分`])])
for (const id of qIds) {
  walk.push([id, SCALE.dimensions.find(d => d.questionIds.includes(id))?.name || '',
    reverseOf[id] ? '是' : '否',
    ...results.flatMap(x => [x.answers[id], scoreOf(id, x.answers[id])])])
}
walk.push(['总分（所有题得分之和）', '', '', ...results.flatMap(x => ['', qIds.reduce((s, id) => s + scoreOf(id, x.answers[id]), 0)])])
walk.push([''])
walk.push(['【第 2 步】维度分：按 ④c 的题号列表聚合，保留 1 位小数'])
walk.push(['维度编码', '维度名称', '所属题号', '计算方式', ...results.map(x => `${x.who}`)])
for (const d of SCALE.dimensions) {
  walk.push([d.code, d.name, d.questionIds.join(','), 'mean',
    ...results.map(x => x.r.dimensions[d.code] ?? '(算不出)')])
}
walk.push(['', '注意：用的是第 1 步的「得分」，不是原始作答值。误用作答值会整体差一个反向计分。'])
walk.push([''])

for (const cs of results) {
  const { who, hint, answers, r, matched } = cs
  walk.push([`════ ${who}（${hint}）════`])
  walk.push(['', '作答：' + qIds.map(id => `${id}=${answers[id]}`).join('  ')])
  walk.push([''])
  walk.push(['', '【第 3 步】计算变量（⑤b）'])
  for (const [name, expr] of M.computed.map(x => [x[0], x[1]])) {
    walk.push(['', '', `${name} = ${expr}`, '→', qIds.reduce((s, id) => s + scoreOf(id, answers[id]), 0)])
  }
  walk.push([''])
  walk.push(['', '【第 4 步】证据规则逐条判断（只取依据量表 = ' + SCALE.code + ' 的）'])
  walk.push(['', '证据编码', '归因编码', '触发条件', '证据权重', '是否命中'])
  const buckets = {}
  for (const [code, at, scale, cond, weight] of M.evidences) {
    if (scale !== SCALE.code) continue
    const hit = r.matchedRuleIds.includes(code)
    if (hit) buckets[at] = (buckets[at] || 0) + weight
    walk.push(['', code, at, cond, weight, hit ? '✓ 命中' : '✗'])
  }
  walk.push([''])
  walk.push(['', '【第 5 步】乘权重基数 → 排序 → 算占比 → 截断到前 3 名 → 打强弱标签'])
  walk.push(['', '归因编码', '归因名称', '证据权重合计', '权重基数', '加权得分', '占比', '标签'])
  const total = Object.entries(buckets).reduce((s, [at, w]) =>
    s + w * (M.attributions.find(a => a.code === at)?.weight || 1), 0)
  const allScored = Object.entries(buckets)
    .map(([at, w]) => {
      const item = M.attributions.find(a => a.code === at)
      return { at, name: item.name, w, base: item.weight, raw: Number((w * item.weight).toFixed(4)) }
    })
    .sort((a, b) => b.raw - a.raw || a.at.localeCompare(b.at))
  allScored.forEach((s, i) => {
    const shown = r.attributions.find(a => a.code === s.at)
    walk.push(['', s.at, s.name, s.w, s.base, s.raw,
      total > 0 ? Number((s.raw / total).toFixed(4)) : 0,
      shown ? ({ primary: '主要', secondary: '次要', reference: '参考' })[shown.strength]
        : `（第 ${i + 1} 名，超出前 3 被截断，不呈现）`])
  })
  if (!allScored.length) walk.push(['', '（无证据命中，归因为空）'])
  walk.push(['', '', '', '', '加权得分合计 =', Number(total.toFixed(4)), '占比之和 ≈ 1', ''])
  walk.push([''])
  walk.push(['', '【第 6 步】分级：按优先级从小到大，第一条命中即停'])
  walk.push(['', '优先级', '规则编码', '触发条件', '判断'])
  const applicable = M.gradingRules
    .filter(g => !g[1] || g[1] === SCALE.code)
    .sort((a, b) => a[2] - b[2])
  let stopped = false
  for (const g of applicable) {
    const [id, , pri, when] = g
    const isHit = r.matchedRuleIds[0] === id
    walk.push(['', pri, id, when || '(兜底，无条件)',
      stopped ? '（前面已命中，不再判断）' : isHit ? '✓ 命中，停止' : '✗'])
    if (isHit) stopped = true
  }
  walk.push(['', '→ 结果', `等级 = ${r.level} / ${r.levelName}`, `严重度 = ${r.severity}`, ''])
  walk.push([''])
  walk.push(['', '【第 7 步】红线：每条独立判断，任一命中即熔断'])
  for (const [cond] of M.redLines) {
    walk.push(['', cond, r.blocked ? '（本次已熔断）' : '✗ 未命中'])
  }
  walk.push(['', '→ 熔断 =', r.blocked ? '是 —— 不生成方案，转走转介流程' : '否'])
  walk.push([''])
  if (r.blocked) {
    walk.push(['', '【第 8 步】因为命中红线，不生成方案。教师看到危机求助指引，系统生成转介工单。'])
  } else {
    walk.push(['', '【第 8 步】方案：行动项来自命中归因的「建议动作」'])
    for (const a of r.actions) walk.push(['', '', a.title, a.detail])
    walk.push([''])
    walk.push(['', '【第 9 步】工具：归因命中(占比加权)×10 + 标签交集×3 + 严重度相同×2 + 作用维度命中×2'])
    walk.push(['', '排名', '工具编码', '工具名称', '总分', '归因分', '标签分', '严重度分', '维度分'])
    matched.forEach((m, i) => walk.push(['', i + 1, m.tool.code, m.tool.name, m.score,
      m.breakdown.attribution, m.breakdown.tag, m.breakdown.severity, m.breakdown.dimension]))
    if (!matched.length) walk.push(['', '（无工具匹配）'])
  }
  walk.push([''])
  walk.push(['', '【最终结果】'])
  walk.push(['', '等级', `${r.level} / ${r.levelName}（严重度 ${r.severity}）`])
  walk.push(['', '归因', r.attributions.length
    ? r.attributions.map(a => `${({ primary: '主要', secondary: '次要', reference: '参考' })[a.strength]}：${a.name}`).join('　')
    : '（无）'])
  walk.push(['', '熔断', r.blocked ? '是' : '否'])
  walk.push(['', '工具', r.blocked ? '（熔断不推工具）' : matched.map(m => m.tool.name).join('、') || '（无）'])
  walk.push([''])
  walk.push([''])
}

walk.push(['【三个案例分别演示了什么】'])
walk.push(['', '张老师', '命中红线 → 不出方案、转介。演示熔断优先于一切。'])
walk.push(['', '李老师', '4 条归因命中但只呈现前 3 条。演示截断规则和强弱标签。'])
walk.push(['', '王老师', '只有 1 条弱证据命中 → 单一归因占比 100%，等级落兜底。演示首位归因无论占比多低都保留。'])
walk.push([''])
walk.push(['【两个手算容易错的地方】'])
walk.push(['', '一', '维度分的 1 位小数是聚合后立即四舍五入的，且会直接参与后续比较。'])
walk.push(['', '', '(4+4+3)/3 = 3.6667 截成 3.7，写阈值不要超过 1 位小数，否则手算和引擎会分叉。'])
walk.push(['', '二', '加权得分和占比各保留 4 位小数，两次截断都在，'])
walk.push(['', '', '所以三项以上时占比之和常见 0.9999，不影响排序和标签。'])

const guideChecklist = [
  ['交付前自检清单', '怎么查', '不过关的后果'],
  ['每个量表编码在 ③ 里唯一，且是 ASCII', '看 ③ 的量表编码列', '⑤d/⑨ 引用不到'],
  ['④ 里每道题的量表编码都能在 ③ 找到', '筛选比对', '这道题不属于任何量表'],
  ['④ 里每道题的选项组编码都能在 ④b 找到', '筛选比对', '教师无法作答'],
  ['④c 里每个维度的所属题号都能在 ④ 找到', '筛选比对', '该维度算不出分'],
  ['⑤d 的 维度[...] 里填的是 ④c 的维度编码，不是题号也不是维度名称', '逐条核对', '整张量表报错，任何作答都出不了方案'],
  ['⑤d 的每条归因编码都能在 ⑤c 找到', '筛选比对', '这条证据永远不生效'],
  ['⑤c 的每条归因项都至少有一条 ⑤d 证据', '按归因编码计数', '该归因永远算不出分（校验报错）'],
  ['每条归因的证据覆盖了中高两个分段', '看触发条件的阈值分布', '中等分作答归因为空，方案缺归因'],
  ['⑤e 每张量表都有能覆盖到的兜底规则', '看触发条件留空的行', '作答落不到任何规则'],
  ['⑤e 兜底规则的优先级是全表最大值', '按优先级排序看最后一行', '兜底会吃掉全部作答，其余规则永不可达'],
  ['⑤e 的严重度和 ⑦ 的严重度用同一套枚举', '对比两列取值', '工具匹配拿不到严重度加分'],
  ['⑦ 每个工具都填了对应归因编码', '看该列有无空值', '这个工具永远不会被推荐（校验报错）'],
  ['⑦ 的作用维度编码填的是 ④c 的维度编码', '逐条核对', '维度这一路加分永远拿不到'],
  ['⑩ 覆盖了 ⑤e 产出的所有等级，且有一条兜底', '对比两边的等级取值', '该等级的方案文案空缺'],
  ['⑨ 的关联量表编码 / 关联工具编码都已存在', '筛选比对', '交叉校验警告'],
  ['导入后在运营台点「校验关联」返回通过', '平台后台 → 归因库编辑页', '存在跨库引用断裂'],
]

// ===================================================================
// 写盘
// ===================================================================

const SHEETS = [
  { name: '使用说明-1 总览与填写顺序', rows: guideOverview },
  { name: '使用说明-2 逐列填法', rows: guideColumns },
  { name: '使用说明-3 咬合关系', rows: guideJoints },
  { name: '使用说明-4 计算推演', rows: walk },
  { name: '使用说明-5 交付自检清单', rows: guideChecklist },
  // ---- 以下是 v4 标准 sheet，名称/列名/列序与 三库填写模板_v4.xlsx 完全一致 ----
  { name: '② 枚举字典', rows: [['枚举类别', '取值（填这个）', '中文含义', '用在哪些列'], ...ENUM_ROWS()] },
  { name: '③ 量表-清单', rows: [['量表编码*', '量表名称*', '量表简称', '所属模块*', '适用学部*', '施测对象*', '施测形式*',
    '触发方式*', '作答频次*', '是否必做*', '预计用时分钟*', '结果可见性*', '数据敏感级*',
    '来源属性*', '手册出处*', '版本*', '量表说明'], ...instrumentRows] },
  { name: '④ 量表-题目', rows: [['量表编码*', '题号*', '题型*', '维度*', '题干*', '选项组编码*', '反向计分*', '权重', '是否必答*', '数据用途*'], ...questionRows] },
  { name: '④b 量表-选项组', rows: [['选项组编码*', '选项顺序*', '选项文本*', '分值*'], ...OPTION_GROUPS.map(r => r.map(String))] },
  { name: '④c 量表-维度定义', rows: [['量表编码*', '维度编码*', '维度名称*', '所属题号列表*', '计算方式*', '权重系数', '维度说明', '高分解释', '低分解释'], ...dimRows] },
  { name: '⑤a 条件写法速查', rows: CONDITION_HELP() },
  { name: '⑤b 归因-计算变量', rows: [['变量名*', '所属模块*', '计算表达式*', '变量说明', '依赖量表编码', '依赖题号', '依赖维度编码'],
    ...M.computed.map(([name, expr, desc, scale, qs, dims]) => [name, M.code, expr, desc, scale, qs, dims])] },
  { name: '⑤c 归因项', rows: [['归因编码*', '归因名称*', '所属模块*', '权重基数*', '工具标签*', '归因说明', '高分表现', '典型诱因', '建议动作', '手册出处'], ...attributionItemRows] },
  { name: '⑤d 证据规则', rows: [['证据编码*', '归因编码*', '依据量表编码*', '触发条件*', '证据权重*', '证据说明*', '手册出处'], ...evidenceRows] },
  { name: '⑤e 分级规则', rows: [['规则编码*', '所属模块*', '依据量表编码', '优先级*', '触发条件', '命中等级*', '等级中文名*', '严重度*',
    '是否红线熔断*', '结果说明*', '升级条件', '升级目标', '复评触发条件', '干预工具', '干预动作', '手册出处'], ...gradingRows] },
  { name: '⑥ 归因-红线熔断', rows: [['所属模块*', '红线条件*', '红线说明*', '熔断范围*', '处置要求*', '熔断后动作', '恢复条件', '责任人', '通知模板', '手册出处'], ...redLineRows] },
  { name: '⑦ 工具-处方总表', rows: [['工具编码*', '工具名称*', '工具简称', '所属模块*', '工具形式*', '适用学部*', '适用对象*',
    '适用症状场景*', '严重度*', '对应归因编码*', '对应归因名称', '工具标签*', '作用维度编码', '效果说明',
    '操作步骤摘要*', '关键话术', '预期效果*', '单次耗时', '疗程与频次', '重评间隔天数',
    '禁止事项*', '禁忌说明', '前置工具编码', '替代工具编码', '进阶工具编码',
    '证据等级*', '证据来源', '效果指标', '失败标准', '准备事项', '所需材料', '输出物', '协同工具编码',
    '手册出处*', '版本*', '跨模块标签'], ...toolRows] },
  { name: '⑦b 工具-步骤明细', rows: [['工具编码*', '步骤序号*', '步骤标题*', '步骤说明*', '预计耗时', '所需材料', '关键提示', '话术模板', '成功标准', '常见问题'], ...stepRows] },
  { name: '⑧ 工具-禁忌规则', rows: [['工具编码*', '禁忌条件*', '禁忌类型*', '禁忌说明*', '替代建议', '适用教师群体', '依据'], ...(contraRows.length ? contraRows : [['', '', '', '', '', '', '']])] },
  { name: '⑨ 关键词-路由', rows: [['关键词编码*', '核心触发词*', '扩展词与近义表达', '排除词', '所属模块*', '匹配优先级*', '匹配模式',
    '风险等级*', '语义分类', '关联量表编码', '关联工具编码', '情境限定', '路由权重', '时效性', '场景描述'], ...routeRows] },
  { name: '⑩ 方案输出模板', rows: [['模板编码*', '所属模块*', '命中归因等级*', '模板类型*', '模板内容*', '占位符说明', '排序*'], ...templateRows] },
]

function ENUM_ROWS() {
  return [
    ['所属模块', 'self_growth', '自我成长赋能', '量表-清单 / 归因项 / 分级规则 / 工具-处方总表 / 关键词-路由 / 方案输出模板'],
    ['所属模块', 'class_system', '班级系统建设', '同上'],
    ['所属模块', 'home_school', '家校沟通合作', '同上'],
    ['所属模块', 'student_case', '学生个体问题', '同上'],
    ['所属模块', 'learning_problem', '学生学习问题', '同上'],
    ['严重度', 'low', '轻度', '⑤e 分级规则 / ⑦ 工具-处方总表　【两处必须用同一套值，这是二者能对上的唯一键】'],
    ['严重度', 'medium', '中度', '同上'],
    ['严重度', 'high', '重度', '同上'],
    ['严重度', 'crisis', '危机', '同上'],
    ['计算方式', 'mean', '维度内各题均值', '④c 量表-维度定义'],
    ['计算方式', 'sum', '维度内各题总分', '④c'],
    ['计算方式', 'weighted', '维度内各题加权求和（只有这个模式才读「权重系数」列）', '④c'],
    ['施测形式', 'self_report', '自评问卷', '③ 量表-清单'],
    ['施测形式', 'observation', '观察记录', '③'],
    ['施测形式', 'interview', '访谈提纲', '③'],
    ['施测形式', 'checklist', '核查清单', '③'],
    ['触发方式', 'manual', '教师手动发起', '③'],
    ['触发方式', 'auto', '系统自动推荐', '③'],
    ['触发方式', 'scheduled', '定时推送', '③'],
    ['作答频次', 'once', '仅一次', '③'],
    ['作答频次', 'daily', '每天', '③'],
    ['作答频次', 'weekly', '每周', '③'],
    ['作答频次', 'monthly', '每月', '③'],
    ['作答频次', 'per_case', '每个个案', '③'],
    ['结果可见性', 'teacher_only', '仅教师可见', '③'],
    ['结果可见性', 'teacher_and_student', '教师和学生可见', '③'],
    ['结果可见性', 'psychologist', '心理专员可见', '③'],
    ['数据敏感级', 'internal', '内部限阅', '③'],
    ['数据敏感级', 'sensitive', '敏感', '③'],
    ['数据敏感级', 'highly_sensitive', '高度敏感', '③'],
    ['来源属性', 'proprietary', '六力自有', '③'],
    ['来源属性', 'external', '外部量表·需授权', '③'],
    ['来源属性', 'adapted', '改编自外部', '③'],
    ['题型', 'single', '单选题', '④ 量表-题目'],
    ['题型', 'multiple', '多选题', '④'],
    ['题型', 'text', '文本填空', '④'],
    ['题型', 'matrix', '矩阵题', '④'],
    ['数据用途', 'compute', '计算维度分', '④'],
    ['数据用途', 'monitor', '质量监测', '④'],
    ['数据用途', 'aux', '辅助信息', '④'],
    ['工具形式', 'exercise', '练习', '⑦'],
    ['工具形式', 'script', '话术', '⑦'],
    ['工具形式', 'checklist', '清单', '⑦'],
    ['工具形式', 'framework', '框架', '⑦'],
    ['工具形式', 'worksheet', '工作表', '⑦'],
    ['证据等级', 'A', '随机对照试验支持', '⑦'],
    ['证据等级', 'B', '准实验或队列研究支持', '⑦'],
    ['证据等级', 'C', '专家共识或案例报告', '⑦'],
    ['证据等级', 'D', '理论推导或经验总结', '⑦'],
    ['禁忌类型', 'block', '硬禁忌（直接排除该工具，唯一的一票否决）', '⑧'],
    ['禁忌类型', 'warn', '软禁忌（提醒但不排除）', '⑧'],
    ['匹配模式', 'exact', '精确匹配', '⑨'],
    ['匹配模式', 'fuzzy', '模糊匹配', '⑨'],
    ['匹配模式', 'regex', '正则表达式', '⑨'],
    ['熔断范围', 'instrument', '仅当前量表', '⑥'],
    ['熔断范围', 'module', '整个模块', '⑥'],
    ['熔断范围', 'system', '全系统', '⑥'],
    ['模板类型', 'summary', '问题摘要', '⑩'],
    ['模板类型', 'conclusion', '评估结论', '⑩'],
    ['模板类型', 'attribution', '归因说明', '⑩'],
    ['模板类型', 'goal', '支持目标', '⑩'],
    ['模板类型', 'action', '行动项', '⑩'],
    ['模板类型', 'tool', '推荐工具', '⑩'],
    ['模板类型', 'caution', '注意事项/禁忌', '⑩'],
    ['模板类型', 'review', '复盘提示', '⑩'],
  ]
}

function CONDITION_HELP() {
  return [
    ['你要表达的意思', '就这样写', '示例', '说明'],
    ['某道题的得分', '题[题号]', '题[q1] >= 4', '反向计分题已自动折算后再取值'],
    ['某个维度的得分', '维度[维度编码]', '维度[SG_EMOTION] >= 4', '填 ④c 的维度编码，不是维度名称，也不是题号'],
    ['某道题的原始作答值', '原始[题号]', '原始[q3] == 1', '不做反向折算，一般不用'],
    ['所有题目的总分', '总分', '总分 >= 20', '反向计分题已折算。指当前作答量表的总分，不带下标'],
    ['所有题目的均分', '均分', '均分 >= 3.5', ''],
    ['最主导的维度', '主导维度', "主导维度 == 'SG_EMOTION'", '返回得分最高的维度编码'],
    ['最薄弱的维度', '短板维度', "短板维度 == 'SG_MEANING'", '返回得分最低的维度编码'],
    ['并且 / 或者', '且 / 或', '题[q1] >= 4 且 题[q3] >= 4', '也可以写 && ||，或英文 AND / OR'],
    ['相等 / 不等', '== / !=', '题[q1] == 5', '写单个 = 系统会自动当成 ==，但建议直接写 =='],
    ['自定义变量', '直接写变量名', '状态总分 >= 20', '变量在 ⑤b 里定义'],
    ['', '', '', '不支持加减乘除。要算差值、比值，请在 ⑤b 里定义变量，或拆成两个条件用「且」连接。'],
    ['', '', '', '变量名不要包含「且」「或」「总分」「均分」「主导维度」「短板维度」这些关键词，否则会被切坏。'],
  ]
}

const wb = XLSX.utils.book_new()
for (const { name, rows } of SHEETS) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const widths = []
  for (const row of rows) {
    row.forEach((cell, i) => {
      const len = String(cell ?? '').length
      widths[i] = Math.min(70, Math.max(widths[i] || 8, len + 2))
    })
  }
  ws['!cols'] = widths.map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, name)
}
mkdirSync(dirname(OUT), { recursive: true })
XLSX.writeFile(wb, OUT)

console.log(`已生成 ${OUT}`)
console.log(`共 ${SHEETS.length} 个 sheet：`)
console.log(`  讲解（导入时自动跳过）：${SHEETS.filter(s => s.name.startsWith('使用说明')).length} 张`)
console.log(`  v4 标准（可直接导入）：${SHEETS.filter(s => !s.name.startsWith('使用说明')).length} 张`)
console.log('\n三个推演案例的引擎实算结果：')
for (const { who, r, matched } of results) {
  console.log(`  ${who}: 等级=${r.level}/${r.levelName} 严重度=${r.severity} 熔断=${r.blocked ? '是' : '否'}`
    + ` 归因${r.attributions.length}条 工具${r.blocked ? 0 : matched.length}个`)
  if (r.attributions.length) {
    console.log(`        ${r.attributions.map(a => `${a.name}(${Math.round(a.share * 100)}%)`).join('  ')}`)
  }
}

/**
 * 一次性校验：home_school V1 业务填写数据（按 v3 模板）全链路校验。
 * 覆盖：五库解析 → 服务端校验（含 ③d 编排自检）→ 表达式语法预检 →
 *       跨库引用一致性 → 规则引擎逐表试算 → 编排状态机 → 敏感数据嗅探。
 * 跑完即删，不入库。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseAssessmentFile, toAssessmentPayload } from '../scripts/import-business-data/transformers/assessment'
import { parseAttributionFile } from '../scripts/import-business-data/transformers/attribution'
import { parseStandardToolFile } from '../scripts/import-business-data/transformers/tool'
import { parseKeywordRouteFile } from '../scripts/import-business-data/transformers/keyword-route'
import { parseOutputTemplateFile } from '../scripts/import-business-data/transformers/output-template'
import { validateModuleResourcePayload } from '../server/domain/module-resource-validation'
import { checkExpressionSyntax, executeRules, extractReferencedInstrumentCodes } from '../server/domain/rules-executor'
import { buildInstrumentOptions, filterTeacherVisibleInstruments } from '../server/domain/assessment-instruments'
import type { AssessmentDefinition } from '../shared/assessments'
import type { AttributionConfig } from '../shared/contracts'

const BASE = 'business-libraries/home_school - V1'
const MODULE = 'home_school' as const

const issues: string[] = []
const notes: string[] = []
const fail = (msg: string) => issues.push(msg)
const note = (msg: string) => notes.push(msg)

// ---------- 1. 解析五库 ----------
const instruments = parseAssessmentFile(`${BASE}/assessment.xlsx`, MODULE)
  .map(item => toAssessmentPayload(item, MODULE)) as AssessmentDefinition[]
const attribution: AttributionConfig = parseAttributionFile(`${BASE}/attribution.xlsx`, MODULE)
const tools = parseStandardToolFile(`${BASE}/tool.xlsx`)
const routes = parseKeywordRouteFile(`${BASE}/keyword_route.xlsx`, MODULE)
const templates = parseOutputTemplateFile(`${BASE}/output_template.xlsx`, MODULE)

note(`量表 ${instruments.length} 张：${instruments.map(i => `${i.code}(${i.questions.length}题,角色=${i.instrumentRole || '未填'},必做=${i.isRequired ? '是' : '否'})`).join('、')}`)
note(`归因项 ${attribution.attributionItems.length}、证据 ${attribution.evidences.length}、分级 ${attribution.gradingRules.length}、红线 ${(attribution.redLines || []).length}、计算变量 ${Object.keys(attribution.computed).length}`)
note(`工具 ${tools.length}、关键词路由 ${routes.length}、输出模板 ${templates.length}`)

// ---------- 2. 服务端校验（与平台后台预检同一套） ----------
const mergedDefinition: AssessmentDefinition = {
  ...instruments[0]!,
  code: '__merged__',
  questions: instruments.flatMap(i => i.questions),
  dimensionDefs: instruments.flatMap(i => i.dimensionDefs || [])
}
const vAssessment = validateModuleResourcePayload({
  module: MODULE, libraryType: 'assessment',
  payload: { instruments },
  counterpart: { attributionConfig: attribution }
})
const vAttribution = validateModuleResourcePayload({
  module: MODULE, libraryType: 'attribution',
  payload: attribution as unknown as Record<string, unknown>,
  counterpart: { assessmentDefinition: mergedDefinition }
})
const vTool = validateModuleResourcePayload({ module: MODULE, libraryType: 'tool', payload: { tools } })
const vRoute = validateModuleResourcePayload({ module: MODULE, libraryType: 'keyword_route', payload: { routes } })
const vTemplate = validateModuleResourcePayload({ module: MODULE, libraryType: 'output_template', payload: { templates } })

for (const [name, v] of Object.entries({ assessment: vAssessment, attribution: vAttribution, tool: vTool, keyword_route: vRoute, output_template: vTemplate })) {
  for (const e of v.errors) fail(`[${name}] ${e.path ? e.path + ' · ' : ''}${e.message}`)
  for (const w of v.warnings) note(`[${name}] 警告: ${w.path ? w.path + ' · ' : ''}${w.message}`)
}

// ---------- 3. 表达式语法预检 ----------
const expressions: Array<{ from: string, expr: string | undefined }> = [
  ...Object.entries(attribution.computed).map(([k, v]) => ({ from: `计算变量 ${k}`, expr: v })),
  ...attribution.evidences.map(e => ({ from: `证据 ${e.evidenceCode}`, expr: e.condition })),
  ...attribution.gradingRules.map(r => ({ from: `分级 ${r.ruleId}`, expr: r.when })),
  ...(attribution.redLines || []).map((r, i) => ({ from: `红线 ${i + 1}`, expr: r.condition })),
  ...instruments.map(i => ({ from: `量表 ${i.code} 触发条件`, expr: i.triggerCondition }))
]
for (const { from, expr } of expressions) {
  if (!expr) continue
  const check = checkExpressionSyntax(expr)
  if (!check.ok) fail(`[表达式] ${from}：${expr} → ${check.error}`)
}

// ---------- 4. 跨库引用一致性 ----------
const instrumentCodes = new Set(instruments.map(i => i.code))
const attributionCodes = new Set(attribution.attributionItems.map(a => a.code))
const toolCodes = new Set(tools.map(t => t.code))

for (const e of attribution.evidences) {
  if (!instrumentCodes.has(e.assessmentCode)) fail(`[引用] 证据 ${e.evidenceCode} 的依据量表编码 ${e.assessmentCode} 不在 ③ 量表清单`)
}
for (const g of attribution.gradingRules) {
  if (g.assessmentCode && !instrumentCodes.has(g.assessmentCode)) fail(`[引用] 分级 ${g.ruleId} 的依据量表编码 ${g.assessmentCode} 不在 ③ 量表清单`)
}
for (const t of tools) {
  const refs = [t.attributionCode, ...(t.attributionCodes || [])].filter(Boolean) as string[]
  for (const ref of refs) if (!attributionCodes.has(ref)) fail(`[引用] 工具 ${t.code} 的对应归因编码 ${ref} 不在 ⑤c 归因项`)
  for (const ref of [t.prerequisiteToolCode, t.alternativeToolCode, t.advancedToolCode].filter(Boolean) as string[]) {
    if (!toolCodes.has(ref)) note(`[引用] 工具 ${t.code} 引用的工具编码 ${ref} 不在本库（若在其他模块请忽略）`)
  }
}
for (const i of instruments) {
  for (const pre of i.prerequisiteCodes || []) if (!instrumentCodes.has(pre)) fail(`[引用] 量表 ${i.code} 的前置量表 ${pre} 不在 ③ 量表清单`)
  for (const exc of i.exclusiveCodes || []) if (!instrumentCodes.has(exc)) fail(`[引用] 量表 ${i.code} 的互斥量表 ${exc} 不在 ③ 量表清单`)
  for (const ref of extractReferencedInstrumentCodes(i.triggerCondition || '')) {
    if (!instrumentCodes.has(ref)) fail(`[引用] 量表 ${i.code} 触发条件引用的量表 ${ref} 不在 ③ 量表清单`)
  }
  // 维度定义引用的题号
  const qids = new Set(i.questions.map(q => q.id))
  for (const def of i.dimensionDefs || []) {
    for (const qid of def.questionIds) if (!qids.has(qid)) fail(`[引用] 量表 ${i.code} 维度 ${def.code} 引用的题号 ${qid} 不存在`)
  }
}
for (const r of routes) {
  if (r.linkedAssessmentCode && !instrumentCodes.has(r.linkedAssessmentCode)) note(`[引用] 路由 ${r.code} 关联量表 ${r.linkedAssessmentCode} 不在 ③`)
  if (r.linkedToolCode && !toolCodes.has(r.linkedToolCode)) note(`[引用] 路由 ${r.code} 关联工具 ${r.linkedToolCode} 不在 ⑦`)
}
// 输出模板等级覆盖：分级规则出现过的等级都应有模板，且必须有 none 兜底
const gradingLevels = new Set(attribution.gradingRules.map(g => g.level))
const templateLevels = new Set(templates.map(t => t.attributionLevel))
for (const level of gradingLevels) {
  if (!templateLevels.has(level)) note(`[模板] 分级等级 ${level} 没有对应的输出模板（有 none 兜底则可接受）`)
}
if (!templateLevels.has('none')) fail('[模板] 缺少 none 兜底输出模板，命中未覆盖等级时方案文案会空缺')

// ---------- 5. 规则引擎逐表试算（全 3 作答 + 全 5 高压作答） ----------
for (const instrument of instruments) {
  for (const [label, value] of [['全3', 3], ['全5', 5]] as const) {
    const answers = Object.fromEntries(instrument.questions.map(q => [q.id, value]))
    try {
      const result = executeRules(attribution, answers, instrument)
      note(`[试算] ${instrument.code} ${label} → 等级=${result.level} 严重度=${result.severity} 熔断=${result.blocked} 主归因=${result.primaryAttribution || '(无)'}`)
    } catch (error) {
      fail(`[试算] ${instrument.code} ${label} 失败：${(error as Error).message}`)
    }
  }
}

// ---------- 6. 编排状态机（新教师视角） ----------
const options = buildInstrumentOptions(instruments, new Map())
const visible = filterTeacherVisibleInstruments(options)
note(`[编排] 新教师可见量表：${visible.map(o => `${o.code}(${o.status}${o.role ? ',' + o.role : ''})`).join('、') || '(无)'}`)
for (const o of options) {
  if (o.triggerError) note(`[编排] ${o.code} 触发条件求值失败（新教师无历史时属正常）：${o.triggerError}`)
}

// ---------- 7. 敏感数据嗅探（S01） ----------
const phonePattern = /1[3-9]\d{9}/
const idCardPattern = /\d{17}[\dXx]/
for (const file of ['assessment.xlsx', 'attribution.xlsx', 'tool.xlsx', 'keyword_route.xlsx', 'output_template.xlsx']) {
  const raw = readFileSync(`${BASE}/${file}`)
  const text = raw.toString('utf8') + raw.toString('latin1')
  if (phonePattern.test(text)) note(`[S01] ${file} 疑似包含手机号模式（xlsx 二进制内嵌字符串，需人工确认）`)
  if (idCardPattern.test(text)) note(`[S01] ${file} 疑似包含身份证号模式（需人工确认）`)
}

describe('home_school V1 业务数据全链路校验', () => {
  it('解析出全部五库内容', () => {
    expect(instruments.length).toBeGreaterThan(0)
    expect(attribution.attributionItems.length).toBeGreaterThan(0)
    expect(tools.length).toBeGreaterThan(0)
    expect(routes.length).toBeGreaterThan(0)
    expect(templates.length).toBeGreaterThan(0)
  })

  it('校验报告', () => {
    console.log('\n========== 说明 / 警告 ==========')
    for (const n of notes) console.log('  ' + n)
    console.log('\n========== 必须修正的问题 ==========')
    for (const i of issues) console.log('  ' + i)
    console.log(`\n合计：${issues.length} 个必须修正，${notes.length} 条说明/警告\n`)
    expect(issues).toEqual([])
  })
})
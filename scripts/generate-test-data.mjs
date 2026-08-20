// 三库测试数据生成 + 导入（v3 多归因加权结构）
//
// 用法:
//   node scripts/generate-test-data.mjs --no-import   只生成 25 个 xlsx
//   node scripts/generate-test-data.mjs --no-import --clean-files   删除旧文件后重新生成
//   node scripts/generate-test-data.mjs               生成并导入到本地 dev server
//   node scripts/generate-test-data.mjs --type=tool   只处理某一类库
//
// 业务内容在 scripts/test-data/modules.mjs，这里只负责按 v4 模板的 sheet 结构落盘。
// sheet 名必须与 v4 模板一致，否则 transformer 会走回退分支、按 sheet 名猜编码。

import XLSX from 'xlsx'
import { mkdirSync, rmSync } from 'node:fs'
import { MODULES, OPTION_GROUPS } from './test-data/modules.mjs'

const BASE_URL = 'http://localhost:3300'
const ADMIN_PHONE = '13800000000'
const ADMIN_PASSWORD = 'Mentor@2026'
const BASE_DIR = 'business-libraries/test-data'
// 版本号在 (library, version) 上有唯一约束，重复导入必须换号。
// 默认 1.0.0，重跑时用 --version=1.0.1 之类。
const VERSION = (process.argv.find(a => a.startsWith('--version=')) || '').split('=')[1] || '1.0.0'

const TYPE_LABELS = {
  assessment: '量表库',
  attribution: '归因库',
  tool: '工具库',
  keyword_route: '关键词路由库',
  output_template: '方案输出模板库',
}
const LIB_TYPES = ['assessment', 'attribution', 'tool', 'keyword_route', 'output_template']

// ---- 量表库 ③④④b④c ----

function makeAssessmentSheets(m) {
  // v4 新增的「量表角色」必须填：多量表模块不标角色时教师端只能平铺展示，
  // 编排纪律也无法自动检查（导入质量校验会因此报警告）。
  const instrumentRows = m.scales.map((s, index) => [
    s.code, s.title, s.shortName, m.code, 'all', 'teacher', 'self_report',
    'manual', s.frequency, s.required ? '是' : '否', String(s.minutes),
    s.role || (index === 0 ? '入口筛查' : '深度诊断'),
    (s.prerequisiteCodes || []).join(','), (s.exclusiveCodes || []).join(','),
    s.triggerCondition || '', s.triggerConditionNote || '',
    'teacher_only', 'sensitive', 'proprietary', `${m.label}手册v1`, '1.0.0', s.description,
  ])

  const questionRows = []
  const dimRows = []
  for (const s of m.scales) {
    for (const [id, dimCode, text, reverse] of s.questions) {
      const dim = s.dimensions.find(d => d.code === dimCode)
      questionRows.push([
        s.code, id, 'single', dim ? dim.name : dimCode, text,
        s.optionGroup, reverse ? '是' : '否', '1', '是', 'compute',
      ])
    }
    for (const d of s.dimensions) {
      dimRows.push([
        s.code, d.code, d.name, d.questionIds.join(','), 'mean', '1',
        `${d.name}维度`, d.high, d.low,
      ])
    }
  }

  return buildWorkbook({
    '③ 量表-清单': {
      headers: ['量表编码*', '量表名称*', '量表简称', '所属模块*', '适用学部*', '施测对象*', '施测形式*',
        '触发方式*', '作答频次*', '是否必做*', '预计用时分钟*', '量表角色*', '前置量表编码', '互斥量表编码',
        '触发条件', '触发条件说明',
        '结果可见性*', '数据敏感级*', '来源属性*', '手册出处*', '版本*', '量表说明'],
      rows: instrumentRows,
    },
    '④ 量表-题目': {
      headers: ['量表编码*', '题号*', '题型*', '维度*', '题干*', '选项组编码*', '反向计分*', '权重', '是否必答*', '数据用途*'],
      rows: questionRows,
    },
    '④b 量表-选项组': {
      headers: ['选项组编码*', '选项顺序*', '选项文本*', '分值*'],
      rows: OPTION_GROUPS.map(r => r.map(String)),
    },
    '④c 量表-维度定义': {
      headers: ['量表编码*', '维度编码*', '维度名称*', '所属题号列表*', '计算方式*', '权重系数', '维度说明', '高分解释', '低分解释'],
      rows: dimRows,
    },
  })
}

// ---- 归因库 ⑤b⑤c⑤d⑤e⑥ ----

function makeAttributionSheets(m) {
  return buildWorkbook({
    '⑤b 归因-计算变量': {
      headers: ['变量名*', '所属模块*', '计算表达式*', '变量说明', '依赖量表编码', '依赖题号', '依赖维度编码'],
      rows: m.computed.map(([name, expr, desc, scale, qs, dims]) => [name, m.code, expr, desc, scale, qs, dims]),
    },
    '⑤c 归因项': {
      headers: ['归因编码*', '归因名称*', '所属模块*', '权重基数*', '工具标签*', '归因说明', '高分表现', '典型诱因', '建议动作', '手册出处'],
      rows: m.attributions.map(a => [
        a.code, a.name, m.code, String(a.weight), a.tags, a.desc, a.high, a.trigger, a.action, `${m.label}手册v1`,
      ]),
    },
    '⑤d 证据规则': {
      headers: ['证据编码*', '归因编码*', '依据量表编码*', '触发条件*', '证据权重*', '证据说明*', '手册出处'],
      rows: m.evidences.map(([code, at, scale, cond, weight, desc]) => [
        code, at, scale, cond, String(weight), desc, `${m.label}手册v1`,
      ]),
    },
    '⑤e 分级规则': {
      headers: ['规则编码*', '所属模块*', '依据量表编码', '优先级*', '触发条件', '命中等级*', '等级中文名*', '严重度*',
        '是否红线熔断*', '结果说明*', '升级条件', '升级目标', '复评触发条件', '干预工具', '干预动作', '手册出处'],
      rows: m.gradingRules.map(([id, scale, pri, when, level, levelName, severity, blocked, desc, esc, escTarget, reEval, ...rest]) => [
        id, m.code, scale, String(pri), when, level, levelName, severity,
        blocked ? '是' : '否', desc, esc, escTarget, reEval,
        rest[0] || '', rest[1] || '', `${m.label}手册v1`,
      ]),
    },
    '⑥ 归因-红线熔断': {
      headers: ['所属模块*', '红线条件*', '红线说明*', '熔断范围*', '处置要求*', '熔断后动作', '恢复条件', '责任人', '通知模板', '手册出处'],
      rows: m.redLines.map(([cond, desc, scope, required, actions, recovery, role, notice]) => [
        m.code, cond, desc, scope, required, actions, recovery, role, notice, `${m.label}手册v1`,
      ]),
    },
  })
}

// ---- 工具库 ⑦⑦b⑧ ----

function makeToolSheets(m) {
  const toolRows = m.tools.map(t => [
    t.code, t.name, t.short, m.code, t.form, 'all', 'teacher',
    t.scene, t.severity, t.at, m.attributions.find(a => a.code === t.at)?.name || '',
    t.tags, t.dims, t.effect,
    t.steps.join('\n'), t.script, t.expect, t.time, t.cycle, '30',
    t.forbid, '', '', '', '',
    t.evidence, t.source, t.indicator, t.fail,
    '准备记录表', '记录表', '一次执行记录', '', `${m.label}手册v1`, '1.0.0', '',
  ])

  const stepRows = []
  for (const t of m.tools) {
    t.steps.forEach((step, index) => {
      stepRows.push([
        t.code, String(index + 1), step.length > 12 ? step.slice(0, 12) : step, step,
        '', '', index === 0 ? '这一步决定后面能不能走下去' : '', index === 0 ? t.script : '',
        '完成本步骤描述的动作', '',
      ])
    })
  }

  const contraRows = []
  for (const t of m.tools) {
    for (const [cond, type, desc, alt] of t.contra || []) {
      contraRows.push([t.code, cond, type, desc, alt, '班主任', `${m.label}手册v1`])
    }
  }

  return buildWorkbook({
    '⑦ 工具-处方总表': {
      headers: ['工具编码*', '工具名称*', '工具简称', '所属模块*', '工具形式*', '适用学部*', '适用对象*',
        '适用症状场景*', '严重度*', '对应归因编码*', '对应归因名称', '工具标签*', '作用维度编码', '效果说明',
        '操作步骤摘要*', '关键话术', '预期效果*', '单次耗时', '疗程与频次', '重评间隔天数',
        '禁止事项*', '禁忌说明', '前置工具编码', '替代工具编码', '进阶工具编码',
        '证据等级*', '证据来源', '效果指标', '失败标准', '准备事项', '所需材料', '输出物', '协同工具编码',
        '手册出处*', '版本*', '跨模块标签'],
      rows: toolRows,
    },
    '⑦b 工具-步骤明细': {
      headers: ['工具编码*', '步骤序号*', '步骤标题*', '步骤说明*', '预计耗时', '所需材料', '关键提示', '话术模板', '成功标准', '常见问题'],
      rows: stepRows,
    },
    '⑧ 工具-禁忌规则': {
      headers: ['工具编码*', '禁忌条件*', '禁忌类型*', '禁忌说明*', '替代建议', '适用教师群体', '依据'],
      rows: contraRows.length ? contraRows : [['', '', '', '', '', '', '']],
    },
  })
}

// ---- 关键词路由 ⑨ / 输出模板 ⑩ ----

function makeKeywordRouteSheets(m) {
  return buildWorkbook({
    '⑨ 关键词-路由': {
      headers: ['关键词编码*', '核心触发词*', '扩展词与近义表达', '排除词', '所属模块*', '匹配优先级*', '匹配模式',
        '风险等级*', '语义分类', '关联量表编码', '关联工具编码', '情境限定', '路由权重', '时效性', '场景描述'],
      rows: m.routes.map(([code, core, expand, exclude, pri, mode, risk, cat, scale, tool, weight, desc]) => [
        code, core, expand, exclude, m.code, String(pri), mode, risk, cat, scale, tool, '', String(weight), 'always', desc,
      ]),
    },
  })
}

function makeOutputTemplateSheets(m) {
  return buildWorkbook({
    '⑩ 方案输出模板': {
      headers: ['模板编码*', '所属模块*', '命中归因等级*', '模板类型*', '模板内容*', '占位符说明', '排序*'],
      rows: m.templates.map(([level, type, content], index) => [
        `${m.code.toUpperCase()}_TPL_${level.toUpperCase()}_${type.toUpperCase()}`, m.code, level, type, content,
        '${主要归因} 替换为占比最高的归因名称；${次要归因} 替换为第 2-3 条归因名称',
        String(index + 1),
      ]),
    },
  })
}

function buildWorkbook(sheets) {
  const wb = XLSX.utils.book_new()
  for (const [name, { headers, rows }] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), name)
  }
  return wb
}

// ---- API ----

async function login() {
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD }),
    redirect: 'manual',
  })
  if (!res.ok) throw new Error(`登录失败: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const setCookie = res.headers.getSetCookie?.() || res.headers.get('set-cookie') || ''
  return Array.isArray(setCookie) ? setCookie.join('; ') : setCookie
}

async function importFile(cookie, module, libraryType, libraryName, workbook) {
  const contentBase64 = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }).toString('base64')
  const res = await fetch(`${BASE_URL}/api/v1/platform-admin/module-resources/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      module, libraryType, scope: 'global', libraryName, version: VERSION,
      notes: 'v3 三库样例数据 1.0.0',
      filename: `${module}_${libraryType}.xlsx`,
      contentBase64, confirmNoPersonalData: true, publish: true,
    }),
    redirect: 'manual',
  })
  return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 400) }
}

// ---- 主流程 ----

const BUILDERS = {
  assessment: makeAssessmentSheets,
  attribution: makeAttributionSheets,
  tool: makeToolSheets,
  keyword_route: makeKeywordRouteSheets,
  output_template: makeOutputTemplateSheets,
}

async function main() {
  const args = process.argv.slice(2)
  const typeFilter = args.find(a => a.startsWith('--type='))?.split('=')[1] || null
  const noImport = args.includes('--no-import')
  const cleanFiles = args.includes('--clean-files')

  console.log('=== 三库样例数据生成（v3 多归因结构）===')
  if (typeFilter) console.log(`  仅处理类型: ${typeFilter}`)
  if (noImport) console.log('  仅生成文件，不导入')
  if (cleanFiles) console.log('  先删除旧测试数据文件')
  console.log()

  let cookie = null
  if (!noImport) {
    try {
      cookie = await login()
      console.log('平台管理员登录成功\n')
    } catch (e) {
      console.error('登录失败:', e.message)
      console.error('请确认 dev server 已启动且 seed 数据就绪；只想生成文件请加 --no-import')
      process.exit(1)
    }
  }

  if (cleanFiles && !typeFilter) rmSync(BASE_DIR, { recursive: true, force: true })
  for (const m of MODULES) mkdirSync(`${BASE_DIR}/${m.code}`, { recursive: true })

  let ok = 0
  let fail = 0
  const failures = []

  for (const m of MODULES) {
    for (const libType of LIB_TYPES) {
      if (typeFilter && libType !== typeFilter) continue
      process.stdout.write(`  ${m.code}/${libType}... `)
      let wb
      try {
        wb = BUILDERS[libType](m)
      } catch (e) {
        console.log(`生成失败: ${e.message}`)
        failures.push(`${m.code}/${libType} 生成失败`)
        fail++
        continue
      }
      XLSX.writeFile(wb, `${BASE_DIR}/${m.code}/${libType}.xlsx`)

      if (noImport) {
        console.log('已生成')
        ok++
        continue
      }
      const result = await importFile(cookie, m.code, libType, `${m.label}·${TYPE_LABELS[libType]}`, wb)
      if (result.ok) {
        console.log('OK')
        ok++
      } else {
        console.log(`FAIL (${result.status})`)
        failures.push(`${m.code}/${libType} HTTP ${result.status}: ${result.body}`)
        fail++
      }
    }
  }

  console.log(`\n=== 完成: ${ok} 成功, ${fail} 失败 ===`)
  for (const f of failures) console.log(`  ${f}`)
  if (fail) process.exitCode = 1
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})

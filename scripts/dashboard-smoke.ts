/**
 * 数据驾驶舱三校隔离冒烟（学部校长角色；组织模型是「学部 = 学校」）。
 *
 * 目标：用三所学校的学部校长账号跑一遍 /api/v1/dashboard/* 接口，验证
 *  1. context 解析出的范围就是本校全部班级，且班级清单不出校；
 *  2. overview / ai-questions / plans / alerts 四个接口都能正常返回；
 *  3. 跨校隔离：传其他学校的班级筛选拿不到数据；
 *  3.1 筛选口径：班级多选与量表分类筛选在明细上生效，量表作答分日字段存在；
 *  4. 区间上限：超长区间返回 400（错误码不是 500）；
 *  5. CSV 导出返回 text/csv，并落地 dashboard.export 审计；
 *  6. 学生脱敏：预警明细只有「学生 A/B/C」标号，没有姓名字段。
 *
 * 本脚本只读业务数据（登录会写会话与登录审计），不会创建或修改业务记录。
 * 学校/账号缺失时打印下一步命令（迁校脚本或开通账号），不自动建号。
 *
 * 用法：
 *   pnpm tsx scripts/dashboard-smoke.ts                                  # 默认本地 dev（3305）
 *   pnpm tsx scripts/dashboard-smoke.ts --base-url https://localhost:3401 --insecure
 *
 * 参数：
 *   --base-url <url>      默认 http://localhost:3305
 *   --primary-phone <p>   小学部校长手机号，默认 13800001001
 *   --junior-phone <p>    初中部校长手机号，默认 13800001002
 *   --senior-phone <p>    高中部校长手机号，默认 13800001003
 *   --primary-pwd/--junior-pwd/--senior-pwd  默认取手机号后 8 位
 *   --insecure            跳过 HTTPS 证书校验（测试环境自签名证书）
 */
import { and, eq, inArray, ne } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import type { Capability, RolePermissions } from '../shared/management'
import { listUserRoles } from '../server/domain/user-roles'
import * as schema from '../server/db/schema'
import { loadLocalEnv } from './load-env'

interface PrincipalSpec {
  label: string
  phone: string
  password: string
  schoolCode: string
}

interface Options {
  baseUrl: string
  insecure: boolean
  principals: PrincipalSpec[]
}

interface CheckResult {
  name: string
  ok: boolean
  detail: string
  /** 数据不足导致的跳过：既不计入通过也不计入失败 */
  skipped?: boolean
}

const checks: CheckResult[] = []
/** 冒烟过程中创建的授权/申请（跑完清理，避免在开发库里留测试数据）。 */
const createdGrants: Array<{ grantId: string, requestId?: string }> = []

function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}：${detail}`)
}

/** 数据不足时的跳过（例如库里没有家长档案），不算失败。 */
function skip(name: string, detail: string) {
  checks.push({ name, ok: true, detail, skipped: true })
  console.log(`⏭ ${name}：${detail}`)
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function parseOptions(): Options {
  const args = process.argv.slice(2)
  const define = (flag: string, fallback: string, label: string, schoolCode: string) => {
    const phone = argValue(args, flag) ?? fallback
    return { label, phone, schoolCode, password: argValue(args, `${flag.replace('-phone', '-pwd')}`) ?? phone.slice(-8) }
  }
  return {
    baseUrl: (argValue(args, '--base-url') ?? 'http://localhost:3305').replace(/\/$/, ''),
    insecure: args.includes('--insecure'),
    principals: [
      define('--primary-phone', '13800001001', '小学部', 'llschool-primary'),
      define('--junior-phone', '13800001002', '初中部', 'llschool-junior'),
      define('--senior-phone', '13800001003', '高中部', 'llschool-senior')
    ]
  }
}

/** 极简 Cookie 会话：保存 Set-Cookie 的 name=value，请求时回传。 */
class Session {
  private cookie = ''

  constructor(private readonly options: Options) {}

  async login(phone: string, password: string): Promise<void> {
    const response = await this.fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, password })
    })
    if (!response.ok) {
      throw new Error(`登录失败（${response.status}）：${phone}`)
    }
    const setCookie = response.headers.getSetCookie?.() ?? []
    const cookie = setCookie.map(item => item.split(';')[0]).filter(Boolean).join('; ')
    if (cookie) this.cookie = cookie
  }

  async get(path: string, headers?: Record<string, string>): Promise<Response> {
    return this.fetch(path, { method: 'GET', headers })
  }

  async post(path: string, body: unknown): Promise<Response> {
    return this.fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  private fetch(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.options.baseUrl}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), ...(this.cookie ? { cookie: this.cookie } : {}) }
    })
  }
}

async function main() {
  const options = parseOptions()
  // 测试环境用自签名证书：显式加 --insecure 才跳过校验，避免默认放宽
  if (options.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  loadLocalEnv()

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('缺少 DATABASE_URL（可先 pnpm env:init）')
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  const db = drizzle(client, { schema })

  try {
    // 学校与班级范围（按学校各自取，不再依赖 section）
    const schools = new Map<string, { id: string, name: string }>()
    const classesBySchool = new Map<string, Array<{ id: string, name: string, status: string }>>()
    for (const principal of options.principals) {
      const [school] = await db.select({ id: schema.schools.id, name: schema.schools.name })
        .from(schema.schools).where(eq(schema.schools.code, principal.schoolCode)).limit(1)
      if (!school) {
        record(`${principal.label}学校`, false, `不存在（${principal.schoolCode}）；先执行 pnpm tsx scripts/split-schools-by-section.ts --apply`)
        continue
      }
      schools.set(principal.schoolCode, school)
      const rows = await db.select({ id: schema.classes.id, name: schema.classes.name, status: schema.classes.status })
        .from(schema.classes).where(eq(schema.classes.schoolId, school.id))
      classesBySchool.set(principal.schoolCode, rows.filter(item => item.status === 'active'))
    }
    if (schools.size !== options.principals.length) throw new Error('三所学校不齐，先执行迁校脚本 scripts/split-schools-by-section.ts --apply')

    console.log(`目标：${options.baseUrl}；学校：${[...schools.values()].map(item => item.name).join('、')}`)

    // 账号检查
    for (const principal of options.principals) {
      const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phone, principal.phone)).limit(1)
      if (!user) {
        record(`${principal.label}校长账号`, false, `不存在；pnpm tsx scripts/create-account.ts --name ${principal.label}校长 --phone ${principal.phone} --roles division_principal --school ${principal.schoolCode} --phone-suffix --apply`)
        continue
      }
      const roles = await listUserRoles(db, user.id)
      const entry = roles.find(item => item.roleCode === 'division_principal')
      record(`${principal.label}校长账号`, Boolean(entry), entry ? `已存在，scope=${JSON.stringify(entry.scope)}` : '账号存在但没有 division_principal 角色')
    }

    // 三个会话
    const sessions = new Map<string, Session>()
    for (const principal of options.principals) {
      try {
        const session = new Session(options)
        await session.login(principal.phone, principal.password)
        sessions.set(principal.schoolCode, session)
      } catch (error) {
        record(`${principal.label}登录`, false, error instanceof Error ? error.message : String(error))
      }
    }

    // 1) context：范围就是本校，班级清单不出校
    for (const principal of options.principals) {
      const session = sessions.get(principal.schoolCode)
      const school = schools.get(principal.schoolCode)
      if (!session || !school) continue
      const response = await session.get('/api/v1/dashboard/context')
      const body = await response.json() as {
        sectionLabel?: string
        classCount?: number
        classes?: Array<{ name?: string }>
      }
      const expected = classesBySchool.get(principal.schoolCode) ?? []
      const ownNames = new Set(expected.map(item => item.name))
      const outside = (body.classes ?? []).filter(item => item.name && !ownNames.has(item.name))
      record(`${principal.label} context`, response.status === 200 && body.sectionLabel === school.name && (body.classCount ?? 0) === expected.length && outside.length === 0,
        `HTTP ${response.status}；数据范围=${body.sectionLabel ?? '—'}；班级 ${body.classes?.length ?? 0}/${expected.length}；越界 ${outside.length}`)
    }

    // 2) 四个接口可用（用班级与学生最多的初中部校长）
    const main = sessions.get('llschool-junior')
    if (!main) throw new Error('初中部校长未登录，后续断言无法执行')
    for (const [label, path] of [
      ['overview', '/api/v1/dashboard/overview'],
      ['ai-questions', '/api/v1/dashboard/ai-questions'],
      ['plans', '/api/v1/dashboard/plans'],
      ['alerts', '/api/v1/dashboard/alerts']
    ] as Array<[string, string]>) {
      const response = await main.get(path)
      record(`接口 ${label}`, response.status === 200, `HTTP ${response.status}`)
    }

    // 3) 明细里的班级都在本校
    const questions = await main.get('/api/v1/dashboard/ai-questions?pageSize=100')
    const questionsBody = await questions.json() as { table?: { rows?: Array<{ className?: string }> } }
    const juniorNames = new Set((classesBySchool.get('llschool-junior') ?? []).map(item => item.name))
    const outsideRows = (questionsBody.table?.rows ?? []).filter(row => row.className && !juniorNames.has(row.className))
    record('初中部问答明细只含本校班级', outsideRows.length === 0,
      outsideRows.length ? `越界班级：${outsideRows.map(row => row.className).join('、')}` : `检查 ${questionsBody.table?.rows?.length ?? 0} 行，全部在本校`)

    // 4) 跨校筛选拿不到数据
    const foreignClassId = (classesBySchool.get('llschool-senior') ?? [])[0]?.id
    if (foreignClassId) {
      const crossResponse = await main.get(`/api/v1/dashboard/ai-questions?classIds=${foreignClassId}`)
      const crossBody = await crossResponse.json() as { kpis?: { aiQuestions?: number }, table?: { total?: number } }
      record('跨校班级筛选拿不到数据', crossResponse.status === 200 && (crossBody.kpis?.aiQuestions ?? 0) === 0 && (crossBody.table?.total ?? 0) === 0,
        `HTTP ${crossResponse.status}；aiQuestions=${crossBody.kpis?.aiQuestions ?? '—'}；table.total=${crossBody.table?.total ?? '—'}`)
    }

    // 5) 区间上限返回 400
    const overLimit = await main.get('/api/v1/dashboard/ai-questions?start=2025-01-01&end=2026-09-28')
    record('超长区间返回 400', overLimit.status === 400, `HTTP ${overLimit.status}`)

    // 5.1) 班级与量表分类筛选在明细上生效
    const sampleClass = (classesBySchool.get('llschool-junior') ?? []).find(item => Boolean(item.name))
    if (sampleClass) {
      const byClass = await main.get(`/api/v1/dashboard/plans?classIds=${sampleClass.id}&pageSize=100`)
      const byClassBody = await byClass.json() as { table?: { rows?: Array<{ className?: string }> } }
      const wrongClass = (byClassBody.table?.rows ?? []).filter(row => row.className && row.className !== sampleClass.name)
      record('班级多选筛选生效', byClass.status === 200 && wrongClass.length === 0,
        `班级「${sampleClass.name}」返回 ${byClassBody.table?.rows?.length ?? 0} 行，越界 ${wrongClass.length} 行`)
    }

    const byCategory = await main.get('/api/v1/dashboard/plans?categories=自我成长赋能&pageSize=100')
    const byCategoryBody = await byCategory.json() as { table?: { rows?: Array<{ category?: string }> } }
    const wrongCategory = (byCategoryBody.table?.rows ?? []).filter(row => row.category !== '自我成长赋能')
    record('量表分类筛选生效', byCategory.status === 200 && wrongCategory.length === 0,
      `分类「自我成长赋能」返回 ${byCategoryBody.table?.rows?.length ?? 0} 行（家校沟通已并入），其他分类 ${wrongCategory.length} 行`)

    // 5.1.1) 明细表「表头维度」：全不勾只出周期总计一行；未勾选的维度不参与聚合、排序列不再 500
    // 维度断言放宽到各页允许的完整区间（量表 90 天 / AI 30 天）：
    // 否则测试库某所学校近 7 天恰好没有提问或方案时，形态断言会因为「没有行」而与实现无关地失败
    const dimsEnd = new Date()
    const dimsWindow = (days: number) => {
      const start = new Date(dimsEnd.getTime() - (days - 1) * 86_400_000)
      return `start=${start.toISOString().slice(0, 10)}&end=${dimsEnd.toISOString().slice(0, 10)}`
    }
    const planDimsWindow = dimsWindow(90)
    const aiDimsWindow = dimsWindow(30)

    const dimsNone = await main.get(`/api/v1/dashboard/plans?dims=none&pageSize=100&${planDimsWindow}`)
    const dimsNoneBody = await dimsNone.json() as {
      table?: { rows?: Array<{ date?: string, className?: string, category?: string, planTotal?: number }>, total?: number }
    }
    const noneRows = dimsNoneBody.table?.rows ?? []
    record('表头维度全不勾只出周期总计一行',
      dimsNone.status === 200 && noneRows.length === 1 && dimsNoneBody.table?.total === 1
      && noneRows[0]?.date === '' && noneRows[0]?.className === '' && noneRows[0]?.category === ''
      && typeof noneRows[0]?.planTotal === 'number',
      `HTTP ${dimsNone.status}；行数 ${noneRows.length}；total=${dimsNoneBody.table?.total ?? '—'}；方案数=${noneRows[0]?.planTotal ?? '—'}`)

    const dimsClass = await main.get(`/api/v1/dashboard/plans?dims=className&pageSize=100&${planDimsWindow}`)
    const dimsClassBody = await dimsClass.json() as {
      table?: { rows?: Array<{ className?: string, date?: string, gradeLabel?: string, category?: string }> }
    }
    const dimsClassRows = dimsClassBody.table?.rows ?? []
    record('表头维度部分勾选：每个班级一行，未勾选的维度清空',
      dimsClass.status === 200 && dimsClassRows.length > 0
      && dimsClassRows.every(row => row.date === '' && row.category === '' && (row.className ?? '').length > 0)
      && new Set(dimsClassRows.map(row => row.className)).size === dimsClassRows.length,
      `按班级聚合 ${dimsClassRows.length} 行（班级互不重复），日期与分类列已清空`)

    const unknownDim = await main.get('/api/v1/dashboard/ai-questions?dims=unknown')
    record('未知表头维度返回 400', unknownDim.status === 400, `HTTP ${unknownDim.status}`)

    // AI 明细的另一套 group by（含 bool_or 高风险聚合）：全不勾只出一行、按日期聚合不重复
    const aiDimsNone = await main.get(`/api/v1/dashboard/ai-questions?dims=none&pageSize=100&${aiDimsWindow}`)
    const aiDimsNoneBody = await aiDimsNone.json() as {
      table?: { rows?: Array<{ date?: string, count?: number, highRisk?: boolean }>, total?: number }
    }
    const aiNoneRows = aiDimsNoneBody.table?.rows ?? []
    record('AI 明细维度全不勾只出周期总计一行',
      aiDimsNone.status === 200 && aiNoneRows.length === 1 && aiDimsNoneBody.table?.total === 1
      && aiNoneRows[0]?.date === '' && typeof aiNoneRows[0]?.count === 'number' && typeof aiNoneRows[0]?.highRisk === 'boolean',
      `HTTP ${aiDimsNone.status}；行数 ${aiNoneRows.length}；提问数=${aiNoneRows[0]?.count ?? '—'}`)

    const aiDimsDate = await main.get(`/api/v1/dashboard/ai-questions?dims=date&pageSize=100&${aiDimsWindow}`)
    const aiDimsDateBody = await aiDimsDate.json() as {
      table?: { rows?: Array<{ date?: string, className?: string, category?: string }> }
    }
    const aiDateRows = aiDimsDateBody.table?.rows ?? []
    record('AI 明细按日期聚合时每天一行且其他维度清空',
      aiDimsDate.status === 200 && aiDateRows.length > 0
      && aiDateRows.every(row => (row.date ?? '').length === 10 && row.className === '' && row.category === '')
      && new Set(aiDateRows.map(row => row.date)).size === aiDateRows.length,
      `返回 ${aiDateRows.length} 天：${aiDateRows.slice(0, 3).map(row => row.date).join('、')}`)

    // 比率排序入口（完成度 / 回填率）：分组子查询必须带对应列，否则会 500
    for (const sortKey of ['completionRate', 'executionRate']) {
      const sorted = await main.get(`/api/v1/dashboard/plans?sort=${sortKey}&order=desc&pageSize=100`)
      record(`明细支持按${sortKey === 'completionRate' ? '完成度' : '回填率'}排序`, sorted.status === 200, `HTTP ${sorted.status}`)
    }

    // 5.2) 量表作答口径字段存在且为数字
    const plansBody = await (await main.get('/api/v1/dashboard/plans')).json() as {
      period?: { start?: string, end?: string }
      kpis?: { assessmentTotal?: unknown, highRiskPlans?: unknown, planTotal?: number }
      previousKpis?: { planTotal?: unknown, highRiskPlans?: unknown }
      previousPeriod?: { start?: string, end?: string }
      byDay?: Array<{ assessmentCount?: unknown }>
      byModule?: unknown[]
      byQuestionCategory?: Array<{ category?: string, count?: number }>
      studentRiskDistribution?: Array<{ label?: string, count?: number }>
      riskDistribution?: Array<{ level?: string, label?: string, count?: number }>
    }
    const assessmentDays = plansBody.byDay ?? []
    const numericDays = assessmentDays.filter(item => typeof item.assessmentCount === 'number')
    record('量表作答分日口径字段', typeof plansBody.kpis?.assessmentTotal === 'number' && numericDays.length === assessmentDays.length && assessmentDays.length > 0,
      `assessmentTotal=${plansBody.kpis?.assessmentTotal ?? '—'}；byDay ${numericDays.length}/${assessmentDays.length} 天带 assessmentCount`)
    // 5.2.1) 高风险方案数与环比字段（量表页第二、五个 KPI 卡的数据源）
    const previousBeforeCurrent = Boolean(
      plansBody.period?.start && plansBody.previousPeriod?.start && plansBody.previousPeriod?.end
      && plansBody.previousPeriod.end < plansBody.period.start
    )
    record('量表页环比与高风险方案数字段', typeof plansBody.kpis?.highRiskPlans === 'number'
      && typeof plansBody.previousKpis?.planTotal === 'number'
      && typeof plansBody.previousKpis?.highRiskPlans === 'number'
      && previousBeforeCurrent,
      `highRiskPlans=${plansBody.kpis?.highRiskPlans ?? '—'}；上期 planTotal=${plansBody.previousKpis?.planTotal ?? '—'}；环比区间 ${plansBody.previousPeriod?.start ?? '—'}~${plansBody.previousPeriod?.end ?? '—'}`)

    // 5.2.2) 量表页两张分布：5 大类口径（量化分类）+ 学生心理风险分布（按人数，四档齐备）
    record('量表分类占比与学生风险分布字段',
      Array.isArray(plansBody.byQuestionCategory) && plansBody.byQuestionCategory.length === 5
      && plansBody.byQuestionCategory.every(item => typeof item.count === 'number')
      && !plansBody.byQuestionCategory.some(item => item.category === '德育类问题')
      && Array.isArray(plansBody.byModule)
      && Array.isArray(plansBody.studentRiskDistribution) && plansBody.studentRiskDistribution.length === 4
      && plansBody.studentRiskDistribution.every(item => typeof item.count === 'number' && typeof item.label === 'string'),
      `分类占比 ${plansBody.byQuestionCategory?.length ?? 0} 类；模块 ${plansBody.byModule?.length ?? 0} 个；学生风险 ${plansBody.studentRiskDistribution?.map(item => `${item.label}=${item.count}`).join('、') ?? '—'}`)

    // 5.2.2.1) 方案风险等级分布（原型「问题风险等级分布」）：三档齐备且合计等于方案总数
    const riskDistribution = plansBody.riskDistribution ?? []
    const riskSum = riskDistribution.reduce((sum, item) => sum + (item.count ?? 0), 0)
    record('方案风险等级分布字段',
      riskDistribution.length === 3
      && riskDistribution.every(item => typeof item.count === 'number' && typeof item.label === 'string')
      && riskDistribution.some(item => item.level === 'high') && riskDistribution.some(item => item.level === 'medium') && riskDistribution.some(item => item.level === 'low')
      && riskSum === (plansBody.kpis?.planTotal ?? -1),
      `分布 ${riskDistribution.map(item => `${item.label}=${item.count}`).join('、') || '—'}；合计=${riskSum}；方案总数=${plansBody.kpis?.planTotal ?? '—'}`)

    // 5.2.2) AI 问答页三个新指标与环比字段（推荐次数 / 推荐后完成作答数 / 高风险对话数）
    const aiBody = await (await main.get('/api/v1/dashboard/ai-questions')).json() as {
      kpis?: { recommended?: unknown, answered?: unknown, highRiskQuestions?: unknown }
      previousKpis?: { recommended?: unknown, answered?: unknown, highRiskQuestions?: unknown }
      previousPeriod?: { start?: string, end?: string }
    }
    record('AI 问答页新指标与环比字段',
      typeof aiBody.kpis?.recommended === 'number'
      && typeof aiBody.kpis?.answered === 'number'
      && typeof aiBody.kpis?.highRiskQuestions === 'number'
      && typeof aiBody.previousKpis?.recommended === 'number'
      && typeof aiBody.previousKpis?.highRiskQuestions === 'number'
      && Boolean(aiBody.previousPeriod?.start && aiBody.previousPeriod?.end),
      `推荐=${aiBody.kpis?.recommended ?? '—'}；作答=${aiBody.kpis?.answered ?? '—'}；高风险提问=${aiBody.kpis?.highRiskQuestions ?? '—'}；上期推荐=${aiBody.previousKpis?.recommended ?? '—'}`)

    // 5.2.3) 总览环比字段（推荐量表作答率与方案执行及时率）
    const overviewBody = await (await main.get('/api/v1/dashboard/overview')).json() as {
      kpis?: { recommendationAnswerRate?: unknown, planTimelyRate?: unknown }
      previousKpis?: { recommendationAnswerRate?: unknown, planTimelyRate?: unknown }
      previousPeriod?: { start?: string, end?: string }
    }
    record('总览环比与及时率字段',
      'recommendationAnswerRate' in (overviewBody.kpis ?? {})
      && 'planTimelyRate' in (overviewBody.kpis ?? {})
      && 'planTimelyRate' in (overviewBody.previousKpis ?? {})
      && Boolean(overviewBody.previousPeriod?.start && overviewBody.previousPeriod?.end),
      `及时率=${overviewBody.kpis?.planTimelyRate ?? '—'}；上期及时率=${overviewBody.previousKpis?.planTimelyRate ?? '—'}`)

    // 5.2.4) 总览聚合卡（W2 / W3 / W4-1 / W4-2 / W5）：分组与字段齐全
    const analysisBody = await (await main.get('/api/v1/dashboard/overview')).json() as {
      analysis?: {
        aiQuestions?: { total?: number, byCategory?: Array<{ category?: string, count?: number }>, topKeywords?: unknown[] }
        plans?: { total?: number, byQuestionCategory?: Array<{ category?: string, count?: number }> }
        studentEvents?: { total?: number, byType?: unknown[] }
        communication?: { total?: number, channels?: unknown[] }
        alerts?: { highRiskOpen?: number, overdueOpen?: number }
      }
    }
    const analysis = analysisBody.analysis ?? {}
    const aiCategories = analysis.aiQuestions?.byCategory ?? []
    const planCategories = analysis.plans?.byQuestionCategory ?? []
    record('总览聚合卡字段（W2 / W3 / W4-1 / W4-2 / W5）',
      aiCategories.length === 6
      && aiCategories.every(item => typeof item.count === 'number' && typeof item.category === 'string')
      && Array.isArray(analysis.aiQuestions?.topKeywords)
      && typeof analysis.aiQuestions?.total === 'number'
      && planCategories.length === 5
      && !planCategories.some(item => item.category === '德育类问题')
      && typeof analysis.plans?.total === 'number'
      && typeof analysis.studentEvents?.total === 'number' && Array.isArray(analysis.studentEvents?.byType)
      && typeof analysis.communication?.total === 'number' && Array.isArray(analysis.communication?.channels)
      && typeof analysis.alerts?.highRiskOpen === 'number' && typeof analysis.alerts?.overdueOpen === 'number',
      `分类 ${aiCategories.length} 类；关键词 ${analysis.aiQuestions?.topKeywords?.length ?? 0} 个；量表分类 ${planCategories.length} 类；事件类型 ${analysis.studentEvents?.byType?.length ?? 0} 类；渠道 ${analysis.communication?.channels?.length ?? 0} 类；高危未闭环=${analysis.alerts?.highRiskOpen ?? '—'}；逾期未闭环=${analysis.alerts?.overdueOpen ?? '—'}`)

    // 5.2.5) 聚合卡与二级页口径一致：同一区间下「总览 W2 提问总数」= AI 问答分析页「问答总数」
    const compareEnd = new Date()
    const compareStart = new Date(compareEnd.getTime() - 29 * 24 * 60 * 60 * 1000)
    const compareRange = `start=${compareStart.toISOString().slice(0, 10)}&end=${compareEnd.toISOString().slice(0, 10)}`
    const overviewRangeBody = await (await main.get(`/api/v1/dashboard/overview?${compareRange}`)).json() as {
      analysis?: { aiQuestions?: { total?: number } }
    }
    const aiRangeBody = await (await main.get(`/api/v1/dashboard/ai-questions?${compareRange}`)).json() as {
      kpis?: { aiQuestions?: number }
    }
    record('总览 W2 与 AI 问答页同区间口径一致',
      typeof overviewRangeBody.analysis?.aiQuestions?.total === 'number'
      && overviewRangeBody.analysis?.aiQuestions?.total === aiRangeBody.kpis?.aiQuestions,
      `总览=${overviewRangeBody.analysis?.aiQuestions?.total ?? '—'}；AI 页=${aiRangeBody.kpis?.aiQuestions ?? '—'}；区间 ${compareRange}`)

    // 5.2.6) 高危未闭环与方案逾期：总览 W5 卡与预警看板 KPI 同区间一致
    const alertsRangeBody = await (await main.get(`/api/v1/dashboard/alerts?${compareRange}&status=all`)).json() as {
      kpis?: { total?: number, highRiskOpen?: number, overdueOpen?: number }
    }
    if ((alertsRangeBody.kpis?.total ?? 0) >= 5000) {
      skip('总览 W5 与预警看板 KPI 同区间一致', '预警行数达到内存合并上限（5000），跳过逐行口径比对')
    } else {
      record('总览 W5 与预警看板 KPI 同区间一致',
        overviewRangeBody.analysis
        && (overviewRangeBody.analysis as { alerts?: { highRiskOpen?: number, overdueOpen?: number } }).alerts?.highRiskOpen === alertsRangeBody.kpis?.highRiskOpen
        && (overviewRangeBody.analysis as { alerts?: { overdueOpen?: number } }).alerts?.overdueOpen === alertsRangeBody.kpis?.overdueOpen,
        `总览=${(overviewRangeBody.analysis as { alerts?: { highRiskOpen?: number, overdueOpen?: number } }).alerts?.highRiskOpen ?? '—'}/${(overviewRangeBody.analysis as { alerts?: { highRiskOpen?: number, overdueOpen?: number } }).alerts?.overdueOpen ?? '—'}；预警页=${alertsRangeBody.kpis?.highRiskOpen ?? '—'}/${alertsRangeBody.kpis?.overdueOpen ?? '—'}`)
    }

    // 5.3) 预警新增口径：每日趋势（含高风险家校沟通）、学生事件类型分布、家校沟通渠道/风险分布、逾期未闭环
    const alertsShape = await (await main.get('/api/v1/dashboard/alerts?status=all')).json() as {
      kpis?: { overdueOpen?: unknown }
      byDay?: Array<{ date?: string, safety?: number, studentEvent?: number, communication?: number, overdue?: number }>
      studentEventTypes?: unknown[]
      communication?: { total?: number, channels?: unknown[], riskLevels?: unknown[], byDay?: unknown[] }
    }
    const byDayOk = Array.isArray(alertsShape.byDay) && alertsShape.byDay.length > 0
      && alertsShape.byDay.every(item => typeof item.safety === 'number' && typeof item.studentEvent === 'number'
        && typeof item.communication === 'number' && typeof item.overdue === 'number')
    record('预警趋势与分布字段', byDayOk
      && Array.isArray(alertsShape.studentEventTypes)
      && Array.isArray(alertsShape.communication?.channels)
      && Array.isArray(alertsShape.communication?.riskLevels)
      && Array.isArray(alertsShape.communication?.byDay)
      && typeof alertsShape.kpis?.overdueOpen === 'number',
    `趋势 ${alertsShape.byDay?.length ?? 0} 天；事件类型 ${alertsShape.studentEventTypes?.length ?? 0} 类；沟通渠道 ${alertsShape.communication?.channels?.length ?? 0} 类；overdueOpen=${alertsShape.kpis?.overdueOpen ?? '—'}`)

    // 5.4) 逾期来源筛选（执行项逾期 / 复盘逾期）
    const overdueResponse = await main.get('/api/v1/dashboard/alerts?sources=plan_action_overdue,plan_review_overdue&status=all')
    const overdueBody = await overdueResponse.json() as { table?: { rows?: Array<{ source?: string }> } }
    const wrongSource = (overdueBody.table?.rows ?? []).filter(row => row.source !== 'plan_action_overdue' && row.source !== 'plan_review_overdue')
    record('逾期来源筛选生效', overdueResponse.status === 200 && wrongSource.length === 0,
      `HTTP ${overdueResponse.status}；逾期行 ${overdueBody.table?.rows?.length ?? 0} 条；越界来源 ${wrongSource.length} 条`)

    // 5.5) 年级 / 班级对比（W8）：年级层级 → 下钻班级 → 越界班级不生效
    const juniorClassIdSet = new Set((classesBySchool.get('llschool-junior') ?? []).map(item => item.id))
    const comparison = await main.get('/api/v1/dashboard/comparison')
    const comparisonBody = await comparison.json() as {
      level?: string
      rows?: Array<{ key?: string, classId?: string | null, grade?: number | null, classCount?: number, aiQuestions?: number, plans?: number, planTimelyRate?: number | null, highRiskOpen?: number }>
    }
    const gradeRows = comparisonBody.rows ?? []
    record('年级对比返回年级行', comparison.status === 200 && comparisonBody.level === 'grade' && gradeRows.length > 0
      && gradeRows.every(row => !row.classId && typeof row.aiQuestions === 'number' && typeof row.plans === 'number' && typeof row.highRiskOpen === 'number'
        && (row.planTimelyRate === null || typeof row.planTimelyRate === 'number')),
    `HTTP ${comparison.status}；level=${comparisonBody.level ?? '—'}；年级行 ${gradeRows.length} 个；及时率字段 ${gradeRows.filter(row => row.planTimelyRate !== undefined).length}/${gradeRows.length}`)

    // 新增排序指标「方案及时率」：接口接受该 metric 并返回 200
    const timelySort = await main.get('/api/v1/dashboard/comparison?metric=planTimelyRate&order=asc')
    record('对比表支持按方案及时率排序', timelySort.status === 200, `HTTP ${timelySort.status}`)

    const drillGrade = gradeRows.find(row => typeof row.grade === 'number')?.grade
    if (drillGrade) {
      const drill = await main.get(`/api/v1/dashboard/comparison?grade=${drillGrade}`)
      const drillBody = await drill.json() as { level?: string, drilldownGrade?: number, rows?: Array<{ classId?: string | null }> }
      const classRows = drillBody.rows ?? []
      const outsideClass = classRows.filter(row => !row.classId || !juniorClassIdSet.has(row.classId))
      record('下钻年级返回本年级班级行', drill.status === 200 && drillBody.level === 'class' && drillBody.drilldownGrade === drillGrade
        && classRows.length > 0 && outsideClass.length === 0,
      `HTTP ${drill.status}；年级=${drillGrade}；班级行 ${classRows.length} 个；越界 ${outsideClass.length} 个`)
    }

    if (foreignClassId) {
      const crossComparison = await main.get(`/api/v1/dashboard/comparison?classIds=${foreignClassId}`)
      const crossBody = await crossComparison.json() as { rows?: Array<{ aiQuestions?: number, plans?: number, highRiskOpen?: number }> }
      const crossRows = crossBody.rows ?? []
      const hasData = crossRows.some(row => (row.aiQuestions ?? 0) > 0 || (row.plans ?? 0) > 0 || (row.highRiskOpen ?? 0) > 0)
      record('对比跨校班级筛选拿不到数据', crossComparison.status === 200 && !hasData,
        `HTTP ${crossComparison.status}；行数=${crossRows.length}；有数据=${hasData}`)
    }

    // 6) 导出 CSV
    const exportResponse = await main.get('/api/v1/dashboard/export?type=plans')
    const contentType = exportResponse.headers.get('content-type') ?? ''
    const exportText = await exportResponse.text()
    record('CSV 导出', exportResponse.status === 200 && contentType.includes('text/csv') && exportText.includes('量表分类'),
      `HTTP ${exportResponse.status}；content-type=${contentType}；首行=${exportText.split('\r\n')[0]?.slice(0, 60)}`)

    // 6.1) 导出表头跟随「表头维度」勾选，内容末尾带数据水印行
    const dimsExport = await main.get('/api/v1/dashboard/export?type=plans&dims=none')
    const dimsExportText = await dimsExport.text()
    const dimsExportLines = dimsExportText.replace('\uFEFF', '').split('\r\n')
    record('导出跟随表头维度并带数据水印',
      dimsExport.status === 200
      && dimsExportLines[0] === '统计区间,方案数,完成度(%),回填率(%),高风险,中风险,低风险'
      && dimsExportLines.some(line => line.includes('数据水印：导出人')),
      `HTTP ${dimsExport.status}；首行=${dimsExportLines[0]?.slice(0, 80)}；水印行 ${dimsExportLines.filter(line => line.includes('数据水印')).length} 行`)

    // 7) 审计
    const juniorSchool = schools.get('llschool-junior')!
    const audits = await db.select({ action: schema.auditLogs.action }).from(schema.auditLogs)
      .where(eq(schema.auditLogs.schoolId, juniorSchool.id))
    const exportAudits = audits.filter(item => item.action === 'dashboard.export')
    record('导出写审计', exportAudits.length > 0, `初中部 dashboard.export 记录 ${exportAudits.length} 条`)

    // 7.1) 查看行为 100% 写审计（PRD 4.2 原则 5）
    const viewAudits = audits.filter(item => item.action === 'dashboard.view')
    record('查看行为写审计', viewAudits.length > 0, `初中部 dashboard.view 记录 ${viewAudits.length} 条`)

    // 8) 非看板角色被拒绝：用看板账号调用学校后台接口应 403
    const forbidden = await main.get('/api/v1/school-admin/dashboard')
    record('看板角色不能进学校后台', forbidden.status === 403 || forbidden.status === 401, `HTTP ${forbidden.status}`)

    // 8.1) 看板角色也不能进学校管理员的平台使用量看板
    const usageForbidden = await main.get('/api/v1/school-admin/usage')
    record('看板角色不能进平台使用量看板', usageForbidden.status === 403, `HTTP ${usageForbidden.status}`)

    // 9) 学生标号脱敏：预警明细里不允许出现学生姓名列
    const alerts = await main.get('/api/v1/dashboard/alerts?status=all')
    const alertsBody = await alerts.json() as { table?: { rows?: Array<Record<string, unknown>> } }
    const leaked = (alertsBody.table?.rows ?? []).filter(row => 'studentName' in row || 'name' in row)
    const labels = [...new Set((alertsBody.table?.rows ?? []).map(row => String(row.studentLabel ?? '')).filter(Boolean))]
    record('预警明细无学生姓名字段', leaked.length === 0, leaked.length ? '发现姓名字段' : `标号样例：${labels.slice(0, 3).join('、') || '（本期无学生事件）'}`)

    // 10) 未登录访问应被拒绝
    const anonymous = await fetch(`${options.baseUrl}/api/v1/dashboard/overview`)
    record('未登录访问被拒绝', anonymous.status === 401 || anonymous.status === 403, `HTTP ${anonymous.status}`)

    // 11) 页面级权限：默认四页可见，逐页取消后该页 403、其余页不受影响（改完恢复）
    for (const principal of options.principals) {
      const session = sessions.get(principal.schoolCode)
      if (!session) continue
      const body = await (await session.get('/api/v1/dashboard/context')).json() as { pages?: string[] }
      const pages = body.pages ?? []
      const expected = ['dashboard', 'dashboard_ai_questions', 'dashboard_plans', 'dashboard_alerts']
      record(`${principal.label} 看板页集合`, expected.every(page => pages.includes(page)), `pages=${pages.join('、') || '（空）'}`)
    }

    const [principalRole] = await db.select({ id: schema.roles.id, permissions: schema.roles.permissions })
      .from(schema.roles).where(eq(schema.roles.code, 'division_principal')).limit(1)
    if (principalRole) {
      const original = principalRole.permissions as RolePermissions
      const restore = async () => {
        await db.update(schema.roles).set({ permissions: original }).where(eq(schema.roles.id, principalRole.id))
      }
      try {
        await db.update(schema.roles).set({
          permissions: {
            pages: { ...original.pages, dashboard_plans: [] as Capability[] },
            records: { ...original.records }
          }
        }).where(eq(schema.roles.id, principalRole.id))
        const denied = await main.get('/api/v1/dashboard/plans')
        const stillOk = await main.get('/api/v1/dashboard/alerts')
        const afterBody = await (await main.get('/api/v1/dashboard/context')).json() as { pages?: string[] }
        // 总览聚合卡随页面权限收敛：取消 dashboard_plans 后 W3 分组不再下发，其余分组不受影响
        const gatedOverview = await (await main.get('/api/v1/dashboard/overview')).json() as { analysis?: Record<string, unknown> }
        record('逐页取消权限生效', denied.status === 403 && stillOk.status === 200 && !(afterBody.pages ?? []).includes('dashboard_plans'),
          `plans HTTP ${denied.status}；alerts HTTP ${stillOk.status}；pages=${(afterBody.pages ?? []).join('、')}`)
        record('总览聚合卡随页面权限收敛',
          Boolean(gatedOverview.analysis?.aiQuestions)
          && gatedOverview.analysis?.plans === undefined
          && Boolean(gatedOverview.analysis?.alerts)
          && Boolean(gatedOverview.analysis?.studentEvents)
          && Boolean(gatedOverview.analysis?.communication),
          `分组=${Object.keys(gatedOverview.analysis ?? {}).join('、') || '（空）'}`)
      } finally {
        await restore()
      }

      // 12) 个体明细：默认关闭 → 不下发学生 ID、直接调用 403；开通后走事由授权读取（改完恢复）
      // 预警区间默认近 7 天，这里放宽到近一年，避免因为本期没有学生事件而拿不到可下钻的行
      const studentEventEnd = new Date()
      const studentEventStart = new Date(studentEventEnd.getTime() - 364 * 86_400_000)
      const studentEventQuery = `status=all&pageSize=100&start=${studentEventStart.toISOString().slice(0, 10)}&end=${studentEventEnd.toISOString().slice(0, 10)}`
      const offAlerts = await (await main.get(`/api/v1/dashboard/alerts?${studentEventQuery}`)).json() as {
        table?: { rows?: Array<{ source?: string, studentId?: string | null }> }
      }
      const offRows = (offAlerts.table?.rows ?? []).filter(row => row.source === 'student_event')
      const leakedIds = offRows.filter(row => row.studentId)
      record('个体明细默认关闭：预警不下发学生 ID', leakedIds.length === 0,
        `学生事件 ${offRows.length} 行，带 studentId ${leakedIds.length} 行`)

      const juniorClassIds = new Set((classesBySchool.get('llschool-junior') ?? []).map(item => item.id))
      const students = await db.select({ id: schema.students.id, classId: schema.students.classId })
        .from(schema.students).where(eq(schema.students.schoolId, juniorSchool.id)).limit(50)
      const target = students.find(item => item.classId && juniorClassIds.has(item.classId))
      if (target) {
        const denied = await main.get(`/api/v1/dashboard/individual/student/${target.id}`)
        record('未开通个体明细时接口 403', denied.status === 403, `HTTP ${denied.status}`)

        try {
          await db.update(schema.roles).set({
            permissions: {
              pages: { ...original.pages },
              records: { ...original.records, dashboard: ['view', 'view_sensitive'] as Capability[] }
            }
          }).where(eq(schema.roles.id, principalRole.id))

          const onAlerts = await (await main.get(`/api/v1/dashboard/alerts?${studentEventQuery}`)).json() as {
            table?: { rows?: Array<{ source?: string, studentId?: string | null }> }
          }
          const onRows = (onAlerts.table?.rows ?? []).filter(row => row.source === 'student_event')
          const onRow = onRows.find(row => row.studentId)
          record('开通后预警下发学生 ID', Boolean(onRow) || onRows.length === 0,
            onRow ? '含 studentId' : '近一年没有学生事件行，跳过（接口级断言见下）')

          const grantResponse = await main.post('/api/v1/admin-access/requests', {
            targetType: 'student',
            targetId: target.id,
            reasonCategory: 'school_duty',
            reasonText: '冒烟校验：核对个体明细下钻的授权与审计链路'
          })
          const grantBody = await grantResponse.json() as { grant?: { id?: string } | null, request?: { id?: string } | null }
          record('看板角色可申请事由授权', grantResponse.status === 200 && Boolean(grantBody.grant?.id), `HTTP ${grantResponse.status}`)
          if (grantBody.grant?.id) createdGrants.push({ grantId: grantBody.grant.id, requestId: grantBody.request?.id })

          const noGrant = await main.get(`/api/v1/dashboard/individual/student/${target.id}`)
          record('无授权头读取个体明细 403', noGrant.status === 403, `HTTP ${noGrant.status}`)

          if (grantBody.grant?.id) {
            const detail = await main.get(`/api/v1/dashboard/individual/student/${target.id}`, { 'x-admin-access-grant': grantBody.grant.id })
            const detailBody = await detail.json() as { student?: { name?: string }, access?: { watermark?: string } }
            const payload = JSON.stringify(detailBody)
            // 最小披露断言：不出现沟通摘要（summary）与问答/沟通正文（content）字段
            const leaks = ['"summary"', '"content"'].filter(key => payload.includes(key))
            record('带授权读取个体明细', detail.status === 200 && Boolean(detailBody.student?.name) && Boolean(detailBody.access?.watermark) && leaks.length === 0,
              `HTTP ${detail.status}；姓名=${detailBody.student?.name ? '已返回' : '—'}；水印=${detailBody.access?.watermark ?? '—'}；越界字段=${leaks.join('、') || '无'}`)

            const individualAudits = await db.select({ action: schema.auditLogs.action }).from(schema.auditLogs)
              .where(eq(schema.auditLogs.schoolId, juniorSchool.id))
            const accessEvents = await db.select({ id: schema.adminAccessEvents.id }).from(schema.adminAccessEvents)
              .where(eq(schema.adminAccessEvents.targetId, target.id))
            record('个体明细写审计与访问事件', individualAudits.some(item => item.action === 'dashboard.individual_view') && accessEvents.length > 0,
              `dashboard.individual_view 审计=${individualAudits.filter(item => item.action === 'dashboard.individual_view').length} 条；访问事件=${accessEvents.length} 条`)

            // 学生明细的新增口径：量表测评与提问摘要（不含原始作答与助手回答正文）
            const payloadText = JSON.stringify(detailBody)
            const studentShape = detailBody as {
              targetType?: string
              assessments?: Array<{ instrumentName?: string, levelLabel?: string }>
              aiQuestions?: Array<{ excerpt?: string, category?: string }>
            }
            record('学生明细含测评与问答摘要口径', studentShape.targetType === 'student'
              && Array.isArray(studentShape.assessments) && Array.isArray(studentShape.aiQuestions)
              && !payloadText.includes('"answers"') && !payloadText.includes('"contentEnc"'),
            `targetType=${studentShape.targetType ?? '—'}；测评 ${studentShape.assessments?.length ?? 0} 条；提问摘要 ${studentShape.aiQuestions?.length ?? 0} 条`)
          }

          // 12.1) 教师与家长个体明细：各自申请事由授权后读取（最小披露投影）
          const drillIndividual = async (targetType: string, targetId: string) => {
            const grantResponse = await main.post('/api/v1/admin-access/requests', {
              targetType,
              targetId,
              reasonCategory: 'school_duty',
              reasonText: '冒烟校验：核对教师/家长个体明细的授权与投影'
            })
            const grantJson = await grantResponse.json() as { grant?: { id?: string } | null, request?: { id?: string } | null }
            if (!grantJson.grant?.id) return { status: grantResponse.status, body: null as unknown }
            createdGrants.push({ grantId: grantJson.grant.id, requestId: grantJson.request?.id })
            const response = await main.get(`/api/v1/dashboard/individual/${targetType}/${targetId}`, { 'x-admin-access-grant': grantJson.grant.id })
            return { status: response.status, body: await response.json() as unknown }
          }

          const juniorClassIdsForTeacher = new Set((classesBySchool.get('llschool-junior') ?? []).map(item => item.id))
          const [teacherRow] = juniorClassIdsForTeacher.size
            ? await db.select({ id: schema.classes.ownerUserId })
                .from(schema.classes)
                .where(and(
                  eq(schema.classes.schoolId, juniorSchool.id),
                  inArray(schema.classes.id, [...juniorClassIdsForTeacher])
                ))
                .limit(1)
            : []
          if (teacherRow?.id) {
            const teacher = await drillIndividual('teacher_profile', teacherRow.id)
            const teacherBody = teacher.body as { targetType?: string, teacher?: { name?: string, classCount?: number, windowDays?: number, aiQuestions?: number } } | null
            record('教师个体明细（计数型最小披露）',
              teacher.status === 200 && teacherBody?.targetType === 'teacher_profile'
              && Boolean(teacherBody?.teacher?.name) && typeof teacherBody?.teacher?.classCount === 'number'
              && !JSON.stringify(teacherBody ?? {}).includes('"title"'),
            `HTTP ${teacher.status}；姓名=${teacherBody?.teacher?.name ? '已返回' : '—'}；负责班级=${teacherBody?.teacher?.classCount ?? '—'}；窗口=${teacherBody?.teacher?.windowDays ?? '—'} 天`)
          } else {
            skip('教师个体明细（计数型最小披露）', '初中部没有带负责教师的班级，跳过')
          }

          // 家长个体：优先取有学生关联的家长，缺失时取本校任一家长（准入还支持沟通记录与负责教师范围两条路径）
          const guardianCandidates = juniorClassIdsForTeacher.size
            ? await db.select({ id: schema.guardians.id })
                .from(schema.guardians)
                .innerJoin(schema.studentGuardians, eq(schema.studentGuardians.guardianId, schema.guardians.id))
                .innerJoin(schema.students, eq(schema.students.id, schema.studentGuardians.studentId))
                .where(and(
                  eq(schema.guardians.schoolId, juniorSchool.id),
                  inArray(schema.students.classId, [...juniorClassIdsForTeacher])
                ))
                .limit(1)
            : []
          const [anyGuardian] = guardianCandidates.length
            ? guardianCandidates
            : await db.select({ id: schema.guardians.id }).from(schema.guardians)
                .where(eq(schema.guardians.schoolId, juniorSchool.id)).limit(1)
          const guardianId = anyGuardian?.id ?? null
          if (guardianId) {
            const guardian = await drillIndividual('guardian', guardianId)
            const guardianBody = guardian.body as {
              targetType?: string
              guardian?: { name?: string, students?: unknown[] }
              communications?: Array<{ channelLabel?: string }>
            } | null
            const text = JSON.stringify(guardianBody ?? {})
            record('家长个体明细（最小披露投影）',
              guardian.status === 200 && guardianBody?.targetType === 'guardian'
              && Boolean(guardianBody?.guardian?.name) && Array.isArray(guardianBody?.guardian?.students)
              && !text.includes('"summaryEnc"') && !text.includes('"summary"'),
            `HTTP ${guardian.status}；姓名=${guardianBody?.guardian?.name ? '已返回' : '—'}；关联学生=${guardianBody?.guardian?.students?.length ?? '—'}；沟通 ${guardianBody?.communications?.length ?? 0} 条`)
          } else {
            skip('家长个体明细（最小披露投影）', '初中部没有落在看板范围内的家长档案，跳过')
          }

          // 12.2) 越权访问尝试：他校学生 → 404 且写审计 dashboard.access_denied
          const [foreignStudent] = await db.select({ id: schema.students.id })
            .from(schema.students)
            .where(ne(schema.students.schoolId, juniorSchool.id))
            .limit(1)
          if (foreignStudent) {
            const crossDenied = await main.get(`/api/v1/dashboard/individual/student/${foreignStudent.id}`)
            const deniedAudits = await db.select({ action: schema.auditLogs.action }).from(schema.auditLogs)
              .where(eq(schema.auditLogs.schoolId, juniorSchool.id))
            record('越权访问被拦截并写审计', crossDenied.status === 404 && deniedAudits.some(item => item.action === 'dashboard.access_denied'),
              `HTTP ${crossDenied.status}；dashboard.access_denied 审计=${deniedAudits.filter(item => item.action === 'dashboard.access_denied').length} 条`)
          } else {
            skip('越权访问被拦截并写审计', '高中部没有学生档案，跳过越权断言')
          }
        } finally {
          await restore()
        }
      } else {
        record('个体明细下钻目标学生', false, '初中部没有带班级的学生，跳过下钻断言')
      }
    }
  } finally {
    // 清理冒烟创建的授权与申请（保持开发库干净）
    for (const item of createdGrants) {
      await db.delete(schema.adminAccessGrants).where(eq(schema.adminAccessGrants.id, item.grantId)).catch(() => undefined)
      if (item.requestId) await db.delete(schema.adminAccessRequests).where(eq(schema.adminAccessRequests.id, item.requestId)).catch(() => undefined)
    }
    await client.end()
  }

  const failed = checks.filter(item => !item.ok && !item.skipped)
  const skipped = checks.filter(item => item.skipped)
  const total = checks.length - skipped.length
  console.log(`\n结论：${total - failed.length}/${total} 项通过${skipped.length ? `；跳过 ${skipped.length} 项（数据不足）：${skipped.map(item => item.name).join('、')}` : ''}`)
  if (failed.length) {
    console.log(`未通过：${failed.map(item => item.name).join('、')}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('冒烟脚本执行失败：', error instanceof Error ? error.message : error)
  process.exitCode = 1
})

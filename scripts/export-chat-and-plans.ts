/**
 * 全量导出：所有教师的首页 AI 问答（Q&A 配对）与全部方案，输出到同一个 XLSX。
 *
 * 用途：业务侧校验 AI 回答质量与方案质量时，需要拿到「库里到底问了什么、答了什么、
 * 生成了哪些方案、执行到哪一步」，而不是只看后台列表。本脚本只读，不写库、不调外部模型。
 *
 * 产出（单个 XLSX，5 个 sheet）：
 *  - AI问答：按会话内时间顺序，把教师提问与紧随其后的助手回答配成一行；重新生成后
 *    已软删除的旧回答不导出，当前生效的回答会导出。
 *  - 方案：一行一个方案（摘要、风险、归因、量表快照、工具清单、行动项进度等）。
 *  - 方案执行项：plan_actions 逐条（当前执行状态口径）。
 *  - 方案复盘：plan_reviews 逐条。
 *  - 说明：数据来源、口径、行数统计与敏感数据提醒。
 *
 * 用法：
 *   pnpm export:chat-plans
 *   pnpm tsx scripts/export-chat-and-plans.ts --out=exports/xxx.xlsx
 *   pnpm tsx scripts/export-chat-and-plans.ts --school=LIULI-PRIMARY   # 按学校编码收窄
 *
 * 目标库由 DATABASE_URL 决定（本地 dev 5434 / 测试 5435 / 正式 5433），默认输出文件名
 * 会带上识别出的环境（正式/测试/本地开发）；解密密钥取 ENCRYPTION_KEY，必须与目标库一致，
 * 否则敏感正文显示「解密失败」。
 * 输出默认落在 git 忽略的 exports/ 目录：文件含教师业务正文与学生/家长身份信息，
 * 仅限内部业务校验使用，不得外发、不得入库、不得提交。
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import XLSX from 'xlsx'
import { moduleMeta } from '../shared/assessments'
import { decryptSensitive } from '../server/utils/crypto'
import { schema, useDb } from '../server/utils/db'
import { loadLocalEnv } from './load-env'

const TZ = 'Asia/Shanghai'
/** Excel 单元格字符上限 32767，留出截断提示的余量。 */
const MAX_CELL_LENGTH = 32_000

function readArg(name: string): string | null {
  const prefix = `--${name}=`
  const hit = process.argv.find(arg => arg.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  return `${day} ${time}`
}

function beijingDateStamp(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()).replace(/-/g, '')
}

/** 清理控制字符并截断到 Excel 上限，避免生成损坏的 xlsx。 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  if (text.length > MAX_CELL_LENGTH) text = `${text.slice(0, MAX_CELL_LENGTH)}…（超出 Excel 单元格上限，已截断）`
  return text
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function moduleTitle(module: string): string {
  return (moduleMeta as Record<string, { title: string } | undefined>)[module]?.title || module
}

// ---- 状态/枚举中文标签（与 app/composables/useDisplayLabels.ts、app/pages/plans/[id].vue 保持一致） ----
const PLAN_STATUS_LABELS: Record<string, string> = {
  pending_acceptance: '待确认',
  accepted: '已接受',
  in_progress: '进行中',
  review_due: '待复盘',
  adjustment_needed: '需调整',
  escalated: '已升级',
  completed: '已完成',
  closed: '已关闭',
  archived: '已归档'
}
const SESSION_STATUS_LABELS: Record<string, string> = { active: '进行中', archived: '已归档' }
const PLAN_SOURCE_LABELS: Record<string, string> = { assistant_dialogue: 'AI 对话', direct_assessment: '量表直接生成' }
const ACCEPTANCE_LABELS: Record<string, string> = { accepted: '已接受', deferred: '暂缓', not_applicable: '不适用' }
const ACTION_DECISION_LABELS: Record<string, string> = { pending: '待确认', included: '已纳入', rejected: '未纳入' }
const ACTION_STATUS_LABELS: Record<string, string> = {
  pending: '待开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '受阻',
  skipped: '已跳过',
  cancelled: '已取消'
}
const REJECT_REASON_LABELS: Record<string, string> = {
  vague: '模糊、不够具体',
  scene_mismatch: '场景不适配',
  unnatural_script: '话术不自然',
  impractical_or_hard: '不实际、行动过难',
  other: '其他原因'
}
const BLOCK_REASON_LABELS: Record<string, string> = {
  time_limited: '时间不足',
  student_unavailable: '学生暂不可用',
  guardian_uncooperative: '家长不配合',
  tool_not_applicable: '工具不适用',
  action_too_hard: '行动过难',
  risk_escalated: '风险升级',
  need_collaboration: '需要协同',
  other: '其他'
}
const EVIDENCE_TYPE_LABELS: Record<string, string> = { observation: '观察', communication: '沟通', artifact: '作品/材料', none: '无' }
const REVIEW_DECISION_LABELS: Record<string, string> = {
  continue_plan: '继续原方案',
  adjust_actions: '调整动作',
  need_collaboration: '需要协同',
  close_success: '目标达成并关闭',
  close_no_longer_needed: '场景变化关闭'
}
const CATEGORY_SOURCE_LABELS: Record<string, string> = { rule: '关键词规则', model: '语义模型', unknown: '未知' }

function labelOf(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return ''
  return map[value] || value
}

/** 只保留 host:port/database，绝不带凭据。 */
function describeDatabaseUrl(url: string | undefined): string {
  if (!url) return '(DATABASE_URL 未配置)'
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`
  } catch {
    return '(DATABASE_URL 无法解析)'
  }
}

/** 按数据库端口识别环境（与 docs/DEVELOPMENT_AND_PRODUCTION.md 的端口约定一致）。 */
function environmentLabel(url: string | undefined): string {
  try {
    const port = new URL(url || '').port
    if (port === '5433') return '正式'
    if (port === '5435') return '测试'
    if (port === '5434') return '本地开发'
  } catch {
    // 落到未知环境
  }
  return '未知环境'
}

loadLocalEnv()

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('缺少 DATABASE_URL（可先 pnpm env:init）')
const encryptionKey = process.env.NUXT_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY
if (!encryptionKey) throw new Error('缺少 ENCRYPTION_KEY，无法解密问答与方案正文')

const db = useDb()

/** 目标库实际存在的列：线上库可能还没跑到本地最新的提问分类埋点迁移，缺列时按空值导出。 */
async function tableColumns(table: string): Promise<Set<string>> {
  const result = await db.execute<{ column_name: string }>(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `)
  return new Set(result.rows.map(row => row.column_name))
}
const chatMessageColumns = await tableColumns('chat_messages')
const hasQuestionCategory = chatMessageColumns.has('question_category')

const schoolFilter = readArg('school')
const environment = environmentLabel(databaseUrl)
const outPath = resolve(readArg('out') || `exports/AI问答与方案_${environment}_${beijingDateStamp()}.xlsx`)

const decryptFailures: string[] = []
function decryptCell(value: string | null | undefined, label: string): string {
  if (!value) return ''
  try {
    return decryptSensitive(value, encryptionKey as string)
  } catch {
    decryptFailures.push(label)
    return '（解密失败：密钥与目标库不匹配或数据损坏）'
  }
}

// ---- 学校范围（--school 按学校编码收窄） ----
const allSchools = await db.select({ id: schema.schools.id, name: schema.schools.name, code: schema.schools.code })
  .from(schema.schools)
  .orderBy(asc(schema.schools.name))
const targetSchools = schoolFilter
  ? allSchools.filter(school => school.code === schoolFilter || school.name === schoolFilter)
  : allSchools
if (schoolFilter && !targetSchools.length) {
  throw new Error(`未找到学校：${schoolFilter}（可选编码：${allSchools.map(school => school.code).join(' / ')}）`)
}
const schoolIds = targetSchools.map(school => school.id)
console.log(`目标库：${describeDatabaseUrl(databaseUrl)}（环境：${environment}）`)
console.log(`学校范围：${targetSchools.map(school => school.name).join('、') || '(无)'}`)

// ---- 会话与消息 ----
const sessionRows = await db.select({
  id: schema.chatSessions.id,
  schoolName: schema.schools.name,
  ownerName: schema.users.name,
  title: schema.chatSessions.title,
  contextType: schema.chatSessions.contextType,
  contextId: schema.chatSessions.contextId,
  status: schema.chatSessions.status,
  createdAt: schema.chatSessions.createdAt
})
  .from(schema.chatSessions)
  .innerJoin(schema.schools, eq(schema.schools.id, schema.chatSessions.schoolId))
  .innerJoin(schema.users, eq(schema.users.id, schema.chatSessions.ownerUserId))
  .where(inArray(schema.chatSessions.schoolId, schoolIds))
  .orderBy(asc(schema.schools.name), asc(schema.users.name), asc(schema.chatSessions.createdAt))

const sessionById = new Map(sessionRows.map(session => [session.id, session]))

const messageRows = await db.select({
  id: schema.chatMessages.id,
  sessionId: schema.chatMessages.sessionId,
  role: schema.chatMessages.role,
  contentEnc: schema.chatMessages.contentEnc,
  metadata: schema.chatMessages.metadata,
  // 提问分类埋点字段由本地较新的迁移引入；目标库缺列时按空值导出（见 说明 sheet）
  category: hasQuestionCategory ? schema.chatMessages.questionCategory : sql<string | null>`NULL::varchar(40)`,
  categorySource: hasQuestionCategory ? schema.chatMessages.questionCategorySource : sql<string | null>`NULL::varchar(20)`,
  keywords: hasQuestionCategory ? schema.chatMessages.questionKeywords : sql<string[]>`'[]'::jsonb`,
  createdAt: schema.chatMessages.createdAt
})
  .from(schema.chatMessages)
  .where(and(isNull(schema.chatMessages.deletedAt), inArray(schema.chatMessages.schoolId, schoolIds)))
  .orderBy(
    asc(schema.chatMessages.sessionId),
    asc(schema.chatMessages.createdAt),
    sql`CASE WHEN ${schema.chatMessages.role} = 'user' THEN 0 ELSE 1 END`,
    asc(schema.chatMessages.id)
  )

// ---- 咨询对象名称（学生/班级/家长） ----
const contextStudentIds = new Set<string>()
const contextGuardianIds = new Set<string>()
const contextClassIds = new Set<string>()
for (const session of sessionRows) {
  if (!session.contextId) continue
  if (session.contextType === 'student') contextStudentIds.add(session.contextId)
  else if (session.contextType === 'guardian') contextGuardianIds.add(session.contextId)
  else if (session.contextType === 'class') contextClassIds.add(session.contextId)
}

async function studentNames(ids: Set<string>): Promise<Map<string, string>> {
  if (!ids.size) return new Map()
  const rows = await db.select({ id: schema.students.id, nameEnc: schema.students.nameEnc })
    .from(schema.students).where(inArray(schema.students.id, [...ids]))
  return new Map(rows.map(row => [row.id, decryptCell(row.nameEnc, `学生姓名 ${row.id}`)]))
}

async function guardianNames(ids: Set<string>): Promise<Map<string, string>> {
  if (!ids.size) return new Map()
  const rows = await db.select({ id: schema.guardians.id, nameEnc: schema.guardians.nameEnc })
    .from(schema.guardians).where(inArray(schema.guardians.id, [...ids]))
  return new Map(rows.map(row => [row.id, decryptCell(row.nameEnc, `家长姓名 ${row.id}`)]))
}

async function classNames(ids: Set<string>): Promise<Map<string, string>> {
  if (!ids.size) return new Map()
  const rows = await db.select({ id: schema.classes.id, name: schema.classes.name, grade: schema.classes.grade })
    .from(schema.classes).where(inArray(schema.classes.id, [...ids]))
  return new Map(rows.map(row => [row.id, `${row.name}（${row.grade} 年级）`]))
}

const contextStudentNames = await studentNames(contextStudentIds)
const contextGuardianNames = await guardianNames(contextGuardianIds)
const contextClassNames = await classNames(contextClassIds)

function describeContext(type: string, id: string | null): string {
  if (!id) return ''
  if (type === 'student') return `学生：${contextStudentNames.get(id) || '（对象已删除或不属于本校）'}`
  if (type === 'guardian') return `家长：${contextGuardianNames.get(id) || '（对象已删除或不属于本校）'}`
  if (type === 'class') return `班级：${contextClassNames.get(id) || '（对象已删除或不属于本校）'}`
  return ''
}

// ---- Q&A 配对：提问 → 紧随其后的回答 ----
interface QaRow {
  sessionId: string
  turn: number | null
  questionAt: Date | null
  question: string
  category: string
  categorySource: string
  keywords: string[]
  answerAt: Date | null
  answer: string
  answerFlags: string[]
  tools: string[]
  sourceCount: number
}

const messagesBySession = new Map<string, typeof messageRows>()
for (const message of messageRows) {
  if (!sessionById.has(message.sessionId)) continue
  const list = messagesBySession.get(message.sessionId) || []
  list.push(message)
  messagesBySession.set(message.sessionId, list)
}

const qaRows: Array<{ session: (typeof sessionRows)[number], row: QaRow }> = []
for (const session of sessionRows) {
  const messages = messagesBySession.get(session.id) || []
  let pending: (typeof messageRows)[number] | null = null
  let turn = 0
  const flush = (question: (typeof messageRows)[number] | null, answer: (typeof messageRows)[number] | null) => {
    const meta = asRecord(answer?.metadata)
    const violations = asArray(meta.answerViolations).map(item => (typeof item === 'string' ? item : JSON.stringify(item)))
    const tools = asArray(meta.toolCalls).map((call) => {
      const record = asRecord(call)
      return asText(record.name) || asText(record.tool) || (typeof call === 'string' ? call : '')
    }).filter(Boolean)
    qaRows.push({
      session,
      row: {
        sessionId: session.id,
        // 提问被教师删除后可能只剩回答：这类行不给轮次，提问列留空
        turn: question ? turn : null,
        questionAt: question?.createdAt ?? null,
        question: decryptCell(question?.contentEnc, `提问 ${question?.id}`),
        category: asText(question?.category),
        categorySource: asText(question?.categorySource),
        keywords: asArray(question?.keywords).map(item => String(item)),
        answerAt: answer?.createdAt ?? null,
        answer: decryptCell(answer?.contentEnc, `回答 ${answer?.id}`),
        answerFlags: violations,
        tools,
        sourceCount: asArray(meta.sources).length
      }
    })
  }
  for (const message of messages) {
    if (message.role === 'user') {
      if (pending) flush(pending, null)
      turn += 1
      pending = message
    } else {
      flush(pending, message)
      pending = null
    }
  }
  if (pending) flush(pending, null)
}

const aiQaSheetRows = qaRows.map(({ session, row }, index) => [
  index + 1,
  cell(session.schoolName),
  cell(session.ownerName),
  cell(session.title),
  cell(describeContext(session.contextType, session.contextId)),
  cell(labelOf(SESSION_STATUS_LABELS, session.status)),
  cell(formatDateTime(session.createdAt)),
  row.turn ?? '',
  cell(formatDateTime(row.questionAt)),
  cell(row.question),
  cell(row.category || '（未分类）'),
  cell(labelOf(CATEGORY_SOURCE_LABELS, row.categorySource)),
  cell(row.keywords.join('；')),
  cell(formatDateTime(row.answerAt)),
  cell(row.answer),
  cell(row.tools.join('；')),
  row.sourceCount,
  cell(row.answerFlags.join('；')),
  cell(session.id)
])

// ---- 方案 ----
const planRows = await db.select({
  id: schema.plans.id,
  schoolName: schema.schools.name,
  ownerName: schema.users.name,
  module: schema.plans.module,
  title: schema.plans.title,
  titleFull: schema.plans.titleFull,
  status: schema.plans.status,
  sourceType: schema.plans.sourceType,
  sourceQuestionSummary: schema.plans.sourceQuestionSummary,
  studentId: schema.plans.studentId,
  classId: schema.plans.classId,
  guardianId: schema.plans.guardianId,
  summaryEnc: schema.plans.summaryEnc,
  actions: schema.plans.actions,
  tools: schema.plans.tools,
  report: schema.plans.report,
  attributionKeywords: schema.plans.attributionKeywords,
  instrumentSnapshots: schema.plans.instrumentSnapshots,
  acceptanceDecision: schema.plans.acceptanceDecision,
  acceptanceReasonEnc: schema.plans.acceptanceReasonEnc,
  acceptedAt: schema.plans.acceptedAt,
  nextReviewAt: schema.plans.nextReviewAt,
  completedAt: schema.plans.completedAt,
  closedAt: schema.plans.closedAt,
  archivedAt: schema.plans.archivedAt,
  aiReportStatus: schema.plans.aiReportStatus,
  aiActionsStatus: schema.plans.aiActionsStatus,
  createdAt: schema.plans.createdAt,
  updatedAt: schema.plans.updatedAt
})
  .from(schema.plans)
  .innerJoin(schema.schools, eq(schema.schools.id, schema.plans.schoolId))
  .innerJoin(schema.users, eq(schema.users.id, schema.plans.ownerUserId))
  .where(inArray(schema.plans.schoolId, schoolIds))
  .orderBy(asc(schema.schools.name), asc(schema.users.name), asc(schema.plans.createdAt))

const planStudentIds = new Set<string>()
const planGuardianIds = new Set<string>()
const planClassIds = new Set<string>()
for (const plan of planRows) {
  if (plan.studentId) planStudentIds.add(plan.studentId)
  if (plan.guardianId) planGuardianIds.add(plan.guardianId)
  if (plan.classId) planClassIds.add(plan.classId)
}
const planStudentNames = await studentNames(planStudentIds)
const planGuardianNames = await guardianNames(planGuardianIds)
const planClassNames = await classNames(planClassIds)

const actionRows = await db.select({
  id: schema.planActions.id,
  planId: schema.planActions.planId,
  sequence: schema.planActions.sequence,
  title: schema.planActions.title,
  detail: schema.planActions.detail,
  decision: schema.planActions.decision,
  decisionReason: schema.planActions.decisionReason,
  decisionNoteEnc: schema.planActions.decisionNoteEnc,
  status: schema.planActions.status,
  dueAt: schema.planActions.dueAt,
  startedAt: schema.planActions.startedAt,
  completedAt: schema.planActions.completedAt,
  executedAt: schema.planActions.executedAt,
  executionNote: schema.planActions.executionNote,
  blockedAt: schema.planActions.blockedAt,
  blockReason: schema.planActions.blockReason,
  blockNoteEnc: schema.planActions.blockNoteEnc,
  evidenceType: schema.planActions.evidenceType,
  evidenceSummaryEnc: schema.planActions.evidenceSummaryEnc,
  teacherConfidence: schema.planActions.teacherConfidence,
  createdAt: schema.planActions.createdAt,
  updatedAt: schema.planActions.updatedAt
})
  .from(schema.planActions)
  .where(inArray(schema.planActions.schoolId, schoolIds))
  .orderBy(asc(schema.planActions.planId), asc(schema.planActions.sequence))

const reviewRows = await db.select({
  id: schema.planReviews.id,
  planId: schema.planReviews.planId,
  reviewAt: schema.planReviews.reviewAt,
  effectScore: schema.planReviews.effectScore,
  progressNote: schema.planReviews.progressNote,
  nextAction: schema.planReviews.nextAction,
  decision: schema.planReviews.decision,
  createdAt: schema.planReviews.createdAt
})
  .from(schema.planReviews)
  .where(inArray(schema.planReviews.schoolId, schoolIds))
  .orderBy(asc(schema.planReviews.planId), asc(schema.planReviews.reviewAt))

interface PlanProgress {
  included: number
  completed: number
  total: number
}
const progressByPlan = new Map<string, PlanProgress>()
for (const action of actionRows) {
  const progress = progressByPlan.get(action.planId) || { included: 0, completed: 0, total: 0 }
  progress.total += 1
  if (action.decision === 'included') {
    progress.included += 1
    if (action.status === 'completed') progress.completed += 1
  }
  progressByPlan.set(action.planId, progress)
}

const reviewsByPlan = new Map<string, typeof reviewRows>()
for (const review of reviewRows) {
  const list = reviewsByPlan.get(review.planId) || []
  list.push(review)
  reviewsByPlan.set(review.planId, list)
}

const planTitleById = new Map(planRows.map(plan => [plan.id, plan.titleFull || plan.title]))
const planMetaById = new Map(planRows.map(plan => [plan.id, {
  schoolName: plan.schoolName,
  ownerName: plan.ownerName,
  module: plan.module,
  title: plan.titleFull || plan.title
}]))
const exportedPlanIds = new Set(planRows.map(plan => plan.id))

const planSheetRows = planRows.map((plan, index) => {
  const report = asRecord(plan.report)
  const profile = asRecord(report.profile)
  const risk = asRecord(report.risk)
  const attributions = asArray(report.attributions).map(asRecord)
  const progress = progressByPlan.get(plan.id)
  const reviews = reviewsByPlan.get(plan.id) || []
  const lastReview = reviews.length ? reviews[reviews.length - 1] : null

  const attributionComposition = attributions.map((item) => {
    const strength = asText(item.strength)
    const strengthLabel = strength === 'primary' ? '主归因' : strength === 'secondary' ? '次归因' : strength === 'reference' ? '参考' : strength
    return `${asText(item.name)}（${strengthLabel}）`
  }).join('；')
  const attributionReasons = attributions.map((item) => {
    const reasons = asArray(item.reasons).map(reason => String(reason))
    return reasons.length ? `${asText(item.name)}：${reasons.join('；')}` : asText(item.name)
  }).join('\n')

  return [
    index + 1,
    cell(plan.schoolName),
    cell(plan.ownerName),
    cell(moduleTitle(plan.module)),
    cell(plan.titleFull || plan.title),
    cell(labelOf(PLAN_STATUS_LABELS, plan.status)),
    cell(labelOf(PLAN_SOURCE_LABELS, plan.sourceType)),
    cell(plan.sourceQuestionSummary),
    cell(plan.studentId ? (planStudentNames.get(plan.studentId) || '（学生已删除）') : ''),
    cell(plan.classId ? (planClassNames.get(plan.classId) || '（班级已删除）') : ''),
    cell(plan.guardianId ? (planGuardianNames.get(plan.guardianId) || '（家长已删除）') : ''),
    cell(risk.label ? `${asText(risk.label)}${asText(risk.level) && asText(risk.level) !== asText(risk.label) ? `（${asText(risk.level)}）` : ''}` : ''),
    cell(asText(risk.severity)),
    cell(asText(risk.description)),
    cell(asText(profile.primaryConcern)),
    cell(decryptCell(plan.summaryEnc, `方案摘要 ${plan.id}`)),
    cell(attributionComposition),
    cell(attributionReasons),
    cell(asArray(plan.attributionKeywords).map(item => String(item)).join('；')),
    cell(asArray(plan.instrumentSnapshots).map((item) => {
      const snapshot = asRecord(item)
      const name = asText(snapshot.name) || asText(snapshot.code)
      const version = asText(snapshot.version)
      return version ? `${name} v${version}` : name
    }).filter(Boolean).join('；')),
    cell(asArray(plan.tools).map((item) => {
      const tool = asRecord(item)
      const attribution = asText(tool.attributionName)
      return attribution ? `${asText(tool.title)}（归因：${attribution}）` : asText(tool.title)
    }).filter(Boolean).join('；')),
    cell(asArray(plan.actions).map((item, actionIndex) => {
      const action = asRecord(item)
      return `${actionIndex + 1}. ${asText(action.title)}`
    }).filter(line => line.length > 3).join('\n')),
    cell(progress ? `纳入 ${progress.included} / 完成 ${progress.completed}（共 ${progress.total} 条）` : '无执行项'),
    reviews.length,
    cell(formatDateTime(lastReview?.reviewAt)),
    cell(formatDateTime(plan.nextReviewAt)),
    cell(labelOf(ACCEPTANCE_LABELS, plan.acceptanceDecision)),
    cell(plan.acceptanceReasonEnc ? decryptCell(plan.acceptanceReasonEnc, `确认说明 ${plan.id}`) : ''),
    cell(`${plan.aiReportStatus} / ${plan.aiActionsStatus}`),
    cell(formatDateTime(plan.createdAt)),
    cell(formatDateTime(plan.updatedAt)),
    cell(formatDateTime(plan.acceptedAt)),
    cell(formatDateTime(plan.completedAt)),
    cell(formatDateTime(plan.closedAt)),
    cell(formatDateTime(plan.archivedAt)),
    cell(plan.id)
  ]
})

const actionSheetRows = actionRows
  .filter(action => exportedPlanIds.has(action.planId))
  .map((action, index) => {
    const meta = planMetaById.get(action.planId)
    return [
      index + 1,
      cell(meta?.schoolName),
      cell(meta?.ownerName),
      cell(meta?.title),
      cell(meta ? moduleTitle(meta.module) : ''),
      action.sequence + 1,
      cell(action.title),
      cell(action.detail),
      cell(labelOf(ACTION_DECISION_LABELS, action.decision)),
      cell(labelOf(REJECT_REASON_LABELS, action.decisionReason)),
      cell(action.decisionNoteEnc ? decryptCell(action.decisionNoteEnc, `未采纳说明 ${action.id}`) : ''),
      cell(labelOf(ACTION_STATUS_LABELS, action.status)),
      cell(formatDateTime(action.dueAt)),
      cell(formatDateTime(action.startedAt)),
      cell(formatDateTime(action.completedAt) || formatDateTime(action.executedAt)),
      cell(labelOf(BLOCK_REASON_LABELS, action.blockReason)),
      cell(action.blockNoteEnc ? decryptCell(action.blockNoteEnc, `受阻说明 ${action.id}`) : ''),
      cell(action.executionNote),
      typeof action.teacherConfidence === 'number' ? action.teacherConfidence : '',
      cell(labelOf(EVIDENCE_TYPE_LABELS, action.evidenceType)),
      cell(action.evidenceSummaryEnc ? decryptCell(action.evidenceSummaryEnc, `证据摘要 ${action.id}`) : ''),
      cell(formatDateTime(action.createdAt)),
      cell(formatDateTime(action.updatedAt)),
      cell(action.id)
    ]
  })

const reviewSheetRows = reviewRows
  .filter(review => exportedPlanIds.has(review.planId))
  .map((review, index) => {
    const meta = planMetaById.get(review.planId)
    return [
      index + 1,
      cell(meta?.schoolName),
      cell(meta?.ownerName),
      cell(meta?.title),
      cell(meta ? moduleTitle(meta.module) : ''),
      cell(formatDateTime(review.reviewAt)),
      review.effectScore,
      cell(review.progressNote),
      cell(review.nextAction),
      cell(labelOf(REVIEW_DECISION_LABELS, review.decision)),
      cell(review.id)
    ]
  })

// ---- 组装工作簿 ----
function buildSheet(header: string[], rows: Array<Array<string | number>>, widths: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows])
  sheet['!cols'] = widths.map(wch => ({ wch }))
  return sheet
}

const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(workbook, buildSheet(
  ['序号', '学校', '教师', '会话标题', '咨询对象', '会话状态', '会话开始时间', '轮次', '提问时间', '提问内容',
    '提问分类', '分类来源', '提问关键词', '回答时间', '回答内容', '本轮调用工具', '引用知识条数', '回答校验告警', '会话ID'],
  aiQaSheetRows,
  [6, 18, 12, 24, 22, 10, 16, 6, 16, 60, 14, 12, 20, 16, 80, 22, 12, 16, 36]
), 'AI问答')

XLSX.utils.book_append_sheet(workbook, buildSheet(
  ['序号', '学校', '负责教师', '模块', '方案标题', '状态', '来源', '来源提问摘要', '关联学生', '关联班级', '关联家长',
    '风险等级', '风险严重度', '风险说明', '主要关切', '方案摘要', '归因构成', '归因依据', '归因关键词', '量表快照',
    '工具清单', '生成时行动建议（快照）', '执行项进度', '复盘次数', '最近复盘时间', '下次复盘时间',
    '确认决定', '确认说明', 'AI 生成状态', '创建时间', '更新时间', '确认时间', '完成时间', '关闭时间', '归档时间', '方案ID'],
  planSheetRows,
  [6, 18, 12, 16, 30, 10, 12, 30, 12, 18, 12, 22, 12, 30, 18, 60, 40, 60, 20, 30, 40, 40, 20, 8, 16, 16, 10, 20, 16, 16, 16, 16, 16, 16, 16, 36]
), '方案')

XLSX.utils.book_append_sheet(workbook, buildSheet(
  ['序号', '学校', '负责教师', '方案标题', '模块', '执行序号', '行动标题', '行动内容', '是否纳入', '未采纳原因',
    '未采纳说明', '执行状态', '截止时间', '开始时间', '完成时间', '受阻原因', '受阻说明', '执行记录', '教师信心(1-5)',
    '证据类型', '证据摘要', '创建时间', '更新时间', '行动ID'],
  actionSheetRows,
  [6, 18, 12, 30, 16, 8, 30, 60, 10, 16, 20, 10, 16, 16, 16, 12, 20, 30, 12, 10, 30, 16, 16, 36]
), '方案执行项')

XLSX.utils.book_append_sheet(workbook, buildSheet(
  ['序号', '学校', '负责教师', '方案标题', '模块', '复盘时间', '效果评分(1-5)', '进展记录', '下一步计划', '复盘决定', '复盘ID'],
  reviewSheetRows,
  [6, 18, 12, 30, 16, 16, 14, 60, 40, 16, 36]
), '方案复盘')

const overviewRows: Array<Array<string | number>> = [
  ['生成时间', formatDateTime(new Date())],
  ['目标环境', environment],
  ['目标数据库', describeDatabaseUrl(databaseUrl)],
  ['学校范围', targetSchools.map(school => school.name).join('、') || '(无)'],
  ['对话会话数', sessionRows.length],
  ['问答轮次（AI问答 sheet 行数）', aiQaSheetRows.length],
  ['方案数', planSheetRows.length],
  ['方案执行项数', actionSheetRows.length],
  ['方案复盘数', reviewSheetRows.length],
  ['解密失败条数', decryptFailures.length],
  ['', ''],
  ['问答口径', '按会话内时间顺序，把教师提问与紧随其后的助手回答配成一行；重新生成后被替换的旧回答、以及被教师删除的消息都不导出（与教师端回看口径一致），因此少数「提问已删除但回答仍在」的行只有回答、提问列留空；未获回答的提问也保留一行。'],
  ['提问分类口径', '取自 chat_messages.question_category（提问落库时写入），为空表示该提问发生在埋点上线前，记为「（未分类）」。'],
  ...(hasQuestionCategory
    ? []
    : [['提问分类提示', '目标库尚未执行提问分类埋点迁移（chat_messages 缺少 question_category 等列），本次导出的提问分类、分类来源、提问关键词三列留空。']]),
  ['方案口径', '方案正文来自 plans（摘要已解密）；风险、归因、量表快照取自生成时固化的 report / instrument_snapshots；行动项进度与「方案执行项」sheet 均以 plan_actions 当前状态为准；「生成时行动建议（快照）」是 plans.actions 的生成时快照，仅供溯源。'],
  ['敏感数据提醒', '本文件含教师业务正文与学生/家长身份信息，仅限内部业务校验使用；不得外发、不得入库、不得提交到版本库（exports/ 已在 .gitignore 中）。'],
  ['解密密钥', 'ENCRYPTION_KEY / NUXT_ENCRYPTION_KEY，必须与目标数据库一致。']
]
if (decryptFailures.length) {
  overviewRows.push(['解密失败明细（前 20 条）', decryptFailures.slice(0, 20).join('；')])
}
XLSX.utils.book_append_sheet(workbook, buildSheet(['项目', '内容'], overviewRows, [32, 100]), '说明')

mkdirSync(dirname(outPath), { recursive: true })
XLSX.writeFile(workbook, outPath)

console.log(`导出完成：${outPath}`)
console.log(`会话 ${sessionRows.length} 个 / 问答 ${aiQaSheetRows.length} 轮 / 方案 ${planSheetRows.length} 个 / 执行项 ${actionSheetRows.length} 条 / 复盘 ${reviewSheetRows.length} 条`)
if (decryptFailures.length) {
  console.warn(`警告：${decryptFailures.length} 条敏感字段解密失败（密钥与目标库不匹配？），对应单元格已标注「解密失败」。`)
}
process.exit(0)

import type { H3Event } from 'h3'
import { and, asc, eq } from 'drizzle-orm'
import { schema, useDb } from '../utils/db'
import type { ToolStructuredStep, ToolContraindicationRule, Severity } from '../../shared/contracts'

type LegacyAction = { title: string, detail: string, status: string }

export function defaultActionDueAt(createdAt: Date, sequence: number) {
  const due = new Date(createdAt)
  due.setDate(due.getDate() + Math.min(sequence + 1, 3))
  return due
}

export function defaultReviewAt(createdAt = new Date()) {
  const review = new Date(createdAt)
  review.setDate(review.getDate() + 7)
  return review
}

/** 懒迁移旧 JSON 动作；保留 plans.actions 和报告快照作为历史证据。 */
export async function ensurePlanActions(event: H3Event, planId: string, ownerUserId: string) {
  const db = useDb(event)
  const existing = await db.select().from(schema.planActions)
    .where(and(eq(schema.planActions.planId, planId), eq(schema.planActions.ownerUserId, ownerUserId)))
    .orderBy(asc(schema.planActions.sequence))
  if (existing.length) return existing

  const [plan] = await db.select().from(schema.plans)
    .where(and(eq(schema.plans.id, planId), eq(schema.plans.ownerUserId, ownerUserId))).limit(1)
  if (!plan) return []
  const legacy = (plan.actions || []) as LegacyAction[]
  if (!legacy.length) return []
  return db.insert(schema.planActions).values(legacy.map((action, sequence) => ({
    schoolId: plan.schoolId,
    planId: plan.id,
    ownerUserId: plan.ownerUserId,
    sequence,
    title: action.title,
    detail: action.detail,
    status: action.status || 'pending',
    dueAt: defaultActionDueAt(plan.createdAt, sequence),
    completedAt: action.status === 'completed' ? plan.updatedAt : null
  }))).onConflictDoNothing().returning()
}

export async function createPlanActions(event: H3Event, input: {
  planId: string
  schoolId: string
  ownerUserId: string
  createdAt?: Date
  actions: LegacyAction[]
}) {
  const createdAt = input.createdAt || new Date()
  if (!input.actions.length) return []
  return useDb(event).insert(schema.planActions).values(input.actions.map((action, sequence) => ({
    schoolId: input.schoolId,
    planId: input.planId,
    ownerUserId: input.ownerUserId,
    sequence,
    title: action.title,
    detail: action.detail,
    status: action.status || 'pending',
    dueAt: defaultActionDueAt(createdAt, sequence)
  }))).returning()
}

/** 工具匹配的输入。归因来自 executeRules 的多归因结果，按占比参与加权。 */
export interface ToolMatchInput {
  dimensions: Record<string, number>
  /** 分级规则产出的严重度，与工具库的严重度共用同一套枚举 */
  severity?: Severity
  attributions?: Array<{ code: string, share: number }>
  toolTags?: string[]
  /** 薄弱维度判定阈值 */
  weakDimensionThreshold?: number
}

export interface ToolMatchScore {
  tool: Record<string, unknown>
  score: number
  /** 每一项的得分明细，用于运营台解释「这个工具为什么被推出来」 */
  breakdown: { attribution: number, tag: number, severity: number, dimension: number }
}

const TOOL_MATCH_WEIGHTS = { attribution: 10, tag: 3, severity: 2, dimension: 2 }
const DEFAULT_WEAK_DIMENSION_THRESHOLD = 2.5
const MAX_MATCHED_TOOLS = 5

/**
 * 给工具打分并排序。纯函数，不依赖数据库，可直接单测。
 *
 * 相比旧实现的关键差别：四个条件从 AND 硬过滤改为加权求和，只有 block 型禁忌仍是硬过滤。
 * 旧实现里任一条件对不上就整个工具库返回空，班主任会拿到没有工具的方案。
 */
export function scoreTools(tools: Array<Record<string, unknown>>, input: ToolMatchInput): ToolMatchScore[] {
  const weakDims = Object.entries(input.dimensions)
    .filter(([, score]) => score <= (input.weakDimensionThreshold ?? DEFAULT_WEAK_DIMENSION_THRESHOLD))
    .map(([dimension]) => normalize(dimension))
  const shareByCode = new Map((input.attributions || []).map(a => [normalize(a.code), a.share]))
  const requestedTags = (input.toolTags || []).map(normalize).filter(Boolean)
  const severity = normalize(input.severity)

  const scored: ToolMatchScore[] = []
  for (const tool of tools) {
    // 禁忌硬过滤：只有条件能够被当前评估结果确认时才一票否决。
    const contraRules = Array.isArray(tool.contraindicationRules)
      ? (tool.contraindicationRules as ToolContraindicationRule[])
      : []
    if (contraRules.some(rule => rule.type === 'block' && matchesContraindication(rule, input))) continue

    // 归因：工具声明的归因编码命中了哪几条结果归因，按各自占比累加
    const toolAttributionCodes = [
      tool.attributionCode,
      ...(Array.isArray(tool.attributionCodes) ? tool.attributionCodes : [])
    ].map(normalize).filter(Boolean)
    const attributionShare = toolAttributionCodes.reduce(
      (sum, code) => sum + (shareByCode.get(code) ?? 0), 0
    )
    const attributionScore = attributionShare * TOOL_MATCH_WEIGHTS.attribution

    // 标签：交集比例
    const toolTags = [
      ...(Array.isArray(tool.tags) ? tool.tags : []),
      ...(Array.isArray(tool.toolTags) ? tool.toolTags : [])
    ].map(normalize).filter(Boolean)
    const tagHits = toolTags.filter(tag => requestedTags.includes(tag)).length
    const tagScore = toolTags.length ? (tagHits / toolTags.length) * TOOL_MATCH_WEIGHTS.tag : 0

    // 严重度：同枚举精确比对，不再做子串匹配
    const toolSeverity = normalize(tool.severity)
    const severityScore = severity && toolSeverity && severity === toolSeverity ? TOOL_MATCH_WEIGHTS.severity : 0

    // 维度：工具作用维度填的是量表维度编码，与薄弱维度精确比对
    const toolDims = Array.isArray(tool.dimensions) ? tool.dimensions.map(normalize) : []
    const dimHits = toolDims.filter(dimension => weakDims.includes(dimension)).length
    const dimensionScore = toolDims.length ? (dimHits / toolDims.length) * TOOL_MATCH_WEIGHTS.dimension : 0

    const score = Number((attributionScore + tagScore + severityScore + dimensionScore).toFixed(4))
    if (score <= 0) continue
    scored.push({
      tool,
      score,
      breakdown: {
        attribution: Number(attributionScore.toFixed(4)),
        tag: Number(tagScore.toFixed(4)),
        severity: severityScore,
        dimension: Number(dimensionScore.toFixed(4))
      }
    })
  }

  // 并列时按工具编码排序，保证同样的评估结果每次得到同样的推荐顺序
  return scored.sort((a, b) =>
    b.score - a.score || String(a.tool.code || '').localeCompare(String(b.tool.code || ''))
  )
}

/** 把工具条目渲染成方案里展示的正文 */
export function renderToolContent(tool: Record<string, unknown>): string {
  const contraRules = Array.isArray(tool.contraindicationRules)
    ? (tool.contraindicationRules as ToolContraindicationRule[])
    : []
  const structuredSteps = Array.isArray(tool.structuredSteps)
    ? (tool.structuredSteps as ToolStructuredStep[])
    : []

  if (structuredSteps.length > 0) {
    const sorted = [...structuredSteps].sort((a, b) => a.seq - b.seq)
    const stepLines = sorted.map((s, idx) => {
      const parts = [`${idx + 1}. ${s.title}: ${s.description}`]
      if (s.keyTip) parts.push(`   提示：${s.keyTip}`)
      if (s.scriptTemplate) parts.push(`   话术：${s.scriptTemplate}`)
      if (s.successCriteria) parts.push(`   达标：${s.successCriteria}`)
      return parts.join('\n')
    })
    let content = stepLines.join('\n\n')
    const warnContras = contraRules.filter(rule => rule.type === 'warn')
    if (warnContras.length > 0) {
      content += '\n\n⚠ 注意事项：\n' + warnContras.map(rule => `- ${rule.description}`).join('\n')
    }
    return content
  }

  const steps = Array.isArray(tool.steps) ? (tool.steps as string[]).join('\n') : String(tool.steps || '')
  const scripts = tool.scripts ? `\n\n关键话术：\n${tool.scripts}` : ''
  const prohibitions = tool.prohibitions ? `\n\n禁止事项：\n${tool.prohibitions}` : ''
  return `${steps}${scripts}${prohibitions}`
}

// 从 moduleResourceLibraries 加载工具库，根据评估结果匹配适用的工具处方
export async function resolveToolsForPlan(
  event: H3Event,
  module: string,
  input: ToolMatchInput & { schoolId?: string | null, requiredCodes?: string[] }
): Promise<Array<{ title: string, content: string, code?: string, sourceVersionId?: string, matchScore?: number }>> {
  const { resolvePublishedModuleResource } = await import('./module-resources')
  const resource = await resolvePublishedModuleResource<{ tools?: Array<Record<string, unknown>> }>(
    event,
    { module: module as any, libraryType: 'tool', schoolId: input.schoolId }
  )
  if (!resource) return []

  const payload = resource.payload
  const tools: Array<Record<string, unknown>> = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.tools)
      ? payload.tools as Array<Record<string, unknown>>
      : []

  if (tools.length === 0) return []

  const render = (tool: Record<string, unknown>, score?: number) => ({
    title: String(tool.name || tool.title || ''),
    code: String(tool.code || '').trim() || undefined,
    sourceVersionId: resource.versionId,
    matchScore: score,
    content: renderToolContent(tool)
  })

  // 等级干预通道：命中等级直选的工具按编码无条件入选（跳过打分），且优先于归因加权结果
  const required = new Set((input.requiredCodes || []).map(normalize).filter(Boolean))
  const direct = required.size
    ? tools.filter(tool => required.has(normalize(tool.code))).map(tool => render(tool, undefined))
    : []

  // 归因加权匹配照常打分；与直选工具按编码去重（直选优先），总量仍受 MAX_MATCHED_TOOLS 约束
  const scored = scoreTools(tools, input)
    .filter(({ tool }) => !required.has(normalize(tool.code)))
    .slice(0, Math.max(0, MAX_MATCHED_TOOLS - direct.length))
    .map(({ tool, score }) => render(tool, score))

  return [...direct, ...scored]
}

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function matchesContraindication(rule: ToolContraindicationRule, input: ToolMatchInput) {
  const condition = normalize(rule.condition)
  if (!condition) return false
  if (['always', 'true', '1', 'yes', '是', '始终'].includes(condition)) return true

  const severityMatch = condition.match(/(?:severity|严重度)\s*(?:==|=|为|是)\s*([a-z_]+)/i)
  if (severityMatch) return normalize(input.severity) === normalize(severityMatch[1])

  const attributionCodes = new Set((input.attributions || []).filter(item => item.share > 0).map(item => normalize(item.code)))
  const attributionMatch = condition.match(/(?:attribution|归因|对应归因)\s*(?:==|=|为|是)\s*([a-z0-9_.:-]+)/i)
  if (attributionMatch) return attributionCodes.has(normalize(attributionMatch[1]))

  const tags = new Set((input.toolTags || []).map(normalize))
  const tagMatch = condition.match(/(?:tag|标签|工具标签)\s*(?:==|=|为|是)\s*([a-z0-9_.:-]+)/i)
  if (tagMatch) return tags.has(normalize(tagMatch[1]))

  return false
}

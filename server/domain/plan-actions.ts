import type { H3Event } from 'h3'
import { and, asc, eq } from 'drizzle-orm'
import { schema, useDb } from '../utils/db'

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

// 从 moduleResourceLibraries 加载工具库，根据评估结果匹配适用的工具处方
export async function resolveToolsForPlan(
  event: H3Event,
  module: string,
  input: {
    dimensions: Record<string, number>
    level?: string
    primaryAttribution?: string
    secondaryAttributions?: string[]
    toolTags?: string[]
    schoolId?: string | null
  }
): Promise<Array<{ title: string, content: string, code?: string, sourceVersionId?: string }>> {
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

  const matchedTools: Array<{ title: string, content: string, code?: string, sourceVersionId?: string }> = []

  for (const tool of tools) {
    const toolSeverity = normalize(tool.severity || tool.severity_grade || tool.level)
    const toolDims = Array.isArray(tool.dimensions) ? tool.dimensions.map(normalize) : []
    const toolAttributions = [
      tool.attribution,
      tool.primaryAttribution,
      ...(Array.isArray(tool.attributions) ? tool.attributions : [])
    ].map(normalize).filter(Boolean)
    const toolTags = [
      tool.tag,
      ...(Array.isArray(tool.tags) ? tool.tags : []),
      ...(Array.isArray(tool.toolTags) ? tool.toolTags : [])
    ].map(normalize).filter(Boolean)

    // 维度匹配：工具的作用维度与评估结果的薄弱维度重叠
    const weakDims = Object.entries(input.dimensions)
      .filter(([, score]) => score <= 2.5) // 阈值：低于2.5视为薄弱
      .map(([dim]) => normalize(dim))

    const dimMatch = toolDims.length === 0 ||
      toolDims.some(dimension => weakDims.some(weakDimension => dimension.includes(weakDimension) || weakDimension.includes(dimension)))

    // 严重度匹配
    const level = normalize(input.level)
    const severityMatch = !level || !toolSeverity || toolSeverity.includes(level) || level.includes(toolSeverity)

    const attributionTerms = [
      input.primaryAttribution,
      ...(input.secondaryAttributions || [])
    ].map(normalize).filter(Boolean)
    const attributionMatch = toolAttributions.length === 0 ||
      toolAttributions.some(attribution => attributionTerms.some(term => attribution.includes(term) || term.includes(attribution)))

    const requestedTags = (input.toolTags || []).map(normalize).filter(Boolean)
    const tagMatch = toolTags.length === 0 ||
      toolTags.some(tag => requestedTags.some(requested => tag.includes(requested) || requested.includes(tag)))

    if (dimMatch && severityMatch && attributionMatch && tagMatch) {
      const steps = Array.isArray(tool.steps) ? (tool.steps as string[]).join('\n') : String(tool.steps || '')
      const scripts = tool.scripts ? `\n\n关键话术：\n${tool.scripts}` : ''
      const prohibitions = tool.prohibitions ? `\n\n禁止事项：\n${tool.prohibitions}` : ''

      matchedTools.push({
        title: String(tool.name || tool.title || ''),
        code: String(tool.code || '').trim() || undefined,
        sourceVersionId: resource.versionId,
        content: `${steps}${scripts}${prohibitions}`
      })
    }

    if (matchedTools.length >= 5) break // 最多推荐5个工具
  }

  return matchedTools
}

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

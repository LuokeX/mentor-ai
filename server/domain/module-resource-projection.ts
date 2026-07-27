import { eq } from 'drizzle-orm'
import type { AssessmentDefinition } from '../../shared/assessments'
import {
  attributionConfigSchema,
  toolLibraryPayloadSchema,
  type LibraryType,
  type ModuleId
} from '../../shared/contracts'
import { schema } from '../utils/db'

type Scope = 'global' | 'school'

export interface ProjectionContext {
  libraryId: string
  versionId: string
  module: ModuleId
  libraryType: LibraryType
  scope: Scope
  schoolId?: string | null
}

export interface AssessmentProjection {
  libraryId: string
  versionId: string
  module: ModuleId
  scope: Scope
  schoolId: string | null
  instrumentCode: string
  title: string
  questionCount: number
  dimensions: string[]
  scoringKeys: string[]
  metadata: Record<string, unknown>
}

export interface AttributionProjection {
  libraryId: string
  versionId: string
  module: ModuleId
  scope: Scope
  schoolId: string | null
  ruleId: string
  priority: number
  level: string
  blocked: boolean
  hasCondition: boolean
  primaryAttribution: string
  secondaryAttributions: string[]
  toolTags: string[]
  reasonCount: number
  metadata: Record<string, unknown>
}

export interface ToolProjection {
  libraryId: string
  versionId: string
  module: ModuleId
  scope: Scope
  schoolId: string | null
  toolCode: string
  name: string
  form: string
  severity?: string | null
  level?: string | null
  primaryAttribution?: string | null
  attributions: string[]
  tags: string[]
  toolTags: string[]
  dimensions: string[]
  stepCount: number
  hasScript: boolean
  hasProhibitions: boolean
  hasExpectedEffect: boolean
  metadata: Record<string, unknown>
}

export interface ModuleResourceProjection {
  assessments: AssessmentProjection[]
  attributionRules: AttributionProjection[]
  tools: ToolProjection[]
}

export function projectModuleResourcePayload(
  context: ProjectionContext,
  payload: Record<string, unknown>
): ModuleResourceProjection {
  const base = {
    libraryId: context.libraryId,
    versionId: context.versionId,
    module: context.module,
    scope: context.scope,
    schoolId: context.schoolId || null
  }

  if (context.libraryType === 'assessment') {
    const rawInstruments = Array.isArray(payload.instruments) ? payload.instruments : [payload]
    return {
      assessments: rawInstruments
        .map((item, index) => projectAssessmentItem(base, item as Partial<AssessmentDefinition>, index))
        .filter((item): item is AssessmentProjection => Boolean(item)),
      attributionRules: [],
      tools: []
    }
  }

  if (context.libraryType === 'attribution') {
    const parsed = attributionConfigSchema.safeParse(payload)
    if (!parsed.success) return { assessments: [], attributionRules: [], tools: [] }
    return {
      assessments: [],
      attributionRules: parsed.data.branches.map(branch => ({
        ...base,
        ruleId: branch.ruleId,
        priority: branch.pri,
        level: branch.level,
        blocked: branch.blocked,
        hasCondition: Boolean(branch.when),
        primaryAttribution: branch.primaryAttribution,
        secondaryAttributions: branch.secondaryAttributions,
        toolTags: branch.toolTags,
        reasonCount: branch.reasons.length,
        metadata: {
          hasCrisisConfig: Boolean(parsed.data.crisis),
          computedKeys: Object.keys(parsed.data.computed),
          actionCount: parsed.data.actions.length,
          toolCount: parsed.data.tools.length
        }
      })),
      tools: []
    }
  }

  const parsed = toolLibraryPayloadSchema.safeParse(payload)
  if (!parsed.success) return { assessments: [], attributionRules: [], tools: [] }
  return {
    assessments: [],
    attributionRules: [],
    tools: parsed.data.tools.map(tool => ({
      ...base,
      toolCode: tool.code,
      name: tool.name,
      form: tool.form,
      severity: tool.severity || null,
      level: tool.level || null,
      primaryAttribution: tool.primaryAttribution || tool.attribution || null,
      attributions: compactUnique([tool.attribution, tool.primaryAttribution, ...(tool.attributions || [])]),
      tags: compactUnique(tool.tags || []),
      toolTags: compactUnique(tool.toolTags || []),
      dimensions: compactUnique(tool.dimensions || []),
      stepCount: tool.steps.length,
      hasScript: Boolean(tool.scripts),
      hasProhibitions: Boolean(tool.prohibitions),
      hasExpectedEffect: Boolean(tool.expectedEffect),
      metadata: {
        duration: tool.duration,
        timePerSession: tool.timePerSession,
        targetUsers: tool.targetUsers
      }
    }))
  }
}

export async function rebuildModuleResourceProjection(
  db: any,
  context: ProjectionContext,
  payload: Record<string, unknown>
) {
  const projection = projectModuleResourcePayload(context, payload)

  await db.delete(schema.moduleResourceAssessmentItems)
    .where(eq(schema.moduleResourceAssessmentItems.versionId, context.versionId))
  await db.delete(schema.moduleResourceAttributionRules)
    .where(eq(schema.moduleResourceAttributionRules.versionId, context.versionId))
  await db.delete(schema.moduleResourceToolItems)
    .where(eq(schema.moduleResourceToolItems.versionId, context.versionId))

  if (projection.assessments.length) {
    await db.insert(schema.moduleResourceAssessmentItems).values(projection.assessments)
  }
  if (projection.attributionRules.length) {
    await db.insert(schema.moduleResourceAttributionRules).values(projection.attributionRules)
  }
  if (projection.tools.length) {
    await db.insert(schema.moduleResourceToolItems).values(projection.tools)
  }

  return projection
}

function projectAssessmentItem(
  base: Omit<AssessmentProjection, 'instrumentCode' | 'title' | 'questionCount' | 'dimensions' | 'scoringKeys' | 'metadata'>,
  instrument: Partial<AssessmentDefinition>,
  index: number
): AssessmentProjection | null {
  const questions = Array.isArray(instrument.questions) ? instrument.questions : []
  const code = instrument.code || (instrument as { instrumentCode?: string }).instrumentCode || `instrument-${index + 1}`
  const title = instrument.title || code
  return {
    ...base,
    instrumentCode: code,
    title,
    questionCount: questions.length,
    dimensions: compactUnique(questions.map(question => question.dimension)),
    scoringKeys: compactUnique(Object.keys((instrument as { scoring?: Record<string, unknown> }).scoring || {})),
    metadata: {
      version: instrument.version,
      module: instrument.module,
      hasInterpretation: Boolean((instrument as { interpretations?: unknown }).interpretations)
    }
  }
}

function compactUnique(values: Array<unknown>) {
  return Array.from(new Set(values.map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean)))
}

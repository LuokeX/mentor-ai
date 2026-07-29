import { eq } from 'drizzle-orm'
import type { AssessmentDefinition } from '../../shared/assessments'
import {
  attributionConfigSchema,
  toolLibraryPayloadSchema,
  outputTemplateLibraryPayloadSchema,
  keywordRouteLibraryPayloadSchema,
  type LibraryType,
  type ModuleId,
  type Severity
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

/** 分级规则投影：只承载等级与严重度，不再承载归因 */
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
  severity: Severity
  assessmentCode: string | null
  metadata: Record<string, unknown>
}

/** 归因项投影：运营台按归因检索工具、查证据覆盖情况的入口 */
export interface AttributionItemProjection {
  libraryId: string
  versionId: string
  module: ModuleId
  scope: Scope
  schoolId: string | null
  attributionCode: string
  attributionName: string
  baseWeight: number
  toolTags: string[]
  evidenceCount: number
  assessmentCodes: string[]
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

// V2 新增投影类型
export interface OutputTemplateProjection {
  libraryId: string
  versionId: string
  module: ModuleId
  scope: Scope
  schoolId: string | null
  templateCode: string
  attributionLevel: string
  type: string
  order: number
  hasPlaceholders: boolean
  metadata: Record<string, unknown>
}

export interface KeywordRouteProjection {
  libraryId: string
  versionId: string
  module: ModuleId
  scope: Scope
  schoolId: string | null
  routeCode: string
  coreKeywords: string
  matchPriority: number
  riskLevel: string
  matchMode: string
  hasExclusionKeywords: boolean
  metadata: Record<string, unknown>
}

export interface ModuleResourceProjection {
  assessments: AssessmentProjection[]
  attributionRules: AttributionProjection[]
  attributionItems: AttributionItemProjection[]
  tools: ToolProjection[]
  // V2 新增
  outputTemplates: OutputTemplateProjection[]
  keywordRoutes: KeywordRouteProjection[]
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
      attributionItems: [],
      tools: [],
      outputTemplates: [],
      keywordRoutes: []
    }
  }

  if (context.libraryType === 'attribution') {
    const parsed = attributionConfigSchema.safeParse(payload)
    if (!parsed.success) return { assessments: [], attributionRules: [], attributionItems: [], tools: [], outputTemplates: [], keywordRoutes: [] }
    return {
      assessments: [],
      // 分级规则投影：运营台按等级/严重度检索
      attributionRules: parsed.data.gradingRules.map(rule => ({
        ...base,
        ruleId: rule.ruleId,
        priority: rule.pri,
        level: rule.level,
        blocked: rule.blocked,
        hasCondition: Boolean(rule.when),
        severity: rule.severity,
        assessmentCode: rule.assessmentCode || null,
        metadata: {
          levelName: rule.levelName || null,
          hasCrisisConfig: Boolean(parsed.data.crisis),
          computedKeys: Object.keys(parsed.data.computed),
          actionCount: parsed.data.actions.length,
          toolCount: parsed.data.tools.length,
          redLineCount: (parsed.data.redLines || []).length,
          hasEscalation: Boolean(rule.escalationCondition),
          hasReEvaluation: Boolean(rule.reEvaluationTrigger)
        }
      })),
      // 归因项投影：这是业务真正要检索的实体（「哪些工具挂在这条归因下」）
      attributionItems: parsed.data.attributionItems.map(item => ({
        ...base,
        attributionCode: item.code,
        attributionName: item.name,
        baseWeight: item.baseWeight,
        toolTags: item.toolTags,
        evidenceCount: parsed.data.evidences.filter(e => e.attributionCode === item.code).length,
        assessmentCodes: [...new Set(
          parsed.data.evidences.filter(e => e.attributionCode === item.code).map(e => e.assessmentCode)
        )],
        metadata: {
          hasDescription: Boolean(item.description),
          hasSuggestedAction: Boolean(item.suggestedAction),
          sourceRef: item.sourceRef || null
        }
      })),
      tools: [],
      outputTemplates: [],
      keywordRoutes: []
    }
  }

  // 工具库
  if (context.libraryType === 'tool') {
    const parsed = toolLibraryPayloadSchema.safeParse(payload)
    if (!parsed.success) return { assessments: [], attributionRules: [], attributionItems: [], tools: [], outputTemplates: [], keywordRoutes: [] }
    return {
      assessments: [],
      attributionRules: [],
      attributionItems: [],
      tools: parsed.data.tools.map(tool => ({
        ...base,
        toolCode: tool.code,
        name: tool.name,
        form: tool.form,
        severity: tool.severity || null,
        level: tool.level || null,
        primaryAttribution: tool.attributionCode || null,
        attributions: compactUnique([tool.attributionCode, ...(tool.attributionCodes || [])]),
        tags: compactUnique(tool.tags || []),
        toolTags: compactUnique(tool.toolTags || []),
        dimensions: compactUnique(tool.dimensions || []),
        stepCount: tool.steps.length,
        hasScript: Boolean(tool.scripts),
        hasProhibitions: Boolean(tool.prohibitions) || (tool.contraindicationRules || []).length > 0,
        hasExpectedEffect: Boolean(tool.expectedEffect),
        metadata: {
          duration: tool.duration,
          timePerSession: tool.timePerSession,
          targetUsers: tool.targetUsers,
          // V2 新增
          hasStructuredSteps: Boolean(tool.structuredSteps && tool.structuredSteps.length),
          structuredStepCount: tool.structuredSteps ? tool.structuredSteps.length : 0,
          evidenceLevel: tool.evidenceLevel || null,
          evidenceSource: tool.evidenceSource || null,
          contraindicationRuleCount: (tool.contraindicationRules || []).length,
          blockRuleCount: (tool.contraindicationRules || []).filter(r => r.type === 'block').length,
          warnRuleCount: (tool.contraindicationRules || []).filter(r => r.type === 'warn').length,
          crossModuleTags: tool.crossModuleTags || [],
          hasScriptTemplate: tool.structuredSteps ? tool.structuredSteps.some(s => s.scriptTemplate) : false
        }
      })),
      outputTemplates: [],
      keywordRoutes: []
    }
  }

  // V2 新增: output_template 投影
  if (context.libraryType === 'output_template') {
    const parsedTemplate = outputTemplateLibraryPayloadSchema.safeParse(payload)
    if (!parsedTemplate.success) return { assessments: [], attributionRules: [], attributionItems: [], tools: [], outputTemplates: [], keywordRoutes: [] }
    return {
      assessments: [],
      attributionRules: [],
      attributionItems: [],
      tools: [],
      outputTemplates: parsedTemplate.data.templates.map(t => ({
        ...base,
        templateCode: t.code,
        attributionLevel: t.attributionLevel,
        type: t.type,
        order: t.order,
        hasPlaceholders: /\$\{[^}]+\}/.test(t.content),
        metadata: {
          contentTypeCharCount: t.content.length,
          hasPlaceholderDoc: Boolean(t.placeholders)
        }
      })),
      keywordRoutes: []
    }
  }

  // V2 新增: keyword_route 投影
  if (context.libraryType === 'keyword_route') {
    const parsedRoute = keywordRouteLibraryPayloadSchema.safeParse(payload)
    if (!parsedRoute.success) return { assessments: [], attributionRules: [], attributionItems: [], tools: [], outputTemplates: [], keywordRoutes: [] }
    return {
      assessments: [],
      attributionRules: [],
      attributionItems: [],
      tools: [],
      outputTemplates: [],
      keywordRoutes: parsedRoute.data.routes.map(r => ({
        ...base,
        routeCode: r.code,
        coreKeywords: r.coreKeywords,
        matchPriority: r.matchPriority,
        riskLevel: r.riskLevel,
        matchMode: r.matchMode,
        hasExclusionKeywords: (r.exclusionKeywords || []).length > 0,
        metadata: {
          hasExpandedKeywords: Boolean(r.expandedKeywords),
          hasContextConstraint: Boolean(r.contextConstraint),
          linkedAssessmentCode: r.linkedAssessmentCode || null,
          linkedToolCode: r.linkedToolCode || null,
          routeWeight: r.routeWeight ?? null,
          temporalValidity: r.temporalValidity
        }
      }))
    }
  }

  // Fallback: 无法识别的类型返回空结果
  return { assessments: [], attributionRules: [], attributionItems: [], tools: [], outputTemplates: [], keywordRoutes: [] }
}

export async function rebuildModuleResourceProjection(
  db: any,
  context: ProjectionContext,
  payload: Record<string, unknown>
) {
  // knowledge 类型已独立为知识库系统，不通过三库运营台投影
  const projection = projectModuleResourcePayload(context, payload)

  await db.delete(schema.moduleResourceAssessmentItems)
    .where(eq(schema.moduleResourceAssessmentItems.versionId, context.versionId))
  await db.delete(schema.moduleResourceAttributionRules)
    .where(eq(schema.moduleResourceAttributionRules.versionId, context.versionId))
  await db.delete(schema.moduleResourceAttributionItems)
    .where(eq(schema.moduleResourceAttributionItems.versionId, context.versionId))
  await db.delete(schema.moduleResourceToolItems)
    .where(eq(schema.moduleResourceToolItems.versionId, context.versionId))

  if (projection.assessments.length) {
    await db.insert(schema.moduleResourceAssessmentItems).values(projection.assessments)
  }
  if (projection.attributionRules.length) {
    await db.insert(schema.moduleResourceAttributionRules).values(projection.attributionRules)
  }
  if (projection.attributionItems.length) {
    await db.insert(schema.moduleResourceAttributionItems).values(projection.attributionItems)
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
      hasInterpretation: Boolean((instrument as { interpretations?: unknown }).interpretations),
      // V2 新增
      applicableGrades: (instrument as { applicableGrades?: number[] }).applicableGrades || null,
      applicableSubjects: (instrument as { applicableSubjects?: string[] }).applicableSubjects || null,
      triggerMethod: (instrument as { triggerMethod?: string }).triggerMethod || null,
      frequency: (instrument as { frequency?: string }).frequency || null,
      isRequired: Boolean((instrument as { isRequired?: boolean }).isRequired),
      hasDimensionDefs: Boolean((instrument as { dimensionDefs?: unknown[] }).dimensionDefs?.length),
      dimensionDefCount: ((instrument as { dimensionDefs?: unknown[] }).dimensionDefs || []).length,
      resultVisibility: (instrument as { resultVisibility?: string }).resultVisibility || null,
      estimatedMinutes: (instrument as { estimatedMinutes?: number }).estimatedMinutes ?? null,
      normReference: (instrument as { normReference?: string }).normReference || null
    }
  }
}

function compactUnique(values: Array<unknown>) {
  return Array.from(new Set(values.map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean)))
}

import {
  previewModuleResourcePayload,
  validateModuleResourcePayload
} from '../../server/domain/module-resource-validation'
import { projectModuleResourcePayload } from '../../server/domain/module-resource-projection'
import type { LibraryType, ModuleId } from '../../shared/contracts'

export interface ImportQualityReport {
  module: ModuleId
  libraryType: LibraryType
  status: 'pass' | 'warn' | 'fail'
  score: number
  summary: {
    assessmentCount: number
    attributionRuleCount: number
    toolCount: number
    warningCount: number
    errorCount: number
  }
  metrics: Record<string, number>
  errors: Array<{ message: string, path?: string }>
  warnings: Array<{ message: string, path?: string }>
  preview: unknown
}

export function evaluateImportQuality(input: {
  module: ModuleId
  libraryType: LibraryType
  payload: Record<string, unknown>
  strict?: boolean
}): ImportQualityReport {
  const validation = validateModuleResourcePayload(input)
  const projection = projectModuleResourcePayload({
    libraryId: '00000000-0000-0000-0000-000000000001',
    versionId: '00000000-0000-0000-0000-000000000002',
    module: input.module,
    libraryType: input.libraryType,
    scope: 'global',
    schoolId: null
  }, input.payload)
  const metrics = calculateMetrics(projection)
  const errorCount = validation.errors.length
  const warningCount = validation.warnings.length
  const status = errorCount > 0 || (input.strict && warningCount > 0)
    ? 'fail'
    : warningCount > 0
      ? 'warn'
      : 'pass'

  return {
    module: input.module,
    libraryType: input.libraryType,
    status,
    score: Math.max(0, 100 - errorCount * 25 - warningCount * 5),
    summary: {
      assessmentCount: projection.assessments.length,
      attributionRuleCount: projection.attributionRules.length,
      toolCount: projection.tools.length,
      warningCount,
      errorCount
    },
    metrics,
    errors: validation.errors,
    warnings: validation.warnings,
    preview: validation.ok ? previewModuleResourcePayload(input) : null
  }
}

export function formatImportQualityReport(report: ImportQualityReport) {
  const lines = [
    `  Quality: ${report.status.toUpperCase()} score=${report.score}`,
    `  Projection: assessments=${report.summary.assessmentCount}, rules=${report.summary.attributionRuleCount}, tools=${report.summary.toolCount}`
  ]
  const metricEntries = Object.entries(report.metrics)
  if (metricEntries.length) {
    lines.push(`  Metrics: ${metricEntries.map(([key, value]) => `${key}=${formatMetric(value)}`).join(', ')}`)
  }
  for (const issue of report.errors.slice(0, 5)) {
    lines.push(`  ERROR: ${issue.path ? `${issue.path}: ` : ''}${issue.message}`)
  }
  for (const issue of report.warnings.slice(0, 5)) {
    lines.push(`  WARN: ${issue.path ? `${issue.path}: ` : ''}${issue.message}`)
  }
  if (report.errors.length > 5) lines.push(`  ERROR: 还有 ${report.errors.length - 5} 条错误未显示`)
  if (report.warnings.length > 5) lines.push(`  WARN: 还有 ${report.warnings.length - 5} 条警告未显示`)
  return lines.join('\n')
}

function calculateMetrics(projection: ReturnType<typeof projectModuleResourcePayload>) {
  const metrics: Record<string, number> = {}

  const questions = projection.assessments.reduce((sum, item) => sum + item.questionCount, 0)
  if (projection.assessments.length) {
    metrics.averageQuestions = questions / projection.assessments.length
    metrics.dimensionCoverage = ratio(
      projection.assessments.filter(item => item.dimensions.length > 0).length,
      projection.assessments.length
    )
  }

  if (projection.attributionRules.length) {
    metrics.fallbackRuleCount = projection.attributionRules.filter(item => !item.hasCondition).length
    metrics.blockedRuleCount = projection.attributionRules.filter(item => item.blocked).length
    metrics.toolTaggedRuleRatio = ratio(
      projection.attributionRules.filter(item => item.toolTags.length > 0).length,
      projection.attributionRules.length
    )
  }

  if (projection.tools.length) {
    metrics.toolMatchHintRatio = ratio(
      projection.tools.filter(item =>
        Boolean(item.level || item.severity || item.primaryAttribution)
        || item.attributions.length > 0
        || item.tags.length > 0
        || item.toolTags.length > 0
        || item.dimensions.length > 0
      ).length,
      projection.tools.length
    )
    metrics.toolScriptRatio = ratio(projection.tools.filter(item => item.hasScript).length, projection.tools.length)
    metrics.toolProhibitionRatio = ratio(projection.tools.filter(item => item.hasProhibitions).length, projection.tools.length)
    metrics.toolExpectedEffectRatio = ratio(projection.tools.filter(item => item.hasExpectedEffect).length, projection.tools.length)
  }

  return metrics
}

function ratio(value: number, total: number) {
  if (total === 0) return 0
  return Number((value / total).toFixed(4))
}

function formatMetric(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

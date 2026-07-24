import { z } from 'zod'
import { moduleIdSchema } from '../../../../../shared/contracts'
import { listPublishedModuleTools } from '../../../../domain/module-resources'
import { requireUser } from '../../../../utils/auth'

const querySchema = z.object({
  severity: z.string().trim().optional(),
  form: z.string().trim().optional(),
  dimension: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })

  const module = moduleIdSchema.parse(getRouterParam(event, 'module'))
  const query = querySchema.parse(getQuery(event))
  const { tools, sourceVersions } = await listPublishedModuleTools(event, module, user.schoolId)
  const filtered = filterTools(tools, query)

  return {
    module,
    tools: filtered.slice(0, query.limit),
    sourceVersions
  }
})

function filterTools(
  tools: unknown[],
  query: z.infer<typeof querySchema>
) {
  const severity = normalize(query.severity)
  const form = normalize(query.form)
  const dimensions = normalizeList(query.dimension)

  return tools.filter((item) => {
    const tool = item as Record<string, unknown>
    const toolSeverity = normalize(readString(tool.severity) || readString(tool.severity_grade))
    const toolForm = normalize(readString(tool.form) || readString(tool.type))
    const toolDimensions = Array.isArray(tool.dimensions)
      ? tool.dimensions.map(value => normalize(String(value))).filter(Boolean)
      : normalizeList(readString(tool.dimension) || readString(tool.category))

    const severityMatch = !severity || !toolSeverity || toolSeverity.includes(severity) || severity.includes(toolSeverity)
    const formMatch = !form || !toolForm || toolForm.includes(form) || form.includes(toolForm)
    const dimensionMatch = dimensions.length === 0 ||
      toolDimensions.length === 0 ||
      dimensions.some(dimension => toolDimensions.some(toolDimension => toolDimension.includes(dimension) || dimension.includes(toolDimension)))

    return severityMatch && formMatch && dimensionMatch
  })
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function normalize(value?: string) {
  return value?.trim().toLowerCase() || ''
}

function normalizeList(value?: string) {
  return normalize(value).split(/[,，、+]/).map(item => item.trim()).filter(Boolean)
}

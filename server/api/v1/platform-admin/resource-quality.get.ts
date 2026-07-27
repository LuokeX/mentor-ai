import { desc, sql } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['platform_admin'])
  const db = useDb(event)
  const [feedbackRows, versionRows, moduleRows] = await Promise.all([
    db.select({
      module: schema.planFeedback.module,
      ruleIds: schema.planFeedback.ruleIds,
      toolCodes: schema.planFeedback.toolCodes,
      sourceResourceVersionIds: schema.planFeedback.sourceResourceVersionIds,
      attributionAccuracy: schema.planFeedback.attributionAccuracy,
      toolUsability: schema.planFeedback.toolUsability,
      scriptNaturalness: schema.planFeedback.scriptNaturalness,
      actionDifficulty: schema.planFeedback.actionDifficulty,
      reviewUsefulness: schema.planFeedback.reviewUsefulness,
      tags: schema.planFeedback.tags,
      createdAt: schema.planFeedback.createdAt
    }).from(schema.planFeedback)
      .orderBy(desc(schema.planFeedback.createdAt))
      .limit(2000),
    db.select({
      versionId: schema.moduleResourceVersions.id,
      libraryId: schema.moduleResourceVersions.libraryId,
      version: schema.moduleResourceVersions.version,
      status: schema.moduleResourceVersions.status,
      module: schema.moduleResourceLibraries.module,
      libraryType: schema.moduleResourceLibraries.libraryType,
      scope: schema.moduleResourceLibraries.scope,
      publishedAt: schema.moduleResourceVersions.publishedAt
    }).from(schema.moduleResourceVersions)
      .innerJoin(schema.moduleResourceLibraries, sql`${schema.moduleResourceVersions.libraryId} = ${schema.moduleResourceLibraries.id}`)
      .orderBy(desc(schema.moduleResourceVersions.updatedAt))
      .limit(500),
    db.select({
      module: schema.planFeedback.module,
      count: sql<number>`count(*)::int`,
      attributionAccuracy: sql<number>`coalesce(round(avg(${schema.planFeedback.attributionAccuracy}), 1), 0)::float`,
      toolUsability: sql<number>`coalesce(round(avg(${schema.planFeedback.toolUsability}), 1), 0)::float`,
      scriptNaturalness: sql<number>`coalesce(round(avg(${schema.planFeedback.scriptNaturalness}), 1), 0)::float`,
      actionDifficulty: sql<number>`coalesce(round(avg(${schema.planFeedback.actionDifficulty}), 1), 0)::float`,
      reviewUsefulness: sql<number>`coalesce(round(avg(${schema.planFeedback.reviewUsefulness}), 1), 0)::float`
    }).from(schema.planFeedback)
      .groupBy(schema.planFeedback.module)
  ])

  const versionsById = new Map(versionRows.map(row => [row.versionId, row]))
  const ruleStats = new Map<string, QualityBucket>()
  const toolStats = new Map<string, QualityBucket>()
  const versionStats = new Map<string, QualityBucket>()
  const tagCounts = new Map<string, number>()

  for (const row of feedbackRows) {
    for (const tag of row.tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
    for (const ruleId of row.ruleIds || []) {
      addBucket(ruleStats, `${row.module || 'unknown'}:${ruleId}`, row, { module: row.module || 'unknown', code: ruleId })
    }
    for (const toolCode of row.toolCodes || []) {
      addBucket(toolStats, `${row.module || 'unknown'}:${toolCode}`, row, { module: row.module || 'unknown', code: toolCode })
    }
    for (const versionId of row.sourceResourceVersionIds || []) {
      const version = versionsById.get(versionId)
      addBucket(versionStats, versionId, row, {
        module: version?.module || row.module || 'unknown',
        code: versionId,
        version: version?.version,
        libraryType: version?.libraryType,
        scope: version?.scope
      })
    }
  }

  return {
    summary: {
      feedbackCount: feedbackRows.length,
      moduleCount: moduleRows.length,
      trackedVersionCount: versionStats.size,
      trackedRuleCount: ruleStats.size,
      trackedToolCount: toolStats.size
    },
    modules: moduleRows,
    tags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([tag, count]) => ({ tag, count })),
    rules: rankBuckets(ruleStats, 'attributionAccuracy'),
    tools: rankBuckets(toolStats, 'toolUsability'),
    versions: rankBuckets(versionStats, 'overall')
  }
})

interface QualityBucket {
  module: string
  code: string
  version?: string
  libraryType?: string
  scope?: string
  count: number
  lowAttribution: number
  lowTool: number
  hardAction: number
  attributionTotal: number
  toolTotal: number
  scriptTotal: number
  difficultyTotal: number
  reviewTotal: number
}

function addBucket(
  map: Map<string, QualityBucket>,
  key: string,
  row: {
    attributionAccuracy: number
    toolUsability: number
    scriptNaturalness: number
    actionDifficulty: number
    reviewUsefulness: number
  },
  meta: { module: string, code: string, version?: string, libraryType?: string, scope?: string }
) {
  const bucket = map.get(key) || {
    ...meta,
    count: 0,
    lowAttribution: 0,
    lowTool: 0,
    hardAction: 0,
    attributionTotal: 0,
    toolTotal: 0,
    scriptTotal: 0,
    difficultyTotal: 0,
    reviewTotal: 0
  }
  bucket.count++
  bucket.lowAttribution += row.attributionAccuracy < 3 ? 1 : 0
  bucket.lowTool += row.toolUsability < 3 ? 1 : 0
  bucket.hardAction += row.actionDifficulty >= 5 ? 1 : 0
  bucket.attributionTotal += row.attributionAccuracy
  bucket.toolTotal += row.toolUsability
  bucket.scriptTotal += row.scriptNaturalness
  bucket.difficultyTotal += row.actionDifficulty
  bucket.reviewTotal += row.reviewUsefulness
  map.set(key, bucket)
}

function rankBuckets(map: Map<string, QualityBucket>, primary: 'attributionAccuracy' | 'toolUsability' | 'overall') {
  return [...map.values()].map(bucket => ({
    ...bucket,
    attributionAccuracy: round(bucket.attributionTotal / bucket.count),
    toolUsability: round(bucket.toolTotal / bucket.count),
    scriptNaturalness: round(bucket.scriptTotal / bucket.count),
    actionDifficulty: round(bucket.difficultyTotal / bucket.count),
    reviewUsefulness: round(bucket.reviewTotal / bucket.count),
    lowAttributionRate: round(bucket.lowAttribution / bucket.count),
    lowToolRate: round(bucket.lowTool / bucket.count),
    hardActionRate: round(bucket.hardAction / bucket.count)
  })).sort((a, b) => {
    const scoreA = primary === 'attributionAccuracy'
      ? a.attributionAccuracy
      : primary === 'toolUsability' ? a.toolUsability : (a.attributionAccuracy + a.toolUsability + a.reviewUsefulness) / 3
    const scoreB = primary === 'attributionAccuracy'
      ? b.attributionAccuracy
      : primary === 'toolUsability' ? b.toolUsability : (b.attributionAccuracy + b.toolUsability + b.reviewUsefulness) / 3
    return scoreA - scoreB || b.count - a.count
  }).slice(0, 30)
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

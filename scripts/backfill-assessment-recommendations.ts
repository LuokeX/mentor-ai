/**
 * 历史量表推荐埋点回填（看板「量表推荐次数 / 推荐后完成作答」口径）。
 *
 * 背景：`assistant_assessment_recommended` 埋点是 2026-10-10 随回答排版基线一起
 * 加入、随 v1.4.0 才上正式环境的。此前助手已经推荐过量表，但只把推荐卡片写进了
 * 助手消息的 `metadata.actionCards`，没有写产品事件，导致看板只能统计到埋点上线
 * 之后的极少数据。
 *
 * 本脚本从历史助手消息的推荐卡片重建产品事件：
 *  - 只认 `kind = 'recommend_assessment'` 的卡片（教师实际看到的推荐）；
 *  - 时间取助手消息落地时间（推荐对教师可见的时刻），便于「推荐后作答」判定；
 *  - instruments 只写卡片上的首选量表编码——历史消息没有保存同轮候选清单，
 *    因此不会把候选量表算进作答匹配（偏保守，不虚高）；
 *  - 已存在的事件按「同教师、同会话、编码出现在 instruments、时间在消息前后
 *    10 分钟内」匹配并跳过，脚本可重复执行（幂等）。
 *
 * 用法：
 *   pnpm tsx scripts/backfill-assessment-recommendations.ts            # 默认 dry-run
 *   pnpm tsx scripts/backfill-assessment-recommendations.ts --apply    # 写库
 *   pnpm tsx scripts/backfill-assessment-recommendations.ts --limit 5  # 小样本
 *
 * 目标库由 DATABASE_URL 决定（本地开发库 5434；测试 5435；正式 5433）。
 */
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { and, asc, eq, isNull } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { loadLocalEnv } from './load-env'

const args = process.argv.slice(2)
const argValue = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const apply = args.includes('--apply')
const limitArg = argValue('--limit')
const limit = limitArg === undefined ? undefined : Number(limitArg)
if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) throw new Error('--limit 需为正整数')

loadLocalEnv()
const databaseUrl = process.env.DATABASE_URL || process.env.MIGRATION_DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

function describeTarget(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}（user=${decodeURIComponent(parsed.username)}）`
  } catch {
    return '（DATABASE_URL 无法解析）'
  }
}

/** 已有事件与历史推荐卡片的匹配窗口：工具调用先写事件，助手消息稍后落库。 */
const MATCH_BEFORE_MS = 10 * 60_000
const MATCH_AFTER_MS = 60_000

const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle(pool, { schema })

interface RecommendationCard {
  messageId: string
  schoolId: string
  userId: string
  sessionId: string
  at: Date
  module: string
  code: string
  hasObject: boolean
}

try {
  const messages = await db.select({
    id: schema.chatMessages.id,
    schoolId: schema.chatMessages.schoolId,
    ownerUserId: schema.chatMessages.ownerUserId,
    sessionId: schema.chatMessages.sessionId,
    createdAt: schema.chatMessages.createdAt,
    metadata: schema.chatMessages.metadata
  }).from(schema.chatMessages)
    .where(andRows())
    .orderBy(asc(schema.chatMessages.createdAt))

  const cards: RecommendationCard[] = []
  for (const message of messages) {
    const metadata = (message.metadata ?? {}) as Record<string, unknown>
    const actionCards = Array.isArray(metadata.actionCards) ? metadata.actionCards : []
    const turnObjects = Array.isArray(metadata.turnObjects) ? metadata.turnObjects : []
    const hasObject = turnObjects.length > 0 || Boolean(metadata.turnObject)
    for (const raw of actionCards) {
      if (!raw || typeof raw !== 'object') continue
      const card = raw as Record<string, unknown>
      if (card.kind !== 'recommend_assessment') continue
      const module = typeof card.module === 'string' ? card.module.trim() : ''
      const code = typeof card.assessmentCode === 'string' ? card.assessmentCode.trim() : ''
      if (!module || !code) continue
      if (!message.sessionId) continue
      cards.push({
        messageId: message.id,
        schoolId: message.schoolId,
        userId: message.ownerUserId,
        sessionId: message.sessionId,
        at: message.createdAt,
        module,
        code,
        hasObject
      })
    }
  }

  const existing = await db.select({
    id: schema.productEvents.id,
    userId: schema.productEvents.userId,
    targetId: schema.productEvents.targetId,
    metadata: schema.productEvents.metadata,
    createdAt: schema.productEvents.createdAt
  }).from(schema.productEvents)
    .where(eq(schema.productEvents.eventName, 'assistant_assessment_recommended'))
    .orderBy(asc(schema.productEvents.createdAt))

  const existingEvents = existing.map(event => ({
    id: event.id,
    userId: event.userId,
    sessionId: event.targetId,
    instruments: String((event.metadata ?? {}).instruments ?? '').split(',').map(item => item.trim()).filter(Boolean),
    at: event.createdAt.getTime()
  }))

  const matched = new Set<string>()
  const pending: RecommendationCard[] = []
  for (const card of cards) {
    const cardAt = card.at.getTime()
    const hit = existingEvents.find(event => !matched.has(event.id)
      && event.userId === card.userId
      && event.sessionId === card.sessionId
      && event.instruments.includes(card.code)
      && event.at >= cardAt - MATCH_BEFORE_MS
      && event.at <= cardAt + MATCH_AFTER_MS)
    if (hit) {
      matched.add(hit.id)
      continue
    }
    pending.push(card)
  }

  const targets = limit === undefined ? pending : pending.slice(0, limit)
  const byModule = new Map<string, number>()
  const byMonth = new Map<string, number>()
  for (const card of targets) {
    byModule.set(card.module, (byModule.get(card.module) ?? 0) + 1)
    const month = card.at.toISOString().slice(0, 7)
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1)
  }

  console.log(`目标库：${describeTarget(databaseUrl)}`)
  console.log(`模式：${apply ? '--apply（写 product_events）' : '--dry-run（不写库）'}${limit ? `；limit=${limit}` : ''}`)
  console.log(`历史推荐卡片：${cards.length} 条；已存在事件匹配：${matched.size} 条；待回填：${pending.length} 条${limit && targets.length < pending.length ? `（本次处理 ${targets.length} 条）` : ''}`)
  console.log(`按模块：${[...byModule.entries()].map(([module, count]) => `${module}=${count}`).join('　') || '—'}`)
  console.log(`按月：${[...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => `${month}=${count}`).join('　') || '—'}`)

  if (apply && targets.length) {
    let inserted = 0
    for (const card of targets) {
      await db.insert(schema.productEvents).values({
        schoolId: card.schoolId,
        userId: card.userId,
        eventName: 'assistant_assessment_recommended',
        targetType: 'chat_session',
        targetId: card.sessionId,
        metadata: {
          module: card.module,
          instruments: card.code,
          hasObject: card.hasObject,
          backfill: true
        },
        createdAt: card.at
      })
      inserted += 1
    }
    console.log(`已写入：${inserted} 条（metadata.backfill=true，时间取助手消息落地时间）`)
  } else if (!apply) {
    console.log('确认无误后追加 --apply 执行回填。')
  }
} finally {
  await pool.end()
}

/** 助手消息且未软删（条件集中在此，避免 select 链上重复拼接）。 */
function andRows() {
  return and(
    eq(schema.chatMessages.role, 'assistant'),
    isNull(schema.chatMessages.deletedAt)
  )
}

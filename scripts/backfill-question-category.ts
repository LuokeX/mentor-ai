/**
 * 历史提问分类回填（分角色数据看板 W2/W3 口径）。
 *
 * 背景：chat_messages 的 question_category / question_category_source /
 * question_category_confidence / question_keywords 四列随迁移 0059/0060 新增，
 * 新提问在聊天入口实时写入（server/api/v1/chat/messages.post.ts），存量提问需要本脚本回填。
 *
 * 目标行：role='user' 且未软删；默认只处理「分类为空」的行，--model 时额外重跑
 *         source='unknown' 的行（默认规则回填留下的未命中行，可用模型再试一次）。
 * 分类口径：规则优先；规则未命中时——默认（不加 --model）写「其他类」+ source=unknown；
 *         加 --model 且学校数据模式不是 local 才调用模型，模型失败/非法仍写 unknown。
 *         学校数据模式为 local 的提问绝不外发（硬约束），一律按 unknown 落库。
 *
 * dry-run：不写 chat_messages；注意 --model 模式下模型调用仍走既有通道，
 *          会按仓库既有行为写 ai_model_calls 审计（只有元数据，无正文）。
 *
 * 用法：
 *   pnpm tsx scripts/backfill-question-category.ts --dry-run          # 默认，只统计不写库
 *   pnpm tsx scripts/backfill-question-category.ts --apply            # 只按规则回填
 *   pnpm tsx scripts/backfill-question-category.ts --apply --model    # 规则 + 模型回填
 *   pnpm tsx scripts/backfill-question-category.ts --dry-run --model --limit 20   # 小样本试跑
 *   目标库由 DATABASE_URL 决定（本地开发库 5434；测试 5435；正式 5433）。
 */
import type { H3Event } from 'h3'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { decryptSensitive } from '../server/utils/crypto'
import { loadLocalEnv } from './load-env'

const args = process.argv.slice(2)
const argValue = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const apply = args.includes('--apply')
const useModel = args.includes('--model')
const limitArg = argValue('--limit')
const limit = limitArg === undefined ? undefined : Number(limitArg)
if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) throw new Error('--limit 需为正整数')

loadLocalEnv()
const databaseUrl = process.env.DATABASE_URL || process.env.MIGRATION_DATABASE_URL
const encryptionKey = process.env.ENCRYPTION_KEY
if (!databaseUrl) throw new Error('DATABASE_URL is required')
if (!encryptionKey) throw new Error('ENCRYPTION_KEY is required')

// 与 scripts/ai-evaluation/* 同一套做法：先桩掉 Nuxt 运行时配置，再动态导入被测模块，
// 这样 --model 的调用仍走 callJsonChat（含脱敏校验与 ai_model_calls 审计）。
if (useModel) {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('--model 需要 DEEPSEEK_API_KEY')
  const runtime = {
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    deepseekGeneratorModel: process.env.DEEPSEEK_GENERATOR_MODEL || 'deepseek-flash',
    deepseekTimeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS) || 30_000,
    aiStrictJsonPurposes: process.env.AI_STRICT_JSON_PURPOSES || '',
    databaseUrl,
    encryptionKey
  }
  Object.assign(globalThis, { useRuntimeConfig: () => runtime })
}

const { QUESTION_CATEGORIES, classifyQuestion, persistQuestionCategory } = await import('../server/domain/question-category')

function describeTarget(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}（user=${decodeURIComponent(parsed.username)}）`
  } catch {
    return '（DATABASE_URL 无法解析）'
  }
}

console.log(`目标库：${describeTarget(databaseUrl)}`)
console.log(`模式：${apply ? '--apply（写库）' : '--dry-run（不写 chat_messages）'}${useModel ? ' + 模型分类' : '（仅规则分类）'}${limit ? `；limit=${limit}` : ''}`)
if (useModel && !apply) console.log('提醒：dry-run + 模型分类仍会真实调用模型，并按既有通道写 ai_model_calls 审计（只记元数据）。')

const pool = new Pool({ connectionString: databaseUrl })
const db = drizzle(pool, { schema })
/** 模型路径只用到 event 取运行时配置与审计上下文，不读请求对象。 */
const fakeEvent = {} as H3Event

try {
  const rows = await db.select({
    id: schema.chatMessages.id,
    schoolId: schema.chatMessages.schoolId,
    ownerUserId: schema.chatMessages.ownerUserId,
    sessionId: schema.chatMessages.sessionId,
    contentEnc: schema.chatMessages.contentEnc,
    category: schema.chatMessages.questionCategory,
    categorySource: schema.chatMessages.questionCategorySource,
    aiDataMode: schema.schoolSettings.aiDataMode
  }).from(schema.chatMessages)
    .leftJoin(schema.schoolSettings, eq(schema.schoolSettings.schoolId, schema.chatMessages.schoolId))
    .where(and(
      eq(schema.chatMessages.role, 'user'),
      isNull(schema.chatMessages.deletedAt),
      useModel
        ? or(isNull(schema.chatMessages.questionCategory), eq(schema.chatMessages.questionCategorySource, 'unknown'))
        : isNull(schema.chatMessages.questionCategory)
    ))
    .orderBy(asc(schema.chatMessages.createdAt))
    .limit(limit ?? 100_000)

  const emptyCount = rows.filter(row => row.category === null).length
  const unknownCount = rows.length - emptyCount
  console.log(`候选提问：${rows.length} 条（分类为空 ${emptyCount}${useModel ? ` / 原 unknown 重跑 ${unknownCount}` : ''}）`)

  const stats = {
    ruleHits: 0,
    modelOk: 0,
    unknown: 0,
    localSchools: 0,
    decryptFailed: 0,
    writeFailed: 0
  }
  const categoryCounts = new Map<string, number>()
  const sourceCounts = new Map<string, number>()
  const keywordCounts = new Map<string, number>()

  for (const [index, row] of rows.entries()) {
    let text: string
    try {
      text = decryptSensitive(row.contentEnc, encryptionKey)
    } catch (error) {
      stats.decryptFailed += 1
      console.warn(`[${index + 1}/${rows.length}] 解密失败，跳过 ${row.id}：${error instanceof Error ? error.message : error}`)
      continue
    }

    // 学校数据模式为 local 时绝不外发；未建 school_settings 行的学校按代码默认值 redacted 处理
    const schoolLocal = row.aiDataMode === 'local'
    if (schoolLocal) stats.localSchools += 1

    const result = await classifyQuestion(fakeEvent, {
      text,
      localMode: !useModel || schoolLocal,
      audit: { schoolId: row.schoolId, ownerUserId: row.ownerUserId, sessionId: row.sessionId }
    })

    if (result.source === 'rule') stats.ruleHits += 1
    else if (result.source === 'model') stats.modelOk += 1
    else stats.unknown += 1
    categoryCounts.set(result.category, (categoryCounts.get(result.category) ?? 0) + 1)
    sourceCounts.set(result.source, (sourceCounts.get(result.source) ?? 0) + 1)
    for (const keyword of result.keywords) keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1)

    if (apply) {
      try {
        await persistQuestionCategory(db, {
          messageId: row.id,
          schoolId: row.schoolId,
          ownerUserId: row.ownerUserId,
          result
        })
      } catch (error) {
        stats.writeFailed += 1
        console.error(`[${index + 1}/${rows.length}] 写库失败 ${row.id}：${error instanceof Error ? error.message : error}`)
      }
    }

    if (useModel && (index + 1) % 10 === 0) console.log(`已处理 ${index + 1}/${rows.length}`)
  }

  const percent = (count: number) => rows.length ? `（${(count / rows.length * 100).toFixed(1)}%）` : ''
  console.log(`\n=== 提问分类回填报告（${apply ? '已写库' : 'dry-run，未写库'}）===`)
  console.log(`分类分布：`)
  for (const category of QUESTION_CATEGORIES) {
    const count = categoryCounts.get(category) ?? 0
    console.log(`  ${category}：${count} 条${percent(count)}`)
  }
  const otherCategories = [...categoryCounts.keys()].filter(key => !(QUESTION_CATEGORIES as readonly string[]).includes(key))
  for (const category of otherCategories) console.log(`  ${category}：${categoryCounts.get(category)} 条（非法取值，请检查）`)
  console.log(`来源分布：rule=${sourceCounts.get('rule') ?? 0} / model=${sourceCounts.get('model') ?? 0} / unknown=${sourceCounts.get('unknown') ?? 0}`)
  console.log(`说明：规则命中 ${stats.ruleHits} 条；模型成功 ${stats.modelOk} 条；未知兜底 ${stats.unknown} 条；local 模式学校提问 ${stats.localSchools} 条（未外发）`)
  const topKeywords = [...keywordCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
  if (topKeywords.length) console.log(`关键词 Top 10：${topKeywords.map(([word, count]) => `${word}(${count})`).join('　')}`)
  console.log(`解密失败：${stats.decryptFailed} 条；写库失败：${stats.writeFailed} 条`)
  if (!apply) console.log('确认无误后追加 --apply 执行回填。')
} finally {
  await pool.end()
}

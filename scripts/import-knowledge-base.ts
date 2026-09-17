/**
 * 知识库「全量替换导入」：把业务改过的导出文件倒回系统（新增 / 修改 / 删除一次对齐）。
 *
 * 背景：平台后台的「批量导入」是纯新增，同一个文件再导一次只会多出一批重复文档；
 * 知识库也没有改正文的入口（PATCH 只改「适用学部」）。而三库文案巡检的实际流程是
 * 「导出全量 → 业务改文案/加条目/删条目 → 导回来、库里与文件一致」，所以单独有这条链路。
 *
 * 匹配依据是导出文件自带的「文档ID」列：
 *  - 有 ID 且库里存在 → 按正文是否变化决定「重切块+重新向量化」或「只合并元数据」；
 *  - ID 留空 → 新增（分块 + 向量化后置 ready）；若库内已有标题与正文都逐字一致的文档，
 *    按同一篇处理（上一轮导入新增、文件里还没回填 ID 的情况，保证同一份文件可重复跑）；
 *  - 库里有、文件里没有 → 删除（连带切块）；
 *  - ID 列缺失、ID 库里查不到、同一 ID 出现多次 → 拒绝执行，不猜。
 *
 * 默认 dry-run（只打印计划，不写库），必须显式加 --write 才写入。
 *
 * 用法：
 *   pnpm knowledge:import -- --file=exports/知识库全量内容_20260917.xlsx
 *   pnpm knowledge:import -- --file=exports/知识库全量内容_20260917.xlsx --write
 *   pnpm knowledge:import -- --file=... --write --allow-mass-delete
 *   pnpm knowledge:import -- --file=... --actor=13800000000
 *
 * 可选参数：
 *   --file=<path>             必填，业务改完回传的 XLSX（必须是平台导出的文件做底稿）
 *   --write                   实际写入；不传即为 dry-run
 *   --allow-mass-delete       允许删除超过库内 20% 的文档（防误用局部导出覆盖全库）
 *   --actor=<手机号|用户ID>   指定导入人（写入 documents.createdBy 与审计）；默认库内唯一平台管理员
 *
 * 环境：读写 process.env.DATABASE_URL 指向的库（本地 dev 为 localhost:5434/mentor_ai_dev）。
 * 向量化读 EMBEDDING_* 环境变量；未开启时新写入的切块不带向量，跑 pnpm resources:reindex 补。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import {
  checksumModuleResourceContent,
  createDocumentWithChunks,
  normalizeModuleResourceContent,
  updateDocumentContentWithChunks,
  updateDocumentMetadata
} from '../server/domain/module-resource-documents'
import { parseKnowledgeWorkbook } from '../server/domain/module-resource-file-import'
import {
  knowledgeImportErrors,
  planKnowledgeImport,
  type ExistingKnowledgeDocument,
  type IncomingKnowledgeDocument
} from '../server/domain/module-resource-knowledge-import'
import { requestProviderEmbeddings, type EmbeddingProvider, type EmbeddingProviderConfig } from '../server/integrations/embeddings'
import { DEFAULT_EMBEDDING_MODEL } from '../server/integrations/ollama'
import { schema, useDb } from '../server/utils/db'
import { normalizeSchoolSection } from '../shared/school-section'
import { loadLocalEnv } from './load-env'

function readArg(name: string): string | null {
  const prefix = `--${name}=`
  const hit = process.argv.find(arg => arg.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

/** CLI 报错只留一行中文原因，不打 Node 堆栈。 */
function fail(error: unknown): never {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
process.on('unhandledRejection', fail)
process.on('uncaughtException', fail)

const WRITE = process.argv.includes('--write')
const ALLOW_MASS_DELETE = process.argv.includes('--allow-mass-delete')
/** 删除超过库内文档的这一比例时，必须显式 --allow-mass-delete：防「按模块导出的文件」覆盖全库 */
const MASS_DELETE_RATIO = 0.2

const fileArg = readArg('file')
if (!fileArg) throw new Error('缺少 --file=<业务改完回传的 XLSX 路径>')
const filePath = resolve(fileArg)
const actorArg = readArg('actor')

loadLocalEnv()
const db = useDb()

/** 脚本侧向量化配置：与 pnpm resources:reindex 同一套环境变量口径。 */
function embeddingConfig(): EmbeddingProviderConfig {
  const provider = (process.env.EMBEDDING_PROVIDER === 'dashscope' ? 'dashscope' : 'ollama') as EmbeddingProvider
  return {
    provider,
    model: process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    baseUrl: provider === 'dashscope'
      ? process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
      : process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    apiKey: process.env.DASHSCOPE_API_KEY || '',
    timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS || 30_000)
  }
}

const embeddingEnabled = process.env.EMBEDDING_ENABLED === 'true'
const embedding = embeddingConfig()
const embedInput = embeddingEnabled
  ? (chunks: Array<{ heading: string | null, content: string }>) =>
      requestProviderEmbeddings(embedding, chunks.map(chunk => `${chunk.heading ? `${chunk.heading}\n` : ''}${chunk.content}`))
  : undefined

async function resolveActorId(): Promise<string> {
  const admins = await db.select({ id: schema.users.id, name: schema.users.name, phone: schema.users.phone })
    .from(schema.users)
    .where(and(eq(schema.users.role, 'platform_admin'), eq(schema.users.status, 'active')))
  if (!admins.length) {
    throw new Error('库里没有可用的平台管理员账号，无法确定导入人；请先建号或用 --actor=<用户ID> 指定')
  }
  if (actorArg) {
    const matched = admins.find(admin => admin.id === actorArg || admin.phone === actorArg || admin.name === actorArg)
    if (!matched) throw new Error(`--actor=${actorArg} 不是平台管理员（可选：${admins.map(admin => `${admin.name}/${admin.phone || '无手机号'}`).join('、')}）`)
    return matched.id
  }
  if (admins.length > 1) {
    throw new Error(`库里有 ${admins.length} 个平台管理员，请用 --actor=<手机号或用户ID> 指定导入人：${admins.map(admin => `${admin.name}/${admin.phone || '无手机号'}`).join('、')}`)
  }
  return admins[0]!.id
}

// ---- 读库内独立知识库文档（只替换独立文档；三库版本生成的文档由版本发布维护，不在此链路） ----
const existingRows = await db.select({
  id: schema.moduleResourceDocuments.id,
  title: schema.moduleResourceDocuments.title,
  sourceType: schema.moduleResourceDocuments.sourceType,
  checksum: schema.moduleResourceDocuments.checksum,
  metadata: schema.moduleResourceDocuments.metadata
})
  .from(schema.moduleResourceDocuments)
  .where(and(
    isNull(schema.moduleResourceDocuments.libraryId),
    isNull(schema.moduleResourceDocuments.versionId)
  ))

const existing: ExistingKnowledgeDocument[] = existingRows.map(row => {
  const metadata = (row.metadata || {}) as Record<string, unknown>
  return {
    id: row.id,
    title: row.title,
    module: String(metadata.module || ''),
    sourceType: row.sourceType,
    sourceRef: typeof metadata.sourceRef === 'string' ? metadata.sourceRef : '',
    notes: typeof metadata.notes === 'string' ? metadata.notes : '',
    tags: Array.isArray(metadata.tags) ? (metadata.tags as unknown[]).map(tag => String(tag)) : [],
    section: normalizeSchoolSection(metadata.applicableSchoolSection),
    checksum: row.checksum
  }
})

// ---- 解析业务回传的文件 ----
const parsed = parseKnowledgeWorkbook(readFileSync(filePath), 'self_growth')

if (!parsed.entries.length) {
  const sheetSummary = parsed.sheets.length
    ? parsed.sheets.map(sheet => `「${sheet.name}」${sheet.rows.length} 行`).join('；')
    : '无（说明类工作表已忽略）'
  throw new Error(`文件里没有可导入的知识文档。检测到数据工作表：${sheetSummary}。请确认数据在「知识文档」表中，且每行有「文档标题」「文档内容」。`)
}

const incoming: IncomingKnowledgeDocument[] = parsed.entries.map((entry) => {
  const content = normalizeModuleResourceContent(entry.content)
  return {
    rowIndex: entry.rowIndex,
    documentId: entry.documentId,
    title: entry.title.trim(),
    module: entry.module,
    sourceType: entry.sourceType,
    sourceRef: (entry.sourceRef || '').trim(),
    notes: (entry.notes || '').trim(),
    tags: entry.tags,
    section: normalizeSchoolSection(entry.applicableSchoolSection),
    content,
    checksum: checksumModuleResourceContent(content)
  }
})

// 有标题没正文、或有正文没标题的行：解析时被跳过，对应文档会落进「删除」分支被误删，所以直接拦下
const knowledgeSheet = parsed.sheets.find(sheet => /知识文档|知识库|knowledge/i.test(sheet.name)) || parsed.sheets[0]
const incompleteRows = (knowledgeSheet?.rows || [])
  .map((row, index) => {
    const title = (row['文档标题'] || row['title'] || '').trim()
    const content = (row['文档内容'] || row['content'] || '').trim()
    return { index: index + 1, title, content }
  })
  .filter(row => (row.title && !row.content) || (row.content && !row.title))
if (incompleteRows.length) {
  const detail = incompleteRows.slice(0, 10).map(row => `第 ${row.index} 行${row.title ? `「${row.title}」缺正文` : '有正文缺标题'}`).join('；')
  throw new Error(`有 ${incompleteRows.length} 行填了标题却没正文（或反过来）：${detail}${incompleteRows.length > 10 ? ' 等' : ''}。这些行不会被导入，对应文档会被当成「文件里没有」而删除。请补齐，或删除整行。`)
}

const plan = planKnowledgeImport({ existing, incoming, hasDocumentIdColumn: parsed.hasDocumentIdColumn })
const errors = knowledgeImportErrors(plan)

const describeRows = (rows: IncomingKnowledgeDocument[], limit = 10) =>
  rows.slice(0, limit).map(row => `第 ${row.rowIndex ?? '?'} 行「${row.title}」`).join('；') + (rows.length > limit ? ` …… 等 ${rows.length} 行` : '')

console.log(`知识库全量替换${WRITE ? '（写入）' : '（dry-run，未写库）'}`)
console.log(`  文件：${filePath}`)
console.log(`  库内独立知识文档：${existing.length} 篇`)
console.log(`  文件：${incoming.length} 行`)
console.log(`  新增 ${plan.create.length} 篇${plan.create.length ? `：${describeRows(plan.create)}` : ''}`)
if (plan.adopted.length) {
  console.log(`  其中 ${plan.adopted.length} 行的「文档ID」留空、但标题与正文同库内已有文档逐字一致，按同一篇处理（不重复新增）：${describeRows(plan.adopted.map(item => item.incoming))}`)
}
console.log(`  更新（正文有改动，重新切块+向量化）${plan.updateContent.length} 篇${plan.updateContent.length ? `：${plan.updateContent.slice(0, 10).map(item => `第 ${item.incoming.rowIndex} 行「${item.incoming.title}」`).join('；')}${plan.updateContent.length > 10 ? ` …… 等 ${plan.updateContent.length} 篇` : ''}` : ''}`)
console.log(`  更新（仅元数据：标题/标签/学段/出处/备注）${plan.updateMetadata.length} 篇${plan.updateMetadata.length ? `：${plan.updateMetadata.slice(0, 10).map(item => `第 ${item.incoming.rowIndex} 行「${item.incoming.title}」`).join('；')}${plan.updateMetadata.length > 10 ? ` …… 等 ${plan.updateMetadata.length} 篇` : ''}` : ''}`)
console.log(`  删除 ${plan.remove.length} 篇${plan.remove.length ? `：${plan.remove.slice(0, 10).map(doc => `「${doc.title}」`).join('；')}${plan.remove.length > 10 ? ` …… 等 ${plan.remove.length} 篇` : ''}` : ''}`)
console.log(`  未变 ${plan.unchanged.length} 篇`)

if (errors.length) {
  console.error('\n无法执行，请先修正：')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

const massDeleteLimit = Math.floor(existing.length * MASS_DELETE_RATIO)
if (plan.remove.length > massDeleteLimit && !ALLOW_MASS_DELETE) {
  console.error(`\n本次将删除 ${plan.remove.length} 篇，超过库内文档的 ${MASS_DELETE_RATIO * 100}%（${massDeleteLimit} 篇）。`)
  console.error('两种常见原因：①拿「按模块导出的文件」覆盖了全库；②「文档ID」列被清空或整列丢失，所有行都对不上库内文档。')
  console.error('确认确实要删这么多，请加 --allow-mass-delete 重跑。')
  process.exit(1)
}

if (!WRITE) {
  console.log('\n以上为 dry-run 结果，未写库。确认无误后加 --write 执行。')
  process.exit(0)
}

// ---- 执行 ----
const actorId = await resolveActorId()
const startedAt = Date.now()
let created = 0
let contentUpdated = 0
let metadataUpdated = 0
let deleted = 0
const failures: Array<{ what: string, error: string }> = []

const docMetadata = (row: IncomingKnowledgeDocument) => ({
  module: row.module,
  libraryType: 'knowledge',
  applicableSchoolSection: row.section,
  tags: row.tags,
  sourceRef: row.sourceRef || null,
  notes: row.notes || null
})
const chunkMetadata = (row: IncomingKnowledgeDocument) => ({
  module: row.module,
  libraryType: 'knowledge',
  applicableSchoolSection: row.section,
  documentTitle: row.title,
  sourceType: row.sourceType,
  tags: row.tags,
  sourceRef: row.sourceRef || null
})

for (const row of plan.create) {
  try {
    await createDocumentWithChunks(db, {
      libraryId: null,
      versionId: null,
      title: row.title,
      sourceType: row.sourceType,
      content: row.content,
      metadata: docMetadata(row),
      status: 'ready',
      createdBy: actorId,
      embedInput,
      embeddingModel: embedInput ? embedding.model : undefined,
      tags: row.tags,
      sourceRef: row.sourceRef || null
    })
    created += 1
  } catch (error) {
    failures.push({ what: `新增「${row.title}」（第 ${row.rowIndex} 行）`, error: error instanceof Error ? error.message : String(error) })
  }
}

for (const item of plan.updateContent) {
  try {
    await updateDocumentContentWithChunks(db, {
      documentId: item.existing.id,
      title: item.incoming.title,
      sourceType: item.incoming.sourceType,
      content: item.incoming.content,
      metadata: docMetadata(item.incoming),
      tags: item.incoming.tags,
      sourceRef: item.incoming.sourceRef || null,
      embedInput,
      embeddingModel: embedInput ? embedding.model : undefined
    })
    contentUpdated += 1
  } catch (error) {
    failures.push({ what: `更新「${item.incoming.title}」（第 ${item.incoming.rowIndex} 行）`, error: error instanceof Error ? error.message : String(error) })
  }
}

for (const item of plan.updateMetadata) {
  try {
    await updateDocumentMetadata(db, {
      documentId: item.existing.id,
      title: item.incoming.title,
      sourceType: item.incoming.sourceType,
      metadata: docMetadata(item.incoming),
      chunkMetadata: chunkMetadata(item.incoming)
    })
    metadataUpdated += 1
  } catch (error) {
    failures.push({ what: `更新元数据「${item.incoming.title}」（第 ${item.incoming.rowIndex} 行）`, error: error instanceof Error ? error.message : String(error) })
  }
}

for (const doc of plan.remove) {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(schema.moduleResourceChunks).where(eq(schema.moduleResourceChunks.documentId, doc.id))
      await tx.delete(schema.moduleResourceDocuments).where(eq(schema.moduleResourceDocuments.id, doc.id))
    })
    deleted += 1
  } catch (error) {
    failures.push({ what: `删除「${doc.title}」`, error: error instanceof Error ? error.message : String(error) })
  }
}

// 审计：脚本没有登录态，actor 取库内平台管理员；来源与文件写在 metadata 里
await db.insert(schema.auditLogs).values({
  actorId,
  action: 'platform_admin.module_resource_document.batch_replace',
  targetType: 'module_resource_document',
  result: failures.length ? 'failure' : 'success',
  metadata: {
    source: 'cli:knowledge-import',
    file: filePath,
    documentCount: incoming.length,
    created,
    contentUpdated,
    metadataUpdated,
    deleted,
    unchanged: plan.unchanged.length,
    failed: failures.length,
    embeddingEnabled,
    durationMs: Date.now() - startedAt
  }
})

console.log('\n知识库全量替换完成')
console.log(`  新增 ${created} 篇；更新正文 ${contentUpdated} 篇；更新元数据 ${metadataUpdated} 篇；删除 ${deleted} 篇；未变 ${plan.unchanged.length} 篇`)
console.log(embeddingEnabled ? '  向量化已开启，更新/新增的文档已重新生成向量' : '  向量化未开启（EMBEDDING_ENABLED≠true）：新增/更新的切块没有向量，请跑 pnpm resources:reindex 补齐')
if (failures.length) {
  console.error(`  失败 ${failures.length} 项：`)
  for (const failure of failures.slice(0, 20)) console.error(`    - ${failure.what}：${failure.error}`)
  process.exit(1)
}

/**
 * 知识库 XLSX 导入（命令行）。
 *
 * 场景：业务把知识内容整理成《平台后台 → 向量库 → 模板》格式的 XLSX（表头与
 * public/templates/knowledge.xlsx 一致：文档标题*／所属模块*／来源类型*／标签关键词／
 * 适用学部／文档内容*／来源出处／备注），需要命令行批量写入向量库时用本脚本。
 *
 * 与平台「批量导入」的差异与一致性：
 *  - 解析、切块、写库全部复用同一份代码（parseKnowledgeWorkbook + createDocumentWithChunks），
 *    因此 metadata 形状、切块口径、向量化状态与平台导入完全一致；
 *  - 平台批量导入是纯新增，重复执行会产生重复文档；本脚本按标题查重（独立知识库文档范围内），
 *    库里已存在的标题默认跳过，需要强行新增时加 --allow-duplicates；文件内部同名（同一问题被
 *    多位教师投题、业务按编号保留两条）不算重复，全部写入并在结束时提示；
 *  - 平台导入由平台管理员在页面操作并写审计；本脚本 actor 取库内第一个启用中的平台管理员，
 *    审计 action 与平台一致（platform_admin.module_resource_document.batch_import），
 *    metadata.source 标为 cli 便于区分。
 *
 * 用法：
 *   # 预览（默认就是 dry-run，只打印将写入什么，不写库）
 *   pnpm tsx scripts/import-knowledge-xlsx.ts 临时文件/初中教师知识库条目-导入版.xlsx
 *
 *   # 实际写入
 *   pnpm tsx scripts/import-knowledge-xlsx.ts 临时文件/初中教师知识库条目-导入版.xlsx --write
 *
 * 可选参数：
 *   --section=<all|primary|junior|senior|repeat>  覆盖文件里的「适用学部」（默认按行取值）
 *   --module=<模块>    文件里「所属模块」缺失时的兜底模块（默认 self_growth）
 *   --write            实际写入；不传即为 dry-run
 *   --allow-duplicates 允许写入与现有标题重复的文档
 *   --allow-production 允许写入正式库（DATABASE_URL 指向 5433 时必须显式放行）
 *
 * 环境：读写 process.env.DATABASE_URL 指向的库（本地开发库 5434 / 测试库 5435 /
 * 正式库 5433）。向量化沿用 EMBEDDING_ENABLED / EMBEDDING_PROVIDER / EMBEDDING_MODEL /
 * DASHSCOPE_* 配置；未启用时只写正文与切块，向量由 pnpm resources:reindex 兜底。
 */
import { readFileSync } from 'node:fs'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { loadLocalEnv } from './load-env'
import { parseKnowledgeWorkbook } from '../server/domain/module-resource-file-import'
import { createDocumentWithChunks } from '../server/domain/module-resource-documents'
import { requestProviderEmbeddings, type EmbeddingProviderConfig } from '../server/integrations/embeddings'
import { useDb, schema } from '../server/utils/db'
import { SCHOOL_SECTIONS } from '../shared/school-section'
import type { ModuleId } from '../shared/contracts'

loadLocalEnv()

function readArg(name: string): string | null {
  const prefix = `--${name}=`
  const hit = process.argv.find(arg => arg.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

const DRY_RUN = !process.argv.includes('--write')
const ALLOW_DUPLICATES = process.argv.includes('--allow-duplicates')
const ALLOW_PRODUCTION = process.argv.includes('--allow-production')
const filePath = process.argv.slice(2).find(arg => !arg.startsWith('--'))
const sectionArg = readArg('section')
const MODULE_IDS: ModuleId[] = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']
const defaultModule = (readArg('module') ?? 'self_growth') as ModuleId

if (!filePath) {
  console.error('用法：pnpm tsx scripts/import-knowledge-xlsx.ts <file.xlsx> [--section=junior] [--write]')
  process.exit(1)
}
if (!MODULE_IDS.includes(defaultModule)) {
  console.error(`--module 必须是 ${MODULE_IDS.join(' / ')} 之一`)
  process.exit(1)
}
if (sectionArg && !(SCHOOL_SECTIONS as readonly string[]).includes(sectionArg)) {
  console.error(`--section 必须是 ${SCHOOL_SECTIONS.join(' / ')} 之一`)
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL || ''
if (!databaseUrl) {
  console.error('DATABASE_URL 未配置')
  process.exit(1)
}
const host = databaseUrl.replace(/\/\/[^@]*@/, '//').replace(/\?.*$/, '')
if (host.includes(':5433') && !ALLOW_PRODUCTION) {
  console.error(`目标库看起来是正式库（${host}）。确认要写入正式库时加 --allow-production。`)
  process.exit(1)
}

const db = useDb()

// actor：与平台导入保持一致，取库内启用中的平台管理员
const [actor] = await db.select({ id: schema.users.id })
  .from(schema.users)
  .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
  .where(and(eq(schema.userRoles.roleCode, 'platform_admin'), eq(schema.users.status, 'active')))
  .limit(1)
if (!actor) {
  console.error('库内没有启用中的平台管理员账号，无法确定导入 actor')
  process.exit(1)
}

// 向量化配置：与平台导入共用 requestProviderEmbeddings，参数口径同 server/integrations/embeddings.ts
const embeddingEnabled = process.env.EMBEDDING_ENABLED === 'true'
const provider = String(process.env.EMBEDDING_PROVIDER || 'ollama') === 'dashscope' ? 'dashscope' : 'ollama'
const embeddingConfig: EmbeddingProviderConfig = {
  provider,
  model: String(process.env.EMBEDDING_MODEL || ''),
  baseUrl: provider === 'dashscope'
    ? String(process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1')
    : String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'),
  apiKey: String(process.env.DASHSCOPE_API_KEY || ''),
  timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS) || 15000
}
if (embeddingEnabled && provider === 'dashscope' && !embeddingConfig.apiKey) {
  console.error('EMBEDDING_ENABLED=true 且 provider=dashscope，但 DASHSCOPE_API_KEY 为空')
  process.exit(1)
}

const parsed = parseKnowledgeWorkbook(readFileSync(filePath), defaultModule)
if (!parsed.entries.length) {
  console.error('文件里没有可导入的知识文档（需要「知识文档」工作表 + 「文档标题」「文档内容」列）')
  process.exit(1)
}

// 独立知识库文档（library_id IS NULL）按标题查重，避免重复导入
const existing = await db.select({ title: schema.moduleResourceDocuments.title })
  .from(schema.moduleResourceDocuments)
  .where(isNull(schema.moduleResourceDocuments.libraryId))
const existingTitles = new Set(existing.map(row => row.title))

const embeddingModel = embeddingEnabled ? embeddingConfig.model : null
const embedInput = embeddingEnabled
  ? async (chunks: Array<{ heading: string | null; content: string }>) => {
      const inputs = chunks.map(chunk => `${chunk.heading ? `${chunk.heading}\n` : ''}${chunk.content}`)
      return requestProviderEmbeddings(embeddingConfig, inputs)
    }
  : undefined

// 文件内部同名（同一问题被多人投题、业务按编号保留两条）：不算重复，全部写入，结束后提示
const fileTitleCounts = new Map<string, number>()
for (const entry of parsed.entries) fileTitleCounts.set(entry.title, (fileTitleCounts.get(entry.title) ?? 0) + 1)
const duplicateInFile = [...fileTitleCounts.entries()].filter(([, count]) => count > 1).map(([title, count]) => `${title}（${count} 条）`)

console.log(`目标库：${host}`)
console.log(`文件：${filePath}`)
console.log(`解析到 ${parsed.entries.length} 篇；适用学部覆盖：${sectionArg ?? '（按行取值）'}；向量化：${embeddingEnabled ? `开（${provider} / ${embeddingConfig.model}）` : '关'}`)
console.log(`模式：${DRY_RUN ? '预演（不写库）' : '写入'}\n`)

let created = 0
let skipped = 0
let chunks = 0
let embedded = 0
const failures: Array<{ title: string, error: string }> = []

for (const entry of parsed.entries) {
  const section = sectionArg ?? entry.applicableSchoolSection ?? 'all'
  const title = entry.title
  if (!ALLOW_DUPLICATES && existingTitles.has(title)) {
    console.log(`  跳过（标题已存在）：${title}`)
    skipped++
    continue
  }
  if (DRY_RUN) {
    console.log(`  将写入：${title}｜模块 ${entry.module}｜学部 ${section}｜标签 ${entry.tags.join('/')}｜标签数 ${entry.tags.length}｜正文 ${entry.content.length} 字`)
    created++
    continue
  }
  try {
    const result = await createDocumentWithChunks(db, {
      libraryId: null,
      versionId: null,
      title,
      sourceType: entry.sourceType,
      content: entry.content,
      metadata: {
        module: entry.module,
        libraryType: 'knowledge',
        applicableSchoolSection: section,
        // 与平台「批量导入」一致：文档级 metadata 也写 tags / sourceRef，供列表展示与导出 XLSX 回填；
        // 同时必须重新以顶层参数传入，才不会被写进切块时的默认值覆盖（见下方注释）
        tags: entry.tags,
        sourceRef: entry.sourceRef ?? null,
        notes: entry.notes ?? null
      },
      status: 'ready',
      createdBy: actor.id,
      // tags / sourceRef 必须走顶层参数：它们会被写进切块 metadata 供检索展示（放进 metadata 会被默认值覆盖）
      tags: entry.tags,
      sourceRef: entry.sourceRef ?? null,
      embedInput,
      embeddingModel
    })
    created++
    chunks += result.chunks
    embedded += result.embedded
    console.log(`  ✓ ${title}（${result.chunks} 段，向量 ${result.embedded}）`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push({ title, error: message })
    console.error(`  ✗ ${title}：${message}`)
  }
}

if (!DRY_RUN && created) {
  await db.insert(schema.auditLogs).values({
    actorId: actor.id,
    action: 'platform_admin.module_resource_document.batch_import',
    targetType: 'module_resource_document',
    result: failures.length ? 'failure' : 'success',
    metadata: {
      source: 'cli:import-knowledge-xlsx',
      file: filePath,
      created,
      skipped,
      chunkCount: chunks,
      embeddedChunkCount: embedded,
      applicableSchoolSection: sectionArg ?? '(per-row)',
      embeddingEnabled,
      embeddingModel: embeddingModel ?? null,
      failed: failures.length,
      failures: failures.slice(0, 10)
    }
  })
}

const verb = DRY_RUN ? '将写入' : '写入'
console.log(`\n完成：${verb} ${created} 篇、跳过 ${skipped} 篇、失败 ${failures.length} 篇；${DRY_RUN ? '预计新增切块' : '新增切块'} ${chunks} 段（其中已向量化 ${embedded} 段）`)
if (duplicateInFile.length) {
  console.log(`注意：文件内有 ${duplicateInFile.length} 组同名条目（同一问题多次投题，按文件内容全部写入）：${duplicateInFile.join('；')}`)
}
if (DRY_RUN) console.log('（预演模式未写库；确认无误后加 --write 实际写入）')

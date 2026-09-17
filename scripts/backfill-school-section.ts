/**
 * 适用学部标签回填脚本（三库资源）。
 *
 * 背景：量表库/工具库 payload 的每一行都带 applicableSchoolSection（all/primary/junior/
 * senior/repeat）。教师侧读取时按 `users.teaching_grades` 折算的学段过滤（口径见
 * shared/school-section.ts）：标了具体学部的只对同学段可见，标 all 或未标注的对所有
 * 学段可见。存量库大多标 all（等价于「所有学段都适用」），本脚本按模块把指定库的
 * 学部统一改成目标值。
 *
 * 安全边界：只改 `module_resource_versions.payload` 的这一个字段，改完走
 * `validateModuleResourcePayload()` 校验 + `rebuildModuleResourceProjection()` 重建投影，
 * 与运营台保存路径一致——不直接写明细表、不动量表题目/计分/归因等业务内容。
 *
 * 用法：
 *   # 先看将要发生什么（默认就是 dry-run，不写库）
 *   pnpm backfill:school-section --section=primary --modules=class_system,home_school,student_case,learning_problem
 *
 *   # 实际写入（必须显式 --write）
 *   pnpm backfill:school-section --section=primary --modules=home_school,student_case,learning_problem --write
 *
 * 可选参数：
 *   --modules=<a,b>        必填，模块清单（self_growth/class_system/home_school/student_case/learning_problem）
 *   --section=<值>         必填，目标学部（all/primary/junior/senior/repeat）
 *   --library-types=<a,b>  默认 assessment,tool；可用 knowledge（知识库文档与切块，按文档 metadata.module 命中）
 *   --version=<x.y.z>      只处理该版本号（默认该库全部已发布版本；对 knowledge 无效）
 *   --include-draft        连草稿/待验证版本一起改（默认只改 published；对 knowledge 无效）
 *   --rebuild-all          即使没有行需要改动，也重写 payload 并重建投影（用于把新增
 *                          metadata 字段补齐到存量投影行；对 knowledge 无效）
 *   --mark-ready           仅 knowledge：把独立知识库文档（不挂版本）状态置为 ready，
 *                          使历史导入的文档能被知识检索召回
 *   --write                实际写入；不传即为 dry-run
 *
 * 环境：读写 process.env.DATABASE_URL 指向的库（本地 dev 为 localhost:5434/mentor_ai_dev）。
 * 正式库（端口 5433）需显式 BACKFILL_ALLOW_PRODUCTION=1 放行。
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { loadLocalEnv } from './load-env'
import { SCHOOL_SECTIONS, resourceRowsOfVersion, type SchoolSection } from '../shared/school-section'
import { useDb, usePool, schema } from '../server/utils/db'
import { validateModuleResourcePayload } from '../server/domain/module-resource-validation'
import { rebuildModuleResourceProjection } from '../server/domain/module-resource-projection'
import type { LibraryType, ModuleId } from '../shared/contracts'

const MODULE_IDS: ModuleId[] = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']

function readArg(name: string): string | null {
  const prefix = `--${name}=`
  const hit = process.argv.find(arg => arg.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

const DRY_RUN = !process.argv.includes('--write')
const INCLUDE_DRAFT = process.argv.includes('--include-draft')
const REBUILD_ALL = process.argv.includes('--rebuild-all')
/** 知识库支线专用：把独立知识库文档（不挂版本）的状态置为 ready，使其可被知识检索召回。 */
const MARK_READY = process.argv.includes('--mark-ready')
const sectionArg = readArg('section') as SchoolSection | null
const moduleArg = readArg('modules')
const libraryTypeArg = readArg('library-types') ?? 'assessment,tool'
const versionArg = readArg('version')

if (!sectionArg || !(SCHOOL_SECTIONS as readonly string[]).includes(sectionArg)) {
  console.error(`--section 必填，且必须是 ${SCHOOL_SECTIONS.join(' / ')} 之一`)
  process.exit(1)
}
if (!moduleArg) {
  console.error(`--modules 必填，逗号分隔，例如 --modules=home_school,learning_problem`)
  process.exit(1)
}
const modules = moduleArg.split(',').map(item => item.trim()).filter(Boolean) as ModuleId[]
const unknownModules = modules.filter(module => !MODULE_IDS.includes(module))
if (unknownModules.length) {
  console.error(`--modules 含未知模块：${unknownModules.join(', ')}`)
  process.exit(1)
}
const libraryTypes = libraryTypeArg.split(',').map(item => item.trim()).filter(Boolean) as LibraryType[]
/** 知识库文档不在版本 payload 里，单独一条支线（按文档/切块 metadata.module 命中）。 */
const KNOWLEDGE_TYPE = 'knowledge'
const wantKnowledge = libraryTypes.includes(KNOWLEDGE_TYPE as LibraryType)
const versionLibraryTypes = libraryTypes.filter(item => item !== KNOWLEDGE_TYPE) as LibraryType[]

/**
 * 知识库支线：文档与切块都不挂版本，直接按 metadata.module 命中，合并写入 applicableSchoolSection。
 * 只动 metadata 里这一个键，不重建向量（向量来自正文，与 metadata 无关）。
 * markReady：把独立知识库文档（不挂版本）的状态置为 ready——知识检索按 ready 判定可见性，
 * 历史上以 draft 导入的存量文档不置 ready 就永远召回不到。
 */
async function updateKnowledgeDocuments(input: {
  modules: ModuleId[]
  section: SchoolSection
  dryRun: boolean
  markReady: boolean
}): Promise<{ docs: number, chunks: number, markedReady: number }> {
  const db = useDb()
  const moduleList = sql.join(input.modules.map(module => sql`${module}`), sql`, `)
  const patch = JSON.stringify({ applicableSchoolSection: input.section })
  const scoped = sql`metadata->>'module' IN (${moduleList})`

  const countOf = async (query: ReturnType<typeof sql>) => {
    const result = await db.execute<{ n: number }>(query)
    return Number(result.rows[0]?.n ?? 0)
  }

  const docs = await countOf(sql`
    SELECT count(*)::int AS n FROM module_resource_documents
    WHERE ${scoped} AND coalesce(metadata->>'applicableSchoolSection', '') <> ${input.section}
  `)
  const chunks = await countOf(sql`
    SELECT count(*)::int AS n FROM module_resource_chunks
    WHERE ${scoped} AND coalesce(metadata->>'applicableSchoolSection', '') <> ${input.section}
  `)
  const staleDocs = input.markReady
    ? await countOf(sql`
        SELECT count(*)::int AS n FROM module_resource_documents
        WHERE ${scoped} AND version_id IS NULL AND library_id IS NULL AND status <> 'ready'
      `)
    : 0

  console.log(`- knowledge / 知识库（按 module 命中）：文档 ${docs} 篇、切块 ${chunks} 条待标注为 ${input.section}${input.markReady ? `；另有 ${staleDocs} 篇独立文档状态待置为 ready` : ''}`)
  if (input.dryRun) return { docs, chunks, markedReady: 0 }

  if (docs) {
    await db.execute(sql`
      UPDATE module_resource_documents
      SET metadata = metadata || ${patch}::jsonb, updated_at = now()
      WHERE ${scoped} AND coalesce(metadata->>'applicableSchoolSection', '') <> ${input.section}
    `)
  }
  if (chunks) {
    await db.execute(sql`
      UPDATE module_resource_chunks
      SET metadata = metadata || ${patch}::jsonb
      WHERE ${scoped} AND coalesce(metadata->>'applicableSchoolSection', '') <> ${input.section}
    `)
  }
  if (staleDocs) {
    await db.execute(sql`
      UPDATE module_resource_documents
      SET status = 'ready', updated_at = now()
      WHERE ${scoped} AND version_id IS NULL AND library_id IS NULL AND status <> 'ready'
    `)
  }
  if (docs || chunks || staleDocs) console.log('  ✓ 已写入（未重建向量：向量来自正文，与学部标签/状态无关）')
  return { docs, chunks, markedReady: staleDocs }
}

async function main() {
  loadLocalEnv()
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
  if (!url) throw new Error('需要 DATABASE_URL 或 MIGRATION_DATABASE_URL')
  const parsed = new URL(url)
  const port = Number(parsed.port)
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  console.log(`目标库：${parsed.hostname}:${port}/${database}`)
  if (port === 5433 && process.env.BACKFILL_ALLOW_PRODUCTION !== '1') {
    console.error('目标看起来是正式库（端口 5433）。确认要写请显式设置 BACKFILL_ALLOW_PRODUCTION=1。')
    process.exit(1)
  }
  console.log(`模式：${DRY_RUN ? 'DRY-RUN（不写库，加 --write 实际写入）' : '写入'}；学部=${sectionArg}；模块=${modules.join(',')}；库类型=${libraryTypes.join(',')}${INCLUDE_DRAFT ? '；含草稿' : '；仅已发布'}${versionArg ? `；版本=${versionArg}` : ''}${REBUILD_ALL ? '；无改动也重建投影' : ''}\n`)

  const db = useDb()

  // 知识库支线（文档/切块不挂版本，先处理）
  let knowledge = { docs: 0, chunks: 0, markedReady: 0 }
  if (wantKnowledge) {
    knowledge = await updateKnowledgeDocuments({ modules, section: sectionArg, dryRun: DRY_RUN, markReady: MARK_READY })
  }

  if (!versionLibraryTypes.length) {
    console.log(`\n合计：知识库文档 ${knowledge.docs} 篇、切块 ${knowledge.chunks} 条${knowledge.markedReady ? `、状态置 ready ${knowledge.markedReady} 篇` : ''}；${DRY_RUN ? '将改动' : '已改动'}`)
    return
  }

  const conditions = [
    inArray(schema.moduleResourceLibraries.module, modules),
    inArray(schema.moduleResourceLibraries.libraryType, versionLibraryTypes)
  ]
  if (!INCLUDE_DRAFT) conditions.push(eq(schema.moduleResourceVersions.status, 'published'))
  if (versionArg) conditions.push(eq(schema.moduleResourceVersions.version, versionArg))

  const versions = await db.select({
    versionId: schema.moduleResourceVersions.id,
    version: schema.moduleResourceVersions.version,
    status: schema.moduleResourceVersions.status,
    payload: schema.moduleResourceVersions.payload,
    libraryId: schema.moduleResourceLibraries.id,
    module: schema.moduleResourceLibraries.module,
    libraryType: schema.moduleResourceLibraries.libraryType,
    scope: schema.moduleResourceLibraries.scope,
    schoolId: schema.moduleResourceLibraries.schoolId,
    schoolName: schema.moduleResourceLibraries.name
  })
    .from(schema.moduleResourceVersions)
    .innerJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceVersions.libraryId, schema.moduleResourceLibraries.id))
    .where(and(...conditions))

  if (!versions.length) {
    console.log('没有匹配的版本，无需处理。')
    return
  }

  let totalRows = 0
  let totalChanged = 0
  const failures: string[] = []

  for (const row of versions) {
    const label = `${row.module} / ${row.libraryType} / ${row.version} (${row.status}${row.scope === 'school' ? '，校级' : ''})`
    const payload = JSON.parse(JSON.stringify(row.payload ?? {})) as Record<string, unknown>
    // 版本 payload 的资源行结构（instruments / tools）与运营台、导入链路共用同一份判定
    const rows = resourceRowsOfVersion(row.libraryType, payload)
    if (!rows.length) {
      console.log(`- ${label}：没有可标注的行，跳过`)
      continue
    }
    let changed = 0
    for (const item of rows) {
      if (item.applicableSchoolSection === sectionArg) continue
      item.applicableSchoolSection = sectionArg
      changed++
    }
    totalRows += rows.length
    totalChanged += changed
    console.log(`- ${label}：${rows.length} 行，其中 ${changed} 行改为 ${sectionArg}`)
    if (!changed && !REBUILD_ALL) continue

    const validation = validateModuleResourcePayload({
      module: row.module as ModuleId,
      libraryType: row.libraryType as LibraryType,
      payload
    })
    if (!validation.ok) {
      const message = validation.errors.map(error => error.message).join('；')
      console.log(`  ⚠ 校验未通过，跳过该版本：${message}`)
      failures.push(`${label}：校验未通过（${message}）`)
      continue
    }
    if (DRY_RUN) continue

    try {
      await db.transaction(async (tx) => {
        await tx.update(schema.moduleResourceVersions)
          .set({ payload, updatedAt: new Date() })
          .where(eq(schema.moduleResourceVersions.id, row.versionId))
        await rebuildModuleResourceProjection(tx, {
          libraryId: row.libraryId,
          versionId: row.versionId,
          module: row.module as ModuleId,
          libraryType: row.libraryType as LibraryType,
          scope: row.scope as 'global' | 'school',
          schoolId: row.schoolId
        }, payload)
      })
      console.log('  ✓ 已写入并重建投影')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`  ✗ 写入失败：${message}`)
      failures.push(`${label}：${message}`)
    }
  }

  console.log(`\n合计：${versions.length} 个版本、${totalRows} 行；${DRY_RUN ? '将改动' : '已改动'} ${totalChanged} 行`)
  if (failures.length) {
    console.log(`\n失败 ${failures.length} 项：`)
    for (const failure of failures) console.log(`  - ${failure}`)
    process.exit(1)
  }
}

main()
  .then(async () => {
    await usePool().end().catch(() => {})
  })
  .catch(async (error) => {
    console.error(`[失败] ${(error as Error).message}`)
    await usePool().end().catch(() => {})
    process.exit(1)
  })

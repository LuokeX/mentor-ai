import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { SCHOOL_SECTIONS, normalizeSchoolSection } from '../../../../../../shared/school-section'
import { requireUser } from '../../../../../utils/auth'
import { writeAudit } from '../../../../../utils/audit'
import { schema, useDb } from '../../../../../utils/db'

const patchSchema = z.object({
  applicableSchoolSection: z.enum([...SCHOOL_SECTIONS] as [string, ...string[]])
    .describe('适用学部：all/primary/junior/senior/repeat')
})

/**
 * 修改知识库文档的「适用学部」。
 *
 * 只改 metadata 里的这一个键（文档级 + 全部切块级），不动正文与向量：
 * 知识检索的学段过滤读的是切块 metadata（`schoolSectionVisibility`），
 * 只改文档不改切块会出现「列表显示小学部、检索仍对所有人可见」的错位。
 * 三库版本同步生成的文档（libraryId/versionId 非空）同样允许调整——
 * 它展示的是这份文档的适用范围，不反向改写三库版本 payload。
 */
export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = patchSchema.parse(await readBody(event))
  const section = normalizeSchoolSection(body.applicableSchoolSection)
  const db = useDb(event)

  const [document] = await db.select({
    id: schema.moduleResourceDocuments.id,
    title: schema.moduleResourceDocuments.title,
    libraryId: schema.moduleResourceDocuments.libraryId,
    metadata: schema.moduleResourceDocuments.metadata,
    module: schema.moduleResourceLibraries.module,
    libraryType: schema.moduleResourceLibraries.libraryType,
    schoolId: schema.moduleResourceLibraries.schoolId
  })
    .from(schema.moduleResourceDocuments)
    .leftJoin(schema.moduleResourceLibraries, eq(schema.moduleResourceDocuments.libraryId, schema.moduleResourceLibraries.id))
    .where(eq(schema.moduleResourceDocuments.id, id))
    .limit(1)

  if (!document) throw createError({ statusCode: 404, message: '文档不存在' })

  const previous = normalizeSchoolSection((document.metadata as Record<string, unknown> | null)?.applicableSchoolSection)
  if (previous === section) {
    return { id, applicableSchoolSection: section, previous, changed: false }
  }

  const patch = JSON.stringify({ applicableSchoolSection: section })

  await db.transaction(async (tx) => {
    await tx.update(schema.moduleResourceDocuments)
      .set({
        metadata: sql<Record<string, unknown>>`${schema.moduleResourceDocuments.metadata} || ${patch}::jsonb`,
        updatedAt: new Date()
      })
      .where(eq(schema.moduleResourceDocuments.id, id))
    await tx.update(schema.moduleResourceChunks)
      .set({ metadata: sql<Record<string, unknown>>`${schema.moduleResourceChunks.metadata} || ${patch}::jsonb` })
      .where(eq(schema.moduleResourceChunks.documentId, id))
  })

  await writeAudit(event, {
    actorId: admin.id,
    schoolId: document.schoolId,
    action: 'platform_admin.module_resource_document.update_school_section',
    targetType: 'module_resource_document',
    targetId: id,
    metadata: {
      title: document.title,
      libraryId: document.libraryId,
      module: document.module,
      libraryType: document.libraryType,
      from: previous,
      to: section
    }
  })

  return { id, applicableSchoolSection: section, previous, changed: true }
})

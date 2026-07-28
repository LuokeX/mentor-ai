import { and, eq, isNull, like, or, sql } from 'drizzle-orm'
import { moduleIdSchema } from '../../../../../../shared/contracts'
import { requireUser } from '../../../../../utils/auth'
import { schema, useDb } from '../../../../../utils/db'
import XLSX from 'xlsx'

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const query = getQuery(event)
  const filterModule = typeof query.module === 'string' ? moduleIdSchema.optional().parse(query.module) : undefined
  const search = typeof query.search === 'string' && query.search.trim() ? query.search.trim() : undefined

  const db = useDb(event)
  const conditions = [
    isNull(schema.moduleResourceDocuments.libraryId),
    isNull(schema.moduleResourceDocuments.versionId)
  ]
  if (search) {
    conditions.push(or(
      like(schema.moduleResourceDocuments.title, `%${search}%`),
      like(schema.moduleResourceDocuments.content, `%${search}%`)
    ) as any)
  }

  let docs = await db.select({
    id: schema.moduleResourceDocuments.id,
    title: schema.moduleResourceDocuments.title,
    sourceType: schema.moduleResourceDocuments.sourceType,
    content: schema.moduleResourceDocuments.content,
    metadata: schema.moduleResourceDocuments.metadata,
    createdAt: schema.moduleResourceDocuments.createdAt,
    updatedAt: schema.moduleResourceDocuments.updatedAt
  })
    .from(schema.moduleResourceDocuments)
    .where(and(...conditions))
    .orderBy(sql`${schema.moduleResourceDocuments.createdAt} DESC`)

  // 按模块筛选（metadata 是 jsonb）
  if (filterModule) {
    docs = docs.filter(doc => {
      const meta = doc.metadata as Record<string, unknown> | null
      return meta?.module === filterModule
    })
  }

  // 构建 XLSX
  const headers = ['文档标题', '所属模块', '来源类型', '标签关键词', '文档内容', '来源出处', '备注']
  const moduleLabelMap: Record<string, string> = {
    self_growth: 'self_growth', class_system: 'class_system',
    home_school: 'home_school', student_case: 'student_case',
    learning_problem: 'learning_problem'
  }

  const rows = docs.map(doc => {
    const meta = (doc.metadata || {}) as Record<string, unknown>
    return [
      doc.title,
      moduleLabelMap[meta.module as string] || (meta.module as string) || 'self_growth',
      doc.sourceType || 'markdown',
      Array.isArray(meta.tags) ? (meta.tags as string[]).join(', ') : '',
      doc.content,
      (meta.sourceRef as string) || '',
      (meta.notes as string) || ''
    ]
  })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  // 设置列宽
  ws['!cols'] = [
    { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 25 },
    { wch: 60 }, { wch: 30 }, { wch: 20 }
  ]
  XLSX.utils.book_append_sheet(wb, ws, '知识文档')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'Content-Disposition', `attachment; filename="knowledge_export_${new Date().toISOString().slice(0, 10)}.xlsx"`)
  return buf
})
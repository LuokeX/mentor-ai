import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { useDb, schema } from '../../../utils/db'
import { writeAudit } from '../../../utils/audit'

const schemaInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), code: z.string().min(2).max(80), name: z.string().min(2).max(160), version: z.string().min(1).max(40), type: z.enum(['assessment', 'attribution', 'tool']), payload: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.enum(['publish', 'retire', 'rollback']), id: z.string().uuid() })
])

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['platform_admin'])
  const body = schemaInput.parse(await readBody(event))
  const db = useDb(event)
  if (body.action === 'create') {
    const [content] = await db.insert(schema.contentPackages).values({
      code: body.code, name: body.name, version: body.version, type: body.type, payload: body.payload, createdBy: admin.id
    }).returning()
    if (!content) throw createError({ statusCode: 500, message: '内容包创建失败' })
    await writeAudit(event, { actorId: admin.id, action: 'content.create', targetType: 'content_package', targetId: content.id })
    return content
  }
  const [target] = await db.select().from(schema.contentPackages).where(eq(schema.contentPackages.id, body.id)).limit(1)
  if (!target) throw createError({ statusCode: 404, message: '内容包不存在' })
  const shouldPublish = body.action === 'publish' || body.action === 'rollback'
  const content = await db.transaction(async (tx) => {
    if (shouldPublish) {
      await tx.update(schema.contentPackages).set({ status: 'retired', updatedAt: new Date() }).where(and(
        eq(schema.contentPackages.code, target.code),
        eq(schema.contentPackages.status, 'published'),
        ne(schema.contentPackages.id, target.id)
      ))
    }
    const [updated] = await tx.update(schema.contentPackages).set({
      status: shouldPublish ? 'published' : 'retired',
      publishedBy: shouldPublish ? admin.id : null,
      publishedAt: shouldPublish ? new Date() : null,
      updatedAt: new Date()
    }).where(eq(schema.contentPackages.id, body.id)).returning()
    return updated
  })
  if (!content) throw createError({ statusCode: 404, message: '内容包不存在' })
  await writeAudit(event, { actorId: admin.id, action: `content.${body.action}`, targetType: 'content_package', targetId: content.id })
  return content
})

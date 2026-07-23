import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import type { PgTable } from 'drizzle-orm/pg-core'
import type { useDb } from './db'

/**
 * 按所有权查询单条记录，不存在时自动抛出 404。
 *
 * 替代每个 GET/PATCH/DELETE 端点中重复的模式：
 *   const [record] = await db.select().from(schema.X).where(and(
 *     eq(schema.X.id, id), eq(schema.X.ownerUserId, user.id), eq(schema.X.schoolId, user.schoolId)
 *   )).limit(1)
 *   if (!record) throw createError({ statusCode: 404, message: 'X不存在' })
 *
 * 使用方式：
 *   const record = await findOwned(db, schema.classes, id, user)
 *   const record = await findOwned(db, schema.students, id, user, '学生不存在')
 */
export async function findOwned<T extends PgTable>(
  db: ReturnType<typeof useDb>,
  table: T,
  id: string,
  user: { id: string; schoolId: string },
  message = '记录不存在'
): Promise<T['$inferSelect']> {
  // 泛型 PgTable 不暴露具体列类型，通过 any 绕过类型约束。
  // 调用方传入 schema.X 等具名表，返回类型 T['$inferSelect'] 保持推断。
  const t = table as any
  const [record] = await (db.select() as any)
    .from(table)
    .where(and(
      eq(t.id, id),
      eq(t.ownerUserId, user.id),
      eq(t.schoolId, user.schoolId),
    ))
    .limit(1)
  if (!record) throw createError({ statusCode: 404, message })
  return record as T['$inferSelect']
}
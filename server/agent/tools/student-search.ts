import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { decryptSensitive, searchableHash } from '../../utils/crypto'
import { schema, useDb } from '../../utils/db'
import { redactOutboundText } from '../../domain/ai-governance'
import type { AgentTool, AgentToolContext } from '../types'

/** 单次返回上限：名单类只读工具的控制阀，避免把整班学生倒进上下文。 */
const STUDENT_SEARCH_MAX_RESULTS = 20

const studentSearchSchema = z.object({
  name: z.string().trim().min(2).max(40).optional()
    .describe('学生姓名全名（精确匹配；姓名加密存储，不支持模糊或部分匹配）'),
  className: z.string().trim().min(2).max(120).optional()
    .describe('班级名称全名（精确匹配），用于「我班上」「这个班」这类不确定姓名的场景'),
  limit: z.number().int().min(1).max(STUDENT_SEARCH_MAX_RESULTS).optional()
    .describe('返回条数上限，默认 10，最多 20')
})

export interface StudentSearchRow {
  id: string
  name: string
  className: string | null
}

/**
 * 学生检索（只读）：把教师口中的姓名或班级解析成具体的学生 id。
 *
 * 权限边界与教师端学生列表一致：只查 schoolId + ownerUserId 命中的在册（active）学生，
 * 越权目标不会出现在结果里；姓名按学校数据模式脱敏后才外发，返回字段只有 id、姓名、班级，
 * 不含档案正文（档案细节由 student_snapshot 按 id 读取）。
 * 查询或解密异常返回空列表与提示文本，不向上抛错。
 */
export const studentSearchTool: AgentTool = {
  name: 'student_search',
  description: '按姓名或班级检索当前教师负责的在册学生，返回学生 id、姓名与班级（最多 20 条）。回答涉及某个学生的具体事实前，先用本工具把姓名解析成学生 id，再用 student_snapshot 读取该学生的档案。',
  schema: studentSearchSchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = studentSearchSchema.safeParse(args)
    if (!parsed.success) {
      console.warn('[agent:student_search] 参数无效:', parsed.error.issues[0]?.message)
      return { students: [], message: '检索参数无效，请提供学生姓名全名或班级名称。' }
    }
    const { name, className } = parsed.data
    const limit = parsed.data.limit ?? 10
    const db = useDb(ctx.event)
    const secret = useRuntimeConfig(ctx.event).encryptionKey
    const mode = ctx.user.dataMode ?? 'redacted'
    try {
      const conditions = [
        eq(schema.students.schoolId, ctx.user.schoolId),
        eq(schema.students.ownerUserId, ctx.user.userId),
        eq(schema.students.status, 'active')
      ]
      // 姓名是 AES 加密存储，只能按 searchableHash 精确匹配
      if (name) conditions.push(eq(schema.students.nameSearch, searchableHash(name, secret)))
      if (className) {
        // 班级只按学校限定：班级可能由同事共同负责，而教师自己的学生在哪都要能查到；
        // 学生结果本身仍由 ownerUserId 收口，不存在越权读取。
        const [klass] = await db.select({ id: schema.classes.id }).from(schema.classes).where(and(
          eq(schema.classes.schoolId, ctx.user.schoolId),
          eq(schema.classes.name, className)
        )).limit(1)
        if (!klass) {
          return { students: [], message: `没有找到名为「${className}」的班级，请向教师确认班级名称。` }
        }
        conditions.push(eq(schema.students.classId, klass.id))
      }
      // 多取一条用于判断是否还有更多，避免把「刚好等于上限」误当成截断
      const rows = await db.select({
        id: schema.students.id,
        nameEnc: schema.students.nameEnc,
        className: schema.classes.name
      }).from(schema.students)
        .leftJoin(schema.classes, and(
          eq(schema.classes.id, schema.students.classId),
          eq(schema.classes.schoolId, ctx.user.schoolId)
        ))
        .where(and(...conditions))
        .orderBy(desc(schema.students.updatedAt))
        .limit(limit + 1)

      const hasMore = rows.length > limit
      const students: StudentSearchRow[] = rows.slice(0, limit).map(row => ({
        id: row.id,
        name: redactOutboundText(decryptSensitive(row.nameEnc, secret), mode),
        className: row.className || null
      }))
      if (!students.length) {
        return {
          students: [],
          message: name
            ? `没有找到姓名完全等于「${name}」的在册学生（姓名需完整且精确）。请向教师确认姓名，或改用班级名称检索。`
            : '没有找到符合条件的学生，请向教师确认姓名或班级。'
        }
      }
      return { students, count: students.length, hasMore }
    } catch (error) {
      console.error('[agent:student_search] 检索失败，返回空结果:', error instanceof Error ? error.message : error)
      return { status: 'error', students: [], message: '学生检索失败，请基于教师描述回答，不要编造学生名单。' }
    }
  }
}

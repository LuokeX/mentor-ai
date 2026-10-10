/**
 * 记录移交留痕（`record_assignments`）。
 *
 * 单独成文件的原因：业务责任链移交（`server/domain/user-transfer.ts`）与学校管理路由都要用它，
 * 但它本身只依赖 drizzle，不依赖 h3/Nitro 运行时——放在 `school-management.ts` 里会让
 * 纯脚本（tsx）无法导入移交逻辑（该模块同时导出依赖 h3 的 `requireSchoolManagement`）。
 * `school-management.ts` 仍按原路径转出 `writeAssignment`，既有调用方不受影响。
 */
import { schema, useDb } from '../utils/db'

export async function writeRecordAssignment(
  db: ReturnType<typeof useDb>,
  input: {
    schoolId: string
    targetType: 'class' | 'student' | 'guardian' | 'communication' | 'plan'
    targetId: string
    fromUserId?: string | null
    toUserId: string
    assignedBy: string
    reason?: string
    metadata?: Record<string, unknown>
  }
) {
  await db.insert(schema.recordAssignments).values({
    schoolId: input.schoolId,
    targetType: input.targetType,
    targetId: input.targetId,
    fromUserId: input.fromUserId || null,
    toUserId: input.toUserId,
    assignedBy: input.assignedBy,
    reason: input.reason,
    metadata: input.metadata || {}
  })
}

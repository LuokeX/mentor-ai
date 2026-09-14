import type { AgentTool, AgentUserContext } from '../types'
import { entityMemoryTool } from './entity-memory'
import { knowledgeSearchTool } from './knowledge-search'
import { moduleRouteTool } from './module-route'
import { recommendAssessmentTool } from './recommend-assessment'
import { recordSnapshotTool } from './record-snapshot'
import { studentSearchTool } from './student-search'
import { studentSnapshotTool } from './student-snapshot'

/**
 * 需要教师上下文（schoolId/ownerUserId）的只读工具。
 * student_search 与 student_snapshot 都按 schoolId + ownerUserId 限定范围，
 * 因此必须等 runAgentGraph 拿到 userCtx 后才能暴露。
 */
export const agentTools: AgentTool[] = [
  recommendAssessmentTool,
  knowledgeSearchTool,
  moduleRouteTool,
  entityMemoryTool,
  studentSearchTool,
  studentSnapshotTool
]

/** 无教师上下文（未装载 userCtx）时可安全暴露的无状态工具。 */
const statelessTools: AgentTool[] = [knowledgeSearchTool, moduleRouteTool]

/**
 * 按上下文裁剪工具集：
 * - userCtx 为空（null / 未提供 userId 或 sessionId）时只暴露 knowledge_search 与
 *   module_route —— 它们不依赖业务对象；
 * - 上下文存在时补充 recommend_assessment（依赖 lastModuleScores 可选）、
 *   entity_memory（依赖 userId/sessionId 读取实体记忆）与学生检索/学生档案；
 * - 仅当会话绑定了咨询对象（businessContext）且教师未选择不引入档案时，
 *   才暴露 record_snapshot（避免模型对未绑定会话做无效查询）。
 *
 * enabledTools：后台 AI 中心运行时配置的启用工具名数组。
 *  - null / 未提供 → 返回全部（按上下文裁剪后的）默认工具；
 *  - 数组 → 仅保留名字命中该数组的工具（空数组 = 禁用全部工具）。
 */
export function buildAgentTools(userCtx: AgentUserContext | null | undefined, enabledTools?: string[] | null): AgentTool[] {
  const base = !userCtx?.userId || !userCtx.sessionId
    ? statelessTools
    : [...agentTools, ...(userCtx.businessContext ? [recordSnapshotTool] : [])]
  if (enabledTools == null) return base
  const allow = new Set(enabledTools)
  return base.filter(tool => allow.has(tool.name))
}

import type { AgentTool, AgentUserContext } from '../types'
import { entityMemoryTool } from './entity-memory'
import { knowledgeSearchTool } from './knowledge-search'
import { moduleRouteTool } from './module-route'
import { recommendAssessmentTool } from './recommend-assessment'
import { recordSnapshotTool } from './record-snapshot'
import { studentSearchTool } from './student-search'
import { studentSnapshotTool } from './student-snapshot'
import { assessmentHistoryTool } from './assessment-history'
import { classOverviewTool } from './class-overview'
import { communicationLookupTool } from './communication-lookup'
import { planLookupTool } from './plan-lookup'
import { resourceLookupTool } from './resource-lookup'
import { teacherBriefTool } from './teacher-brief'

/**
 * 教师业务数据只读工具（需要 schoolId/ownerUserId 收口）。
 * 全部只读：教师业务正文的写入仍由既有 REST 路由执行（带归属校验、并发校验和审计），
 * 模型只能读取并把结论写进回答，不能直接改数据。
 */
export const agentTools: AgentTool[] = [
  recommendAssessmentTool,
  knowledgeSearchTool,
  moduleRouteTool,
  entityMemoryTool,
  studentSearchTool,
  studentSnapshotTool,
  planLookupTool,
  assessmentHistoryTool,
  communicationLookupTool,
  classOverviewTool,
  teacherBriefTool,
  resourceLookupTool
]

/** 无教师上下文（未装载 userCtx）时可安全暴露的无状态工具。 */
const statelessTools: AgentTool[] = [knowledgeSearchTool, moduleRouteTool]

/**
 * 按上下文裁剪工具集：
 * - userCtx 为空（null / 未提供 userId 或 sessionId）时只暴露 knowledge_search 与
 *   module_route —— 它们不依赖业务对象；
 * - 上下文存在时补充 recommend_assessment（依赖 lastModuleScores 可选）、
 *   entity_memory（依赖 userId/sessionId 读取实体记忆）、学生检索/档案，
 *   以及方案、评估历史、沟通记录、班级概览、教师待办与三库资源目录；
 * - 仅当会话绑定了咨询对象（businessContext）且教师未选择不引入档案时，
 *   才暴露 record_snapshot（避免模型对未绑定会话做无效查询）。
 *
 * enabledTools：AI_AGENT_ENABLED_TOOLS 环境变量给出的启用工具名数组。
 *  - null / 未提供 → 返回全部（按上下文裁剪后的）默认工具；
 *  - 数组 → 仅保留名字命中该数组的工具（空数组 = 禁用全部工具）。
 *
 * 注意：工具定义集合在会话内必须稳定（绑定对象改变会新建会话），
 * 否则每轮请求前缀都会分叉，DeepSeek 前缀缓存全部落空。
 */
export function buildAgentTools(userCtx: AgentUserContext | null | undefined, enabledTools?: string[] | null): AgentTool[] {
  const base = !userCtx?.userId || !userCtx.sessionId
    ? statelessTools
    : [...agentTools, ...(userCtx.businessContext ? [recordSnapshotTool] : [])]
  if (enabledTools == null) return base
  const allow = new Set(enabledTools)
  return base.filter(tool => allow.has(tool.name))
}

import type { AgentTool, AgentUserContext } from '../types'
import { entityMemoryTool } from './entity-memory'
import { knowledgeSearchTool } from './knowledge-search'
import { moduleRouteTool } from './module-route'
import { recommendAssessmentTool } from './recommend-assessment'

/** 全部只读工具（P0「回答先行 Agent」工具层）。 */
export const agentTools: AgentTool[] = [
  recommendAssessmentTool,
  knowledgeSearchTool,
  moduleRouteTool,
  entityMemoryTool
]

/** 无教师上下文（未装载 userCtx）时可安全暴露的无状态工具。 */
const statelessTools: AgentTool[] = [knowledgeSearchTool, moduleRouteTool]

/**
 * 按上下文裁剪工具集：
 * - userCtx 为空（null / 未提供 userId 或 sessionId）时只暴露 knowledge_search 与
 *   module_route —— 它们不依赖业务对象；
 * - 上下文存在时补充 recommend_assessment（依赖 lastModuleScores 可选）与
 *   entity_memory（依赖 userId/sessionId 读取实体记忆）。
 */
export function buildAgentTools(userCtx: AgentUserContext | null | undefined): AgentTool[] {
  if (!userCtx?.userId || !userCtx.sessionId) return statelessTools
  return agentTools
}
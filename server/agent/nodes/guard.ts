/**
 * guard 节点（P0 简化版）：纯函数，无 DB 访问。
 *
 * P0 中上下文装载（业务对象上下文 / 画像 / 记忆 / 治理脱敏）由入口 AGENT-C
 * 负责，本文件只提供 `prepareRunInput`，把入口已准备好的上下文整理成
 * AgentUserContext（契约必要字段），供调用 runAgentGraph 前组装。
 */
import type { AgentMessage, AgentUserContext } from '../types'
import type { ModuleId } from '../../../shared/contracts'
import type { KnowledgeCitation } from '../../integrations/deepseek'

export interface PrepareRunInputArgs {
  schoolId: string
  userId: string
  sessionId: string
  /** 咨询对象（学生/班级/家长）上下文摘要，可为 null 表示未指定。 */
  businessContextText?: string | null
  /** 跨会话实体记忆（按需拉取）。 */
  entityMemory?: AgentMessage[]
  /** 教师画像。 */
  teacherProfileText?: string
  /** 知识库检索命中（引用来源）。 */
  citations?: KnowledgeCitation[]
  /** 上一轮模块评分（模块分诊依据）。 */
  lastModuleScores?: Record<ModuleId, number>
}

/** 把入口已有上下文整理为 AgentUserContext（必要字段恒有值，可选字段缺省不注入）。 */
export function prepareRunInput(args: PrepareRunInputArgs): AgentUserContext {
  const ctx: AgentUserContext = {
    schoolId: args.schoolId,
    userId: args.userId,
    sessionId: args.sessionId
  }
  if (args.businessContextText !== undefined) ctx.businessContextText = args.businessContextText
  if (args.entityMemory !== undefined && args.entityMemory.length > 0) ctx.entityMemory = args.entityMemory
  if (args.teacherProfileText !== undefined && args.teacherProfileText.trim() !== '') ctx.teacherProfileText = args.teacherProfileText
  if (args.citations !== undefined && args.citations.length > 0) ctx.citations = args.citations
  if (args.lastModuleScores !== undefined && Object.keys(args.lastModuleScores).length > 0) ctx.lastModuleScores = args.lastModuleScores
  return ctx
}
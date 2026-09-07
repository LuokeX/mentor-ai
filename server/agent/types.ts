/**
 * Agent 化改造共享契约（P0）。
 *
 * 供以下模块共同引用：
 *  - server/agent/graph.ts / nodes/* （基座）
 *  - server/agent/tools/* （工具层）
 *  - server/api/v1/chat/messages.post.ts（入口接入）
 *  - app/pages/index.vue（SSE 渲染，仅消费事件名常量由 SSE 传输，不 import 本文件）
 */
import type { H3Event } from 'h3'
import type { z } from 'zod'
import type { ModuleId } from '../../shared/contracts'
import type { KnowledgeCitation } from '../integrations/deepseek'

/** 对话消息（与 chatMessages 存储一致的角色视图）。 */
export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

/** 教师上下文（业务对象/记忆/画像），由 guard 节点装载，工具可读。 */
export interface AgentUserContext {
  schoolId: string
  userId: string
  sessionId: string
  /** 咨询对象（学生/班级/家长）上下文摘要，可为 null。 */
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

/** 工具执行上下文：权限过滤后的只读数据，执行器可安全使用。 */
export interface AgentToolContext {
  event: H3Event
  user: AgentUserContext
}

/** 工具定义：LangChain Tool 的声明 + 执行器。 */
export interface AgentTool {
  name: string
  description: string
  /** 参数 JSON Schema（zod），用于校验与传递给模型。 */
  schema: z.ZodTypeAny
  /** 执行器：只允许读自己的数据；写操作由 P1 的 HITL confirm 节点接管。 */
  execute(args: unknown, ctx: AgentToolContext): Promise<unknown>
}

/** SSE 事件名常量（messages.post.ts 与前端共用名称，前端为硬编码字符串匹配）。 */
export const AGENT_SSE_EVENTS = {
  THINKING: 'thinking',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  ACTION_CARD: 'action_card',
  SOURCES: 'sources',
  ANSWER_DELTA: 'answer_delta',
  ANSWER: 'answer',
  DONE: 'done'
} as const

/** action_card 类型：P0 支持量表推荐卡，P1 扩展确认卡/方案卡。 */
export type ActionCard =
  | {
      kind: 'recommend_assessment'
      module: ModuleId
      /** 量表编码（assessmentDefinitions 白名单内）。 */
      assessmentCode: string
      title: string
      reason: string
      /** 引导文案，如"点击开始作答"。 */
      ctaLabel: string
    }
  | {
      kind: 'info'
      title: string
      content: string
    }

/** Agent 图状态（LangGraph StateGraph reducer 用）。 */
export interface AgentState {
  /** 对话消息历史（含本轮用户输入），每轮追加。 */
  messages: AgentMessage[]
  /** 教师上下文（guard 装载）。 */
  userCtx: AgentUserContext | null
  /** 模块评分（分诊依据，可由 module_route / recommend_assessment 更新）。 */
  moduleScores: Record<ModuleId, number> | null
  /** 是否已输出初步解答（防止同一会话重复输出首答）。 */
  preliminaryGiven: boolean
  /** 待确认的写操作（P1 HITL 使用，P0 恒为空）。 */
  pendingConfirm: unknown | null
  /** 终止原因编码：done | max_rounds | safety_hit | error | fallback。 */
  exitReason: 'done' | 'max_rounds' | 'safety_hit' | 'error' | 'fallback' | null
  /** SSE 事件采集器：节点将事件推给入口（入口转发给前端）。 */
  emit: (event: string, data: unknown) => void
  /** 最终输出（preliminary/report 节点写入）。 */
  output: {
    answer: string
    actionCards: ActionCard[]
  } | null
}
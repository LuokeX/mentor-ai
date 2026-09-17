import { z } from 'zod'
import type { AgentTool } from '../../server/agent/types'
import type { EvaluationScenario } from './scenarios'
import { getModulePlaybookText } from '../../server/agent/module-playbooks'

export const FIXTURE_VERSION = 'synthetic-school-v1'
export function evaluationTools(s: EvaluationScenario): AgentTool[] {
  return s.tools.map(name => ({ name,
    description: ({ knowledge_search: '查询已发布的教师支持知识。', module_route: '读取模块分析框架。', record_snapshot: '读取当前对象档案。', entity_memory: '读取同一对象历史沟通。', assessment_history: '查询已提交评估。', plan_lookup: '查询已有方案与复盘。' } as Record<string, string>)[name]!,
    schema: z.object({ query: z.string().optional() }),
    execute: async () => {
      if (s.fixture === 'error') return { status: 'error', error: '工具执行失败', message: '合成故障；不能当作没有记录。' }
      if (name === 'knowledge_search') return { status: s.fixture === 'empty' ? 'empty' : 'success', items: s.fixture === 'empty' ? [] : [{ chunkId: `${s.module}-synthetic-1`, versionId: FIXTURE_VERSION, documentTitle: '合成教师支持资源', content: '建议先描述可观察事实，再确认对方的困难。把任务拆成可开始的动作，观察参与和独立完成的变化。解释是待验证的，不作诊断；沟通无效时检查是否回应实际诉求。', module: s.module, libraryType: 'tool' }], catalog: [] }
      if (name === 'module_route') return { module: s.module, playbook: getModulePlaybookText(s.module) }
      if (name === 'record_snapshot') return { status: 'empty', message: '合成场景未绑定档案，只能使用教师提供的信息。' }
      if (name === 'entity_memory') return { status: 'empty', memories: [] }
      if (name === 'assessment_history') return s.id.endsWith('-07') ? { submitted: [{ sessionId: '11111111-1111-4111-8111-111111111111', module: s.module, assessmentCode: 'SYNTHETIC', level: 'L1', levelName: '合成一般支持', dimensions: { 合成维度: 3 }, object: null }], drafts: [], openSessions: [] } : { submitted: [], drafts: [], openSessions: [], status: 'empty' }
      return s.id.endsWith('-08') ? { plans: [{ id: '22222222-2222-4222-8222-222222222222', title: '合成支持方案', status: 'review_due', module: s.module, actions: [{ title: '核实实际困难', status: 'completed' }], lastReview: null }] } : { plans: [], status: 'empty' }
    }
  }))
}

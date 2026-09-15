import { z } from 'zod'
import type { ModuleId } from '../../../shared/contracts'
import { moduleMeta } from '../../../shared/assessments'
import { topModuleFromScores } from '../../domain/chat-clarification'
import {
  describeTriggerEvidence,
  filterTeacherVisibleInstruments,
  listInstrumentOptions,
  resolveReachableInstrument,
  type AssessmentContextRef,
  type InstrumentOption
} from '../../domain/assessment-instruments'
import { getModulePlaybookText } from '../module-playbooks'
import type { ActionCard, AgentTool, AgentToolContext } from '../types'
import { pickModuleByKeywords } from './module-route'
const recommendAssessmentSchema = z.object({
  query: z.string().trim().min(4).max(200).describe('教师当前困扰的简短描述（50字内优先）'),
  module: z.enum(['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']).optional()
    .describe('已经明确模块时可直接指定；不传则按上一轮模块评分与描述关键词判定')
})

/** 确定性挑选顺序：业务判定「现在该做」→ 必做且可做 → 第一张可做。 */
export function pickInstrumentOption(options: InstrumentOption[]): InstrumentOption | null {
  return options.find(option => option.status === 'suggested')
    || options.find(option => option.isRequired && option.status !== 'locked')
    || options.find(option => option.status !== 'locked')
    || null
}

/** 从真实量表选项组织推荐理由（只用确定性信息，不做诊断性表述）。 */
export function buildInstrumentReason(option: InstrumentOption, module: ModuleId, redirectedFrom?: InstrumentOption | null): string {
  const moduleTitle = moduleMeta[module]?.title || module
  const size = [
    option.questionCount ? `${option.questionCount} 题` : '',
    option.estimatedMinutes ? `约 ${option.estimatedMinutes} 分钟` : ''
  ].filter(Boolean).join('，')
  const parts: string[] = []
  if (redirectedFrom) {
    parts.push(`你的情况更适合做「${redirectedFrom.title}」，但它需要先完成前置量表。`)
  }
  parts.push(`「${option.title}」是「${moduleTitle}」模块当前可做的量表${size ? `（${size}）` : ''}。`)
  if (option.status === 'suggested') {
    // 说实测事实（谁、什么时候、多少分、什么结论），不复述触发条件原文
    parts.push(describeTriggerEvidence(option)
      || '业务规则判定现在适合做这张（触发条件已命中）。')
  } else if (option.isRequired) {
    parts.push('该量表在模块内标记为必做。')
  }
  if (option.triggerConditionNote && option.status !== 'suggested') {
    parts.push(`适用条件：${option.triggerConditionNote}`)
  }
  if (option.lastSubmittedAt) {
    parts.push('该量表此前已完成过，如需重测可复查变化。')
  }
  parts.push('先做它能给后续归因与行动建议提供依据。')
  return parts.join('')
}

/**
 * 候选清单（供模型说明还有哪些可选）：排除被推荐的那张，最多 5 条。
 * 「建议做」的候选用实测依据说明原因，不把触发条件原文交给模型
 * ——规则原文是条件式描述，转述后容易变成对教师数据的断言。
 */
function buildAlternatives(options: InstrumentOption[], pickedCode: string) {
  return options
    .filter(option => option.code !== pickedCode)
    .slice(0, 5)
    .map(option => ({
      code: option.code,
      title: option.title,
      status: option.status,
      isRequired: option.isRequired,
      triggerConditionNote: option.status === 'suggested' ? null : option.triggerConditionNote ?? null,
      triggerEvidence: option.status === 'suggested' ? describeTriggerEvidence(option) : null
    }))
}

/**
 * 量表推荐（仅推荐，不发起作答）。
 *
 * 与模块页保持同一套门禁：候选来自已发布量表库（listInstrumentOptions），
 * 红线检查量表只在业务判定「高危阈值已命中」时可见（filterTeacherVisibleInstruments），
 * 被前置锁住时改推前置（resolveReachableInstrument）。
 * 只做确定性挑选，不再有「每模块第一张入口筛查」这种与模块页不一致的简化。
 */
export const recommendAssessmentTool: AgentTool = {
  name: 'recommend_assessment',
  description: '从当前模块已发布且当前可做的量表中推荐一张（仅推荐，不发起作答），返回模块、量表编码、推荐理由、「开始作答」动作卡、其他候选量表与模块框架。被前置量表锁住时会改推前置量表。教师描述已经明确时调用；不要自行给出等级、归因或分数。推荐理由里的触发依据是实测事实（哪张量表、何时完成、均分与结论），照实转述即可，不要说成「平台监测到风险」或复述规则阈值；没有触发依据时只说业务规则判定现在适合做，不要推断教师的数据。',
  schema: recommendAssessmentSchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = recommendAssessmentSchema.safeParse(args)
    if (!parsed.success) {
      return { module: null, assessmentCode: null, title: null, reason: '暂无匹配量表', actionCard: null, alternatives: [], playbook: '' }
    }
    const query = parsed.data.query
    const module: ModuleId = parsed.data.module
      || topModuleFromScores(ctx.user.lastModuleScores)
      || pickModuleByKeywords(query)
      || 'self_growth'
    const playbook = getModulePlaybookText(module)

    try {
      // 当前会话绑定的咨询对象：对象级量表（per_case / 红线检查）的触发条件只认同一对象的提交
      const binding = ctx.user.businessContext
      const context: AssessmentContextRef | null = binding ? { type: binding.type, id: binding.id } : null
      const options = filterTeacherVisibleInstruments(await listInstrumentOptions(ctx.event, module, {
        id: ctx.user.userId,
        schoolId: ctx.user.schoolId
      }, undefined, context))
      if (!options.length) {
        return {
          module: null,
          assessmentCode: null,
          title: null,
          reason: `${moduleMeta[module]?.title || module}模块暂无可推荐的已发布量表，请联系平台管理员确认量表库发布状态。`,
          actionCard: null,
          alternatives: [],
          playbook
        }
      }

      let picked = pickInstrumentOption(options)
      let redirectedFrom: InstrumentOption | null = null
      if (!picked) {
        // 全部被门禁锁住：顺着前置链改推第一张能做的
        const locked = options.find(option => option.status === 'locked')
        const resolved = locked ? resolveReachableInstrument(options, locked.code) : null
        if (resolved) {
          picked = resolved.instrument
          redirectedFrom = resolved.redirectedFrom
        }
      }
      if (!picked) {
        return {
          module: null,
          assessmentCode: null,
          title: null,
          reason: `${moduleMeta[module]?.title || module}模块的量表当前都被前置条件锁住，请先完成前置量表后再来。`,
          actionCard: null,
          alternatives: buildAlternatives(options, ''),
          playbook
        }
      }

      const reason = buildInstrumentReason(picked, module, redirectedFrom)
      const actionCard: ActionCard = {
        kind: 'recommend_assessment',
        module,
        assessmentCode: picked.code,
        title: picked.title,
        reason,
        ctaLabel: '开始作答'
      }
      return {
        module,
        assessmentCode: picked.code,
        title: picked.title,
        reason,
        /** 触发条件命中时的实测依据（分数/结论/时间），模型据此说明原因 */
        triggerEvidence: picked.triggerEvidence,
        actionCard,
        alternatives: buildAlternatives(options, picked.code),
        playbook
      }
    } catch (error) {
      console.error('[agent:recommend_assessment] 读取量表库失败:', error instanceof Error ? error.message : error)
      return {
        module: null,
        assessmentCode: null,
        title: null,
        reason: '量表库读取失败，请基于教师描述给出通用建议，不要编造量表名称或结论。',
        actionCard: null,
        alternatives: [],
        playbook
      }
    }
  }
}

import { z } from 'zod'
import { resolvePublishedModuleResource, listPublishedModuleTools } from '../../domain/module-resources'
import { findBannedTerms } from '../../domain/knowledge-text-guard'
import { truncateAssistantText } from '../../domain/assistant-readers'
import { viewerSchoolSections } from '../../utils/stage-filter'
import type { AgentTool, AgentToolContext } from '../types'

/** 单次返回的条目上限（与三库资源目录同一量级，避免工具结果撑爆 token 预算）。 */
export const RESOURCE_DETAIL_LIMIT = 6
/** 工具卡步骤上限与单步字数上限。 */
export const RESOURCE_DETAIL_STEP_LIMIT = 8
const STEP_CHARS = 160
const FIELD_CHARS = 300

export interface AttributionDetailItem {
  libraryType: 'attribution'
  code: string | null
  name: string
  /** 出现这个问题时通常什么表现 */
  manifestations: string | null
  /** 通常由什么引起 */
  causes: string | null
  /** 命中后给老师的建议动作 */
  suggestedAction: string | null
  /** 跨库匹配标签 */
  tags: string[]
}

export interface ToolDetailItem {
  libraryType: 'tool'
  code: string | null
  name: string
  /** 适用症状（什么时候用这个工具） */
  manifestations: string | null
  /** 关键步骤（已截断，最多 RESOURCE_DETAIL_STEP_LIMIT 条） */
  steps: string[]
  /** 预期效果与单次时长 */
  expectedEffect: string | null
  duration: string | null
}

export type ResourceDetailItem = AttributionDetailItem | ToolDetailItem

export interface ResourceDetailFilter {
  /** 按现象或名称筛选（不区分大小写，包含匹配） */
  keyword?: string | null
  /** 按名称筛选（不区分大小写，包含匹配） */
  name?: string | null
  limit?: number
}

/** 目录与明细共用的字段读取：只取非空字符串。 */
function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asTags(value: unknown, max = 8): string[] {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim())).map(tag => tag.trim()).slice(0, max)
    : []
}

/**
 * 明细外发前的文本防线（字段级），与知识片段共用同一份判定口径
 *（server/domain/knowledge-text-guard.ts 的 findBannedTerms：红线词 + 内部编码）：
 * 正文里命中红线词或内部编码的字段整段置空——知识片段按整段丢弃，明细按字段丢弃，
 * 避免一条症状描述把整张工具卡挡掉；判定用未截断的原文，避免禁用措辞落在截断点之后漏检。
 */
function safeText(value: string | null, max: number): string | null {
  if (!value) return null
  if (findBannedTerms(value).length) return null
  return truncateAssistantText(value, max)
}

/**
 * 名称只按「面向教师的红线词」判定：危机 / 红线 / 预警 / 立即 / 110 / 120。
 *
 * 为什么不像正文字段那样连内部编码一起查：三库条目名是教师本来就看得见的业务名称，
 * 「班主任一日工作SOP」「心理风险A-E响应SOP」这类名字里的 SOP / A-E 是工具名的一部分，
 * 按内部编码整条丢弃会让这些已发布工具对 AI 不可见；而含「危机」的名称本身就是
 * 教师侧禁用措辞，必须整条丢弃（名称没法像字段那样置空）。
 */
const OUTBOUND_REDLINE_TERMS: readonly string[] = ['危机', '红线', '预警', '立即', '110', '120']

function hasRedlineTerm(text: string): boolean {
  return findBannedTerms(text).some(term => OUTBOUND_REDLINE_TERMS.includes(term))
}

/** 数组字段（标签、步骤）：逐条过滤命中防线的文本。 */
function safeList(values: string[], max: number): string[] {
  return values.filter(value => !findBannedTerms(value).length).map(value => truncateAssistantText(value, max))
}

function matches(fields: Array<string | null>, keyword: string): boolean {
  return fields.some(field => Boolean(field) && (field as string).toLowerCase().includes(keyword))
}

/** 名称命中关键词的排前面（资料顺序在其后保持稳定）。 */
function rankByNameHit<T extends { name: string }>(items: T[], keyword: string): T[] {
  if (!keyword) return items
  return [...items].sort((left, right) =>
    Number(right.name.toLowerCase().includes(keyword)) - Number(left.name.toLowerCase().includes(keyword)))
}

/**
 * 归因库明细：原因名 / 常见表现 / 通常成因 / 建议动作 / 匹配标签（纯函数，供单测）。
 * 不返回证据规则、分级规则与红线内容——那些属于平台内部运行规则，不能进入教师侧回答。
 */
export function buildAttributionDetailItems(
  payload: Record<string, unknown> | null | undefined,
  options: ResourceDetailFilter = {}
): AttributionDetailItem[] {
  const raw = Array.isArray(payload?.attributionItems) ? payload?.attributionItems as unknown[] : []
  const keyword = (options.keyword || '').trim().toLowerCase()
  const nameFilter = (options.name || '').trim().toLowerCase()
  const limit = options.limit ?? RESOURCE_DETAIL_LIMIT

  const items: AttributionDetailItem[] = []
  for (const entry of raw) {
    const record = entry as Record<string, unknown>
    const rawName = asText(record.name)
    if (!rawName) continue
    // 名称含「危机」等教师侧禁用措辞时整条丢弃：名称没法置空，也就不给教师看这一条
    if (hasRedlineTerm(rawName)) continue
    const name = truncateAssistantText(rawName, 80)
    const manifestations = safeText(asText(record.highManifestation), FIELD_CHARS)
    const causes = safeText(asText(record.typicalTrigger), FIELD_CHARS)
    const suggestedAction = safeText(asText(record.suggestedAction), FIELD_CHARS)
    const tags = safeList(asTags(record.toolTags), 80)
    if (nameFilter && !rawName.toLowerCase().includes(nameFilter)) continue
    if (keyword && !matches([name, manifestations, causes, suggestedAction, tags.join(' ')], keyword)) continue
    items.push({
      libraryType: 'attribution',
      code: asText(record.code),
      name,
      manifestations,
      causes,
      suggestedAction,
      tags
    })
  }

  return rankByNameHit(items, keyword).slice(0, limit)
}

/**
 * 工具库明细：工具名 / 适用症状 / 关键步骤 / 预期效果 / 时长（纯函数，供单测）。
 * 不返回禁忌规则与 contraindication 文本（含内部处置流程，且措辞可能触发教师侧红线词约束）。
 */
export function buildToolDetailItems(
  tools: unknown[] | null | undefined,
  options: ResourceDetailFilter = {}
): ToolDetailItem[] {
  const raw = Array.isArray(tools) ? tools : []
  const keyword = (options.keyword || '').trim().toLowerCase()
  const nameFilter = (options.name || '').trim().toLowerCase()
  const limit = options.limit ?? RESOURCE_DETAIL_LIMIT

  const items: ToolDetailItem[] = []
  for (const entry of raw) {
    const record = entry as Record<string, unknown>
    const rawName = asText(record.name)
    if (!rawName) continue
    if (hasRedlineTerm(rawName)) continue
    const name = truncateAssistantText(rawName, 80)
    const manifestations = safeText(asText(record.symptoms), FIELD_CHARS)
    const steps = Array.isArray(record.steps)
      ? safeList(
          record.steps.filter((step): step is string => typeof step === 'string' && Boolean(step.trim())).slice(0, RESOURCE_DETAIL_STEP_LIMIT),
          STEP_CHARS
        )
      : []
    const expectedEffect = safeText(asText(record.expectedEffect), FIELD_CHARS)
    const duration = safeText(asText(record.duration), 80)
    if (nameFilter && !rawName.toLowerCase().includes(nameFilter)) continue
    if (keyword && !matches([name, manifestations, steps.join(' '), expectedEffect], keyword)) continue
    items.push({
      libraryType: 'tool',
      code: asText(record.code),
      name,
      manifestations,
      steps,
      expectedEffect,
      duration
    })
  }

  return rankByNameHit(items, keyword).slice(0, limit)
}

const resourceDetailSchema = z.object({
  module: z.enum(['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem'])
    .describe('要查询的模块（必填；一次查一个模块）'),
  libraryType: z.enum(['attribution', 'tool']).default('attribution')
    .describe('attribution = 归因库（这类问题的常见表现、通常成因与建议动作）；tool = 工具库（现成做法的适用症状与关键步骤）'),
  keyword: z.string().trim().max(60).optional()
    .describe('按现象或名称筛选，如「走神」「拖拉」「家长不回消息」；不传则按资料顺序返回前几条'),
  name: z.string().trim().max(60).optional()
    .describe('按名称取，如「注意力分散型」；与 keyword 二选一即可')
})

/**
 * 三库明细查询（只读）：把已发布版本里的归因项与工具卡正文按需给模型。
 *
 * 定位：教师问「这类问题通常有哪些原因」「平台有没有具体做法」时，让模型能按平台资料
 * 说明常见表现、通常成因与建议做法；判定仍归模块规则——工具描述里写明不得据此断言
 * 某个学生属于哪一类原因，也不得改写步骤原文。
 *
 * 只读已发布版本 payload，不写库、不重新向量化；版本更新后自动跟随。
 * 字段白名单之外的内部规则（证据规则、分级规则、红线、禁忌规则）不在这里暴露，
 * 命中外发文本防线的字段整段置空，名称命中时整条丢弃。
 */
export const resourceDetailTool: AgentTool = {
  name: 'resource_detail',
  description: '查询某个模块已发布三库资料里的正文明细：归因库（libraryType=attribution）返回每一类可能原因的常见表现、通常成因、建议动作与匹配标签；工具库（libraryType=tool）返回现成做法的适用症状与关键步骤。教师问「这类问题通常有哪些原因」「有没有具体做法、怎么做」时调用；只能按返回内容说明平台资料里怎么归类与建议，不得据此判定某个学生属于哪一类原因、不得给出等级结论，也不要改写步骤原文或编造未返回的内容。',
  schema: resourceDetailSchema,
  async execute(args: unknown, ctx: AgentToolContext): Promise<unknown> {
    const parsed = resourceDetailSchema.safeParse(args)
    if (!parsed.success) {
      return {
        status: 'error',
        items: [],
        message: '查询参数无效：module 必填且需为五个业务模块之一，libraryType 只能是 attribution 或 tool。'
      }
    }
    const { module, libraryType, keyword, name } = parsed.data
    const options: ResourceDetailFilter = { keyword: keyword ?? null, name: name ?? null, limit: RESOURCE_DETAIL_LIMIT }
    const emptyMessage = libraryType === 'attribution'
      ? '该模块的归因库里没有符合条件的原因条目。请基于通用工作方法回答，不要编造平台归因维度。'
      : '该模块的工具库里没有符合条件的工具。请基于通用工作方法回答，不要编造平台工具。'
    try {
      if (libraryType === 'tool') {
        // 学段：与模块页/资源目录同一口径，按教师任教年级过滤工具
        const sections = viewerSchoolSections(ctx.event, ctx.user.teachingGrades)
        const { tools } = await listPublishedModuleTools(ctx.event, module, ctx.user.schoolId, { sections })
        const items = buildToolDetailItems(tools, options)
        if (!items.length) return { status: 'empty', libraryType, items: [], message: emptyMessage }
        return { status: 'success', libraryType, items }
      }
      const resource = await resolvePublishedModuleResource<Record<string, unknown>>(ctx.event, {
        module, libraryType: 'attribution', schoolId: ctx.user.schoolId
      })
      const items = buildAttributionDetailItems(resource?.payload ?? null, options)
      if (!items.length) return { status: 'empty', libraryType, items: [], message: emptyMessage }
      return { status: 'success', libraryType, items }
    } catch (error) {
      console.error('[agent:resource_detail] 读取三库明细失败，返回空结果:', error instanceof Error ? error.message : error)
      return { status: 'error', items: [], message: '三库明细读取失败，请基于通用工作方法回答，不要编造平台内容。' }
    }
  }
}

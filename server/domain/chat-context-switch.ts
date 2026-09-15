/**
 * 会话内切换咨询对象（@ 换对象）的元数据与提示文案。
 *
 * 规则：一个会话默认只绑定一个咨询对象；教师可以在会话中途 @ 另一个对象，
 * 此时保留既有消息（不新建会话、不清空记录），从下一条消息起绑定新对象。
 *
 * 换绑必须同时做两件事：
 * 1. 元数据留痕 `contextSwitches`（谁 → 谁、发生在什么时候），前端据此在时间线里插分隔条；
 * 2. system 提示里持续声明「历史消息属于旧对象」——切换后每轮都带同一段文案，
 *    保持请求前缀逐轮稳定（前缀一旦每轮分叉，DeepSeek 前缀缓存会全部落空，
 *    见 docs/AI_ASSISTANT_AND_KNOWLEDGE.md 的对话记忆口径）。
 *
 * 边界：本模块只处理元数据与文案，不读写数据库、不做归属校验（归属由入口用
 * buildAssistantBusinessContext 完成）；换绑不改变历史消息，也不重建会话摘要。
 */

export type ChatContextType = 'student' | 'class' | 'guardian'

export interface ChatContextRef {
  type: ChatContextType
  id: string
  /** 展示名（学生/家长姓名或班级名）；历史数据可能缺失 */
  label: string | null
}

/** 一次换绑：from 为切换前的绑定（会话创建时未留名时可能为 null），to 为切换后的绑定。 */
export interface ChatContextSwitchEntry {
  /** ISO 时间戳：换绑发生在该时刻，前端据此把分隔条插到其后第一条消息之前 */
  at: string
  from: ChatContextRef | null
  to: ChatContextRef
}

/** 元数据里最多保留的换绑条数（超出丢弃最早的，只用于展示与提示，不影响业务数据）。 */
export const CONTEXT_SWITCH_LIMIT = 20

export function contextTypeLabel(type?: string | null): string {
  return type === 'student' ? '学生' : type === 'class' ? '班级' : type === 'guardian' ? '家长' : '咨询对象'
}

function normalizeRef(value: unknown): ChatContextRef | null {
  if (!value || typeof value !== 'object') return null
  const ref = value as Partial<ChatContextRef>
  if (ref.type !== 'student' && ref.type !== 'class' && ref.type !== 'guardian') return null
  if (typeof ref.id !== 'string' || !ref.id) return null
  return {
    type: ref.type,
    id: ref.id,
    label: typeof ref.label === 'string' && ref.label.trim() ? ref.label.trim() : null
  }
}

/** 把数据库里的 (type, id, label) 归一化成引用；类型不在白名单或缺 id 时返回 null。 */
export function toContextRef(type?: string | null, id?: string | null, label?: string | null): ChatContextRef | null {
  const normalized = type === 'student' || type === 'class' || type === 'guardian' ? type : null
  if (!normalized || !id) return null
  return { type: normalized, id, label: typeof label === 'string' && label.trim() ? label.trim() : null }
}

/** 读取会话元数据里的换绑记录（不合法条目直接丢弃，不做修复）。 */
export function readContextSwitches(metadata: unknown): ChatContextSwitchEntry[] {
  const raw = (metadata as Record<string, unknown> | null | undefined)?.contextSwitches
  if (!Array.isArray(raw)) return []
  const entries: ChatContextSwitchEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const to = normalizeRef(record.to)
    if (!to || typeof record.at !== 'string' || !record.at) continue
    entries.push({ at: record.at, from: normalizeRef(record.from), to })
  }
  return entries
}

/** 会话当前绑定对象的展示名（会话创建或换绑时写入，历史会话可能为空）。 */
export function readContextLabel(metadata: unknown): string | null {
  const value = (metadata as Record<string, unknown> | null | undefined)?.contextLabel
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * 追加一条换绑记录，返回新的元数据对象（不改原对象）。
 * 同时把 `contextLabel` 更新为最新绑定对象的展示名，供会话列表与后续换绑引用旧名。
 */
export function appendContextSwitch(
  metadata: Record<string, unknown> | null | undefined,
  entry: ChatContextSwitchEntry
): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' ? metadata : {}
  const entries = [...readContextSwitches(base), entry].slice(-CONTEXT_SWITCH_LIMIT)
  return {
    ...base,
    contextLabel: entry.to.label || base.contextLabel || null,
    contextSwitches: entries
  }
}

function describeRef(ref: ChatContextRef | null): string | null {
  if (!ref) return null
  const label = ref.label ? `「${ref.label}」` : ''
  return `${contextTypeLabel(ref.type)}${label}`
}

/**
 * 判断一条消息是否算作「绑定对象的记忆」。
 *
 * 会话中途换绑过对象时，同一条会话里既有旧对象的消息也有新对象的消息；
 * 实体记忆按会话当前绑定取消息，若不过滤就会把旧对象的内容说成当前对象的沟通史。
 * 规则：只看换绑到该对象之后（含）的消息；从未换绑的会话全部算数。
 */
export function isMessageAfterBindingSwitch(
  entries: ChatContextSwitchEntry[],
  binding: { type: string, id: string },
  createdAt: Date
): boolean {
  let boundary: number | null = null
  for (const entry of entries) {
    if (entry.to.type !== binding.type || entry.to.id !== binding.id) continue
    const at = Date.parse(entry.at)
    if (Number.isNaN(at)) continue
    if (boundary === null || at > boundary) boundary = at
  }
  return boundary === null || createdAt.getTime() >= boundary
}

/**
 * 生成「本会话换过咨询对象」的持续提示。
 *
 * 输出必须只依赖传入的换绑记录（同一份元数据每轮得到同一结果），否则每轮 system 前缀都会变。
 * 没有换绑记录时返回 null（常见路径不增加 token）。
 */
export function buildContextSwitchNote(entries: ChatContextSwitchEntry[]): string | null {
  if (!entries.length) return null
  const previous: string[] = []
  for (const entry of entries) {
    const described = describeRef(entry.from)
    if (described && previous[previous.length - 1] !== described) previous.push(described)
  }
  const current = describeRef(entries[entries.length - 1]!.to)
  const previousText = previous.length ? previous.slice(-3).join('、') : '其他对象'
  return `本会话中途切换过咨询对象：此前讨论的是${previousText}，当前咨询对象是${current}。`
    + '历史消息只作为这段对话的背景，不要把两者的信息混用；当前对象的具体事实必须先调用 record_snapshot 等工具查询，未查询时不要凭印象描述。'
}

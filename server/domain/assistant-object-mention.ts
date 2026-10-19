/**
 * 从教师本轮消息里识别「本轮对象」（学生 / 班级，可多名）。
 *
 * 背景：会话对象原先只能靠输入框 @ 选择；教师直接在句子里写出学生姓名或班级名时，
 * 助手是否去查档案完全取决于模型自己是否决定调用检索工具，表现为「时好时坏」。
 * 这里用确定性代码做一次预解析，把消息里能确认的对象交给本轮回答使用，
 * 但它**不改变会话绑定**：会话绑定仍由 @ 或教师点「固定为本会话对象」决定，
 * 这样跨会话记忆、摘要与方案收口的作用范围不会因为一句顺带的提及而改变。
 *
 * 匹配方式：按当前教师负责的名单做包含匹配（班级名是明文，学生名解密后比对），
 * 而不是把消息切成候选片段去查哈希：姓名是加密存储、只能精确匹配，
 * 含数字、间隔号或超长姓名的形式（如「阿依古丽·买买提」）切片段就永远命不中。
 * 名单范围与教师端学生列表一致（schoolId + ownerUserId + 在册），越权目标不会出现。
 *
 * 决定策略（纯函数 decideMentionObjects）：
 *  - 命中多个学生时整体作为本轮对象集（2026-10-16 支持 @ 多名学生），按出现顺序排列；
 *  - 同一姓名对应多条档案（同名不同人）、或命中数超过上限时，这些项不自动采用，交界面点选；
 *  - 命中学生时不再并入班级（避免一句话里顺带的班级名把范围放大）；没有学生时按班级同理。
 */
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { CHAT_CONTEXT_MAX } from '../../shared/contracts'
import { decryptSensitive } from '../utils/crypto'
import { schema, useDb } from '../utils/db'
import type { AuthUser } from '../../app/composables/useAuth'
import type { ChatContextRef } from './chat-context-switch'
import { isSameContextSet } from './chat-session-contexts'

export interface MentionedObject {
  type: 'student' | 'class'
  id: string
  label: string
}

export type MentionResolution =
  | { kind: 'none' }
  /**
   * 本轮识别到的对象集（按在消息里出现的先后排序）与无法自动决定的候选
   * （同名多条档案、超出上限的命中），候选交前端让教师点选。
   */
  | { kind: 'objects', objects: MentionedObject[], candidates: MentionedObject[] }

/** 名单读取上限：教师负责的学生与班级都是有限集合，这里只做防御性上限。 */
export const MENTION_ROSTER_LIMIT = 500
/** 姓名最短长度：太短的名字（如单字）在自由文本里误命中概率过高，不作为识别依据。 */
export const MENTION_MIN_NAME_LENGTH = 2
/** 本轮自动采用的对象数上限（与会话绑定上限同源）。 */
const MENTION_MAX_OBJECTS = CHAT_CONTEXT_MAX
/** 候选数量上限（交界面点选）。 */
const MENTION_MAX_CANDIDATES = 20

/**
 * 在自由文本里找出与给定名称完全一致的片段。纯函数，便于测试与复用。
 * 名称长度不足 MENTION_MIN_NAME_LENGTH 时忽略（避免单字误命中）。
 */
export function matchMentionedNames(text: string, names: string[]): string[] {
  const matched = new Set<string>()
  for (const name of names) {
    if (name.length >= MENTION_MIN_NAME_LENGTH && text.includes(name)) matched.add(name)
  }
  return [...matched]
}

/**
 * 依据命中的学生与班级决定本轮对象集。纯函数，便于测试与复用。入参按消息里的出现顺序排列。
 */
export function decideMentionObjects(students: MentionedObject[], classes: MentionedObject[]): MentionResolution {
  const picked = pickResolvedObjects(students.length ? students : classes)
  if (!picked.objects.length && !picked.candidates.length) return { kind: 'none' }
  return { kind: 'objects', objects: picked.objects, candidates: picked.candidates.slice(0, MENTION_MAX_CANDIDATES) }
}

/**
 * 把按姓名命中的对象归并成「可自动采用的对象集」与「需要教师点选的候选」：
 * 同名对应多条档案时无法确定是哪一个，整组降级为候选；超出上限的命中同样降级为候选。
 */
function pickResolvedObjects(matched: MentionedObject[]): { objects: MentionedObject[], candidates: MentionedObject[] } {
  const byLabel = new Map<string, MentionedObject[]>()
  for (const item of matched) byLabel.set(item.label, [...(byLabel.get(item.label) || []), item])
  const objects: MentionedObject[] = []
  const candidates: MentionedObject[] = []
  for (const group of byLabel.values()) {
    if (group.length > 1) {
      candidates.push(...group)
      continue
    }
    const item = group[0]!
    if (objects.length >= MENTION_MAX_OBJECTS) {
      candidates.push(item)
      continue
    }
    objects.push(item)
  }
  return { objects, candidates }
}

/** 本轮识别结果怎么用：未绑定会话才作本轮对象；已绑定会话只提示「要不要整组切过去」。 */
export interface EntryObjectUse {
  /** 本轮回答按它收口（仅会话未绑定对象时；可多名） */
  turnObjects: MentionedObject[]
  /** 无法自动确认的候选（同名多条档案 / 超出上限），交界面点选（仅会话未绑定对象时） */
  candidates: MentionedObject[]
  /** 会话已绑定对象、本轮又提到不同的对象集时，提示教师是否整组切换（不自动切换、不参与本轮收口） */
  suggestedSwitch: MentionedObject[]
}

/**
 * 决定本轮识别结果的使用方式。纯函数。
 *
 * 已绑定会话里提到别的对象时，既不静默切换（会改变记忆与方案的作用范围），
 * 也不静默忽略（教师会以为助手已经读过那些对象）——只把「要不要切过去」交给教师点。
 */
export function decideEntryObjectUse(input: {
  binding: ChatContextRef[]
  mention: MentionResolution
}): EntryObjectUse {
  const { binding, mention } = input
  if (mention.kind === 'none') {
    return { turnObjects: [], candidates: [], suggestedSwitch: [] }
  }
  if (!binding.length) {
    return { turnObjects: mention.objects, candidates: mention.candidates, suggestedSwitch: [] }
  }
  const suggested = mention.objects.length && !isSameContextSet(mention.objects, binding)
    ? mention.objects
    : []
  return { turnObjects: [], candidates: mention.candidates, suggestedSwitch: suggested }
}

/**
 * 解析本轮消息里提到的对象。
 *
 * 任何异常都返回 `{ kind: 'none' }`：识别失败只影响便利性，不能影响回答本身，
 * 更不能据此推断「没有这个学生」。
 */
export async function resolveMentionedObjects(
  event: H3Event,
  user: Pick<AuthUser, 'id' | 'schoolId'>,
  message: string
): Promise<MentionResolution> {
  const text = (message || '').trim()
  if (!user.schoolId || text.length < MENTION_MIN_NAME_LENGTH) return { kind: 'none' }
  const db = useDb(event)
  const secret = useRuntimeConfig(event).encryptionKey
  try {
    const [studentRows, classRows] = await Promise.all([
      db.select({ id: schema.students.id, nameEnc: schema.students.nameEnc })
        .from(schema.students)
        .where(and(
          eq(schema.students.schoolId, user.schoolId),
          eq(schema.students.ownerUserId, user.id),
          eq(schema.students.status, 'active')
        ))
        .limit(MENTION_ROSTER_LIMIT),
      db.select({ id: schema.classes.id, name: schema.classes.name })
        .from(schema.classes)
        .where(and(
          eq(schema.classes.schoolId, user.schoolId),
          eq(schema.classes.ownerUserId, user.id),
          eq(schema.classes.status, 'active')
        ))
        .limit(MENTION_ROSTER_LIMIT)
    ])
    const students: MentionedObject[] = studentRows
      .map(row => ({ id: row.id, name: decryptSensitive(row.nameEnc, secret) }))
      .filter(row => matchMentionedNames(text, [row.name]).length > 0)
      .map(row => ({ type: 'student' as const, id: row.id, label: row.name }))
      .sort((a, b) => text.indexOf(a.label) - text.indexOf(b.label))
    const classes: MentionedObject[] = matchMentionedNames(text, classRows.map(row => row.name))
      .map(name => {
        const hit = classRows.find(row => row.name === name)!
        return { type: 'class' as const, id: hit.id, label: hit.name }
      })
      .sort((a, b) => text.indexOf(a.label) - text.indexOf(b.label))
    return decideMentionObjects(students, classes)
  } catch (error) {
    console.warn('[assistant-object-mention] 本轮对象识别失败，按未识别处理:', error instanceof Error ? error.message : error)
    return { kind: 'none' }
  }
}

/**
 * 把一条 AI 对话消息转存为业务记录时的预填读取（学生事件 / 家校沟通共用）。
 *
 * 链路：聊天页气泡的「转存」菜单跳转到目标页并带上 ?chatSessionId=&chatMessageId=；
 * 目标页用本 composable 拉取该消息（服务端按归属校验，越权 404），把正文与关联对象交给
 * 页面打开新建抽屉预填；提交时页面再把这两个 id 作为来源写回记录（见 chat-transfer-source.ts）。
 *
 * 为什么不在聊天页直接带着正文跳转：正文最长 4000 字，塞进 URL 不可靠，
 * 而且跳过服务端的归属校验会把别人的会话内容带进本地页面。
 *
 * 预填对象：优先用消息元数据里的本轮对象（turnObjects，@ 多名学生时的实际作用对象），
 * 没有时回退会话绑定的对象集；只按目标页支持的类型过滤（学生事件只取学生）。
 */
import type { LocationQuery } from 'vue-router'

export interface ChatRecordPrefillObject {
  id: string
  label: string
}

export interface ChatRecordPrefill {
  /** 消息正文（未截断，由调用方按目标字段长度裁剪） */
  text: string
  /** 关联学生（本轮对象优先，回退会话对象集） */
  students: ChatRecordPrefillObject[]
  /** 关联家长（仅家校沟通需要） */
  guardians: ChatRecordPrefillObject[]
  sessionId: string
  messageId: string
}

/** 从消息正文提取记录标题：取首个非空行、去掉常见 markdown 前缀、截断到 40 字。 */
export function deriveRecordTitle(text: string): string {
  const firstLine = (text || '')
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0) || ''
  const cleaned = firstLine
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*>\d.、)）\s]+/, '')
    .replace(/\*\*/g, '')
    .trim()
  if (cleaned.length <= 40) return cleaned
  return `${cleaned.slice(0, 39)}…`
}

/** 按字符截断（超长时以省略号收尾），用于把消息正文裁到目标字段上限内。 */
export function truncateRecordText(text: string, max: number): string {
  const value = text || ''
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

interface SessionMessageLike {
  id?: string
  text?: string
  metadata?: Record<string, unknown> | null
}

interface SessionDetailLike {
  session?: { contexts?: Array<{ type?: string, id?: string, label?: string | null }> | null } | null
  messages?: SessionMessageLike[]
}

/** 把消息元数据 / 会话对象集归一化成 { type, id, label } 列表（丢弃非法项与重复项）。 */
export function pickPrefillObjects(
  messageMetadata: Record<string, unknown> | null | undefined,
  sessionContexts: Array<{ type?: string, id?: string, label?: string | null }> | null | undefined
): Array<{ type: string, id: string, label: string }> {
  const raw: unknown[] = Array.isArray(messageMetadata?.turnObjects)
    ? messageMetadata!.turnObjects as unknown[]
    : (messageMetadata?.turnObject ? [messageMetadata.turnObject] : [])
  const source = raw.length ? raw : (sessionContexts || [])
  const seen = new Set<string>()
  const objects: Array<{ type: string, id: string, label: string }> = []
  for (const item of source) {
    const record = item as { type?: unknown, id?: unknown, label?: unknown }
    const type = typeof record?.type === 'string' ? record.type : ''
    const id = typeof record?.id === 'string' ? record.id : ''
    if (!type || !id) continue
    const key = `${type}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    objects.push({ type, id, label: typeof record?.label === 'string' && record.label ? record.label : '该对象' })
  }
  return objects
}

/**
 * 目标页挂载时读取转存预填。
 * 触发后立刻清掉查询参数（避免刷新重复打开抽屉）；读取失败静默跳过，不阻断手工新建。
 */
export function useChatRecordPrefill(options: {
  /** 目标页是否需要关联家长（家校沟通为 true） */
  withGuardians?: boolean
  /** 拿到预填后打开新建抽屉并写入表单 */
  apply: (prefill: ChatRecordPrefill) => void | Promise<void>
}) {
  const route = useRoute()
  onMounted(async () => {
    const query = route.query as LocationQuery
    const sessionId = typeof query.chatSessionId === 'string' ? query.chatSessionId : ''
    const messageId = typeof query.chatMessageId === 'string' ? query.chatMessageId : ''
    if (!sessionId || !messageId) return
    try {
      await navigateTo({ path: route.path, query: {} }, { replace: true })
    } catch { /* 清理查询参数失败不影响预填 */ }
    try {
      const detail = await $fetch<SessionDetailLike>(`/api/v1/chat/sessions/${sessionId}`)
      const message = (detail.messages || []).find(item => item.id === messageId)
      if (!message) return
      const objects = pickPrefillObjects(message.metadata, detail.session?.contexts)
      await options.apply({
        text: String(message.text || ''),
        students: objects.filter(item => item.type === 'student').map(item => ({ id: item.id, label: item.label })),
        guardians: options.withGuardians
          ? objects.filter(item => item.type === 'guardian').map(item => ({ id: item.id, label: item.label }))
          : [],
        sessionId,
        messageId
      })
    } catch {
      // 预填失败（会话已归档 / 越权 / 网络异常）不提示，教师仍可手工新建
    }
  })
}

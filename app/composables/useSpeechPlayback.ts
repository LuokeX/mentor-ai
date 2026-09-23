/**
 * 回答朗读：按分片取回服务端合成的语音并在浏览器里顺序播放。
 *
 * 设计要点：
 * - 手动朗读由用户点击触发；页面级的「语音对话」自动朗读由调用方在回答定稿后调 play()，
 *   实际能否出声仍取决于浏览器的自动播放策略（教师点开关与发消息都算用户手势，正常可播放）；
 * - 分片「边播边预取下一片」：首片到达即开始播放，播完一片时下一片通常已经就绪；
 * - 分片结果按 messageId 缓存（`Map<string, string[]>` 存 blob URL）：重复点击同一条回答
 *   不重复请求、不重复计费；缓存只保留最近若干条消息的语音，超出即回收 blob URL；
 * - 切换消息、删除消息、切换会话、重新生成以及组件卸载时都要 stop() 复位。
 */
import { onBeforeUnmount, ref } from 'vue'

interface SpeechChunkResponse {
  audio: string
  mime: string
  chunk: { index: number, total: number }
}

/** 最多同时缓存的回答条数（每条最多 20 片，服务端上限）。 */
const MAX_CACHED_MESSAGES = 6

/** 业务错误优先用服务端返回的中文 message；拿不到时用兜底文案，不暴露内部错误。 */
function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const data = (error as { data?: { message?: unknown } }).data
    if (data && typeof data.message === 'string' && data.message.trim()) return data.message.trim()
  }
  return fallback
}

export function useSpeechPlayback() {
  const toast = useToast()
  /** 正在朗读的消息 id（按钮据此显示「停止」并高亮） */
  const speakingId = ref<string | null>(null)
  /** 正在等待首片返回的消息 id（按钮显示加载态） */
  const loadingId = ref<string | null>(null)

  /** messageId → 已下载分片的 blob URL（下标即分片序号） */
  const cache = new Map<string, string[]>()
  /** messageId → 服务端返回的总片数 */
  const totals = new Map<string, number>()
  /** 在途分片请求去重：同一分片并发请求只发一次（预取与主循环共用） */
  const inFlight = new Map<string, Promise<void>>()

  let element: HTMLAudioElement | null = null
  /** 中止当前分片播放的句柄：stop() 调用它让 await 立即结束 */
  let cancelCurrentPlay: (() => void) | null = null
  /** 播放代次：每次 stop/切换自增，旧循环据此静默退出 */
  let token = 0

  /** 停止播放并复位状态（幂等）。 */
  function stop() {
    token += 1
    cancelCurrentPlay?.()
    cancelCurrentPlay = null
    if (element) {
      element.onended = null
      element.onerror = null
      element.pause()
      element.removeAttribute('src')
      element = null
    }
    speakingId.value = null
    loadingId.value = null
  }

  /** 回收超出上限的最早缓存（保留当前正在播放/刚请求的那条）。 */
  function trimCache(keepId: string) {
    for (const [id, urls] of cache) {
      if (cache.size <= MAX_CACHED_MESSAGES) break
      if (id === keepId || id === speakingId.value) continue
      for (const url of urls) if (url) URL.revokeObjectURL(url)
      cache.delete(id)
      totals.delete(id)
    }
  }

  function revokeAll() {
    for (const urls of cache.values()) {
      for (const url of urls) if (url) URL.revokeObjectURL(url)
    }
    cache.clear()
    totals.clear()
    inFlight.clear()
  }

  /** base64 音频 → blob URL（比 data URL 更省内存，也便于统一回收）。 */
  function base64ToObjectUrl(audio: string, mime: string): string {
    const binary = atob(audio)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/mpeg' }))
  }

  /** 取回指定分片（已缓存时直接返回；同一分片并发调用复用同一个请求）。 */
  function loadChunk(messageId: string, index: number): Promise<void> {
    if (cache.get(messageId)?.[index]) return Promise.resolve()
    const key = `${messageId}:${index}`
    const reused = inFlight.get(key)
    if (reused) return reused
    const request = $fetch<SpeechChunkResponse>(`/api/v1/chat/messages/${messageId}/speech`, { query: { chunk: index } })
      .then((result) => {
        const urls = cache.get(messageId) ?? []
        urls[index] = base64ToObjectUrl(result.audio, result.mime)
        cache.set(messageId, urls)
        const total = Number(result.chunk?.total)
        totals.set(messageId, Number.isFinite(total) && total > 0 ? total : index + 1)
        trimCache(messageId)
      })
      .finally(() => { inFlight.delete(key) })
    inFlight.set(key, request)
    return request
  }

  /** 播放单个分片；resolve(true) 表示正常播完，被 stop() 打断或播放失败为 false。 */
  function playChunk(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const audio = new Audio()
      element = audio
      let settled = false
      const finish = (played: boolean) => {
        if (settled) return
        settled = true
        if (cancelCurrentPlay === cancel) cancelCurrentPlay = null
        audio.onended = null
        audio.onerror = null
        resolve(played)
      }
      const cancel = () => finish(false)
      audio.onended = () => finish(true)
      audio.onerror = () => finish(false)
      cancelCurrentPlay = cancel
      audio.preload = 'auto'
      audio.src = url
      // 只在用户点击后调用：不满足自动播放策略时立即失败并给出提示
      void audio.play().catch(() => finish(false))
    })
  }

  /** 顺序播放全部分片，同时预取下一片。 */
  async function playSequence(messageId: string, current: number): Promise<void> {
    let index = 0
    while (current === token) {
      await loadChunk(messageId, index)
      if (current !== token) return
      const url = cache.get(messageId)?.[index]
      if (!url) {
        // 分片取到了却没有可用音频：复位按钮状态，避免停在「停止」态
        stop()
        return
      }
      const total = totals.get(messageId) ?? index + 1
      // 边播边预取：下一片失败不打断当前播放，播到时再取一次
      if (index + 1 < total) void loadChunk(messageId, index + 1).catch(() => undefined)
      if (loadingId.value === messageId) loadingId.value = null
      const played = await playChunk(url)
      if (!played) {
        // 被打断：直接退出；真正的播放失败抛给 toggle 统一提示
        if (current !== token) return
        throw new Error('speech_play_failed')
      }
      if (current !== token) return
      if (index + 1 >= total) break
      index += 1
    }
    if (current === token) stop()
  }

  /**
   * 开始朗读一条回答（自动朗读与手动朗读共用）。
   *
   * silent：失败不弹提示。自动朗读的失败大多是预期内的——浏览器拦截自动播放、服务端返回 409
   * 「该回答没有可朗读的内容」、学校数据模式为 local 时 403——每轮回答都弹一次错误会干扰教师。
   */
  async function play(messageId: string, options: { silent?: boolean } = {}) {
    if (!messageId) return
    // 已经在读（含首片还在加载）的就是同一条：不打断、不重复请求
    if (speakingId.value === messageId || loadingId.value === messageId) return
    stop()
    const current = ++token
    speakingId.value = messageId
    loadingId.value = messageId
    try {
      await playSequence(messageId, current)
    } catch (error) {
      if (current !== token) return
      stop()
      if (!options.silent) toast.add({ title: '语音播放失败', description: errorMessage(error, '请稍后重试。'), color: 'error' })
    }
  }

  /** 点击朗读按钮：同一条消息再次点击即停止，不同消息则切换播放。 */
  async function toggle(messageId: string) {
    if (!messageId) return
    if (speakingId.value === messageId) {
      // 同一条消息（含首片还在加载时）再次点击：立即停止
      stop()
      return
    }
    await play(messageId)
  }

  onBeforeUnmount(() => {
    stop()
    revokeAll()
  })

  return { speakingId, loadingId, toggle, play, stop }
}

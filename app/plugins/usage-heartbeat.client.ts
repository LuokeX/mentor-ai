/**
 * 平台使用量的活跃心跳上报（PRD 8.3 S2 的数据源）。
 *
 * 行为：
 * - 登录后立即上报一次，之后每 USAGE_HEARTBEAT_INTERVAL_SECONDS 秒一次（仅页面可见时）；
 * - 页面从隐藏切回可见且距上次上报已超过一个间隔时补一次；
 * - 未登录 / 退出登录后停止上报；
 * - 全部失败静默：埋点失败不能影响教学业务，服务端还会按会话做节流。
 *
 * 只上报「我还在这里」这一个事实，不带任何业务内容；服务端从会话 Cookie 取用户与会话 id。
 */
import { USAGE_HEARTBEAT_INTERVAL_SECONDS } from '#shared/school-usage'

export default defineNuxtPlugin(() => {
  const { user } = useAuth()
  // 路由类型联合过深（nuxt/nuxt#33735）：这里有意擦除 $fetch 的泛型，避免类型递归超限
  const request = $fetch as unknown as (url: string, options: { method: 'POST' }) => Promise<unknown>
  const intervalMs = USAGE_HEARTBEAT_INTERVAL_SECONDS * 1000
  let timer: ReturnType<typeof setInterval> | null = null
  let lastSentAt = 0

  const send = () => {
    if (document.visibilityState !== 'visible') return
    lastSentAt = Date.now()
    // 有意吞掉失败：心跳是尽力而为的运营埋点
    void request('/api/v1/usage/heartbeat', { method: 'POST' }).catch(() => undefined)
  }

  const onVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return
    if (Date.now() - lastSentAt >= intervalMs) send()
  }

  const start = () => {
    if (timer) return
    send()
    timer = setInterval(send, intervalMs)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  const stop = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  watch(() => user.value?.id, (id) => {
    if (id) start()
    else stop()
  }, { immediate: true })
})

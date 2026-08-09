/**
 * 全局 401 引导：任何业务接口返回 401（会话过期）时，统一改写错误文案并引导回登录页。
 *
 * 背景：三库运营台/业务向导是长填写场景，会话过期后页面毫无感知，直到最后一步
 * 「检查」才爆出「请先登录」，业务会误以为是内容没过检。此处把文案统一为
 * 「登录已过期，请重新登录」（页面 catch 里 error.data.message 会显示它），
 * 并引导回登录页。向导草稿存在 localStorage，登录后回向导页自动恢复，不丢内容。
 *
 * 排除 /api/v1/auth/ 前缀：登录/激活接口自身的 401（如密码错误）不在此列。
 */
export default defineNuxtPlugin((nuxtApp) => {
  const base = globalThis.$fetch as any
  if (!base || typeof base.create !== 'function') return

  let lastRedirectAt = 0
  const THROTTLE_MS = 3000

  const instance = base.create({
    onResponseError({ response }: {
      response: { status: number; url: string; _data?: Record<string, unknown> | null }
    }) {
      if (response.status !== 401) return
      if (String(response.url).includes('/api/v1/auth/')) return
      const data = response._data
      if (data && typeof data.message === 'string') {
        data.message = '登录已过期，请重新登录'
      }
      nuxtApp.runWithContext(() => {
        if (useRoute().path === '/login') return
        const now = Date.now()
        if (now - lastRedirectAt < THROTTLE_MS) return
        lastRedirectAt = now
        useToast().add({ title: '登录已过期，请重新登录', color: 'warning' })
        void navigateTo('/login')
      })
    }
  })

  globalThis.$fetch = instance
  nuxtApp.$fetch = instance
})
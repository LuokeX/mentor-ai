import type { DashboardContext, DashboardPageKey } from '#shared/dashboard'
import { DASHBOARD_PAGES } from '#shared/dashboard'

/**
 * 看板页面级权限兜底（体验层，服务端仍独立鉴权）。
 *
 * - 复用页面自身的 `/api/v1/dashboard/context` 请求（同 key，Nuxt 会自动去重）；
 * - 当前页在平台后台「角色权限配置」被取消「查看」后，自动跳到第一个可用页面
 *   （该页接口本身会返回 403，前端跳转只是避免显示报错）。
 */
export async function useDashboardPageAccess(pageKey: DashboardPageKey) {
  const { data: context } = await useFetch<DashboardContext>('/api/v1/dashboard/context')

  if (import.meta.client) {
    watchEffect(() => {
      const pages = context.value?.pages
      if (!pages?.length || pages.includes(pageKey)) return
      const first = DASHBOARD_PAGES.find(page => pages.includes(page.key))
      if (first) void navigateTo(first.to)
    })
  }

  return { context }
}

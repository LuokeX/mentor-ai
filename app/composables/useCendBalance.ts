/**
 * C 端积分余额（顶栏右上角展示）。
 *
 * 余额不放在 /auth/me 里，避免学校租户的每次身份刷新都多查一次积分；
 * 只在当前激活工作区是 C 端时按需读取。积分发生变化的动作（问答完成、
 * 签到、完善资料）调用 refresh() 更新同一份 useState。
 */
export const useCendBalance = () => {
  const balance = useState<number | null>('cend-point-balance', () => null)
  const { user, tenants } = useAuth()

  const cendTenant = computed(() => tenants.value.find(item => item.kind === 'cend'))
  const isCendWorkspace = computed(() => Boolean(
    cendTenant.value && user.value?.schoolId === cendTenant.value.schoolId
  ))

  // 动态 API 路由很多，统一擦除 $fetch 的路由联合类型（与 useAuth 同一做法）。
  const requestFetch = $fetch as unknown as <T>(url: string) => Promise<T>

  const refresh = async () => {
    // SSR 阶段不请求：该接口依赖登录 Cookie，服务端直接 $fetch 不会带上会话，
    // 401 会被全局 401 插件当成会话过期并重定向到 /login（表现为刷新即退出）。
    // 顶栏余额属于客户端展示，hydration 后由 layout 的 watch 再取。
    if (import.meta.server) return
    if (!isCendWorkspace.value) {
      balance.value = null
      return
    }
    try {
      const data = await requestFetch<{ balance: number }>('/api/v1/cend/points/balance')
      balance.value = data.balance
    } catch {
      // 余额只是辅助展示：接口失败不打断页面，保留上一次的值
    }
  }

  return { balance, isCendWorkspace, refresh }
}

import { pathIsShared, roleHomePath, rolesDomainOfPath, rolesOf } from '~/composables/useAuth'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login' || to.path === '/activate') return
  const { user, refresh, switchRole } = useAuth()
  if (!user.value) await refresh()
  if (!user.value) return navigateTo('/login')

  // 激活角色的落地页：所有回落都以它为准
  const home = roleHomePath(user.value.role)
  // 可访问范围 = 账号持有所有角色的前缀并集；共用区域（/notifications）人人可进，且不触发切换
  if (pathIsShared(to.path)) return

  // 反查目标路径归属哪些角色域（数据驾驶舱由校长/德育主任/年级主任共用）：不属于任何角色域一律回落首页
  const domains = rolesDomainOfPath(to.path)
  if (!domains.length) return navigateTo(home)
  // 当前激活角色本来就能进这个域：直接放行，不需要切换
  if (domains.includes(user.value.role)) return
  // 账号不持有该域内任何角色：按并集规则也没有访问权，回落到激活角色首页
  const targetRole = domains.find(role => rolesOf(user.value).includes(role))
  if (!targetRole) return navigateTo(home)

  // 持有该角色但当前激活的不是它：先切换激活角色再放行，避免进入页面后接口 403。
  // 中间件在 SSR 首屏也会执行（switchRole 内部已按服务端转发 Cookie）。
  try {
    await switchRole(targetRole)
  } catch {
    // 切换失败（会话过期或服务端拒绝）：按落地页规则回到激活角色首页
    return navigateTo(home)
  }
})

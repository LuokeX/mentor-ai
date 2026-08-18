export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login' || to.path === '/activate') return
  const { user, refresh } = useAuth()
  if (!user.value) await refresh()
  if (!user.value) return navigateTo('/login')

  const allowedPrefixes: Record<string, string[]> = {
    teacher: ['/', '/module', '/information', '/notifications', '/growth', '/plans'],
    psychologist: ['/specialist', '/notifications'],
    school_admin: ['/school-admin', '/notifications'],
    platform_admin: ['/platform-admin', '/notifications']
  }
  const allowed = allowedPrefixes[user.value.role] || []
  if (!allowed.some(prefix => prefix === '/' ? to.path === '/' : to.path.startsWith(prefix))) {
    const homes: Record<string, string> = { teacher: '/', psychologist: '/specialist', school_admin: '/school-admin', platform_admin: '/platform-admin' }
    const home = homes[user.value.role] || '/login'
    return navigateTo(home)
  }
})

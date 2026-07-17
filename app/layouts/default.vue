<script setup lang="ts">
const { user, refresh, logout } = useAuth()
await refresh()

const roleHome = computed(() => {
  if (user.value?.role === 'school_admin') return '/school-admin'
  if (user.value?.role === 'platform_admin') return '/platform-admin'
  if (user.value?.role === 'psychologist') return '/specialist'
  return '/'
})
const mobileItems = computed(() => {
  if (user.value?.role === 'teacher') return [
    { label: '工作台', icon: 'i-lucide-house', to: '/' },
    { label: '档案', icon: 'i-lucide-folder-user', to: '/information' },
    { label: '通知', icon: 'i-lucide-bell', to: '/notifications' }
  ]
  return [
    { label: '工作台', icon: 'i-lucide-layout-dashboard', to: roleHome.value },
    { label: '通知', icon: 'i-lucide-bell', to: '/notifications' }
  ]
})
</script>

<template>
  <div class="min-h-screen">
    <header v-if="user" class="sticky top-0 z-40 border-b border-emerald-950/5 bg-[#f8faf6]/90 backdrop-blur-xl">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
        <NuxtLink :to="roleHome" class="flex items-center gap-3">
          <span class="grid size-10 place-items-center rounded-2xl bg-emerald-800 text-lg text-white">六</span>
          <span>
            <strong class="block text-sm">教师赋能智能平台</strong>
            <small class="text-xs text-slate-500">AI · 安全 · 成长</small>
          </span>
        </NuxtLink>
        <nav class="hidden items-center gap-2 md:flex">
          <UButton v-if="user.role === 'teacher'" to="/" variant="ghost" color="neutral">工作台</UButton>
          <UButton v-if="user.role === 'teacher'" to="/information" variant="ghost" color="neutral">信息中心</UButton>
          <UButton v-if="user.role === 'school_admin'" to="/school-admin" variant="ghost" color="neutral">学校管理</UButton>
          <UButton v-if="user.role === 'platform_admin'" to="/platform-admin" variant="ghost" color="neutral">平台管理</UButton>
          <UButton v-if="user.role === 'psychologist'" to="/specialist" variant="ghost" color="neutral">转介工作台</UButton>
        </nav>
        <div class="flex items-center gap-3">
          <div class="hidden text-right sm:block">
            <p class="text-sm font-medium">{{ user.name }}</p>
            <p class="text-xs text-slate-500">{{ user.roleLabel }}</p>
          </div>
          <UButton icon="i-lucide-log-out" color="neutral" variant="soft" aria-label="退出" @click="logout" />
        </div>
      </div>
    </header>
    <main class="pb-20 md:pb-0">
      <slot />
    </main>
    <nav v-if="user" class="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-[max(1rem,env(safe-area-inset-left))] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <div class="mx-auto flex max-w-md justify-around">
        <NuxtLink v-for="item in mobileItems" :key="item.to" :to="item.to" class="flex min-h-16 min-w-20 flex-col items-center justify-center gap-1 text-xs text-slate-500" active-class="!text-emerald-700">
          <UIcon :name="item.icon" class="size-5" /><span>{{ item.label }}</span>
        </NuxtLink>
      </div>
    </nav>
  </div>
</template>

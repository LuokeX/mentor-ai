<script setup lang="ts">
const { user, refresh, logout } = useAuth()
await refresh()

const roleHome = computed(() => {
  if (user.value?.role === 'school_admin') return '/school-admin'
  if (user.value?.role === 'platform_admin') return '/platform-admin'
  if (user.value?.role === 'psychologist') return '/specialist'
  return '/'
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
    <main>
      <slot />
    </main>
  </div>
</template>

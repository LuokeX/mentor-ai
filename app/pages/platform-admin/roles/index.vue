<script setup lang="ts">
interface RoleRow {
  id: string
  code: string
  name: string
  description: string | null
  isSystem: boolean
  updatedAt: string
  recordCount: number
  pageCount: number
}

const { data, pending, refresh, error } = await useFetch<{ roles: RoleRow[] }>('/api/v1/platform-admin/roles')

const roleCodeLabel: Record<string, string> = {
  teacher: '教师',
  psychologist: '心理专员',
  school_admin: '学校管理员',
  platform_admin: '平台管理员',
}
</script>

<template>
  <ManagementPage title="角色管理" description="平台固定四角色；权限清单决定各角色可用的页面级与记录级操作入口。">
    <div v-if="error" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">角色列表加载失败：{{ error.data?.message || '请稍后重试' }}</div>
    <div v-else class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div class="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <p class="text-sm text-gray-500">共 {{ data?.roles?.length || 0 }} 个系统角色</p>
        <UButton icon="i-lucide-refresh-cw" variant="ghost" color="neutral" size="xs" :loading="pending" @click="() => refresh()">
          刷新
        </UButton>
      </div>
      <div v-if="pending && !data" class="space-y-3 p-5">
        <div v-for="i in 4" :key="i" class="h-16 animate-pulse rounded-lg bg-gray-100" />
      </div>
      <div v-else class="divide-y divide-gray-50">
        <div
          v-for="role in data?.roles || []"
          :key="role.id"
          class="group flex cursor-pointer items-center gap-4 px-5 py-4 transition-colors hover:bg-gray-50/60"
          @click="navigateTo(`/platform-admin/roles/${role.id}`)"
        >
          <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700">
            <UIcon name="i-lucide-shield" class="size-5" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="font-medium text-gray-900">{{ role.name }}</p>
              <UBadge variant="subtle" color="neutral" size="xs">{{ role.code }}</UBadge>
              <UBadge v-if="role.isSystem" variant="soft" color="info" size="xs">系统</UBadge>
            </div>
            <p class="mt-0.5 truncate text-sm text-gray-500">{{ role.description || roleCodeLabel[role.code] || '—' }}</p>
          </div>
          <div class="hidden shrink-0 text-right sm:block">
            <p class="text-sm text-gray-600">记录级 {{ role.recordCount }} 项 · 页面级 {{ role.pageCount }} 项</p>
            <p class="mt-0.5 text-xs text-gray-400">更新于 {{ new Date(role.updatedAt).toLocaleString('zh-CN') }}</p>
          </div>
          <UButton icon="i-lucide-chevron-right" variant="ghost" color="neutral" size="sm" class="shrink-0" />
        </div>
      </div>
    </div>
  </ManagementPage>
</template>
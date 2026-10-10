<script setup lang="ts">
import { MANAGED_TARGET_TYPES } from '~~/shared/management'
import { ROLE_LABELS } from '~/composables/useAuth'

interface RoleRow {
  id: string
  code: string
  name: string
  description: string | null
  isSystem: boolean
  updatedAt: string
  isDefault: boolean
  lastChange: { actorName: string | null, createdAt: string } | null
  recordCount: number
  pageCount: number
  targetTypeCount: number
  dashboardPageCount: number
}

const { data, pending, refresh, error } = await useFetch<{ roles: RoleRow[] }>('/api/v1/platform-admin/roles')

/**
 * 角色分组只用于列表展示（业务角色 / 管理角色 / 只读看板角色），
 * 与鉴权无关；角色代码来自 roles 目录表，未知代码落到「其他角色」。
 */
type RoleCategory = 'business' | 'admin' | 'dashboard' | 'other'

const CATEGORY_META: Record<RoleCategory, { label: string, hint: string }> = {
  business: { label: '业务角色', hint: '使用 AI 助手与业务模块的一线角色' },
  admin: { label: '管理角色', hint: '承担校内或平台级管理职责' },
  dashboard: { label: '数据驾驶舱角色（只读）', hint: '只看聚合看板，不进管理框架、不读写业务正文' },
  other: { label: '其他角色', hint: '目录表里出现但代码未登记的角色' }
}
const CATEGORY_ORDER: RoleCategory[] = ['business', 'admin', 'dashboard', 'other']

const ROLE_CATEGORY: Record<string, RoleCategory> = {
  teacher: 'business',
  psychologist: 'business',
  school_admin: 'admin',
  platform_admin: 'admin',
  division_principal: 'dashboard',
  moral_education_director: 'dashboard',
  grade_director: 'dashboard'
}
const ROLE_ICONS: Record<string, string> = {
  teacher: 'i-lucide-graduation-cap',
  psychologist: 'i-lucide-heart-handshake',
  school_admin: 'i-lucide-building-2',
  platform_admin: 'i-lucide-shield-check',
  division_principal: 'i-lucide-chart-line',
  moral_education_director: 'i-lucide-book-open',
  grade_director: 'i-lucide-users-round'
}

function categoryOf(code: string): RoleCategory {
  return ROLE_CATEGORY[code] ?? 'other'
}
function roleLabel(row: RoleRow): string {
  return row.name || ROLE_LABELS[row.code as keyof typeof ROLE_LABELS] || row.code
}

// 目标类型总数：任一角色都可能配置到全部目标类型，用于展示「已覆盖 N/23」
const TARGET_TYPE_TOTAL = MANAGED_TARGET_TYPES.length

const groupedRoles = computed(() => {
  const rows = data.value?.roles ?? []
  return CATEGORY_ORDER
    .map(category => ({ category, meta: CATEGORY_META[category], rows: rows.filter(row => categoryOf(row.code) === category) }))
    .filter(group => group.rows.length > 0)
})
</script>

<template>
  <ManagementPage title="角色权限配置" description="决定每个角色可用的页面入口与记录级操作；业务规则（跨校隔离、负责人、状态门禁）不受勾选影响。">
    <div v-if="error" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">角色列表加载失败：{{ error.data?.message || '请稍后重试' }}</div>

    <template v-else>
      <div class="mb-4 flex items-center justify-between gap-3">
        <p class="text-sm text-gray-500">共 {{ data?.roles?.length || 0 }} 个角色 · 权限变更即时生效并写入审计日志</p>
        <UButton icon="i-lucide-refresh-cw" variant="ghost" color="neutral" size="xs" :loading="pending" @click="() => refresh()">
          刷新
        </UButton>
      </div>

      <div v-if="pending && !data" class="space-y-3">
        <div v-for="i in 4" :key="i" class="h-28 animate-pulse rounded-xl bg-gray-100" />
      </div>

      <div v-else class="space-y-8">
        <section v-for="group in groupedRoles" :key="group.category">
          <div class="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 class="text-sm font-semibold text-gray-900">{{ group.meta.label }}</h2>
            <span class="text-xs text-gray-400">{{ group.meta.hint }}</span>
          </div>

          <div class="grid gap-3 lg:grid-cols-2">
            <button
              v-for="role in group.rows"
              :key="role.id"
              type="button"
              class="flex flex-col rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:border-gray-300 hover:shadow-md"
              @click="navigateTo(`/platform-admin/roles/${role.id}`)"
            >
              <div class="flex items-start gap-3">
                <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700">
                  <UIcon :name="ROLE_ICONS[role.code] || 'i-lucide-shield'" class="size-5" />
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="font-medium text-gray-900">{{ roleLabel(role) }}</p>
                    <UBadge variant="subtle" color="neutral" size="xs">{{ role.code }}</UBadge>
                    <UBadge v-if="role.isSystem" variant="soft" color="info" size="xs">系统</UBadge>
                  </div>
                  <p class="mt-0.5 line-clamp-2 text-sm text-gray-500">{{ role.description || '—' }}</p>
                </div>
                <UBadge v-if="!role.isDefault" variant="soft" color="warning" size="xs" class="shrink-0">已自定义</UBadge>
                <UBadge v-else variant="soft" color="success" size="xs" class="shrink-0">系统默认</UBadge>
              </div>

              <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>页面级 <span class="font-medium text-gray-700">{{ role.pageCount }}</span> 项</span>
                <span>记录级 <span class="font-medium text-gray-700">{{ role.recordCount }}</span> 项</span>
                <span>覆盖 <span class="font-medium text-gray-700">{{ role.targetTypeCount }}/{{ TARGET_TYPE_TOTAL }}</span> 类目标</span>
                <span v-if="role.dashboardPageCount > 0" class="text-emerald-700">驾驶舱 <span class="font-medium">{{ role.dashboardPageCount }}/4</span> 页可见</span>
              </div>

              <div class="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
                <UIcon name="i-lucide-history" class="size-3.5" />
                <span v-if="role.lastChange">
                  最近修改：{{ role.lastChange.actorName || '平台管理员' }} · {{ formatDateTime(role.lastChange.createdAt) }}
                </span>
                <span v-else>暂无权限变更记录</span>
              </div>
            </button>
          </div>
        </section>
      </div>
    </template>
  </ManagementPage>
</template>

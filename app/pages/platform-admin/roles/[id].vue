<script setup lang="ts">
import { MANAGED_TARGET_TYPES } from '~~/shared/management'

interface RoleDetail {
  id: string
  code: string
  name: string
  description: string | null
  isSystem: boolean
  updatedAt: string
  permissions: {
    pages: Record<string, string[]>
    records: Record<string, string[]>
  }
}

const route = useRoute()
const { data: role, pending, refresh } = await useFetch<RoleDetail>(`/api/v1/platform-admin/roles/${route.params.id}`)

const { capabilityLabel, targetTypeLabel } = useDisplayLabels()

/** 页面级可勾选能力 */
const PAGE_CAPABILITIES = ['view', 'create']
/** 记录级可勾选能力（view_sensitive 由敏感授权流程管理，不在清单内展示） */
const RECORD_CAPABILITIES = ['view', 'edit', 'inline_edit', 'archive', 'restore', 'transfer', 'graduate', 'delete', 'disable']

const form = reactive<{ permissions: { pages: Record<string, string[]>, records: Record<string, string[]> } }>({
  permissions: { pages: {}, records: {} },
})
const initialized = ref(false)

watch(role, (value) => {
  if (!value) return
  // 深拷贝一份可编辑副本；保存时整体回传
  form.permissions = {
    pages: Object.fromEntries(Object.entries(value.permissions.pages || {}).map(([k, v]) => [k, [...v]])),
    records: Object.fromEntries(Object.entries(value.permissions.records || {}).map(([k, v]) => [k, [...v]])),
  }
  initialized.value = true
}, { immediate: true })

function hasPerm(group: 'pages' | 'records', targetType: string, cap: string): boolean {
  return form.permissions[group][targetType]?.includes(cap) ?? false
}
function togglePerm(group: 'pages' | 'records', targetType: string, cap: string) {
  const list = form.permissions[group][targetType] ?? (form.permissions[group][targetType] = [])
  const index = list.indexOf(cap)
  if (index >= 0) list.splice(index, 1)
  else list.push(cap)
}

const saving = ref(false)
const saveError = ref('')
const saved = ref(false)
async function savePermissions() {
  if (!role.value) return
  saving.value = true
  saveError.value = ''
  saved.value = false
  try {
    await $fetch(`/api/v1/platform-admin/roles/${role.value.id}`, {
      method: 'PATCH',
      query: { expectedUpdatedAt: role.value.updatedAt },
      body: { permissions: form.permissions },
    })
    saved.value = true
    await refresh()
    window.setTimeout(() => { saved.value = false }, 3000)
  } catch (error: unknown) {
    const response = error as { statusCode?: number, data?: { message?: string } }
    if (response.statusCode === 409) {
      saveError.value = response.data?.message || '角色权限已被其他平台管理员修改，请刷新后重试'
      await refresh()
    } else {
      saveError.value = response.data?.message || '保存失败，请稍后重试'
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ManagementPage title="角色权限" :description="role ? `${role.name}（${role.code}）的权限清单` : '加载中…'">
    <div class="mb-4 flex items-center gap-2">
      <UButton to="/platform-admin/roles" variant="ghost" color="neutral" icon="i-lucide-arrow-left" size="sm">返回角色列表</UButton>
    </div>

    <div v-if="pending && !role" class="space-y-3">
      <div v-for="i in 5" :key="i" class="h-20 animate-pulse rounded-xl bg-gray-100" />
    </div>

    <div v-else-if="role">
      <div class="mb-4 flex flex-wrap items-center gap-2 text-sm text-gray-500">
        <UBadge variant="subtle" color="neutral">{{ role.code }}</UBadge>
        <UBadge v-if="role.isSystem" variant="soft" color="info">系统内置</UBadge>
        <span>权限变更即时生效，并写入审计日志</span>
      </div>

      <div class="space-y-4">
        <div v-for="targetType in MANAGED_TARGET_TYPES" :key="targetType" class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p class="mb-3 flex items-center gap-2 text-sm font-medium text-gray-900">
            <UIcon name="i-lucide-folder-kanban" class="size-4 text-gray-400" />
            {{ targetTypeLabel(targetType) }}
            <span class="text-xs font-normal text-gray-400">{{ targetType }}</span>
          </p>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="rounded-lg bg-gray-50/70 p-3">
              <p class="mb-2 text-xs font-medium text-gray-500">页面级能力（列表页顶部操作）</p>
              <div class="flex flex-wrap gap-x-4 gap-y-1.5">
                <UCheckbox
                  v-for="cap in PAGE_CAPABILITIES"
                  :key="cap"
                  :model-value="hasPerm('pages', targetType, cap)"
                  :label="capabilityLabel(cap)"
                  @update:model-value="() => togglePerm('pages', targetType, cap)"
                />
              </div>
            </div>
            <div class="rounded-lg bg-gray-50/70 p-3">
              <p class="mb-2 text-xs font-medium text-gray-500">记录级能力（行内操作，受行级业务规则约束）</p>
              <div class="flex flex-wrap gap-x-4 gap-y-1.5">
                <UCheckbox
                  v-for="cap in RECORD_CAPABILITIES"
                  :key="cap"
                  :model-value="hasPerm('records', targetType, cap)"
                  :label="capabilityLabel(cap)"
                  @update:model-value="() => togglePerm('records', targetType, cap)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="sticky bottom-0 mt-4 flex items-center gap-3 rounded-xl border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <UButton color="primary" icon="i-lucide-save" :loading="saving" :disabled="!initialized" @click="savePermissions">
          保存权限清单
        </UButton>
        <span v-if="saved" class="text-sm text-green-600">已保存，权限即时生效</span>
        <span v-else-if="saveError" class="text-sm text-red-600">{{ saveError }}</span>
        <span v-else class="text-xs text-gray-400">勾选状态仅在点击保存后生效</span>
      </div>
    </div>

    <div v-else class="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-400">角色不存在或已删除</div>
  </ManagementPage>
</template>
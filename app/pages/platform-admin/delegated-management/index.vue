<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import type { ManagedListResult } from '~~/shared/management'

interface DelegatedRow {
  id: string
  schoolId: string
  schoolName: string
  scopes: string[]
  reason: string
  status: string
  expiresAt: string | null
  createdAt: string
}
interface SchoolRow { id: string; name: string }

const list = useManagedList<DelegatedRow>('/api/v1/platform-admin/delegated-management')
const columns = [
  { key: 'schoolName', label: '学校' },
  { key: 'scopes', label: '授权范围' },
  { key: 'reason', label: '申请事由' },
  { key: 'status', label: '状态' },
  { key: 'expiresAt', label: '到期时间', mobileHidden: true },
  { key: 'createdAt', label: '申请时间', mobileHidden: true },
]
const { data: schoolData } = await useFetch<ManagedListResult<SchoolRow>>('/api/v1/platform-admin/schools', {
  query: { page: 1, pageSize: 100, status: 'active' },
})
const schoolOptions = computed(() => (schoolData.value?.rows || []).map(item => ({ label: item.name, value: item.id })))
const scopeOptions = [
  { label: '账号', value: 'users' },
  { label: '教师', value: 'teachers' },
  { label: '部门', value: 'departments' },
  { label: '班级', value: 'classes' },
  { label: '学生', value: 'students' },
  { label: '家长', value: 'guardians' },
]
const drawerOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const form = reactive({ schoolId: '', scopes: [] as string[], reason: '' })

function openCreate() {
  Object.assign(form, { schoolId: '', scopes: [], reason: '' })
  formError.value = ''
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
}

function toggleScope(scope: string, checked: boolean) {
  form.scopes = checked
    ? [...new Set([...form.scopes, scope])]
    : form.scopes.filter(item => item !== scope)
}

async function submitRequest() {
  if (!form.schoolId || !form.scopes.length || form.reason.trim().length < 10) {
    formError.value = '请选择学校和至少一个范围，并填写至少 10 个字符的申请事由'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    await $fetch('/api/v1/platform-admin/delegated-management/requests', {
      method: 'POST',
      body: { schoolId: form.schoolId, scopes: form.scopes, reason: form.reason },
    })
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '代管申请提交失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ManagementPage title="委托授权" description="向目标学校申请短时、范围受限的基础资料代管权限。" :can-create="list.pageCapabilities.value.includes('create')" create-label="申请代管" @create="openCreate">
    <TableToolbar :loading="list.loading.value" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value">
      <template #scopes-data="{ row }"><div class="flex flex-wrap gap-1"><UBadge v-for="scope in row.scopes" :key="scope" color="neutral" variant="subtle">{{ scope }}</UBadge></div></template>
      <template #reason-data="{ row }"><span class="line-clamp-2 max-w-md text-sm">{{ row.reason }}</span></template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'approved' ? 'success' : row.status === 'pending' ? 'warning' : 'neutral'" variant="subtle">{{ row.status === 'approved' ? '已授权' : row.status === 'pending' ? '待审批' : row.status === 'revoked' ? '已撤销' : '已拒绝' }}</UBadge></template>
      <template #expiresAt-data="{ value }">{{ value ? new Date(String(value)).toLocaleString('zh-CN') : '—' }}</template>
      <template #createdAt-data="{ value }">{{ new Date(String(value)).toLocaleString('zh-CN') }}</template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <EntityFormDrawer :open="drawerOpen" title="申请平台代管" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="submitRequest">
        <UFormField label="目标学校" required><USelect v-model="form.schoolId" :items="schoolOptions" class="w-full" /></UFormField>
        <UFormField label="申请范围" required>
          <div class="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 p-3">
            <UCheckbox v-for="scope in scopeOptions" :key="scope.value" :model-value="form.scopes.includes(scope.value)" :label="scope.label" @update:model-value="toggleScope(scope.value, Boolean($event))" />
          </div>
        </UFormField>
        <UFormField label="申请事由" required><UTextarea v-model="form.reason" :rows="4" placeholder="至少 10 个字符" class="w-full" /></UFormField>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2"><UButton variant="outline" @click="closeDrawer">取消</UButton><UButton type="submit" :loading="saving">提交申请</UButton></div>
      </form>
    </EntityFormDrawer>
  </ManagementPage>
</template>

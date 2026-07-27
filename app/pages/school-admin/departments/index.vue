<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import type { ManagedListResult } from '~~/shared/management'

interface DepartmentRow {
  id: string
  name: string
  code: string | null
  type: string
  parentId: string | null
  leaderUserId: string | null
  leaderName: string | null
  description: string | null
  memberCount: number
  classCount: number
  status: string
  updatedAt: string
}
interface OptionRow { id: string; name: string }

const list = useManagedList<DepartmentRow>('/api/v1/school-admin/departments')
const columns = [
  { key: 'name', label: '部门名称', sortable: true },
  { key: 'code', label: '编码', sortable: true, mobileHidden: true },
  { key: 'type', label: '类型', sortable: true },
  { key: 'leaderName', label: '负责人' },
  { key: 'memberCount', label: '成员数', sortable: true },
  { key: 'classCount', label: '班级数', sortable: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '有效', value: 'active' },
  { label: '已归档', value: 'archived' },
]
const typeOptions = [
  { label: '年级组', value: 'grade_group' },
  { label: '学科组', value: 'subject_group' },
  { label: '行政部门', value: 'administrative' },
  { label: '其他', value: 'other' },
]
const typeLabels = Object.fromEntries(typeOptions.map(item => [item.value, item.label]))
const { data: teacherData } = await useFetch<ManagedListResult<OptionRow>>('/api/v1/school-admin/teachers', {
  query: { page: 1, pageSize: 100, status: 'active' },
})
const teacherOptions = computed(() => [
  { label: '暂不指定', value: '__none__' },
  ...(teacherData.value?.rows || []).map(item => ({ label: item.name, value: item.id })),
])
const parentOptions = computed(() => [
  { label: '无上级部门', value: '__none__' },
  ...list.rows.value
    .filter(item => item.status === 'active' && item.id !== editing.value?.id)
    .map(item => ({ label: item.name, value: item.id })),
])

const drawerOpen = ref(false)
const editing = ref<DepartmentRow | null>(null)
const lifecycle = ref<{ action: 'archive' | 'restore'; row: DepartmentRow } | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({
  name: '',
  code: '',
  type: 'other',
  parentId: '__none__',
  leaderUserId: '__none__',
  description: '',
})

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', code: '', type: 'other', parentId: '__none__', leaderUserId: '__none__', description: '' })
  formError.value = ''
  drawerOpen.value = true
}

function openEdit(rowOrId: DepartmentRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  editing.value = row
  Object.assign(form, {
    name: row.name,
    code: row.code || '',
    type: row.type,
    parentId: row.parentId || '__none__',
    leaderUserId: row.leaderUserId || '__none__',
    description: row.description || '',
  })
  formError.value = ''
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
}

async function saveDepartment() {
  if (!form.name.trim()) {
    formError.value = '请填写部门名称'
    return
  }
  saving.value = true
  formError.value = ''
  const body = {
    name: form.name,
    code: form.code || undefined,
    type: form.type,
    parentId: form.parentId === '__none__' ? null : form.parentId,
    leaderUserId: form.leaderUserId === '__none__' ? null : form.leaderUserId,
    description: form.description || null,
  }
  try {
    if (editing.value) {
      await $fetch(`/api/v1/school-admin/departments/${editing.value.id}`, {
        method: 'PATCH',
        query: { expectedUpdatedAt: editing.value.updatedAt },
        body,
      })
    } else {
      await $fetch('/api/v1/school-admin/departments', { method: 'POST', body })
    }
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { statusCode?: number; data?: { message?: string } }
    formError.value = response.statusCode === 409
      ? '部门已被其他管理员修改，请刷新后重试'
      : response.data?.message || '部门保存失败'
  } finally {
    saving.value = false
  }
}

async function runLifecycle(reason: string) {
  if (!lifecycle.value) return
  saving.value = true
  formError.value = ''
  const { action, row } = lifecycle.value
  try {
    await $fetch(`/api/v1/school-admin/departments/${row.id}/${action}`, {
      method: 'POST',
      body: { expectedUpdatedAt: row.updatedAt, reason },
    })
    lifecycle.value = null
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '部门状态更新失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ManagementPage title="部门管理" description="统一维护组织层级、负责人、成员及班级归属。" :can-create="list.pageCapabilities.value.includes('create')" create-label="创建部门" @create="openCreate">
    <TableToolbar :search-value="list.q.value" :status-filter="list.statusFilter.value" :status-options="statusOptions" search-placeholder="搜索部门名称或编码..." :loading="list.loading.value" @search="list.onSearch" @update:status-filter="list.onStatusChange" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange" @row-click="openEdit">
      <template #type-data="{ value }">{{ typeLabels[String(value)] || value }}</template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle">{{ row.status === 'active' ? '有效' : '已归档' }}</UBadge></template>
      <template #actions-data="{ row }">
        <RowActions
          :capabilities="row._capabilities"
          :row-id="row.id"
          @view="openEdit"
          @edit="openEdit"
          @archive="lifecycle = { action: 'archive', row }"
          @restore="lifecycle = { action: 'restore', row }"
        />
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <EntityFormDrawer :open="drawerOpen" :title="editing ? '编辑部门' : '创建部门'" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="saveDepartment">
        <UFormField label="部门名称" required><UInput v-model="form.name" class="w-full" /></UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="部门编码"><UInput v-model="form.code" class="w-full" /></UFormField>
          <UFormField label="部门类型"><USelect v-model="form.type" :items="typeOptions" class="w-full" /></UFormField>
          <UFormField label="上级部门"><USelect v-model="form.parentId" :items="parentOptions" class="w-full" /></UFormField>
          <UFormField label="负责人"><USelect v-model="form.leaderUserId" :items="teacherOptions" class="w-full" /></UFormField>
        </div>
        <UFormField label="说明"><UTextarea v-model="form.description" :rows="4" class="w-full" /></UFormField>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" @click="closeDrawer">取消</UButton><UButton type="submit" :loading="saving">保存</UButton></div>
      </form>
    </EntityFormDrawer>
    <LifecycleDialog
      :open="Boolean(lifecycle)"
      :action="lifecycle?.action === 'archive' ? '归档部门' : '恢复部门'"
      :target-name="lifecycle?.row.name"
      :loading="saving"
      @close="lifecycle = null"
      @confirm="runLifecycle"
    />
  </ManagementPage>
</template>

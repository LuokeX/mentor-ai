<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import type { ManagedListResult } from '~~/shared/management'

interface ClassRow {
  id: string
  name: string
  grade: number
  studentCount: number
  ownerUserId: string
  ownerName: string
  departmentId: string | null
  departmentName: string | null
  externalCode: string | null
  status: string
  updatedAt: string
}
interface OptionRow { id: string; name: string; status: string }

const list = useManagedList<ClassRow>('/api/v1/school-admin/classes')
const columns = [
  { key: 'name', label: '班级名称', sortable: true },
  { key: 'grade', label: '年级', sortable: true },
  { key: 'ownerName', label: '负责教师' },
  { key: 'departmentName', label: '部门', mobileHidden: true },
  { key: 'studentCount', label: '学生数', sortable: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' }, { label: '在读', value: 'active' },
  { label: '已归档', value: 'archived' }, { label: '已毕业', value: 'graduated' },
]
const { data: teacherData } = await useFetch<ManagedListResult<OptionRow>>('/api/v1/school-admin/teachers', { query: { page: 1, pageSize: 100, status: 'active' } })
const { data: departmentData } = await useFetch<ManagedListResult<OptionRow>>('/api/v1/school-admin/departments', { query: { page: 1, pageSize: 100, status: 'active' } })
const teacherOptions = computed(() => (teacherData.value?.rows || []).map(item => ({ label: item.name, value: item.id })))
const departmentOptions = computed(() => [
  { label: '不指定部门', value: '__none__' },
  ...(departmentData.value?.rows || []).map(item => ({ label: item.name, value: item.id })),
])

const drawerOpen = ref(false)
const editing = ref<ClassRow | null>(null)
const saving = ref(false)
const formError = ref('')
const lifecycle = ref<{ action: 'archive' | 'restore' | 'graduate'; row: ClassRow } | null>(null)
const form = reactive({ name: '', grade: 1, ownerUserId: '', departmentId: '__none__', externalCode: '', studentCount: 0 })

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', grade: 1, ownerUserId: '', departmentId: '__none__', externalCode: '', studentCount: 0 })
  formError.value = ''
  drawerOpen.value = true
}
function openEdit(rowOrId: ClassRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  editing.value = row
  Object.assign(form, {
    name: row.name, grade: row.grade, ownerUserId: row.ownerUserId,
    departmentId: row.departmentId || '__none__', externalCode: row.externalCode || '', studentCount: row.studentCount,
  })
  formError.value = ''
  drawerOpen.value = true
}
async function saveClass() {
  if (!form.name.trim() || !form.ownerUserId) {
    formError.value = '请填写班级名称并选择负责教师'
    return
  }
  saving.value = true
  formError.value = ''
  const body = {
    name: form.name,
    grade: Number(form.grade),
    ownerUserId: form.ownerUserId,
    departmentId: form.departmentId === '__none__' ? null : form.departmentId,
    externalCode: form.externalCode || undefined,
    studentCount: Number(form.studentCount),
    reason: editing.value?.ownerUserId !== form.ownerUserId ? '学校管理员在班级管理表中调整负责教师' : undefined,
  }
  try {
    if (editing.value) {
      await $fetch(`/api/v1/school-admin/classes/${editing.value.id}`, {
        method: 'PATCH',
        query: { expectedUpdatedAt: editing.value.updatedAt },
        body,
      })
    } else {
      await $fetch('/api/v1/school-admin/classes', { method: 'POST', body })
    }
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { statusCode?: number; data?: { message?: string } }
    formError.value = response.statusCode === 409 ? '记录已被其他管理员修改，请刷新后重试' : response.data?.message || '班级保存失败'
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
    await $fetch(`/api/v1/school-admin/classes/${row.id}/${action}`, {
      method: 'POST',
      body: { expectedUpdatedAt: row.updatedAt, reason },
    })
    lifecycle.value = null
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '班级状态更新失败'
  } finally {
    saving.value = false
  }
}

function closeDrawer() {
  drawerOpen.value = false
}
</script>

<template>
  <ManagementPage title="班级管理" description="创建、移交、归档和毕业班级；所有生命周期操作保留审计。" :can-create="list.pageCapabilities.value.includes('create')" create-label="创建班级" @create="openCreate">
    <TableToolbar :search-value="list.q.value" :status-filter="list.statusFilter.value" :status-options="statusOptions" search-placeholder="搜索班级名称..." :loading="list.loading.value" @search="list.onSearch" @update:status-filter="list.onStatusChange" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange" @row-click="openEdit">
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : row.status === 'graduated' ? 'info' : 'neutral'" variant="subtle">{{ row.status === 'active' ? '在读' : row.status === 'graduated' ? '已毕业' : '已归档' }}</UBadge></template>
      <template #actions-data="{ row }">
        <RowActions
          :capabilities="row._capabilities"
          :row-id="row.id"
          @view="openEdit"
          @edit="openEdit"
          @transfer="openEdit"
          @archive="lifecycle = { action: 'archive', row }"
          @restore="lifecycle = { action: 'restore', row }"
          @graduate="lifecycle = { action: 'graduate', row }"
        />
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <EntityFormDrawer :open="drawerOpen" :title="editing ? '编辑班级' : '创建班级'" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="saveClass">
        <UFormField label="班级名称" required><UInput v-model="form.name" class="w-full" /></UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="年级" required><UInput v-model.number="form.grade" type="number" min="1" max="12" class="w-full" /></UFormField>
          <UFormField label="负责教师" required><USelect v-model="form.ownerUserId" :items="teacherOptions" class="w-full" /></UFormField>
          <UFormField label="所属部门"><USelect v-model="form.departmentId" :items="departmentOptions" class="w-full" /></UFormField>
          <UFormField label="外部编号"><UInput v-model="form.externalCode" class="w-full" /></UFormField>
        </div>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" @click="closeDrawer">取消</UButton><UButton type="submit" :loading="saving">保存</UButton></div>
      </form>
    </EntityFormDrawer>
    <LifecycleDialog
      :open="Boolean(lifecycle)"
      :action="lifecycle?.action === 'archive' ? '归档班级' : lifecycle?.action === 'restore' ? '恢复班级' : '设为毕业班'"
      :target-name="lifecycle?.row.name"
      :loading="saving"
      @close="lifecycle = null"
      @confirm="runLifecycle"
    />
  </ManagementPage>
</template>

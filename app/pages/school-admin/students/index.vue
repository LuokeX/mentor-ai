<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import type { ManagedListResult } from '~~/shared/management'

interface StudentRow {
  id: string
  name: string
  gender: string | null
  classId: string | null
  className: string | null
  ownerUserId: string
  ownerName: string
  departmentName: string | null
  status: string
  updatedAt: string
}
interface OptionRow { id: string; name: string }

const list = useManagedList<StudentRow>('/api/v1/school-admin/students')
const columns = [
  { key: 'name', label: '学生姓名', sortable: true },
  { key: 'className', label: '班级', sortable: true },
  { key: 'ownerName', label: '负责教师' },
  { key: 'departmentName', label: '部门', mobileHidden: true },
  { key: 'gender', label: '性别', mobileHidden: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '在读', value: 'active' },
  { label: '已归档', value: 'archived' },
]
const { data: classData } = await useFetch<ManagedListResult<OptionRow>>('/api/v1/school-admin/classes', {
  query: { page: 1, pageSize: 100, status: 'active' },
})
const { data: teacherData } = await useFetch<ManagedListResult<OptionRow>>('/api/v1/school-admin/teachers', {
  query: { page: 1, pageSize: 100, status: 'active' },
})
const classOptions = computed(() => [
  { label: '暂不分班', value: '__none__' },
  ...(classData.value?.rows || []).map(item => ({ label: item.name, value: item.id })),
])
const teacherOptions = computed(() => (teacherData.value?.rows || []).map(item => ({ label: item.name, value: item.id })))

const drawerOpen = ref(false)
const editing = ref<StudentRow | null>(null)
const lifecycle = ref<{ action: 'archive' | 'restore'; row: StudentRow } | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({ name: '', gender: '', classId: '__none__', ownerUserId: '' })

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', gender: '', classId: '__none__', ownerUserId: '' })
  formError.value = ''
  drawerOpen.value = true
}

function openEdit(rowOrId: StudentRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  editing.value = row
  Object.assign(form, {
    name: row.name,
    gender: row.gender || '',
    classId: row.classId || '__none__',
    ownerUserId: row.ownerUserId,
  })
  formError.value = ''
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
}

async function saveStudent() {
  if (!form.name.trim() || !form.ownerUserId) {
    formError.value = '请填写学生姓名并选择负责教师'
    return
  }
  saving.value = true
  formError.value = ''
  const ownerChanged = editing.value?.ownerUserId !== form.ownerUserId
  const body = {
    name: form.name,
    gender: form.gender || null,
    classId: form.classId === '__none__' ? null : form.classId,
    ownerUserId: form.ownerUserId,
    reason: editing.value && ownerChanged ? '学校管理员在学生管理表中调整负责教师' : undefined,
  }
  try {
    if (editing.value) {
      await $fetch(`/api/v1/school-admin/students/${editing.value.id}`, {
        method: 'PATCH',
        query: { expectedUpdatedAt: editing.value.updatedAt },
        body,
      })
    } else {
      await $fetch('/api/v1/school-admin/students', { method: 'POST', body })
    }
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { statusCode?: number; data?: { message?: string } }
    formError.value = response.statusCode === 409
      ? '学生档案已被其他管理员修改，请刷新后重试'
      : response.data?.message || '学生保存失败'
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
    await $fetch(`/api/v1/school-admin/students/${row.id}/${action}`, {
      method: 'POST',
      body: { expectedUpdatedAt: row.updatedAt, reason },
    })
    lifecycle.value = null
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '学生状态更新失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ManagementPage title="学生管理" description="管理全校学生的班级、负责教师和生命周期；不物理删除业务档案。" :can-create="list.pageCapabilities.value.includes('create')" create-label="添加学生" @create="openCreate">
    <TableToolbar :search-value="list.q.value" :status-filter="list.statusFilter.value" :status-options="statusOptions" search-placeholder="输入完整姓名或外部编号..." :loading="list.loading.value" @search="list.onSearch" @update:status-filter="list.onStatusChange" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange" @row-click="openEdit">
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle">{{ row.status === 'active' ? '在读' : '已归档' }}</UBadge></template>
      <template #actions-data="{ row }">
        <RowActions
          :capabilities="row._capabilities"
          :row-id="row.id"
          @view="openEdit"
          @edit="openEdit"
          @transfer="openEdit"
          @archive="lifecycle = { action: 'archive', row }"
          @restore="lifecycle = { action: 'restore', row }"
        />
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <EntityFormDrawer :open="drawerOpen" :title="editing ? '编辑学生' : '添加学生'" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="saveStudent">
        <UFormField label="学生姓名" required><UInput v-model="form.name" class="w-full" /></UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="性别"><UInput v-model="form.gender" class="w-full" /></UFormField>
          <UFormField label="班级"><USelect v-model="form.classId" :items="classOptions" class="w-full" /></UFormField>
          <UFormField label="负责教师" required><USelect v-model="form.ownerUserId" :items="teacherOptions" class="w-full" /></UFormField>
        </div>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" @click="closeDrawer">取消</UButton><UButton type="submit" :loading="saving">保存</UButton></div>
      </form>
    </EntityFormDrawer>
    <LifecycleDialog
      :open="Boolean(lifecycle)"
      :action="lifecycle?.action === 'archive' ? '归档学生' : '恢复学生'"
      :target-name="lifecycle?.row.name"
      :loading="saving"
      @close="lifecycle = null"
      @confirm="runLifecycle"
    />
  </ManagementPage>
</template>

<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import type { ManagedListResult } from '~~/shared/management'

interface StudentRow {
  id: string
  name: string
  classId: string | null
  className: string | null
  gender: string | null
  status: string
  updatedAt: string
}

interface ClassOption {
  id: string
  name: string
  status: string
}

const list = useManagedList<StudentRow>('/api/v1/information/students')
const columns = [
  { key: 'name', label: '学生姓名', sortable: true },
  { key: 'className', label: '班级' },
  { key: 'gender', label: '性别', mobileHidden: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'updatedAt', label: '最近更新', sortable: true, mobileHidden: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '在读', value: 'active' },
  { label: '已归档', value: 'archived' },
]

const drawerOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const form = reactive({ name: '', classId: '', gender: '', notes: '' })
const { data: classData } = await useFetch<ManagedListResult<ClassOption>>('/api/v1/information/classes', {
  query: { page: 1, pageSize: 100, status: 'active' },
})
const classOptions = computed(() => (classData.value?.rows || []).map(item => ({ label: item.name, value: item.id })))

function openCreate() {
  Object.assign(form, { name: '', classId: '', gender: '', notes: '' })
  formError.value = ''
  drawerOpen.value = true
}

async function createStudent() {
  if (!form.name.trim() || !form.classId) {
    formError.value = '请填写学生姓名并选择班级'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    await $fetch('/api/v1/information/entities', {
      method: 'POST',
      body: {
        type: 'student',
        name: form.name,
        classId: form.classId,
        gender: form.gender || undefined,
        notes: form.notes || undefined,
      },
    })
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '学生创建失败'
  } finally {
    saving.value = false
  }
}

function openStudent(id: string) {
  void navigateTo(`/information/students/${id}`)
}

function openStudentRow(row: StudentRow) {
  openStudent(row.id)
}

function closeDrawer() {
  drawerOpen.value = false
}
</script>

<template>
  <ManagementPage
    title="我负责的学生"
    description="维护您负责班级中的学生档案；归档和跨教师移交由学校管理员处理。"
    :can-create="list.pageCapabilities.value.includes('create')"
    create-label="添加学生"
    @create="openCreate"
  >
    <TableToolbar
      :search-value="list.q.value"
      :status-filter="list.statusFilter.value"
      :status-options="statusOptions"
      search-placeholder="输入完整姓名搜索..."
      :loading="list.loading.value"
      @search="list.onSearch"
      @update:status-filter="list.onStatusChange"
      @refresh="list.refresh"
    />
    <ManagedDataTable
      :columns="columns"
      :rows="list.rows.value"
      :loading="list.loading.value"
      :sort="list.sort.value"
      :order="list.order.value"
      @sort="list.onSortChange"
      @row-click="openStudentRow"
    >
      <template #status-data="{ row }">
        <UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle" size="xs">
          {{ row.status === 'active' ? '在读' : '已归档' }}
        </UBadge>
      </template>
      <template #updatedAt-data="{ value }">{{ new Date(String(value)).toLocaleDateString('zh-CN') }}</template>
      <template #actions-data="{ row }">
        <RowActions
          :capabilities="row._capabilities"
          :row-id="row.id"
          @view="openStudent"
          @edit="openStudent"
        />
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ list.error.value }}</div>
    <TablePagination
      :page="list.page.value"
      :page-size="list.pageSize.value"
      :total="list.total.value"
      @update:page="list.onPageChange"
      @update:page-size="list.onPageSizeChange"
    />

    <EntityFormDrawer :open="drawerOpen" title="添加学生" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="createStudent">
        <UFormField label="学生姓名" required><UInput v-model="form.name" class="w-full" /></UFormField>
        <UFormField label="所在班级" required><USelect v-model="form.classId" :items="classOptions" class="w-full" /></UFormField>
        <UFormField label="性别"><UInput v-model="form.gender" class="w-full" /></UFormField>
        <UFormField label="备注"><UTextarea v-model="form.notes" :rows="4" class="w-full" /></UFormField>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="closeDrawer">取消</UButton>
          <UButton type="submit" :loading="saving">保存</UButton>
        </div>
      </form>
    </EntityFormDrawer>
  </ManagementPage>
</template>

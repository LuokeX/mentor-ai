<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import type { ManagedListResult } from '~~/shared/management'

interface EventRow {
  id: string
  studentId: string
  studentName: string
  eventType: string
  severity: string
  title: string
  description: string | null
  resolution: string | null
  occurredAt: string
  status: string
  updatedAt: string
}
interface StudentOption { id: string; name: string }

const list = useManagedList<EventRow>('/api/v1/information/student-events')
const columns = [
  { key: 'title', label: '事件标题' },
  { key: 'studentName', label: '学生' },
  { key: 'eventType', label: '类型', sortable: true, mobileHidden: true },
  { key: 'severity', label: '严重程度', sortable: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'occurredAt', label: '发生时间', sortable: true, mobileHidden: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '待处理', value: 'open' },
  { label: '已解决', value: 'resolved' },
  { label: '已关闭', value: 'closed' },
]
const eventTypes = ['违纪', '冲突', '异常行为', '学业波动', '其他'].map(value => ({ label: value, value }))
const severities = ['低', '中', '高', '严重'].map(value => ({ label: value, value }))
const statuses = [
  { label: '待处理', value: 'open' },
  { label: '已解决', value: 'resolved' },
  { label: '已关闭', value: 'closed' },
]
const { data: studentData } = await useFetch<ManagedListResult<StudentOption>>('/api/v1/information/students', { query: { page: 1, pageSize: 100, status: 'active' } })
const studentOptions = computed(() => (studentData.value?.rows || []).map(item => ({ label: item.name, value: item.id })))

const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({
  studentId: '',
  title: '',
  eventType: '其他',
  severity: '低',
  description: '',
  resolution: '',
  status: 'open',
  occurredAt: '',
  updatedAt: '',
})

function openCreate() {
  editingId.value = null
  Object.assign(form, {
    studentId: '', title: '', eventType: '其他', severity: '低',
    description: '', resolution: '', status: 'open',
    occurredAt: new Date().toISOString().slice(0, 16), updatedAt: '',
  })
  formError.value = ''
  drawerOpen.value = true
}

function openEdit(rowOrId: EventRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  editingId.value = row.id
  Object.assign(form, {
    studentId: row.studentId,
    title: row.title,
    eventType: row.eventType,
    severity: row.severity,
    description: row.description || '',
    resolution: row.resolution || '',
    status: row.status,
    occurredAt: new Date(row.occurredAt).toISOString().slice(0, 16),
    updatedAt: row.updatedAt,
  })
  formError.value = ''
  drawerOpen.value = true
}

async function saveEvent() {
  if (!form.studentId || !form.title.trim()) {
    formError.value = '请选择学生并填写事件标题'
    return
  }
  saving.value = true
  formError.value = ''
  const body = {
    title: form.title,
    eventType: form.eventType,
    severity: form.severity,
    description: form.description || undefined,
    resolution: form.resolution || undefined,
    status: form.status,
    occurredAt: new Date(form.occurredAt).toISOString(),
  }
  try {
    if (editingId.value) {
      await $fetch(`/api/v1/information/student-events/${editingId.value}`, {
        method: 'PATCH',
        query: { expectedUpdatedAt: form.updatedAt },
        body,
      })
    } else {
      await $fetch('/api/v1/information/student-events', {
        method: 'POST',
        body: { ...body, studentId: form.studentId },
      })
    }
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { statusCode?: number; data?: { message?: string } }
    formError.value = response.statusCode === 409 ? '事件已被其他用户修改，请重新打开后再编辑' : response.data?.message || '事件保存失败'
  } finally {
    saving.value = false
  }
}

function closeDrawer() {
  drawerOpen.value = false
}

async function archiveEvent(eventId: string) {
  if (!confirm('确定归档这条学生事件吗？归档后历史记录保留，仅归档处理。')) return
  try {
    await $fetch(`/api/v1/information/student-events/${eventId}`, { method: 'DELETE' })
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { data?: { message?: string } }
    formError.value = response.data?.message || '归档失败，请重试'
  }
}
</script>

<template>
  <ManagementPage title="学生事件记录" description="记录、解决和关闭学生事件，历史记录不物理删除。" :can-create="list.pageCapabilities.value.includes('create')" create-label="新增学生事件" @create="openCreate">
    <TableToolbar
      :search-value="list.q.value"
      :status-filter="list.statusFilter.value"
      :status-options="statusOptions"
      search-placeholder="搜索事件标题..."
      :loading="list.loading.value"
      @search="list.onSearch"
      @update:status-filter="list.onStatusChange"
      @refresh="list.refresh"
    />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange" @row-click="openEdit">
      <template #severity-data="{ value }"><UBadge :color="value === '严重' ? 'error' : value === '高' ? 'warning' : 'neutral'" variant="subtle">{{ value }}</UBadge></template>
      <template #status-data="{ value }"><UBadge :color="value === 'open' ? 'warning' : value === 'resolved' ? 'success' : 'neutral'" variant="subtle">{{ value === 'open' ? '待处理' : value === 'resolved' ? '已解决' : '已关闭' }}</UBadge></template>
      <template #occurredAt-data="{ value }">{{ new Date(String(value)).toLocaleString('zh-CN') }}</template>
      <template #actions-data="{ row }"><RowActions :capabilities="row._capabilities" :row-id="row.id" @view="openEdit" @edit="openEdit" @archive="archiveEvent" /></template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <EntityFormDrawer :open="drawerOpen" :title="editingId ? '编辑学生事件' : '新增学生事件'" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="saveEvent">
        <UFormField label="学生" required><USelect v-model="form.studentId" :items="studentOptions" :disabled="Boolean(editingId)" class="w-full" /></UFormField>
        <UFormField label="标题" required><UInput v-model="form.title" class="w-full" /></UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="类型"><USelect v-model="form.eventType" :items="eventTypes" class="w-full" /></UFormField>
          <UFormField label="严重程度"><USelect v-model="form.severity" :items="severities" class="w-full" /></UFormField>
          <UFormField label="状态"><USelect v-model="form.status" :items="statuses" :disabled="!editingId" class="w-full" /></UFormField>
          <UFormField label="发生时间"><UInput v-model="form.occurredAt" type="datetime-local" class="w-full" /></UFormField>
        </div>
        <UFormField label="事件说明"><UTextarea v-model="form.description" :rows="4" class="w-full" /></UFormField>
        <UFormField label="处理结果"><UTextarea v-model="form.resolution" :rows="3" class="w-full" /></UFormField>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" @click="closeDrawer">取消</UButton><UButton type="submit" :loading="saving">保存</UButton></div>
      </form>
    </EntityFormDrawer>
  </ManagementPage>
</template>

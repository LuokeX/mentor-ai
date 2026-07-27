<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import type { ManagedListResult } from '~~/shared/management'

interface ReferralRow {
  id: string
  priority: string
  severity: string
  status: string
  teacherName: string
  psychologistId: string | null
  acknowledgedAt: string | null
  createdAt: string
}
interface PsychologistRow { id: string; name: string }

const list = useManagedList<ReferralRow>('/api/v1/school-admin/referrals')
const columns = [
  { key: 'priority', label: '优先级' },
  { key: 'severity', label: '风险级别' },
  { key: 'teacherName', label: '发起教师' },
  { key: 'status', label: '状态' },
  { key: 'psychologistId', label: '心理专员' },
  { key: 'createdAt', label: '创建时间', mobileHidden: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '待确认', value: 'created' },
  { label: '已确认', value: 'acknowledged' },
  { label: '线下处置', value: 'offline_handling' },
  { label: '已升级', value: 'escalated' },
  { label: '已关闭', value: 'closed' },
]
const { data: psychologistData } = await useFetch<ManagedListResult<PsychologistRow>>('/api/v1/school-admin/users', {
  query: { page: 1, pageSize: 100, role: 'psychologist', status: 'active' },
})
const psychologistOptions = computed(() => (psychologistData.value?.rows || []).map(item => ({ label: item.name, value: item.id })))
const psychologistNames = computed(() => new Map((psychologistData.value?.rows || []).map(item => [item.id, item.name])))
const assigning = ref<ReferralRow | null>(null)
const form = reactive({ psychologistId: '', reason: '' })
const saving = ref(false)
const actionError = ref('')

function openAssign(id: string) {
  const row = list.rows.value.find(item => item.id === id)
  if (!row) return
  if (!row._capabilities.includes('transfer')) {
    actionError.value = '该工单已确认或结束，仅可查看状态，不能再次转派'
    return
  }
  actionError.value = ''
  assigning.value = row
  Object.assign(form, { psychologistId: row.psychologistId || '', reason: '' })
}

function closeAssign() {
  assigning.value = null
}

async function assignReferral() {
  if (!assigning.value || !form.psychologistId || form.reason.trim().length < 10) {
    actionError.value = '请选择心理专员并填写至少 10 个字符的转派事由'
    return
  }
  saving.value = true
  actionError.value = ''
  try {
    await $fetch(`/api/v1/school-admin/referrals/${assigning.value.id}/assign`, {
      method: 'PATCH',
      body: { psychologistId: form.psychologistId, reason: form.reason },
    })
    assigning.value = null
    await list.refresh()
  } catch (error: unknown) {
    actionError.value = (error as { data?: { message?: string } }).data?.message || '转介分配失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ManagementPage title="转介管理" description="监督本校危机转介 SLA，并仅在尚未确认时转派心理专员。">
    <TableToolbar :status-filter="list.statusFilter.value" :status-options="statusOptions" :loading="list.loading.value" @update:status-filter="list.onStatusChange" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange">
      <template #priority-data="{ row }"><UBadge :color="row.priority === 'urgent' ? 'error' : 'warning'" variant="subtle">{{ row.priority }}</UBadge></template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'closed' ? 'neutral' : row.status === 'created' || row.status === 'escalated' ? 'error' : 'success'" variant="subtle">{{ row.status }}</UBadge></template>
      <template #psychologistId-data="{ value }">{{ value ? psychologistNames.get(String(value)) || String(value).slice(0, 8) : '未分配' }}</template>
      <template #createdAt-data="{ value }">{{ new Date(String(value)).toLocaleString('zh-CN') }}</template>
      <template #actions-data="{ row }"><RowActions :capabilities="row._capabilities" :row-id="row.id" @view="openAssign" @transfer="openAssign" /></template>
    </ManagedDataTable>
    <div v-if="list.error.value || actionError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ actionError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <UModal :open="Boolean(assigning)" @update:open="value => { if (!value) assigning = null }">
      <template #header><h3 class="text-lg font-semibold">转派心理专员</h3></template>
      <template #body>
        <div class="space-y-4">
          <UFormField label="心理专员" required><USelect v-model="form.psychologistId" :items="psychologistOptions" class="w-full" /></UFormField>
          <UFormField label="转派事由" required><UTextarea v-model="form.reason" :rows="3" class="w-full" /></UFormField>
        </div>
      </template>
      <template #footer><div class="flex justify-end gap-2"><UButton variant="outline" @click="closeAssign">取消</UButton><UButton :loading="saving" @click="assignReferral">确认转派</UButton></div></template>
    </UModal>
  </ManagementPage>
</template>

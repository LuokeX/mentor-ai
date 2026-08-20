<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'

interface AccessRequestRow {
  id: string
  requesterName: string
  targetType: string
  targetId: string
  reasonCategory: string
  reasonText: string
  status: string
  expiresAt: string | null
  createdAt: string
}

const list = useManagedList<AccessRequestRow>('/api/v1/school-admin/access-requests')
const columns = [
  { key: 'requesterName', label: '申请人' },
  { key: 'targetType', label: '目标类型' },
  { key: 'reasonText', label: '申请事由' },
  { key: 'status', label: '状态' },
  { key: 'createdAt', label: '申请时间', mobileHidden: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '待审批', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '已拒绝', value: 'rejected' },
]
const review = ref<{ row: AccessRequestRow; decision: 'approved' | 'rejected' } | null>(null)
const saving = ref(false)
const actionError = ref('')

async function submitReview() {
  if (!review.value) return
  saving.value = true
  actionError.value = ''
  try {
    await $fetch(`/api/v1/school-admin/access-requests/${review.value.row.id}/review`, {
      method: 'POST',
      body: { decision: review.value.decision },
    })
    review.value = null
    await list.refresh()
  } catch (error: unknown) {
    actionError.value = (error as { data?: { message?: string } }).data?.message || '审批失败'
  } finally {
    saving.value = false
  }
}

function closeReview() {
  review.value = null
}

function openReview(row: AccessRequestRow, decision: 'approved' | 'rejected') {
  review.value = { row, decision }
}
</script>

<template>
  <ManagementPage title="授权审批" description="审批本校管理员的目标级敏感档案访问申请；授权有效期由服务端强制限制。">
    <TableToolbar :status-filter="list.statusFilter.value" :status-options="statusOptions" :loading="list.loading.value" @update:status-filter="list.onStatusChange" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange">
      <template #reasonText-data="{ row }"><span class="line-clamp-2 max-w-md text-sm">{{ row.reasonText }}</span></template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'pending' ? 'warning' : row.status === 'approved' ? 'success' : 'neutral'" variant="subtle">{{ row.status === 'pending' ? '待审批' : row.status === 'approved' ? '已通过' : '已拒绝' }}</UBadge></template>
      <template #createdAt-data="{ value }">{{ formatDateTime(value) }}</template>
      <template #actions-data="{ row }">
        <div v-if="row.status === 'pending'" class="flex gap-1">
          <UButton size="xs" color="success" variant="soft" @click="openReview(row, 'approved')">通过</UButton>
          <UButton size="xs" color="error" variant="soft" @click="openReview(row, 'rejected')">拒绝</UButton>
        </div>
        <span v-else class="text-xs text-gray-400">已处理</span>
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value || actionError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ actionError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <UModal :open="Boolean(review)" @update:open="value => { if (!value) review = null }">
      <template #header><h3 class="text-lg font-semibold">{{ review?.decision === 'approved' ? '通过访问申请' : '拒绝访问申请' }}</h3></template>
      <template #body>
        <div class="space-y-3 text-sm">
          <p>申请人：{{ review?.row.requesterName }}</p>
          <p>目标：{{ review?.row.targetType }} / {{ review?.row.targetId }}</p>
          <p class="rounded-lg bg-gray-50 p-3">{{ review?.row.reasonText }}</p>
          <p v-if="review?.decision === 'approved'" class="text-amber-700">通过后仅获得目标级临时只读权限，访问仍会记录审计。</p>
        </div>
      </template>
      <template #footer><div class="flex justify-end gap-2"><UButton variant="outline" @click="closeReview">取消</UButton><UButton :color="review?.decision === 'approved' ? 'success' : 'error'" :loading="saving" @click="submitReview">确认</UButton></div></template>
    </UModal>
  </ManagementPage>
</template>

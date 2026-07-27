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
interface DelegatedRequestRow {
  id: string
  requesterName: string
  scopes: string[]
  reason: string
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
const delegatedList = useManagedList<DelegatedRequestRow>('/api/v1/school-admin/delegated-management')
const delegatedColumns = [
  { key: 'requesterName', label: '平台申请人' },
  { key: 'scopes', label: '申请范围' },
  { key: 'reason', label: '申请事由' },
  { key: 'status', label: '状态' },
  { key: 'expiresAt', label: '到期时间', mobileHidden: true },
  { key: 'actions', label: '操作' },
]
const delegatedReview = ref<{ row: DelegatedRequestRow; decision: 'approved' | 'rejected' | 'revoked' } | null>(null)
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

async function submitDelegatedReview() {
  if (!delegatedReview.value) return
  saving.value = true
  actionError.value = ''
  try {
    await $fetch(`/api/v1/school-admin/delegated-management/${delegatedReview.value.row.id}/review`, {
      method: 'POST',
      body: { decision: delegatedReview.value.decision },
    })
    delegatedReview.value = null
    await delegatedList.refresh()
  } catch (error: unknown) {
    actionError.value = (error as { data?: { message?: string } }).data?.message || '代管审批失败'
  } finally {
    saving.value = false
  }
}

function closeDelegatedReview() {
  delegatedReview.value = null
}

function openDelegatedReview(row: DelegatedRequestRow, decision: 'approved' | 'rejected' | 'revoked') {
  delegatedReview.value = { row, decision }
}
</script>

<template>
  <ManagementPage title="授权审批" description="审批本校管理员的目标级敏感档案访问申请；授权有效期由服务端强制限制。">
    <TableToolbar :status-filter="list.statusFilter.value" :status-options="statusOptions" :loading="list.loading.value" @update:status-filter="list.onStatusChange" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange">
      <template #reasonText-data="{ row }"><span class="line-clamp-2 max-w-md text-sm">{{ row.reasonText }}</span></template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'pending' ? 'warning' : row.status === 'approved' ? 'success' : 'neutral'" variant="subtle">{{ row.status === 'pending' ? '待审批' : row.status === 'approved' ? '已通过' : '已拒绝' }}</UBadge></template>
      <template #createdAt-data="{ value }">{{ new Date(String(value)).toLocaleString('zh-CN') }}</template>
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

    <div class="mt-8 border-t border-gray-200 pt-6">
      <h2 class="text-base font-semibold text-gray-900">平台代管授权</h2>
      <p class="mt-1 text-sm text-gray-500">平台管理员只能申请基础管理范围；批准后最长有效 30 分钟，可随时撤销。</p>
    </div>
    <ManagedDataTable :columns="delegatedColumns" :rows="delegatedList.rows.value" :loading="delegatedList.loading.value">
      <template #scopes-data="{ row }"><div class="flex flex-wrap gap-1"><UBadge v-for="scope in row.scopes" :key="scope" color="neutral" variant="subtle">{{ scope }}</UBadge></div></template>
      <template #reason-data="{ row }"><span class="line-clamp-2 max-w-md text-sm">{{ row.reason }}</span></template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'approved' ? 'success' : row.status === 'pending' ? 'warning' : 'neutral'" variant="subtle">{{ row.status }}</UBadge></template>
      <template #expiresAt-data="{ value }">{{ value ? new Date(String(value)).toLocaleString('zh-CN') : '—' }}</template>
      <template #actions-data="{ row }">
        <div class="flex gap-1">
          <template v-if="row.status === 'pending'">
            <UButton size="xs" color="success" variant="soft" @click="openDelegatedReview(row, 'approved')">通过</UButton>
            <UButton size="xs" color="error" variant="soft" @click="openDelegatedReview(row, 'rejected')">拒绝</UButton>
          </template>
          <UButton v-else-if="row.status === 'approved'" size="xs" color="error" variant="soft" @click="openDelegatedReview(row, 'revoked')">撤销</UButton>
          <span v-else class="text-xs text-gray-400">已结束</span>
        </div>
      </template>
    </ManagedDataTable>
    <TablePagination :page="delegatedList.page.value" :page-size="delegatedList.pageSize.value" :total="delegatedList.total.value" @update:page="delegatedList.onPageChange" @update:page-size="delegatedList.onPageSizeChange" />

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
    <UModal :open="Boolean(delegatedReview)" @update:open="value => { if (!value) delegatedReview = null }">
      <template #header><h3 class="text-lg font-semibold">{{ delegatedReview?.decision === 'approved' ? '批准平台代管' : delegatedReview?.decision === 'revoked' ? '撤销平台代管' : '拒绝平台代管' }}</h3></template>
      <template #body>
        <div class="space-y-3 text-sm">
          <p>申请人：{{ delegatedReview?.row.requesterName }}</p>
          <p>范围：{{ delegatedReview?.row.scopes.join('、') }}</p>
          <p class="rounded-lg bg-gray-50 p-3">{{ delegatedReview?.row.reason }}</p>
        </div>
      </template>
      <template #footer><div class="flex justify-end gap-2"><UButton variant="outline" @click="closeDelegatedReview">取消</UButton><UButton :color="delegatedReview?.decision === 'approved' ? 'success' : 'error'" :loading="saving" @click="submitDelegatedReview">确认</UButton></div></template>
    </UModal>
  </ManagementPage>
</template>

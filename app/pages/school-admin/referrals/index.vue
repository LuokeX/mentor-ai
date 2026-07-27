<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
const { rows, total, page, pageSize, sort, order, loading, error, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; priority: string; status: string; psychologistId: string; createdAt: string; updatedAt: string }>('/api/v1/school-admin/referrals')
const columns = [{ key: 'priority', label: '优先级' }, { key: 'status', label: '状态' }, { key: 'psychologistId', label: '专员' }, { key: 'createdAt', label: '创建时间' }]
</script>
<template>
  <ManagementPage title="转介管理" description="管理心理转介工单">
    <TableToolbar :loading="loading" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #priority-data="{ row }"><UBadge :color="row.priority === 'urgent' ? 'error' : 'warning'" variant="subtle" size="xs">{{ row.priority }}</UBadge></template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'created' ? 'info' : row.status === 'acknowledged' ? 'warning' : row.status === 'closed' ? 'neutral' : 'success'" variant="subtle" size="xs">{{ row.status }}</UBadge></template>
      <template #psychologistId-data="{ row }"><span class="text-xs text-gray-500 font-mono">{{ row.psychologistId?.slice(0, 8) || '—' }}</span></template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
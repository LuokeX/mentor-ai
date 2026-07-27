<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
const { rows, total, page, pageSize, sort, order, loading, error, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; requesterId: string; targetType: string; status: string; createdAt: string }>('/api/v1/school-admin/access-requests')
const columns = [{ key: 'requesterId', label: '申请人' }, { key: 'targetType', label: '目标类型' }, { key: 'status', label: '状态' }, { key: 'createdAt', label: '申请时间' }]
</script>
<template>
  <ManagementPage title="授权审批" description="管理敏感数据访问授权申请">
    <TableToolbar :loading="loading" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #status-data="{ row }"><UBadge :color="row.status === 'pending' ? 'warning' : row.status === 'approved' ? 'success' : 'neutral'" variant="subtle" size="xs">{{ row.status === 'pending' ? '待审批' : row.status === 'approved' ? '已通过' : '已拒绝' }}</UBadge></template>
      <template #requesterId-data="{ row }"><span class="text-xs text-gray-500 font-mono">{{ row.requesterId?.slice(0, 8) }}</span></template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
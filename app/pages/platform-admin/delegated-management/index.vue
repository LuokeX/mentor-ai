<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
const { rows, total, page, pageSize, q, sort, order, loading, error, pageCapabilities, onSearch, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; schoolId: string; status: string; createdAt: string }>('/api/v1/platform-admin/delegated-management')
const columns = [{ key: 'schoolId', label: '学校' }, { key: 'status', label: '状态' }, { key: 'createdAt', label: '申请时间' }]
</script>
<template>
  <ManagementPage title="委托授权" description="管理平台代管授权">
    <TableToolbar :search-value="q" :loading="loading" @search="onSearch" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #status-data="{ row }"><UBadge :color="row.status === 'approved' ? 'success' : row.status === 'pending' ? 'warning' : 'neutral'" variant="subtle" size="xs">{{ row.status === 'approved' ? '已授权' : row.status === 'pending' ? '待审批' : '已撤销' }}</UBadge></template>
      <template #schoolId-data="{ row }"><span class="text-xs text-gray-500 font-mono">{{ row.schoolId?.slice(0, 8) }}</span></template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
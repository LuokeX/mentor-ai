<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
const { rows, total, page, pageSize, q, sort, order, loading, error, onSearch, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; action: string; targetType: string; actorId: string; result: string; createdAt: string }>('/api/v1/platform-admin/audit-logs')
const columns = [{ key: 'action', label: '操作' }, { key: 'targetType', label: '类型' }, { key: 'actorId', label: '操作人' }, { key: 'result', label: '结果' }, { key: 'createdAt', label: '时间' }]
</script>
<template>
  <ManagementPage title="审计日志" description="平台级操作审计记录">
    <TableToolbar :loading="loading" search-placeholder="搜索操作或目标类型..." :search-value="q" @search="onSearch" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #result-data="{ row }"><UBadge :color="row.result === 'success' ? 'success' : 'error'" variant="subtle" size="xs">{{ row.result }}</UBadge></template>
      <template #createdAt-data="{ value }">{{ new Date(String(value)).toLocaleString('zh-CN') }}</template>
      <template #actorId-data="{ row }"><span class="text-xs text-gray-500 font-mono">{{ row.actorId?.slice(0, 8) }}</span></template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
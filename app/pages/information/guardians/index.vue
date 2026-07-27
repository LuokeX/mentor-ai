<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import { useCapabilities } from '~/composables/useCapabilities'
const { rows, total, page, pageSize, q, statusFilter, sort, order, loading, error, pageCapabilities, onSearch, onStatusChange, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; relation: string; status: string; updatedAt: string }>('/api/v1/information/guardians')
const columns = [{ key: 'id', label: 'ID' }, { key: 'relation', label: '关系' }, { key: 'status', label: '状态' }, { key: 'actions', label: '操作' }]
const statusOptions = [{ label: '全部', value: 'all' }, { label: '有效', value: 'active' }, { label: '已归档', value: 'archived' }]
</script>
<template>
  <ManagementPage title="家长管理" description="管理您负责的学生家长档案" :can-create="pageCapabilities.includes('create')" create-label="添加家长">
    <TableToolbar :search-value="q" :status-filter="statusFilter" :status-options="statusOptions" search-placeholder="搜索家长..." :loading="loading" @search="onSearch" @update:status-filter="onStatusChange" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle" size="xs">{{ row.status === 'active' ? '有效' : '已归档' }}</UBadge></template>
      <template #id-data="{ row }"><span class="text-xs text-gray-500 font-mono">{{ row.id.slice(0, 8) }}</span></template>
      <template #actions-data="{ row }"><RowActions :capabilities="row._capabilities" :row-id="row.id" /></template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
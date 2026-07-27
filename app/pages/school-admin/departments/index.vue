<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
const { rows, total, page, pageSize, q, statusFilter, sort, order, loading, error, pageCapabilities, onSearch, onStatusChange, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; name: string; type: string; code: string; status: string; updatedAt: string }>('/api/v1/school-admin/departments')
const columns = [{ key: 'name', label: '部门名称' }, { key: 'code', label: '编码' }, { key: 'type', label: '类型' }, { key: 'status', label: '状态' }, { key: 'actions', label: '操作' }]
const statusOpts = [{ label: '全部', value: 'all' }, { label: '有效', value: 'active' }, { label: '已归档', value: 'archived' }]
</script>
<template>
  <ManagementPage title="部门管理" description="管理部门组织架构" :can-create="pageCapabilities.includes('create')" create-label="创建部门">
    <TableToolbar :search-value="q" :status-filter="statusFilter" :status-options="statusOpts" search-placeholder="搜索部门名称..." :loading="loading" @search="onSearch" @update:status-filter="onStatusChange" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle" size="xs">{{ row.status === 'active' ? '有效' : '已归档' }}</UBadge></template>
      <template #actions-data="{ row }"><RowActions :capabilities="row._capabilities" :row-id="row.id" /></template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
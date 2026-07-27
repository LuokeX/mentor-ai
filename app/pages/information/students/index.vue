<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import { useCapabilities } from '~/composables/useCapabilities'
const { rows, total, page, pageSize, q, statusFilter, sort, order, loading, error, pageCapabilities, onSearch, onStatusChange, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; classId: string; gender: string; status: string; updatedAt: string }>('/api/v1/information/students')
const columns = [{ key: 'id', label: 'ID' }, { key: 'classId', label: '班级' }, { key: 'gender', label: '性别' }, { key: 'status', label: '状态' }, { key: 'actions', label: '操作' }]
const statusOptions = [{ label: '全部', value: 'all' }, { label: '在读', value: 'active' }, { label: '已归档', value: 'archived' }]
</script>
<template>
  <ManagementPage title="学生管理" description="管理您负责的学生档案" :can-create="pageCapabilities.includes('create')" create-label="添加学生">
    <TableToolbar :search-value="q" :status-filter="statusFilter" :status-options="statusOptions" search-placeholder="搜索学生..." :loading="loading" @search="onSearch" @update:status-filter="onStatusChange" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle" size="xs">{{ row.status === 'active' ? '在读' : '已归档' }}</UBadge></template>
      <template #classId-data="{ row }"><span class="text-xs text-gray-500 font-mono">{{ row.classId?.slice(0, 8) }}</span></template>
      <template #id-data="{ row }"><span class="text-xs text-gray-500 font-mono">{{ row.id.slice(0, 8) }}</span></template>
      <template #actions-data="{ row }"><RowActions :capabilities="row._capabilities" :row-id="row.id" /></template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
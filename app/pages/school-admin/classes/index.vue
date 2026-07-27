<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
const { rows, total, page, pageSize, q, statusFilter, sort, order, loading, error, pageCapabilities, onSearch, onStatusChange, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; name: string; grade: number; studentCount: number; status: string; updatedAt: string }>('/api/v1/school-admin/classes')
const columns = [{ key: 'name', label: '班级名称' }, { key: 'grade', label: '年级' }, { key: 'studentCount', label: '学生数' }, { key: 'status', label: '状态' }, { key: 'actions', label: '操作' }]
const statusOpts = [{ label: '全部', value: 'all' }, { label: '在读', value: 'active' }, { label: '已归档', value: 'archived' }, { label: '已毕业', value: 'graduated' }]
</script>
<template>
  <ManagementPage title="班级管理" description="管理全校班级档案" :can-create="pageCapabilities.includes('create')" create-label="创建班级">
    <TableToolbar :search-value="q" :status-filter="statusFilter" :status-options="statusOpts" search-placeholder="搜索班级名称..." :loading="loading" @search="onSearch" @update:status-filter="onStatusChange" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : row.status === 'archived' ? 'neutral' : 'info'" variant="subtle" size="xs">{{ row.status === 'active' ? '在读' : row.status === 'archived' ? '已归档' : '已毕业' }}</UBadge></template>
      <template #actions-data="{ row }"><RowActions :capabilities="row._capabilities" :row-id="row.id" /></template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
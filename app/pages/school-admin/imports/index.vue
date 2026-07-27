<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
const { rows, total, page, pageSize, sort, order, loading, error, pageCapabilities, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; importType: string; status: string; totalRows: number; createdRows: number; errorCount: number; createdAt: string }>('/api/v1/school-admin/imports')
const columns = [{ key: 'importType', label: '导入类型' }, { key: 'status', label: '状态' }, { key: 'totalRows', label: '总行数' }, { key: 'createdRows', label: '新增' }, { key: 'errorCount', label: '错误' }, { key: 'createdAt', label: '导入时间' }]
</script>
<template>
  <ManagementPage title="导入管理" description="管理数据导入记录">
    <TableToolbar :loading="loading" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #status-data="{ row }"><UBadge :color="row.status === 'completed' ? 'success' : row.status === 'processing' ? 'info' : 'warning'" variant="subtle" size="xs">{{ row.status }}</UBadge></template>
    </ManagedDataTable>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
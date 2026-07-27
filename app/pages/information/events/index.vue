<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import { useCapabilities } from '~/composables/useCapabilities'
const { rows, total, page, pageSize, statusFilter, sort, order, loading, error, pageCapabilities, onStatusChange, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; eventType: string; severity: string; title: string; occurredAt: string; status: string; updatedAt: string }>('/api/v1/information/student-events')
const columns = [{ key: 'title', label: '事件标题' }, { key: 'eventType', label: '类型' }, { key: 'severity', label: '严重程度' }, { key: 'status', label: '状态' }, { key: 'actions', label: '操作' }]
const statusOpts = [{ label: '全部', value: 'all' }, { label: '待处理', value: 'open' }, { label: '已解决', value: 'resolved' }, { label: '已关闭', value: 'closed' }]
const sevColor = (s: string) => s === '严重' ? 'error' : s === '高' ? 'warning' : s === '中' ? 'warning' : 'success'
const statusLabel = (s: string) => s === 'open' ? '待处理' : s === 'resolved' ? '已解决' : s === 'closed' ? '已关闭' : s
</script>
<template>
  <ManagementPage title="学生事件" description="管理学生事件记录" :can-create="pageCapabilities.includes('create')" create-label="记录事件">
    <TableToolbar :status-filter="statusFilter" :status-options="statusOpts" :loading="loading" @update:status-filter="onStatusChange" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #status-data="{ row }"><UBadge :color="row.status === 'open' ? 'warning' : row.status === 'resolved' ? 'success' : 'neutral'" variant="subtle" size="xs">{{ statusLabel(row.status) }}</UBadge></template>
      <template #severity-data="{ row }"><UBadge :color="sevColor(row.severity)" variant="subtle" size="xs">{{ row.severity }}</UBadge></template>
      <template #actions-data="{ row }"><RowActions :capabilities="row._capabilities" :row-id="row.id" /></template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
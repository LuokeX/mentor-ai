<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
const { rows, total, page, pageSize, sort, order, loading, error, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; eventType: string; planId: string; createdAt: string }>('/api/v1/school-admin/plan-operations')
const columns = [{ key: 'eventType', label: '事件类型' }, { key: 'planId', label: '方案ID' }, { key: 'createdAt', label: '时间' }]
</script>
<template>
  <ManagementPage title="运维管理" description="方案运维事件记录">
    <TableToolbar :loading="loading" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #planId-data="{ row }"><span class="text-xs text-gray-500 font-mono">{{ row.planId?.slice(0, 8) || '—' }}</span></template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import { useCapabilities } from '~/composables/useCapabilities'
const { rows, total, page, pageSize, q, sort, order, loading, error, pageCapabilities, onSearch, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; parentType: string; riskLevel: string; occurredAt: string; updatedAt: string }>('/api/v1/information/communications')
const columns = [{ key: 'parentType', label: '家长类型' }, { key: 'riskLevel', label: '风险等级' }, { key: 'occurredAt', label: '发生时间' }, { key: 'actions', label: '操作' }]
const riskColor = (r: string) => r === 'high' ? 'error' : r === 'medium' ? 'warning' : 'success'
</script>
<template>
  <ManagementPage title="沟通记录" description="管理家校沟通记录" :can-create="pageCapabilities.includes('create')" create-label="记录沟通">
    <TableToolbar :search-value="q" search-placeholder="搜索沟通记录..." :loading="loading" @search="onSearch" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #riskLevel-data="{ row }"><UBadge :color="riskColor(row.riskLevel)" variant="subtle" size="xs">{{ row.riskLevel === 'high' ? '高' : row.riskLevel === 'medium' ? '中' : '低' }}</UBadge></template>
      <template #actions-data="{ row }"><RowActions :capabilities="row._capabilities" :row-id="row.id" /></template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
const { rows, total, page, pageSize, q, sort, order, loading, error, pageCapabilities, onSearch, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; name: string; code: string; status: string; updatedAt: string }>('/api/v1/platform-admin/schools')
const columns = [{ key: 'name', label: '学校名称' }, { key: 'code', label: '编码' }, { key: 'status', label: '状态' }, { key: 'actions', label: '操作' }]
</script>
<template>
  <ManagementPage title="学校管理" description="管理平台注册学校" :can-create="pageCapabilities.includes('create')" create-label="注册学校">
    <TableToolbar :search-value="q" search-placeholder="搜索学校..." :loading="loading" @search="onSearch" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle" size="xs">{{ row.status === 'active' ? '正常' : '停用' }}</UBadge></template>
      <template #actions-data="{ row }"><RowActions :capabilities="row._capabilities" :row-id="row.id" /></template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
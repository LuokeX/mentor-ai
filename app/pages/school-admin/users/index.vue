<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import { useCapabilities } from '~/composables/useCapabilities'
const { rows, total, page, pageSize, q, sort, order, loading, error, pageCapabilities, onSearch, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; name: string; email: string; role: string; status: string; activatedAt: string; updatedAt: string }>('/api/v1/school-admin/users')
const columns = [{ key: 'name', label: '姓名' }, { key: 'email', label: '邮箱' }, { key: 'role', label: '角色' }, { key: 'status', label: '状态' }, { key: 'actions', label: '操作' }]
const roleLabels: Record<string, string> = { teacher: '班主任', psychologist: '心理专员', school_admin: '学校管理员' }
const statusLabel = (s: string) => s === 'active' ? '正常' : s === 'invited' ? '已邀请' : s === 'disabled' ? '已停用' : s
</script>
<template>
  <ManagementPage title="账号管理" description="管理本校教师和心理专员账号" :can-create="pageCapabilities.includes('create')" create-label="邀请用户">
    <TableToolbar :search-value="q" search-placeholder="搜索姓名或邮箱..." :loading="loading" @search="onSearch" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #role-data="{ row }"><span class="text-sm text-gray-600">{{ roleLabels[row.role] || row.role }}</span></template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : row.status === 'invited' ? 'info' : 'neutral'" variant="subtle" size="xs">{{ statusLabel(row.status) }}</UBadge></template>
      <template #actions-data="{ row }"><RowActions :capabilities="row._capabilities" :row-id="row.id" /></template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>
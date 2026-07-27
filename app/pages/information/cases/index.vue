<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
const { rows, total, page, pageSize, statusFilter, sort, order, loading, error, onStatusChange, onSortChange, onPageChange, onPageSizeChange, refresh } = useManagedList<{ id: string; title: string; module: string; status: string; updatedAt: string }>('/api/v1/information/cases')
const columns = [{ key: 'title', label: '标题' }, { key: 'module', label: '模块' }, { key: 'status', label: '状态' }, { key: 'updatedAt', label: '最近更新', sortable: true, mobileHidden: true }]
const statusOpts = [{ label: '全部', value: 'all' }, { label: '进行中', value: 'active' }, { label: '已关闭', value: 'closed' }, { label: '已归档', value: 'archived' }]
const moduleLabel = (m: string) => ({ self_growth: '个人成长', class_system: '班级系统', home_school: '家校沟通', student_case: '学生个案', learning_problem: '学习问题' })[m] || m
</script>
<template>
  <ManagementPage title="支持案例" description="支持案例由评估和方案工作流生成，不作为普通 CRUD 记录处理。">
    <TableToolbar :status-filter="statusFilter" :status-options="statusOpts" :loading="loading" @update:status-filter="onStatusChange" @refresh="refresh" />
    <ManagedDataTable :columns="columns" :rows="rows" :loading="loading" :sort="sort" :order="order" @sort="onSortChange">
      <template #module-data="{ row }"><span class="text-xs text-gray-500">{{ moduleLabel(row.module) }}</span></template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : row.status === 'closed' ? 'neutral' : 'info'" variant="subtle" size="xs">{{ row.status === 'active' ? '进行中' : row.status === 'closed' ? '已关闭' : '已归档' }}</UBadge></template>
      <template #updatedAt-data="{ value }">{{ new Date(String(value)).toLocaleDateString('zh-CN') }}</template>
    </ManagedDataTable>
    <div v-if="error" class="text-center py-8 text-red-500 text-sm">{{ error }}</div>
    <TablePagination :page="page" :page-size="pageSize" :total="total" @update:page="onPageChange" @update:page-size="onPageSizeChange" />
  </ManagementPage>
</template>

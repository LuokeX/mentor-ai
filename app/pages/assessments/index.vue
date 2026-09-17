<script setup lang="ts">
/**
 * 评估记录列表（专项评估菜单）。
 *
 * 一条记录 = 一个评估组：同一问题下连续提交的多张量表聚合在一条里，
 * 所以行数与方案数大致对应，不会出现同一份方案重复出现好几次。
 *
 * 安全熔断的记录也是普通一行：点进去能看到当时的转介处置指引。
 * 这是教师在方案列表之外唯一能找到被冻结方案的入口——所以状态文案用
 * 「安全转介」，不出现「熔断 / 危机 / 预警」等词。
 */
import { moduleMeta } from '#shared/assessments'
import { useManagedList } from '~/composables/useManagedList'

interface RecordPlanRef {
  id: string
  title: string
  titleFull: string | null
  status: string
  frozenBeforeAcceptance: boolean
}

interface AssessmentRecordRow {
  id: string
  module: string
  moduleTitle: string
  status: 'active' | 'completed' | 'referred'
  objectType: string | null
  objectLabel: string | null
  level: string | null
  levelName: string | null
  severity: string | null
  instrumentCodes: string[]
  instrumentNames: string[]
  instrumentCount: number
  lastSubmittedAt: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  hasReport: boolean
  canContinue: boolean
  plan: RecordPlanRef | null
}

const moduleTab = ref('all')

const {
  rows, total, page, pageSize, q, statusFilter, sort, order, loading, error,
  onSearch, onStatusChange, onSortChange, onPageChange, onPageSizeChange, refresh, fetchList, resetPage
} = useManagedList<AssessmentRecordRow>('/api/v1/assessments/records', {
  extraQuery: () => ({
    module: moduleTab.value !== 'all' ? moduleTab.value : undefined
  })
})

const moduleTabs = [
  { label: '全部', value: 'all' },
  ...Object.entries(moduleMeta).map(([value, meta]) => ({ label: meta.title, value }))
]

function onModuleChange(value: string) {
  moduleTab.value = value
  resetPage()
  fetchList()
}

const columns = [
  { key: 'module', label: '模块', sortable: true, class: 'w-44 max-w-44 min-w-0' },
  { key: 'summary', label: '评估内容', class: 'w-80 max-w-80 min-w-0' },
  { key: 'status', label: '状态', class: 'w-28 max-w-28' },
  { key: 'levelName', label: '结论', class: 'w-28 max-w-28' },
  { key: 'plan', label: '关联方案', class: 'w-64 max-w-64 min-w-0' },
  { key: 'lastSubmittedAt', label: '最近评估', sortable: true, class: 'w-32 max-w-32' }
]

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '进行中', value: 'active' },
  { label: '已完成', value: 'completed' },
  { label: '安全转介', value: 'referred' }
]

const STATUS_TEXT: Record<string, string> = {
  active: '进行中',
  completed: '已完成',
  referred: '安全转介'
}
const STATUS_COLOR: Record<string, 'info' | 'success' | 'error'> = {
  active: 'info',
  completed: 'success',
  referred: 'error'
}
const SEVERITY_COLOR: Record<string, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
  low: 'success',
  medium: 'info',
  high: 'warning',
  crisis: 'error'
}

const moduleTitle = (module: string) =>
  (moduleMeta as Record<string, { title: string }>)[module]?.title || module

const OBJECT_TYPE_TEXT: Record<string, string> = { student: '学生', class: '班级', guardian: '家长' }

function objectText(row: AssessmentRecordRow) {
  if (!row.objectType || !row.objectLabel) return null
  return `${OBJECT_TYPE_TEXT[row.objectType] || '对象'} · ${row.objectLabel}`
}

const router = useRouter()
</script>

<template>
  <ManagementPage
    title="评估记录"
    description="你完成的每一次模块评估，含结论、组内量表与关联方案"
    :can-create="false"
  >
    <!-- 模块页签：全部 + 五模块，与方案列表保持一致 -->
    <div class="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="按模块筛选评估记录">
      <UButton
        v-for="tab in moduleTabs"
        :key="tab.value"
        size="sm"
        :variant="moduleTab === tab.value ? 'solid' : 'soft'"
        :color="moduleTab === tab.value ? 'primary' : 'neutral'"
        class="shrink-0"
        @click="onModuleChange(tab.value)"
      >
        {{ tab.label }}
      </UButton>
    </div>

    <div class="mb-4">
      <TableToolbar
        :search-value="q"
        :status-filter="statusFilter"
        :status-options="statusOptions"
        search-placeholder="搜索量表或方案标题..."
        :loading="loading"
        @search="onSearch"
        @update:status-filter="onStatusChange"
        @refresh="refresh"
      />
    </div>

    <ManagedDataTable
      v-if="loading || rows.length"
      :columns="columns"
      :rows="rows"
      :loading="loading"
      :sort="sort"
      :order="order"
      @sort="onSortChange"
      @row-click="(row: AssessmentRecordRow) => router.push(`/assessments/${row.id}`)"
    >
      <template #module-data="{ row }">
        <div class="min-w-0">
          <p class="truncate">{{ moduleTitle(row.module) }}</p>
          <p v-if="objectText(row)" class="mt-0.5 truncate text-xs text-slate-400">{{ objectText(row) }}</p>
        </div>
      </template>
      <template #summary-data="{ row }">
        <NuxtLink :to="`/assessments/${row.id}`" class="block truncate font-medium text-emerald-700 hover:underline">
          {{ row.instrumentNames.join('、') || moduleTitle(row.module) }}
        </NuxtLink>
        <p v-if="row.instrumentCount > 1" class="mt-0.5 text-xs text-slate-400">共 {{ row.instrumentCount }} 张量表</p>
      </template>
      <template #status-data="{ row }">
        <UBadge :color="STATUS_COLOR[row.status] || 'neutral'" variant="soft" size="md">
          {{ STATUS_TEXT[row.status] || row.status }}
        </UBadge>
      </template>
      <template #levelName-data="{ row }">
        <UBadge
          v-if="row.status !== 'referred' && (row.levelName || row.level)"
          :color="SEVERITY_COLOR[row.severity || ''] || 'neutral'"
          variant="soft"
          size="md"
        >
          {{ row.levelName || row.level }}
        </UBadge>
        <span v-else-if="row.status === 'referred'" class="text-xs text-slate-400">已转介处置</span>
        <span v-else class="text-xs text-slate-400">—</span>
      </template>
      <template #plan-data="{ row }">
        <NuxtLink
          v-if="row.plan"
          :to="`/plans/${row.plan.id}`"
          class="flex min-w-0 items-center gap-1.5 text-emerald-700 hover:underline"
        >
          <span class="truncate">{{ row.plan.title }}</span>
          <UBadge v-if="row.plan.frozenBeforeAcceptance" color="error" variant="soft" size="sm">已停止</UBadge>
        </NuxtLink>
        <span v-else-if="row.canContinue" class="text-xs text-slate-400">评估进行中，尚未生成方案</span>
        <span v-else class="text-xs text-slate-400">未生成方案</span>
      </template>
      <template #lastSubmittedAt-data="{ row }">{{ formatDate(row.lastSubmittedAt) }}</template>
    </ManagedDataTable>

    <div v-if="error" class="py-8 text-center text-sm text-red-500">{{ error }}</div>
    <div v-else-if="!loading && !rows.length" class="py-12 text-center text-sm text-slate-400">
      还没有评估记录。完成一次模块评估后，这里会保留每次的结论与关联方案。
    </div>

    <TablePagination
      :page="page"
      :page-size="pageSize"
      :total="total"
      @update:page="onPageChange"
      @update:page-size="onPageSizeChange"
    />
  </ManagementPage>
</template>

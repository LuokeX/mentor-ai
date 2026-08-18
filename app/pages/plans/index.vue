<script setup lang="ts">
/**
 * 方案列表。
 *
 * 补这一页之前，方案只能从「提交评估后的那一次 CTA」「工作台今日动作」
 * 「事件中心待复盘」三个入口进入。方案一旦不逾期也不待复盘，就再也点不到——
 * 教师做完的工作在系统里等于消失了。
 */
import { moduleMeta } from '#shared/assessments'
import { useManagedList } from '~/composables/useManagedList'

interface PlanRow {
  id: string
  title: string
  titleFull?: string | null
  sourceType?: string | null
  module: string
  status: string
  attributionKeywords?: string[]
  instrumentSnapshots?: Array<{ code: string, name: string, version: string, sequence: number }>
  nextReviewAt: string | null
  completedAt: string | null
  updatedAt: string
}

const moduleTab = ref('all')
const reviewFrom = ref('')
const reviewTo = ref('')

const {
  rows, total, page, pageSize, q, statusFilter, sort, order, loading, error,
  onSearch, onStatusChange, onSortChange, onPageChange, onPageSizeChange, refresh, fetchList, resetPage
} = useManagedList<PlanRow>('/api/v1/plans', {
  extraQuery: () => ({
    module: moduleTab.value !== 'all' ? moduleTab.value : undefined,
    reviewFrom: reviewFrom.value || undefined,
    reviewTo: reviewTo.value || undefined,
  }),
})

const moduleTabs = [
  { label: '全部', value: 'all' },
  ...Object.entries(moduleMeta).map(([value, meta]) => ({ label: meta.title, value })),
]

function onModuleChange(value: string) {
  moduleTab.value = value
  resetPage()
  fetchList()
}

watch([reviewFrom, reviewTo], () => {
  resetPage()
  fetchList()
})

const columns = [
  { key: 'title', label: '方案标题', sortable: true, class: 'w-80 max-w-80 min-w-0' },
  { key: 'module', label: '模块', class: 'w-44 max-w-44 min-w-0' },
  { key: 'status', label: '状态', class: 'w-28 max-w-28' },
  { key: 'nextReviewAt', label: '复盘日期', sortable: true, class: 'w-32 max-w-32' },
  { key: 'updatedAt', label: '最近更新', sortable: true, class: 'w-32 max-w-32' },
]

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '进行中', value: 'active' },
  { label: '待确认', value: 'pending_acceptance' },
  { label: '待复盘', value: 'review_due' },
  { label: '需调整', value: 'adjustment_needed' },
  { label: '需协同', value: 'escalated' },
  { label: '已完成', value: 'completed' },
  { label: '已关闭', value: 'closed' },
]

// 与方案详情页保持同一套文案和配色，避免同一状态在两个页面长得不一样
const STATUS_TEXT: Record<string, string> = {
  pending_acceptance: '待确认', accepted: '已接受', in_progress: '进行中',
  review_due: '待复盘', adjustment_needed: '需调整', escalated: '需协同',
  completed: '已完成', closed: '已关闭', archived: '已归档'
}
const STATUS_COLOR: Record<string, 'info' | 'success' | 'neutral' | 'warning' | 'error'> = {
  pending_acceptance: 'warning', accepted: 'info', in_progress: 'info',
  review_due: 'warning', adjustment_needed: 'warning', escalated: 'error',
  completed: 'success', closed: 'neutral', archived: 'neutral'
}

const moduleTitle = (module: string) =>
  (moduleMeta as Record<string, { title: string }>)[module]?.title || module

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('zh-CN') : '—'

/** 复盘日期已过且方案未结束时标红，让教师一眼看到该处理哪个 */
function reviewOverdue(row: PlanRow) {
  if (!row.nextReviewAt || row.completedAt) return false
  return new Date(row.nextReviewAt).getTime() < Date.now()
}

const router = useRouter()
</script>

<template>
  <ManagementPage
    title="方案"
    description="由评估生成的行动方案，含执行、复盘与质量反馈记录"
    :can-create="false"
  >
    <!-- 模块页签：全部 + 五模块，横向滚动 -->
    <div class="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="按模块筛选方案">
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

    <!-- 复盘日期 + 工具栏同一行（窄屏自动换行） -->
    <div class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
      <div class="min-w-0 flex-1">
        <TableToolbar
          :search-value="q"
          :status-filter="statusFilter"
          :status-options="statusOptions"
          search-placeholder="搜索方案标题..."
          :loading="loading"
          @search="onSearch"
          @update:status-filter="onStatusChange"
          @refresh="refresh"
        />
      </div>
      <div class="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <UIcon name="i-lucide-calendar-range" class="size-4 text-slate-400" />
        <span class="shrink-0 text-slate-500">复盘日期</span>
        <UInput v-model="reviewFrom" type="date" class="w-40" aria-label="复盘开始日期" />
        <span class="text-slate-400">至</span>
        <UInput v-model="reviewTo" type="date" class="w-40" aria-label="复盘结束日期" />
      </div>
    </div>

    <ManagedDataTable
      :columns="columns"
      :rows="rows"
      :loading="loading"
      :sort="sort"
      :order="order"
      @sort="onSortChange"
      @row-click="(row: PlanRow) => router.push(`/plans/${row.id}`)"
    >
      <template #title-data="{ row }">
        <UTooltip
          v-if="row.titleFull && row.titleFull !== row.title"
          :text="row.titleFull"
          class="block min-w-0"
          :popper="{ placement: 'top', strategy: 'fixed' }"
        >
          <NuxtLink :to="`/plans/${row.id}`" class="block truncate font-medium text-emerald-700 hover:underline">
            {{ row.title }}
          </NuxtLink>
        </UTooltip>
        <NuxtLink v-else :to="`/plans/${row.id}`" class="block truncate font-medium text-emerald-700 hover:underline">
          {{ row.title }}
        </NuxtLink>
      </template>
      <template #module-data="{ row }">
        <div class="min-w-0">
          <p class="truncate">{{ moduleTitle(row.module) }}</p>
          <p v-if="row.instrumentSnapshots?.length" class="mt-0.5 truncate text-xs text-slate-400" :title="row.instrumentSnapshots.map(item => item.name).join('、')">
            {{ row.instrumentSnapshots.slice(0, 2).map(item => item.name).join('、') }}{{ row.instrumentSnapshots.length > 2 ? ` 等 ${row.instrumentSnapshots.length} 份量表` : '' }}
          </p>
          <p v-if="row.attributionKeywords?.length" class="mt-0.5 truncate text-xs text-slate-400">
            {{ row.attributionKeywords.join('、') }}
          </p>
        </div>
      </template>
      <template #status-data="{ row }">
        <UBadge :color="STATUS_COLOR[row.status] || 'neutral'" variant="soft" size="md">
          {{ STATUS_TEXT[row.status] || row.status }}
        </UBadge>
      </template>
      <template #nextReviewAt-data="{ row }">
        <span :class="reviewOverdue(row) ? 'font-medium text-red-600' : ''">
          {{ formatDate(row.nextReviewAt) }}
          <template v-if="reviewOverdue(row)"> · 已逾期</template>
        </span>
      </template>
      <template #updatedAt-data="{ row }">{{ formatDate(row.updatedAt) }}</template>
    </ManagedDataTable>

    <div v-if="error" class="py-8 text-center text-sm text-red-500">{{ error }}</div>
    <div v-else-if="!loading && !rows.length" class="py-12 text-center text-sm text-slate-400">
      还没有方案。完成一次模块评估后，系统会自动生成对应的行动方案。
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

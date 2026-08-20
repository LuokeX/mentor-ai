<script setup lang="ts">
/**
 * 学校后台 · 方案管理。
 *
 * 接口契约（server/api/v1/school-admin/plans）：
 * - 列表行：id / ownerUserId / teacherName / title / titleFull / module / status /
 *   attributionKeywords / instrumentSnapshots / nextReviewAt / completedAt / closedAt /
 *   createdAt / updatedAt + _capabilities
 * - 详情：整行（summaryEnc/acceptanceReasonEnc 已解密为 summary/acceptanceReason）+
 *   assessments（code/status/result/submittedAt）
 * - PATCH：body { title?, nextReviewAt?, status?, expectedUpdatedAt }（expectedUpdatedAt 在 body）
 * - archive/restore：POST body { expectedUpdatedAt, reason }；物理删除：DELETE body { reason }
 *
 * 状态流转：服务端 canTransitionPlanStatus 仅放行固定转移表，前端下拉按当前状态预过滤。
 */
import { useManagedList } from '~/composables/useManagedList'

interface PlanRow {
  id: string
  ownerUserId: string
  teacherName: string
  title: string
  titleFull: string | null
  module: string
  status: string
  attributionKeywords: string[]
  instrumentSnapshots: Array<{ code: string; name: string; version: string; sequence: number }>
  nextReviewAt: string | null
  completedAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
}
interface PlanDetail extends PlanRow {
  summary: string
  acceptanceReason: string | null
  actions: Array<{ title: string; detail: string; status: string }>
  tools: Array<{ title: string; content: string }>
  report: Record<string, unknown>
  assessments: Array<{
    id: string
    code: string
    status: string
    result: Record<string, unknown> | null
    submittedAt: string | null
  }>
}

const list = useManagedList<PlanRow>('/api/v1/school-admin/plans')

const columns = [
  { key: 'title', label: '标题', class: 'w-72 max-w-72 min-w-0' },
  { key: 'teacherName', label: '教师' },
  { key: 'module', label: '模块' },
  { key: 'status', label: '状态' },
  { key: 'nextReviewAt', label: '下次复盘' },
  { key: 'updatedAt', label: '更新时间', sortable: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '待确认', value: 'pending_acceptance' },
  { label: '已接受', value: 'accepted' },
  { label: '进行中', value: 'in_progress' },
  { label: '待复盘', value: 'review_due' },
  { label: '需调整', value: 'adjustment_needed' },
  { label: '需协同', value: 'escalated' },
  { label: '已完成', value: 'completed' },
  { label: '已关闭', value: 'closed' },
  { label: '已归档', value: 'archived' },
]
const STATUS_TEXT: Record<string, string> = {
  pending_acceptance: '待确认', accepted: '已接受', in_progress: '进行中',
  review_due: '待复盘', adjustment_needed: '需调整', escalated: '需协同',
  completed: '已完成', closed: '已关闭', archived: '已归档',
}
const STATUS_COLOR: Record<string, 'info' | 'success' | 'neutral' | 'warning' | 'error'> = {
  pending_acceptance: 'warning', accepted: 'info', in_progress: 'info',
  review_due: 'warning', adjustment_needed: 'warning', escalated: 'error',
  completed: 'success', closed: 'neutral', archived: 'neutral',
}
const ACTION_STATUS_TEXT: Record<string, string> = {
  pending: '未开始', in_progress: '进行中', completed: '已完成',
  blocked: '受阻', skipped: '已跳过', cancelled: '已取消',
}
const MODULE_LABELS: Record<string, string> = {
  self_growth: '自我成长', class_system: '班级系统', home_school: '家校共育',
  student_case: '学生个案', learning_problem: '学习问题',
}

/** 与服务端 domain/plan-operations.ts PLAN_STATUS_TRANSITIONS 保持一致（前端仅预过滤，最终以服务端校验为准） */
const PLAN_STATUS_TRANSITIONS: Record<string, string[]> = {
  accepted: ['in_progress', 'closed'],
  in_progress: ['completed', 'closed'],
  review_due: ['in_progress', 'completed', 'closed'],
  adjustment_needed: ['in_progress', 'closed'],
  escalated: ['closed'],
}

function riskSeverityColor(severity?: string): 'error' | 'warning' | 'success' | 'neutral' {
  const map: Record<string, 'error' | 'warning' | 'success' | 'neutral'> = {
    crisis: 'error', high: 'error', medium: 'warning', low: 'success',
  }
  return map[severity || ''] || 'neutral'
}
function attributionStrengthLabel(strength: unknown) {
  return { primary: '主要', secondary: '次要', reference: '参考' }[String(strength)] || '参考'
}
function assessmentResultSummary(result: Record<string, unknown> | null) {
  if (!result || typeof result !== 'object') return '—'
  const report = (result as Record<string, unknown>).report
  if (report && typeof report === 'object') {
    const risk = (report as Record<string, unknown>).risk as Record<string, unknown> | undefined
    const profile = (report as Record<string, unknown>).profile as Record<string, unknown> | undefined
    return String(risk?.label || profile?.title || '')
  }
  return String((result as Record<string, unknown>).levelName || '')
}

// ===== 详情抽屉 =====
const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<PlanDetail | null>(null)

async function openDetail(rowOrId: PlanRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  detailOpen.value = true
  detailLoading.value = true
  try {
    detail.value = await $fetch<PlanDetail>(`/api/v1/school-admin/plans/${row.id}`)
  } finally {
    detailLoading.value = false
  }
}

const reportAttributions = computed<Array<{ name: string; strength: string; reasons: string[] }>>(() => {
  const report = detail.value?.report
  if (!report || typeof report !== 'object') return []
  const attributions = (report as Record<string, unknown>).attributions
  return Array.isArray(attributions) ? attributions as Array<{ name: string; strength: string; reasons: string[] }> : []
})
const reportRisk = computed<Record<string, unknown> | null>(() => {
  const report = detail.value?.report
  if (!report || typeof report !== 'object') return null
  const risk = (report as Record<string, unknown>).risk
  return risk && typeof risk === 'object' ? risk as Record<string, unknown> : null
})
const reportProfile = computed<Record<string, unknown> | null>(() => {
  const report = detail.value?.report
  if (!report || typeof report !== 'object') return null
  const profile = (report as Record<string, unknown>).profile
  return profile && typeof profile === 'object' ? profile as Record<string, unknown> : null
})

// ===== 编辑抽屉（标题 + 状态）=====
const editOpen = ref(false)
const editTitle = ref('')
const editStatus = ref('')
const formError = ref('')
const saving = ref(false)
const lifecycle = ref<{ action: 'archive' | 'restore'; row: PlanRow } | null>(null)
const deleteTarget = ref<PlanRow | null>(null)
const deleteReason = ref('')
const deleteFormError = ref('')

const allowedStatusOptions = computed(() => {
  const current = detail.value?.status || ''
  return (PLAN_STATUS_TRANSITIONS[current] || []).map(status => ({
    label: STATUS_TEXT[status] || status,
    value: status,
  }))
})

async function openEdit(rowOrId: PlanRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  formError.value = ''
  try {
    const data = await $fetch<PlanDetail>(`/api/v1/school-admin/plans/${row.id}`)
    detail.value = data
    editTitle.value = data.title
    editStatus.value = ''
    editOpen.value = true
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '方案详情加载失败'
  }
}

async function savePlan() {
  if (!detail.value) return
  const body: Record<string, unknown> = { expectedUpdatedAt: detail.value.updatedAt }
  const title = editTitle.value.trim()
  if (title && title !== detail.value.title) body.title = title
  if (editStatus.value && editStatus.value !== detail.value.status) body.status = editStatus.value
  if (!body.title && !body.status) {
    editOpen.value = false
    return
  }
  saving.value = true
  formError.value = ''
  try {
    await $fetch(`/api/v1/school-admin/plans/${detail.value.id}`, {
      method: 'PATCH',
      body,
    })
    editOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { statusCode?: number; data?: { message?: string } }
    formError.value = response.statusCode === 409
      ? response.data?.message || '方案已被修改，请刷新后重试'
      : response.data?.message || '方案保存失败'
  } finally {
    saving.value = false
  }
}

// ===== 归档 / 恢复 / 删除 =====
async function runLifecycle(reason: string) {
  if (!lifecycle.value) return
  saving.value = true
  formError.value = ''
  const { action, row } = lifecycle.value
  try {
    await $fetch(`/api/v1/school-admin/plans/${row.id}/${action}`, {
      method: 'POST',
      body: { expectedUpdatedAt: row.updatedAt, reason },
    })
    lifecycle.value = null
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '方案状态更新失败'
  } finally {
    saving.value = false
  }
}

const canDelete = computed(() => deleteReason.value.trim().length >= 10)

async function confirmDelete() {
  if (!deleteTarget.value || !canDelete.value) return
  saving.value = true
  deleteFormError.value = ''
  try {
    await $fetch(`/api/v1/school-admin/plans/${deleteTarget.value.id}`, {
      method: 'DELETE',
      body: { reason: deleteReason.value.trim() },
    })
    deleteTarget.value = null
    deleteReason.value = ''
    await list.refresh()
  } catch (error: unknown) {
    deleteFormError.value = (error as { data?: { message?: string } }).data?.message || '方案删除失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ManagementPage title="方案管理" description="查看本校教师方案，可调整标题与状态、归档、恢复或删除（仅删除方案，评估保留）。所有操作保留审计。">
    <TableToolbar
      :search-value="list.q.value"
      :status-filter="list.statusFilter.value"
      :status-options="statusOptions"
      search-placeholder="搜索方案标题..."
      :loading="list.loading.value"
      @search="list.onSearch"
      @update:status-filter="list.onStatusChange"
      @refresh="list.refresh"
    />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange">
      <template #title-data="{ row }">
        <UTooltip :text="row.titleFull || row.title" class="block min-w-0" :popper="{ placement: 'top', strategy: 'fixed' }">
          <span class="block truncate font-medium text-emerald-700">{{ row.title }}</span>
        </UTooltip>
      </template>
      <template #module-data="{ row }">{{ MODULE_LABELS[row.module] || row.module }}</template>
      <template #status-data="{ row }">
        <UBadge :color="STATUS_COLOR[row.status] || 'neutral'" variant="soft" size="md">{{ STATUS_TEXT[row.status] || row.status }}</UBadge>
      </template>
      <template #nextReviewAt-data="{ row }">{{ formatDate(row.nextReviewAt) }}</template>
      <template #updatedAt-data="{ value }">{{ formatDateTime(value as string | null) }}</template>
      <template #actions-data="{ row }">
        <RowActions
          :capabilities="row._capabilities"
          :row-id="row.id"
          @view="openDetail"
          @edit="openEdit"
          @archive="lifecycle = { action: 'archive', row }"
          @restore="lifecycle = { action: 'restore', row }"
          @delete="deleteTarget = row"
        />
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <!-- 详情抽屉（敏感内容，开启全屏水印） -->
    <EntityDetailDrawer :open="detailOpen" title="方案详情" :loading="detailLoading" @close="detailOpen = false">
      <div v-if="detail" class="space-y-6">
        <div v-if="detailOpen" class="sensitive-watermark" aria-hidden="true">
          <template v-for="n in 16" :key="n"><span>敏感数据 · 禁止外传</span></template>
        </div>
        <div>
          <h3 class="text-base font-semibold text-slate-800">{{ detail.title }}</h3>
          <p v-if="detail.titleFull && detail.titleFull !== detail.title" class="mt-1 text-xs leading-5 text-slate-400">{{ detail.titleFull }}</p>
          <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
            <span>教师：{{ detail.teacherName }}</span>
            <span>模块：{{ MODULE_LABELS[detail.module] || detail.module }}</span>
            <UBadge :color="STATUS_COLOR[detail.status] || 'neutral'" variant="soft" size="sm">{{ STATUS_TEXT[detail.status] || detail.status }}</UBadge>
          </div>
          <p v-if="detail.attributionKeywords?.length" class="mt-1 text-xs text-slate-400">归因关键词：{{ detail.attributionKeywords.join('、') }}</p>
        </div>

        <section>
          <h4 class="mb-2 text-sm font-semibold text-slate-700">方案摘要</h4>
          <p class="whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">{{ detail.summary }}</p>
        </section>

        <section v-if="detail.assessments?.length">
          <h4 class="mb-2 text-sm font-semibold text-slate-700">关联评估（{{ detail.assessments.length }} 份）</h4>
          <div class="space-y-2">
            <div v-for="assessment in detail.assessments" :key="assessment.id" class="grid gap-2 rounded-xl border border-slate-100 p-3 text-sm md:grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)_9rem]">
              <div><span class="text-slate-400">量表</span><p class="mt-0.5 font-medium break-all">{{ assessment.code }}</p></div>
              <div><span class="text-slate-400">状态</span><p class="mt-0.5">{{ STATUS_TEXT[assessment.status] || assessment.status }}</p></div>
              <div><span class="text-slate-400">结果</span><p class="mt-0.5 font-medium">{{ assessmentResultSummary(assessment.result) }}</p></div>
              <div><span class="text-slate-400">提交时间</span><p class="mt-0.5">{{ assessment.submittedAt ? formatDateTime(assessment.submittedAt) : '—' }}</p></div>
            </div>
          </div>
        </section>

        <section v-if="detail.tools?.length">
          <h4 class="mb-2 text-sm font-semibold text-slate-700">工具卡（{{ detail.tools.length }}）</h4>
          <div class="space-y-2">
            <div v-for="tool in detail.tools" :key="tool.title" class="rounded-xl bg-slate-50 p-3">
              <p class="text-sm font-semibold text-slate-700">{{ tool.title }}</p>
              <p class="mt-1 text-xs leading-5 text-slate-500">{{ tool.content }}</p>
            </div>
          </div>
        </section>

        <section v-if="detail.actions?.length">
          <h4 class="mb-2 text-sm font-semibold text-slate-700">方案动作（{{ detail.actions.length }}）</h4>
          <div class="space-y-2">
            <div v-for="(action, index) in detail.actions" :key="`${action.title}-${index}`" class="rounded-xl border border-slate-100 p-3">
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-medium text-slate-700">{{ index + 1 }}. {{ action.title }}</p>
                <UBadge color="neutral" variant="soft" size="xs">{{ ACTION_STATUS_TEXT[action.status] || action.status }}</UBadge>
              </div>
              <p v-if="action.detail" class="mt-1 whitespace-pre-line text-xs leading-5 text-slate-500">{{ action.detail }}</p>
            </div>
          </div>
        </section>

        <section v-if="reportProfile || reportRisk">
          <h4 class="mb-2 text-sm font-semibold text-slate-700">评估报告（简要）</h4>
          <div class="rounded-xl border border-slate-100 p-4">
            <div class="flex items-center gap-2">
              <p class="text-sm font-semibold text-slate-800">{{ String(reportProfile?.title || '') }}</p>
              <UBadge v-if="reportRisk" :color="riskSeverityColor(String((reportRisk as Record<string, unknown>).severity || ''))" variant="soft">
                {{ String((reportRisk as Record<string, unknown>).label || '') }}
              </UBadge>
            </div>
            <p v-if="reportProfile?.summary" class="mt-2 text-sm leading-6 text-slate-600">{{ String(reportProfile.summary) }}</p>
            <p v-if="reportProfile?.primaryConcern" class="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">主要关注：{{ String(reportProfile.primaryConcern) }}</p>
            <div v-if="reportAttributions.length" class="mt-3 space-y-1.5">
              <p class="text-xs font-medium text-slate-500">归因构成</p>
              <div v-for="attribution in reportAttributions" :key="attribution.name" class="flex items-start gap-2">
                <UBadge size="xs" :color="attribution.strength === 'primary' ? 'primary' : 'neutral'" :variant="attribution.strength === 'primary' ? 'solid' : 'soft'">
                  {{ attributionStrengthLabel(attribution.strength) }}
                </UBadge>
                <p class="text-xs leading-5 text-slate-600">{{ attribution.name }}</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </EntityDetailDrawer>

    <!-- 编辑抽屉：标题 + 状态 -->
    <EntityFormDrawer :open="editOpen" title="编辑方案" @close="editOpen = false">
      <div class="space-y-4">
        <UFormField label="方案标题">
          <UInput v-model="editTitle" maxlength="200" class="w-full" />
        </UFormField>
        <UFormField v-if="allowedStatusOptions.length" label="方案状态" hint="仅展示当前状态下允许流转的目标状态">
          <USelect v-model="editStatus" :items="[{ label: '（保持不变）', value: '' }, ...allowedStatusOptions]" class="w-full" />
        </UFormField>
        <p v-else class="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">当前状态（{{ STATUS_TEXT[detail?.status || ''] || detail?.status }}）不允许流转，仅可修改标题。</p>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="editOpen = false">取消</UButton>
          <UButton :loading="saving" @click="savePlan">保存</UButton>
        </div>
      </div>
    </EntityFormDrawer>

    <LifecycleDialog
      :open="Boolean(lifecycle)"
      :action="lifecycle?.action === 'archive' ? '归档方案' : '恢复方案'"
      :target-name="lifecycle?.row.title"
      :loading="saving"
      @close="lifecycle = null"
      @confirm="runLifecycle"
    />

    <!-- 物理删除：确认 + 事由 -->
    <UModal :open="Boolean(deleteTarget)" @update:open="value => { if (!value) { deleteTarget = null; deleteReason = ''; deleteFormError = '' } }">
      <template #header><h3 class="text-lg font-semibold">删除方案</h3></template>
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-600">
            确认删除方案 <span class="font-medium">{{ deleteTarget?.title }}</span>（{{ deleteTarget?.teacherName }}）？
          </p>
          <p class="rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-700">
            仅删除方案及方案执行记录，<strong>关联评估记录保留</strong>。删除后不可恢复。
          </p>
          <UFormField label="操作事由" required>
            <UTextarea v-model="deleteReason" :rows="3" placeholder="请输入删除事由（至少 10 个字符）" class="w-full" />
          </UFormField>
          <p v-if="deleteFormError" class="text-sm text-red-600">{{ deleteFormError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="outline" @click="deleteTarget = null">取消</UButton>
          <UButton color="error" :loading="saving" :disabled="!canDelete" @click="confirmDelete">确认删除</UButton>
        </div>
      </template>
    </UModal>
  </ManagementPage>
</template>
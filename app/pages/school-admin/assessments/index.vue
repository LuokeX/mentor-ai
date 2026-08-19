<script setup lang="ts">
/**
 * 学校后台 · 评估记录管理。
 *
 * 接口契约（server/api/v1/school-admin/assessments）：
 * - 列表行：id / ownerUserId / teacherName / module / assessmentCode / definitionVersion
 *   / status(draft|submitted|archived) / submittedAt / createdAt / updatedAt + _capabilities
 * - 详情：整行 + answers（Record<questionId, number|string|boolean>）+ result（含 report/tools）
 * - PATCH：body { answers?, status?, expectedUpdatedAt }（expectedUpdatedAt 在 body 中）
 * - archive/restore：POST body { expectedUpdatedAt, reason }
 * - 物理删除：DELETE body { reason }（≥10 字，连带删除关联方案）
 *
 * 服务端排序白名单仅 createdAt/submittedAt，而 useManagedList 默认 sort=updatedAt
 * 会被 Zod 直接 400 拒绝，因此通过 extraQuery 把默认排序纠正为 submittedAt。
 */
import { useManagedList } from '~/composables/useManagedList'
import { assessmentDefinitions } from '#shared/assessments'
import type { AssessmentReport } from '#shared/reports'

interface AssessmentRow {
  id: string
  ownerUserId: string
  teacherName: string
  module: string
  assessmentCode: string
  definitionVersion: string
  status: 'draft' | 'submitted' | 'archived'
  submittedAt: string | null
  createdAt: string
  updatedAt: string
}
interface AssessmentDetail extends AssessmentRow {
  answers: Record<string, number | string | boolean>
  result: Record<string, unknown> | null
  dataClassification: string
  archivedAt: string | null
  archivedBy: string | null
  archivedPreviousStatus: string | null
}

const route = useRoute()
const list = useManagedList<AssessmentRow>('/api/v1/school-admin/assessments', {
  extraQuery: () => {
    const current = (route.query.sort as string) || ''
    return { sort: ['createdAt', 'submittedAt'].includes(current) ? current : 'submittedAt' }
  },
})

const columns = [
  { key: 'teacherName', label: '教师' },
  { key: 'module', label: '模块' },
  { key: 'assessmentCode', label: '量表代码' },
  { key: 'definitionVersion', label: '版本' },
  { key: 'status', label: '状态' },
  { key: 'submittedAt', label: '提交时间', sortable: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '草稿', value: 'draft' },
  { label: '已提交', value: 'submitted' },
  { label: '已归档', value: 'archived' },
]
const MODULE_LABELS: Record<string, string> = {
  self_growth: '自我成长', class_system: '班级系统', home_school: '家校共育',
  student_case: '学生个案', learning_problem: '学习问题',
}
const STATUS_TEXT: Record<string, string> = {
  draft: '草稿', submitted: '已提交', archived: '已归档',
}

// ===== 详情抽屉 =====
const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<AssessmentDetail | null>(null)

/** 适配层：详情接口的 result 是 Record<string, unknown>，其中 report 即 AssessmentReport */
const reportData = computed<AssessmentReport | null>(() => {
  const result = detail.value?.result
  if (!result || typeof result !== 'object') return null
  const report = (result as Record<string, unknown>).report
  return report && typeof report === 'object' ? (report as AssessmentReport) : null
})
const reportTools = computed<Array<{ title: string; content: string }>>(() => {
  const result = detail.value?.result
  if (!result || typeof result !== 'object') return []
  const tools = (result as Record<string, unknown>).tools
  return Array.isArray(tools) ? tools as Array<{ title: string; content: string }> : []
})
/** 题目结构：详情接口不返回题目定义，仅当评估使用的量表与内置定义同码时按题渲染，否则 JSON 文本编辑 */
const builtinDef = computed(() => {
  if (!detail.value) return null
  return Object.values(assessmentDefinitions)
    .find(def => def.code === detail.value!.assessmentCode) || null
})

function questionText(questionId: string) {
  return builtinDef.value?.questions.find(q => q.id === questionId)?.text || questionId
}
function answerLabel(questionId: string, value: number | string | boolean) {
  const question = builtinDef.value?.questions.find(q => q.id === questionId)
  const option = question?.options.find(o => o.value === value)
  return option ? `${option.label}（${String(value)}）` : String(value)
}
const answerEntries = computed(() => Object.entries(detail.value?.answers || {}))

async function openDetail(rowOrId: AssessmentRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  detailOpen.value = true
  detailLoading.value = true
  try {
    detail.value = await $fetch<AssessmentDetail>(`/api/v1/school-admin/assessments/${row.id}`)
  } finally {
    detailLoading.value = false
  }
}

// ===== 答案编辑抽屉 =====
const editOpen = ref(false)
/** 内置量表（选项值恒为 number）专用作答记录 */
const editAnswerValues = reactive<Record<string, number>>({})
const editJson = ref('')
const formError = ref('')
const saving = ref(false)
const lifecycle = ref<{ action: 'archive' | 'restore'; row: AssessmentRow } | null>(null)
const deleteTarget = ref<AssessmentRow | null>(null)
const deleteReason = ref('')
const deleteFormError = ref('')

async function openEdit(rowOrId: AssessmentRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  formError.value = ''
  try {
    const data = await $fetch<AssessmentDetail>(`/api/v1/school-admin/assessments/${row.id}`)
    detail.value = data
    const def = Object.values(assessmentDefinitions).find(d => d.code === data.assessmentCode)
    Object.keys(editAnswerValues).forEach(key => delete editAnswerValues[key])
    if (def) {
      for (const question of def.questions) {
        const value = data.answers?.[question.id]
        if (typeof value === 'number') editAnswerValues[question.id] = value
      }
    }
    editJson.value = JSON.stringify(data.answers || {}, null, 2)
    editOpen.value = true
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '评估详情加载失败'
  }
}

function parseAnswersJson(text: string): Record<string, number | string | boolean> | null {
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    for (const value of Object.values(parsed)) {
      if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') return null
    }
    return parsed as Record<string, number | string | boolean>
  } catch {
    return null
  }
}

async function saveAnswers() {
  if (!detail.value) return
  let answers: Record<string, number | string | boolean>
  if (builtinDef.value) {
    answers = { ...editAnswerValues }
    const missing = builtinDef.value.questions.filter(q => answers[q.id] === undefined)
    if (missing.length) {
      formError.value = `还有 ${missing.length} 道题未作答，请全部选择后再保存`
      return
    }
  } else {
    const parsed = parseAnswersJson(editJson.value)
    if (!parsed) {
      formError.value = '答案 JSON 格式不正确，需为 { 题目ID: 数值 } 形式的对象'
      return
    }
    answers = parsed
  }
  saving.value = true
  formError.value = ''
  try {
    await $fetch(`/api/v1/school-admin/assessments/${detail.value.id}`, {
      method: 'PATCH',
      body: { answers, expectedUpdatedAt: detail.value.updatedAt },
    })
    editOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { statusCode?: number; data?: { message?: string } }
    formError.value = response.statusCode === 409
      ? response.data?.message || '评估已被修改，请刷新后重试'
      : response.data?.message || '评估答案保存失败'
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
    await $fetch(`/api/v1/school-admin/assessments/${row.id}/${action}`, {
      method: 'POST',
      body: { expectedUpdatedAt: row.updatedAt, reason },
    })
    lifecycle.value = null
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '评估状态更新失败'
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
    await $fetch(`/api/v1/school-admin/assessments/${deleteTarget.value.id}`, {
      method: 'DELETE',
      body: { reason: deleteReason.value.trim() },
    })
    deleteTarget.value = null
    deleteReason.value = ''
    await list.refresh()
  } catch (error: unknown) {
    deleteFormError.value = (error as { data?: { message?: string } }).data?.message || '评估删除失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ManagementPage title="评估记录" description="查看本校教师评估记录，可修正答案重算结果、归档、恢复或物理删除（连带关联方案）。所有操作保留审计。">
    <TableToolbar
      :search-value="list.q.value"
      :status-filter="list.statusFilter.value"
      :status-options="statusOptions"
      search-placeholder="搜索教师姓名..."
      :loading="list.loading.value"
      @search="list.onSearch"
      @update:status-filter="list.onStatusChange"
      @refresh="list.refresh"
    />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange">
      <template #module-data="{ row }">{{ MODULE_LABELS[row.module] || row.module }}</template>
      <template #status-data="{ row }">
        <UBadge
          :color="row.status === 'submitted' ? 'success' : row.status === 'draft' ? 'info' : 'neutral'"
          variant="subtle"
        >{{ STATUS_TEXT[row.status] || row.status }}</UBadge>
      </template>
      <template #submittedAt-data="{ value }">{{ value ? new Date(String(value)).toLocaleString('zh-CN') : '—' }}</template>
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
    <EntityDetailDrawer :open="detailOpen" title="评估详情" :loading="detailLoading" @close="detailOpen = false">
      <div v-if="detail" class="space-y-5">
        <div v-if="detailOpen" class="sensitive-watermark" aria-hidden="true">
          <template v-for="n in 16" :key="n"><span>敏感数据 · 禁止外传</span></template>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div><span class="text-slate-400">教师</span><p class="font-medium">{{ detail.teacherName }}</p></div>
          <div><span class="text-slate-400">模块</span><p class="font-medium">{{ MODULE_LABELS[detail.module] || detail.module }}</p></div>
          <div><span class="text-slate-400">量表代码</span><p class="font-medium break-all">{{ detail.assessmentCode }}</p></div>
          <div><span class="text-slate-400">版本</span><p class="font-medium">{{ detail.definitionVersion }}</p></div>
          <div><span class="text-slate-400">状态</span><p class="font-medium">{{ STATUS_TEXT[detail.status] || detail.status }}</p></div>
          <div><span class="text-slate-400">提交时间</span><p class="font-medium">{{ detail.submittedAt ? new Date(detail.submittedAt).toLocaleString('zh-CN') : '—' }}</p></div>
        </div>

        <section>
          <h3 class="mb-3 text-sm font-semibold text-slate-700">作答明细</h3>
          <div class="space-y-2">
            <div v-for="[questionId, value] in answerEntries" :key="questionId" class="rounded-xl border border-slate-100 p-3">
              <p class="text-sm font-medium text-slate-700">{{ questionText(questionId) }}</p>
              <p class="mt-1 text-xs text-slate-500">
                <span class="text-slate-400">题号 {{ questionId }} ·</span> {{ answerLabel(questionId, value) }}
              </p>
            </div>
          </div>
        </section>

        <section v-if="reportData">
          <h3 class="mb-3 text-sm font-semibold text-slate-700">评估报告</h3>
          <AssessmentReportView :report="reportData" :tools="reportTools" />
        </section>
        <p v-else class="rounded-lg bg-slate-50 p-3 text-xs text-slate-400">该记录尚未生成评估报告（草稿或旧数据）。</p>
      </div>
    </EntityDetailDrawer>

    <!-- 答案编辑抽屉 -->
    <EntityFormDrawer :open="editOpen" title="编辑评估答案" @close="editOpen = false">
      <div class="space-y-4">
        <div v-if="builtinDef" class="space-y-3">
          <p class="rounded-lg bg-amber-50/60 p-3 text-xs leading-5 text-amber-800">
            修改答案将重算评估结果，方案快照不更新（方案内容以生成时固化的快照为准）。
          </p>
          <div v-for="question in builtinDef.questions" :key="question.id" class="rounded-xl border border-slate-100 p-3">
            <p class="text-sm font-medium text-slate-700">{{ question.text }}</p>
            <p v-if="question.dimension" class="mt-0.5 text-xs text-slate-400">维度：{{ question.dimension }}</p>
            <USelect
              v-model="editAnswerValues[question.id]"
              :items="question.options.map(option => ({ label: `${option.label}（${option.value}）`, value: option.value }))"
              class="mt-2 w-full"
            />
          </div>
        </div>
        <div v-else class="space-y-3">
          <p class="rounded-lg bg-amber-50/60 p-3 text-xs leading-5 text-amber-800">
            当前量表无内置题目定义，请直接编辑答案 JSON。修改答案将重算评估结果，方案快照不更新。
          </p>
          <UTextarea v-model="editJson" :rows="12" class="w-full font-mono" placeholder='{ "q1": 3, "q2": 2 }' />
        </div>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="editOpen = false">取消</UButton>
          <UButton :loading="saving" @click="saveAnswers">保存并重算</UButton>
        </div>
      </div>
    </EntityFormDrawer>

    <LifecycleDialog
      :open="Boolean(lifecycle)"
      :action="lifecycle?.action === 'archive' ? '归档评估' : '恢复评估'"
      :target-name="lifecycle ? `${lifecycle.row.teacherName} 的评估（${lifecycle.row.assessmentCode}）` : undefined"
      :loading="saving"
      @close="lifecycle = null"
      @confirm="runLifecycle"
    />

    <!-- 物理删除：确认 + 事由 -->
    <UModal :open="Boolean(deleteTarget)" @update:open="value => { if (!value) { deleteTarget = null; deleteReason = ''; deleteFormError = '' } }">
      <template #header><h3 class="text-lg font-semibold">删除评估</h3></template>
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-600">
            确认删除 <span class="font-medium">{{ deleteTarget?.teacherName }}</span> 的评估（{{ deleteTarget?.assessmentCode }}）？
          </p>
          <p class="rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-700">
            删除后不可恢复，且将<strong>连带删除关联的行动方案</strong>及方案执行记录。
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
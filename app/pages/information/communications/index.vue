<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import { RECORD_RELATED_TARGET_MAX, communicationChannelLabels } from '~~/shared/contracts'
import type { CommunicationChannel } from '~~/shared/contracts'
import type { ManagedListResult } from '~~/shared/management'
import { COMMUNICATION_RISK_OPTIONS, canonicalCommunicationRiskLevel, communicationRiskLabel } from '~~/shared/dashboard'

interface CommunicationRow {
  id: string
  summaryPreview: string
  studentId: string | null
  guardianId: string | null
  /** 主学生 / 主家长（看板与统计按主对象归属） */
  studentName: string | null
  guardianName: string | null
  /** 主对象在前的完整名单（支持多选学生 / 多选家长） */
  studentNames: string[]
  guardianNames: string[]
  /** 「某生爸爸（真实姓名）」展示；无关联学生时回退 guardianNames */
  guardianLabels?: string[]
  guardianRelation?: string | null
  guardianLabel?: string | null
  channel: string | null
  parentType: string | null
  riskLevel: string | null
  status: string
  occurredAt: string
  updatedAt: string
  /** 来源（从 AI 对话转存时写入）：可回跳原对话 */
  sourceChatSessionId: string | null
  sourceChatMessageId: string | null
}
interface OptionRow { id: string; name: string }
interface CommunicationDetail extends CommunicationRow {
  summary: string
  attitudeType: string | null
  studentIds: string[]
  guardianIds: string[]
}

const list = useManagedList<CommunicationRow>('/api/v1/information/communications')
const columns = [
  // 摘要列固定宽度：列表预览最长 80 字，不设限会把整张表撑出横向滚动（与方案/评估列表同口径）
  { key: 'summaryPreview', label: '沟通摘要', class: 'w-96 max-w-96 min-w-0' },
  { key: 'studentNames', label: '关联学生' },
  { key: 'guardianNames', label: '关联家长', mobileHidden: true },
  { key: 'channel', label: '沟通渠道' },
  { key: 'parentType', label: '家长类型', mobileHidden: true },
  { key: 'riskLevel', label: '风险等级', sortable: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'occurredAt', label: '沟通时间', sortable: true, mobileHidden: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '有效', value: 'active' },
  { label: '已归档', value: 'archived' },
]
/** 渠道下拉：值为英文码，可留空表示未标注 */
const channelOptions: { label: string; value: string }[] = (Object.keys(communicationChannelLabels) as CommunicationChannel[])
  .map(value => ({ label: communicationChannelLabels[value], value }))
const riskLevelOptions: Array<{ label: string, value: string }> = [...COMMUNICATION_RISK_OPTIONS]
function riskLabel(value: unknown): string {
  return communicationRiskLabel(typeof value === 'string' ? value : null)
}
function channelLabel(value: unknown): string {
  return typeof value === 'string' && value in communicationChannelLabels
    ? communicationChannelLabels[value as CommunicationChannel]
    : '未标注'
}
const { data: studentData } = await useFetch<ManagedListResult<OptionRow>>('/api/v1/information/students', { query: { page: 1, pageSize: 100, status: 'active' } })
const { data: guardianData } = await useFetch<ManagedListResult<OptionRow>>('/api/v1/information/guardians', { query: { page: 1, pageSize: 100, status: 'active' } })
const studentOptions = computed(() => (studentData.value?.rows || []).map(item => ({ label: item.name, value: item.id })))
const guardianOptions = computed(() => (guardianData.value?.rows || []).map(item => ({ label: item.name, value: item.id })))

const drawerOpen = ref(false)
const batchImportOpen = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const formError = ref('')
const archiveRow = ref<CommunicationRow | null>(null)
const form = reactive({
  summary: '',
  /** 关联学生 / 关联家长（首个为主对象；编辑时不改关联，与既有行为一致） */
  studentIds: [] as string[],
  guardianIds: [] as string[],
  channel: '',
  parentType: '',
  attitudeType: '',
  riskLevel: '',
  updatedAt: '',
  sourceChatSessionId: null as string | null,
  sourceChatMessageId: null as string | null,
})
const editingStudentNames = ref<string[]>([])
const editingGuardianNames = ref<string[]>([])

function resetForm() {
  Object.assign(form, {
    summary: '', studentIds: [], guardianIds: [], channel: '', parentType: '', attitudeType: '',
    riskLevel: '', updatedAt: '', sourceChatSessionId: null, sourceChatMessageId: null,
  })
  editingStudentNames.value = []
  editingGuardianNames.value = []
}

function openCreate() {
  editingId.value = null
  resetForm()
  formError.value = ''
  drawerOpen.value = true
}

function openBatchImport() {
  batchImportOpen.value = true
}

/** 列表「关联学生 / 关联家长」列：主对象在前，超过 2 人折叠为「张三 等 N 人」。 */
function namesColumnLabel(names: string[] | null | undefined): string {
  const list = (names || []).filter(Boolean)
  if (!list.length) return '—'
  return list.length > 2 ? `${list[0]} 等 ${list.length} 人` : list.join('、')
}

/**
 * 从 AI 对话转存：读取 ?chatSessionId=&chatMessageId=，打开新建抽屉并预填。
 * 摘要用消息全文（截 3000 字），关联学生 / 关联家长用本轮对象（回退会话对象），可在表单里改。
 */
useChatRecordPrefill({
  withGuardians: true,
  apply: (prefill) => {
    openCreate()
    if (!prefill.text.trim()) return
    form.summary = truncateRecordText(prefill.text, 3000)
    form.studentIds = prefill.students.map(item => item.id)
    form.guardianIds = prefill.guardians.map(item => item.id)
    form.sourceChatSessionId = prefill.sessionId
    form.sourceChatMessageId = prefill.messageId
  }
})

async function openEdit(id: string) {
  saving.value = true
  formError.value = ''
  try {
    const detail = await $fetch<CommunicationDetail>(`/api/v1/information/communications/${id}`)
    editingId.value = id
    editingStudentNames.value = detail.studentNames?.length
      ? detail.studentNames
      : (detail.studentIds?.length ? detail.studentIds.map(() => '已关联学生') : [])
    editingGuardianNames.value = detail.guardianNames?.length
      ? detail.guardianNames
      : (detail.guardianIds?.length ? detail.guardianIds.map(() => '已关联家长') : [])
    Object.assign(form, {
      summary: detail.summary,
      studentIds: detail.studentIds ?? (detail.studentId ? [detail.studentId] : []),
      guardianIds: detail.guardianIds ?? (detail.guardianId ? [detail.guardianId] : []),
      channel: detail.channel || '',
      parentType: detail.parentType || '',
      attitudeType: detail.attitudeType || '',
      riskLevel: canonicalCommunicationRiskLevel(detail.riskLevel) ?? '',
      updatedAt: detail.updatedAt,
      sourceChatSessionId: detail.sourceChatSessionId ?? null,
      sourceChatMessageId: detail.sourceChatMessageId ?? null,
    })
    drawerOpen.value = true
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '沟通记录加载失败'
  } finally {
    saving.value = false
  }
}

async function saveCommunication() {
  if (form.summary.trim().length < 5) {
    formError.value = '沟通摘要至少填写 5 个字符'
    return
  }
  if (form.studentIds.length > RECORD_RELATED_TARGET_MAX || form.guardianIds.length > RECORD_RELATED_TARGET_MAX) {
    formError.value = `关联学生与关联家长各最多 ${RECORD_RELATED_TARGET_MAX} 个`
    return
  }
  saving.value = true
  formError.value = ''
  try {
    if (editingId.value) {
      await $fetch(`/api/v1/information/communications/${editingId.value}`, {
        method: 'PATCH',
        query: { expectedUpdatedAt: form.updatedAt },
        body: {
          summary: form.summary,
          channel: form.channel || null,
          parentType: form.parentType || null,
          attitudeType: form.attitudeType || null,
          riskLevel: form.riskLevel || null,
        },
      })
    } else {
      await $fetch('/api/v1/information/entities', {
        method: 'POST',
        body: {
          type: 'communication',
          summary: form.summary,
          studentIds: form.studentIds.length ? form.studentIds : undefined,
          guardianIds: form.guardianIds.length ? form.guardianIds : undefined,
          channel: form.channel || undefined,
          parentType: form.parentType || undefined,
          attitudeType: form.attitudeType || undefined,
          riskLevel: form.riskLevel || undefined,
          ...(form.sourceChatSessionId && form.sourceChatMessageId
            ? { sourceChatSessionId: form.sourceChatSessionId, sourceChatMessageId: form.sourceChatMessageId }
            : {}),
        },
      })
    }
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { data?: { message?: string }; statusCode?: number }
    formError.value = response.statusCode === 409
      ? '记录已被其他用户修改，请关闭窗口并重新打开'
      : response.data?.message || '沟通记录保存失败'
  } finally {
    saving.value = false
  }
}

async function archiveCommunication(reason: string) {
  if (!archiveRow.value) return
  saving.value = true
  try {
    await $fetch(`/api/v1/information/communications/${archiveRow.value.id}/archive`, {
      method: 'POST',
      body: { expectedUpdatedAt: archiveRow.value.updatedAt, reason },
    })
    archiveRow.value = null
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '归档失败'
  } finally {
    saving.value = false
  }
}

function openCommunicationRow(row: CommunicationRow) {
  void openEdit(row.id)
}

function closeDrawer() {
  drawerOpen.value = false
}
</script>

<template>
  <ManagementPage
    title="家校沟通"
    description="以结构化记录维护家校沟通；归档后保留历史且不可继续编辑。"
    :can-create="list.pageCapabilities.value.includes('create')"
    create-label="新增沟通"
    :create-actions="[
      { label: '新增沟通', icon: 'i-lucide-pen-line', handle: openCreate },
      { label: '批量导入沟通记录', icon: 'i-lucide-file-spreadsheet', handle: openBatchImport },
    ]"
    @create="openCreate"
  >
    <TableToolbar
      :status-filter="list.statusFilter.value"
      :status-options="statusOptions"
      :loading="list.loading.value"
      @update:status-filter="list.onStatusChange"
      @refresh="list.refresh"
    />
    <ManagedDataTable
      :columns="columns"
      :rows="list.rows.value"
      :loading="list.loading.value"
      :sort="list.sort.value"
      :order="list.order.value"
      @sort="list.onSortChange"
      @row-click="openCommunicationRow"
    >
      <template #summaryPreview-data="{ row }">
        <UTooltip :text="row.summaryPreview" class="block min-w-0" :popper="{ placement: 'top', strategy: 'fixed' }">
          <span class="block truncate">{{ row.summaryPreview }}</span>
        </UTooltip>
      </template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle">{{ row.status === 'active' ? '有效' : '已归档' }}</UBadge></template>
      <template #studentNames-data="{ row }">{{ namesColumnLabel(row.studentNames) }}</template>
      <template #guardianNames-data="{ row }">{{ namesColumnLabel(row.guardianLabels?.length ? row.guardianLabels : row.guardianNames) }}</template>
      <template #channel-data="{ value }">{{ channelLabel(value) }}</template>
      <template #riskLevel-data="{ value }"><UBadge v-if="value" color="warning" variant="subtle">{{ riskLabel(value) }}</UBadge><span v-else>—</span></template>
      <template #occurredAt-data="{ value }">{{ formatDateTime(value) }}</template>
      <template #actions-data="{ row }">
        <RowActions
          :capabilities="row._capabilities"
          :row-id="row.id"
          @view="openEdit"
          @edit="openEdit"
          @archive="archiveRow = row"
        />
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <EntityFormDrawer :open="drawerOpen" :title="editingId ? '编辑沟通记录' : '新增沟通记录'" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="saveCommunication">
        <!-- 编辑时不允许改关联对象（与既有行为一致）：只读展示完整名单 -->
        <div v-if="editingId" class="grid gap-4 sm:grid-cols-2">
          <UFormField label="关联学生">
            <p class="text-sm text-slate-600">{{ editingStudentNames.length ? editingStudentNames.join('、') : '未指定' }}</p>
          </UFormField>
          <UFormField label="关联家长">
            <p class="text-sm text-slate-600">{{ editingGuardianNames.length ? editingGuardianNames.join('、') : '未指定' }}</p>
          </UFormField>
        </div>
        <div v-else class="grid gap-4 sm:grid-cols-2">
          <UFormField label="关联学生" description="可多选，首个为主学生">
            <USelectMenu v-model="form.studentIds" :items="studentOptions" multiple searchable value-key="value" class="w-full" placeholder="可多选" />
          </UFormField>
          <UFormField label="关联家长" description="可多选，首个为主家长">
            <USelectMenu v-model="form.guardianIds" :items="guardianOptions" multiple searchable value-key="value" class="w-full" placeholder="可多选" />
          </UFormField>
        </div>
        <UFormField label="沟通摘要" required><UTextarea v-model="form.summary" :rows="7" class="w-full" /></UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="沟通渠道"><USelect v-model="form.channel" :items="channelOptions" placeholder="未标注" class="w-full" /></UFormField>
          <UFormField label="家长类型"><UInput v-model="form.parentType" class="w-full" /></UFormField>
          <UFormField label="态度类型"><UInput v-model="form.attitudeType" class="w-full" /></UFormField>
          <UFormField label="风险等级"><USelect v-model="form.riskLevel" :items="riskLevelOptions" placeholder="未标注" class="w-full" /></UFormField>
        </div>
        <p v-if="form.sourceChatSessionId" class="flex items-center gap-1.5 text-xs text-slate-500">
          <UIcon name="i-lucide-message-square-quote" class="size-3.5" />
          来源：AI 对话
          <NuxtLink :to="`/?sessionId=${form.sourceChatSessionId}`" target="_blank" rel="noopener noreferrer" class="text-emerald-700 hover:underline">回看原对话</NuxtLink>
        </p>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="closeDrawer">取消</UButton>
          <UButton type="submit" :loading="saving">保存</UButton>
        </div>
      </form>
    </EntityFormDrawer>
    <LifecycleDialog
      :open="Boolean(archiveRow)"
      action="归档沟通记录"
      :target-name="archiveRow?.summaryPreview"
      :loading="saving"
      @close="archiveRow = null"
      @confirm="archiveCommunication"
    />

    <BatchImportDrawer
      :open="batchImportOpen"
      title="批量导入家校沟通"
      templateUrl="/api/v1/information/communications/import-template"
      previewUrl="/api/v1/information/communications/import-preview"
      commitUrl="/api/v1/information/communications/import-commit"
      :sample-fields="['studentName', 'occurredAt', 'summaryPreview']"
      @close="batchImportOpen = false"
      @imported="list.refresh"
    />
  </ManagementPage>
</template>

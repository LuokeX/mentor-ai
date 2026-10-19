<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import { RECORD_RELATED_TARGET_MAX, eventStatuses, eventStatusLabels, studentEventTypeLabels, studentEventTypes } from '~~/shared/contracts'
import type { ManagedListResult } from '~~/shared/management'

interface EventRow {
  id: string
  studentId: string
  studentName: string
  /** 主学生 + 关联学生（主学生在前）：一行事件可关联多名学生 */
  studentNames: string[]
  relatedStudentNames: string[]
  eventType: string
  severity: string
  title: string
  description: string | null
  resolution: string | null
  occurredAt: string
  status: string
  updatedAt: string
  /** 来源（从 AI 对话转存时写入）：可回跳原对话 */
  sourceChatSessionId: string | null
  sourceChatMessageId: string | null
}
interface StudentOption { id: string; name: string }

const list = useManagedList<EventRow>('/api/v1/information/student-events')
const columns = [
  { key: 'title', label: '事件标题' },
  { key: 'studentName', label: '学生' },
  { key: 'eventType', label: '类型', sortable: true, mobileHidden: true },
  { key: 'severity', label: '严重程度', sortable: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'occurredAt', label: '发生时间', sortable: true, mobileHidden: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '待处理', value: 'open' },
  { label: '已解决', value: 'resolved' },
  { label: '已关闭', value: 'closed' },
]
const eventTypes: { label: string; value: string }[] = studentEventTypes.map(value => ({ label: studentEventTypeLabels[value], value }))
const severities = ['低', '中', '高', '严重'].map(value => ({ label: value, value }))
const statuses: { label: string, value: string }[] = eventStatuses.map(value => ({ label: eventStatusLabels[value], value }))

const { data: studentData } = await useFetch<ManagedListResult<StudentOption>>('/api/v1/information/students', { query: { page: 1, pageSize: 100, status: 'active' } })
const studentOptions = computed(() => (studentData.value?.rows || []).map(item => ({ label: item.name, value: item.id })))

const drawerOpen = ref(false)
const batchImportOpen = ref(false)
const editingId = ref<string | null>(null)
const editingStudentNames = ref<string[]>([])
const saving = ref(false)
const formError = ref('')
const form = reactive({
  /** 关联学生（首个为主学生；编辑时不改关联，与既有行为一致） */
  studentIds: [] as string[],
  title: '',
  eventType: '其他',
  severity: '低',
  description: '',
  resolution: '',
  status: 'open',
  occurredAt: '',
  updatedAt: '',
  sourceChatSessionId: null as string | null,
  sourceChatMessageId: null as string | null,
})

function openCreate() {
  editingId.value = null
  editingStudentNames.value = []
  Object.assign(form, {
    studentIds: [], title: '', eventType: '其他', severity: '低',
    description: '', resolution: '', status: 'open',
    occurredAt: toBeijingInput(new Date()), updatedAt: '',
    sourceChatSessionId: null, sourceChatMessageId: null,
  })
  formError.value = ''
  drawerOpen.value = true
}

function openEdit(rowOrId: EventRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  editingId.value = row.id
  editingStudentNames.value = row.studentNames?.length ? row.studentNames : [row.studentName]
  Object.assign(form, {
    studentIds: [row.studentId],
    title: row.title,
    eventType: row.eventType,
    severity: row.severity,
    description: row.description || '',
    resolution: row.resolution || '',
    status: row.status,
    occurredAt: toBeijingInput(row.occurredAt),
    updatedAt: row.updatedAt,
    sourceChatSessionId: row.sourceChatSessionId ?? null,
    sourceChatMessageId: row.sourceChatMessageId ?? null,
  })
  formError.value = ''
  drawerOpen.value = true
}

/** 列表「学生」列：主学生在前，超过 2 人折叠为「张三 等 N 人」。 */
function studentColumnLabel(row: EventRow): string {
  const names = row.studentNames?.length ? row.studentNames : (row.studentName ? [row.studentName] : [])
  if (!names.length) return '—'
  return names.length > 2 ? `${names[0]} 等 ${names.length} 人` : names.join('、')
}

async function saveEvent() {
  if (!form.studentIds.length || !form.title.trim()) {
    formError.value = '请选择学生并填写事件标题'
    return
  }
  if (form.studentIds.length > RECORD_RELATED_TARGET_MAX) {
    formError.value = `一次最多关联 ${RECORD_RELATED_TARGET_MAX} 名学生`
    return
  }
  saving.value = true
  formError.value = ''
  const body = {
    title: form.title,
    eventType: form.eventType,
    severity: form.severity,
    description: form.description || undefined,
    resolution: form.resolution || undefined,
    status: form.status,
    occurredAt: parseBeijingInput(form.occurredAt)?.toISOString() ?? undefined,
  }
  try {
    if (editingId.value) {
      await $fetch(`/api/v1/information/student-events/${editingId.value}`, {
        method: 'PATCH',
        query: { expectedUpdatedAt: form.updatedAt },
        body,
      })
    } else {
      await $fetch('/api/v1/information/student-events', {
        method: 'POST',
        body: {
          ...body,
          studentIds: form.studentIds,
          ...(form.sourceChatSessionId && form.sourceChatMessageId
            ? { sourceChatSessionId: form.sourceChatSessionId, sourceChatMessageId: form.sourceChatMessageId }
            : {}),
        },
      })
    }
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { statusCode?: number; data?: { message?: string } }
    formError.value = response.statusCode === 409 ? '事件已被其他用户修改，请重新打开后再编辑' : response.data?.message || '事件保存失败'
  } finally {
    saving.value = false
  }
}

function closeDrawer() {
  drawerOpen.value = false
}

function openBatchImport() {
  batchImportOpen.value = true
}

/**
 * 从 AI 对话转存：读取 ?chatSessionId=&chatMessageId=，打开新建抽屉并预填。
 * 标题取消息首行（截 40 字），说明用全文；关联学生用本轮对象（回退会话对象），可在表单里改。
 */
useChatRecordPrefill({
  apply: (prefill) => {
    openCreate()
    if (!prefill.text.trim()) return
    form.title = deriveRecordTitle(prefill.text)
    form.description = truncateRecordText(prefill.text, 4000)
    form.studentIds = prefill.students.map(item => item.id)
    form.sourceChatSessionId = prefill.sessionId
    form.sourceChatMessageId = prefill.messageId
  }
})

async function archiveEvent(eventId: string) {
  if (!confirm('确定归档这条学生事件吗？归档后历史记录保留，仅归档处理。')) return
  try {
    await $fetch(`/api/v1/information/student-events/${eventId}`, { method: 'DELETE' })
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { data?: { message?: string } }
    formError.value = response.data?.message || '归档失败，请重试'
  }
}
</script>

<template>
  <ManagementPage
    title="学生事件记录"
    description="记录、解决和关闭学生事件，历史记录不物理删除。"
    :can-create="list.pageCapabilities.value.includes('create')"
    create-label="新增学生事件"
    :create-actions="[
      { label: '新增学生事件', icon: 'i-lucide-pen-line', handle: openCreate },
      { label: '批量导入事件记录', icon: 'i-lucide-file-spreadsheet', handle: openBatchImport },
    ]"
    @create="openCreate"
  >
    <TableToolbar
      :search-value="list.q.value"
      :status-filter="list.statusFilter.value"
      :status-options="statusOptions"
      search-placeholder="搜索事件标题..."
      :loading="list.loading.value"
      @search="list.onSearch"
      @update:status-filter="list.onStatusChange"
      @refresh="list.refresh"
    />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange" @row-click="openEdit">
      <template #studentName-data="{ row }"><span class="truncate">{{ studentColumnLabel(row) }}</span></template>
      <template #severity-data="{ value }"><UBadge :color="value === '严重' ? 'error' : value === '高' ? 'warning' : 'neutral'" variant="subtle">{{ value }}</UBadge></template>
      <template #status-data="{ value }"><UBadge :color="value === 'open' ? 'warning' : value === 'resolved' ? 'success' : value === 'archived' ? 'neutral' : 'neutral'" variant="subtle">{{ value === 'open' ? '待处理' : value === 'resolved' ? '已解决' : value === 'archived' ? '已归档' : '已关闭' }}</UBadge></template>
      <template #occurredAt-data="{ value }">{{ formatDateTime(value) }}</template>
      <template #actions-data="{ row }"><RowActions :capabilities="row._capabilities" :row-id="row.id" @view="openEdit" @edit="openEdit" @archive="archiveEvent" /></template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <EntityFormDrawer :open="drawerOpen" :title="editingId ? '编辑学生事件' : '新增学生事件'" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="saveEvent">
        <!-- 编辑时不允许改关联学生（与既有行为一致）：只读展示完整名单 -->
        <UFormField v-if="editingId" label="学生">
          <p class="text-sm text-slate-600">{{ editingStudentNames.join('、') }}<span class="ml-2 text-xs text-slate-400">编辑不改关联学生</span></p>
        </UFormField>
        <UFormField v-else label="学生" required description="可选择多名学生，首个为主学生（看板与统计按主学生归属）">
          <USelectMenu v-model="form.studentIds" :items="studentOptions" multiple searchable value-key="value" class="w-full" placeholder="选择一名或多名学生" />
        </UFormField>
        <UFormField label="标题" required><UInput v-model="form.title" class="w-full" /></UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="类型"><USelect v-model="form.eventType" :items="eventTypes" class="w-full" /></UFormField>
          <UFormField label="严重程度"><USelect v-model="form.severity" :items="severities" class="w-full" /></UFormField>
          <UFormField label="状态"><USelect v-model="form.status" :items="statuses" class="w-full" /></UFormField>
          <UFormField label="发生时间"><UInput v-model="form.occurredAt" type="datetime-local" class="w-full" /></UFormField>
        </div>
        <UFormField label="事件说明"><UTextarea v-model="form.description" :rows="4" class="w-full" /></UFormField>
        <UFormField label="处理结果"><UTextarea v-model="form.resolution" :rows="3" class="w-full" /></UFormField>
        <p v-if="form.sourceChatSessionId" class="flex items-center gap-1.5 text-xs text-slate-500">
          <UIcon name="i-lucide-message-square-quote" class="size-3.5" />
          来源：AI 对话
          <NuxtLink :to="`/?sessionId=${form.sourceChatSessionId}`" class="text-emerald-700 hover:underline">回看原对话</NuxtLink>
        </p>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" @click="closeDrawer">取消</UButton><UButton type="submit" :loading="saving">保存</UButton></div>
      </form>
    </EntityFormDrawer>

    <BatchImportDrawer
      :open="batchImportOpen"
      title="批量导入学生事件"
      templateUrl="/api/v1/information/student-events/import-template"
      previewUrl="/api/v1/information/student-events/import-preview"
      commitUrl="/api/v1/information/student-events/import-commit"
      :sample-fields="['studentName', 'eventType', 'severity', 'occurredAt']"
      @close="batchImportOpen = false"
      @imported="list.refresh"
    />
  </ManagementPage>
</template>

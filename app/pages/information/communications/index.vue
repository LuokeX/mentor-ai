<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import type { ManagedListResult } from '~~/shared/management'

interface CommunicationRow {
  id: string
  summaryPreview: string
  studentId: string | null
  guardianId: string | null
  parentType: string | null
  riskLevel: string | null
  status: string
  occurredAt: string
  updatedAt: string
}
interface OptionRow { id: string; name: string }
interface CommunicationDetail extends CommunicationRow {
  summary: string
  attitudeType: string | null
  containerLevel: number | null
}

const list = useManagedList<CommunicationRow>('/api/v1/information/communications')
const columns = [
  { key: 'summaryPreview', label: '沟通摘要' },
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
const { data: studentData } = await useFetch<ManagedListResult<OptionRow>>('/api/v1/information/students', { query: { page: 1, pageSize: 100, status: 'active' } })
const { data: guardianData } = await useFetch<ManagedListResult<OptionRow>>('/api/v1/information/guardians', { query: { page: 1, pageSize: 100, status: 'active' } })
const studentOptions = computed(() => (studentData.value?.rows || []).map(item => ({ label: item.name, value: item.id })))
const guardianOptions = computed(() => (guardianData.value?.rows || []).map(item => ({ label: item.name, value: item.id })))

const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const formError = ref('')
const archiveRow = ref<CommunicationRow | null>(null)
const form = reactive({
  summary: '',
  studentId: '',
  guardianId: '',
  parentType: '',
  attitudeType: '',
  riskLevel: '',
  containerLevel: null as number | null,
  updatedAt: '',
})

function resetForm() {
  Object.assign(form, {
    summary: '', studentId: '', guardianId: '', parentType: '', attitudeType: '',
    riskLevel: '', containerLevel: null, updatedAt: '',
  })
}

function openCreate() {
  editingId.value = null
  resetForm()
  formError.value = ''
  drawerOpen.value = true
}

async function openEdit(id: string) {
  saving.value = true
  formError.value = ''
  try {
    const detail = await $fetch<CommunicationDetail>(`/api/v1/information/communications/${id}`)
    editingId.value = id
    Object.assign(form, {
      summary: detail.summary,
      studentId: detail.studentId || '',
      guardianId: detail.guardianId || '',
      parentType: detail.parentType || '',
      attitudeType: detail.attitudeType || '',
      riskLevel: detail.riskLevel || '',
      containerLevel: detail.containerLevel,
      updatedAt: detail.updatedAt,
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
  saving.value = true
  formError.value = ''
  try {
    if (editingId.value) {
      await $fetch(`/api/v1/information/communications/${editingId.value}`, {
        method: 'PATCH',
        query: { expectedUpdatedAt: form.updatedAt },
        body: {
          summary: form.summary,
          parentType: form.parentType || null,
          attitudeType: form.attitudeType || null,
          riskLevel: form.riskLevel || null,
          containerLevel: form.containerLevel,
        },
      })
    } else {
      await $fetch('/api/v1/information/entities', {
        method: 'POST',
        body: {
          type: 'communication',
          summary: form.summary,
          studentId: form.studentId || undefined,
          guardianId: form.guardianId || undefined,
          parentType: form.parentType || undefined,
          attitudeType: form.attitudeType || undefined,
          riskLevel: form.riskLevel || undefined,
          containerLevel: form.containerLevel ?? undefined,
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
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle">{{ row.status === 'active' ? '有效' : '已归档' }}</UBadge></template>
      <template #riskLevel-data="{ value }"><UBadge v-if="value" color="warning" variant="subtle">{{ value }}</UBadge><span v-else>—</span></template>
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
        <div v-if="!editingId" class="grid gap-4 sm:grid-cols-2">
          <UFormField label="关联学生"><USelect v-model="form.studentId" :items="studentOptions" class="w-full" /></UFormField>
          <UFormField label="关联家长"><USelect v-model="form.guardianId" :items="guardianOptions" class="w-full" /></UFormField>
        </div>
        <UFormField label="沟通摘要" required><UTextarea v-model="form.summary" :rows="7" class="w-full" /></UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="家长类型"><UInput v-model="form.parentType" class="w-full" /></UFormField>
          <UFormField label="态度类型"><UInput v-model="form.attitudeType" class="w-full" /></UFormField>
          <UFormField label="风险等级"><UInput v-model="form.riskLevel" class="w-full" /></UFormField>
          <UFormField label="容纳水平（-4 至 4）"><UInput v-model.number="form.containerLevel" type="number" :min="-4" :max="4" class="w-full" /></UFormField>
        </div>
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
  </ManagementPage>
</template>

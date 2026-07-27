<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import type { ManagedListResult } from '~~/shared/management'

interface GuardianRow {
  id: string
  name: string
  phoneMasked: string | null
  relation: string | null
  ownerUserId: string
  ownerName: string
  linkedStudents: Array<{ id: string; name: string }>
  status: string
  updatedAt: string
}
interface OptionRow { id: string; name: string }

const list = useManagedList<GuardianRow>('/api/v1/school-admin/guardians')
const columns = [
  { key: 'name', label: '家长姓名', sortable: true },
  { key: 'relation', label: '关系', sortable: true },
  { key: 'phoneMasked', label: '联系电话', mobileHidden: true },
  { key: 'linkedStudents', label: '关联学生' },
  { key: 'ownerName', label: '负责教师', mobileHidden: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '有效', value: 'active' },
  { label: '已归档', value: 'archived' },
]
const { data: teacherData } = await useFetch<ManagedListResult<OptionRow>>('/api/v1/school-admin/teachers', {
  query: { page: 1, pageSize: 100, status: 'active' },
})
const teacherOptions = computed(() => (teacherData.value?.rows || []).map(item => ({ label: item.name, value: item.id })))

const drawerOpen = ref(false)
const editing = ref<GuardianRow | null>(null)
const lifecycle = ref<{ action: 'archive' | 'restore'; row: GuardianRow } | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({ name: '', phone: '', relation: '', ownerUserId: '' })

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', phone: '', relation: '', ownerUserId: '' })
  formError.value = ''
  drawerOpen.value = true
}

function openEdit(rowOrId: GuardianRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  editing.value = row
  Object.assign(form, {
    name: row.name,
    phone: '',
    relation: row.relation || '',
    ownerUserId: row.ownerUserId,
  })
  formError.value = ''
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
}

async function saveGuardian() {
  if (!form.name.trim() || !form.ownerUserId) {
    formError.value = '请填写家长姓名并选择负责教师'
    return
  }
  saving.value = true
  formError.value = ''
  const ownerChanged = editing.value?.ownerUserId !== form.ownerUserId
  const body: Record<string, unknown> = {
    name: form.name,
    relation: form.relation || null,
    ownerUserId: form.ownerUserId,
  }
  if (form.phone) body.phone = form.phone
  if (editing.value && ownerChanged) body.reason = '学校管理员在家长管理表中调整负责教师'
  try {
    if (editing.value) {
      await $fetch(`/api/v1/school-admin/guardians/${editing.value.id}`, {
        method: 'PATCH',
        query: { expectedUpdatedAt: editing.value.updatedAt },
        body,
      })
    } else {
      await $fetch('/api/v1/school-admin/guardians', { method: 'POST', body })
    }
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { statusCode?: number; data?: { message?: string } }
    formError.value = response.statusCode === 409
      ? '家长档案已被其他管理员修改，请刷新后重试'
      : response.data?.message || '家长保存失败'
  } finally {
    saving.value = false
  }
}

async function runLifecycle(reason: string) {
  if (!lifecycle.value) return
  saving.value = true
  formError.value = ''
  const { action, row } = lifecycle.value
  try {
    await $fetch(`/api/v1/school-admin/guardians/${row.id}/${action}`, {
      method: 'POST',
      body: { expectedUpdatedAt: row.updatedAt, reason },
    })
    lifecycle.value = null
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '家长状态更新失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ManagementPage title="家长管理" description="以最小披露方式管理家长档案、关联学生和负责教师；列表只显示脱敏电话。" :can-create="list.pageCapabilities.value.includes('create')" create-label="添加家长" @create="openCreate">
    <TableToolbar :search-value="list.q.value" :status-filter="list.statusFilter.value" :status-options="statusOptions" search-placeholder="输入完整姓名或外部编号..." :loading="list.loading.value" @search="list.onSearch" @update:status-filter="list.onStatusChange" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange" @row-click="openEdit">
      <template #linkedStudents-data="{ row }"><span class="text-sm">{{ row.linkedStudents.map((student: { name: string }) => student.name).join('、') || '—' }}</span></template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle">{{ row.status === 'active' ? '有效' : '已归档' }}</UBadge></template>
      <template #actions-data="{ row }">
        <RowActions
          :capabilities="row._capabilities"
          :row-id="row.id"
          @view="openEdit"
          @edit="openEdit"
          @transfer="openEdit"
          @archive="lifecycle = { action: 'archive', row }"
          @restore="lifecycle = { action: 'restore', row }"
        />
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <EntityFormDrawer :open="drawerOpen" :title="editing ? '编辑家长' : '添加家长'" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="saveGuardian">
        <UFormField label="家长姓名" required><UInput v-model="form.name" class="w-full" /></UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="与学生关系"><UInput v-model="form.relation" class="w-full" /></UFormField>
          <UFormField :label="editing ? '更新电话（留空表示不修改）' : '联系电话'"><UInput v-model="form.phone" class="w-full" /></UFormField>
          <UFormField label="负责教师" required><USelect v-model="form.ownerUserId" :items="teacherOptions" class="w-full" /></UFormField>
        </div>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" @click="closeDrawer">取消</UButton><UButton type="submit" :loading="saving">保存</UButton></div>
      </form>
    </EntityFormDrawer>
    <LifecycleDialog
      :open="Boolean(lifecycle)"
      :action="lifecycle?.action === 'archive' ? '归档家长' : '恢复家长'"
      :target-name="lifecycle?.row.name"
      :loading="saving"
      @close="lifecycle = null"
      @confirm="runLifecycle"
    />
  </ManagementPage>
</template>

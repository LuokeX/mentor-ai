<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import type { ManagedListResult } from '~~/shared/management'

interface UserRow {
  id: string
  name: string
  email: string
  role: 'teacher' | 'psychologist'
  status: 'active' | 'invited' | 'disabled'
  activatedAt: string | null
  lastLoginAt: string | null
  updatedAt: string
}
interface OptionRow { id: string; name: string; role?: string }
interface InvitationResult {
  activationToken: string
  expiresAt: string
}

const list = useManagedList<UserRow>('/api/v1/school-admin/users')
const columns = [
  { key: 'name', label: '姓名', sortable: true },
  { key: 'email', label: '邮箱', sortable: true },
  { key: 'role', label: '角色', sortable: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'lastLoginAt', label: '最近登录', sortable: true, mobileHidden: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '正常', value: 'active' },
  { label: '待激活', value: 'invited' },
  { label: '已停用', value: 'disabled' },
]
const roleOptions = [
  { label: '教师', value: 'teacher' },
  { label: '心理专员', value: 'psychologist' },
]
const roleLabels: Record<string, string> = { teacher: '教师', psychologist: '心理专员' }
const statusLabels: Record<string, string> = { active: '正常', invited: '待激活', disabled: '已停用' }

const { data: teacherData } = await useFetch<ManagedListResult<OptionRow>>('/api/v1/school-admin/teachers', {
  query: { page: 1, pageSize: 100, status: 'active' },
})
const teacherOptions = computed(() => (teacherData.value?.rows || []).map(item => ({ label: item.name, value: item.id })))
const psychologistOptions = computed(() => list.rows.value
  .filter(item => item.role === 'psychologist' && item.status === 'active')
  .map(item => ({ label: item.name, value: item.id })))

const drawerOpen = ref(false)
const editing = ref<UserRow | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({ name: '', email: '', role: 'teacher' as 'teacher' | 'psychologist', reactivate: false })
const invitation = ref<InvitationResult | null>(null)
const activationLink = computed(() => invitation.value ? `/activate?token=${encodeURIComponent(invitation.value.activationToken)}` : '')
const copied = ref(false)

const disableTarget = ref<UserRow | null>(null)
const disableForm = reactive({ toUserId: '', newPsychologistId: '__none__', reason: '' })
const deleteTarget = ref<UserRow | null>(null)

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', email: '', role: 'teacher', reactivate: false })
  formError.value = ''
  drawerOpen.value = true
}

function openEdit(rowOrId: UserRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  editing.value = row
  Object.assign(form, { name: row.name, email: row.email, role: row.role, reactivate: false })
  formError.value = ''
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
}

async function saveUser() {
  if (form.name.trim().length < 2 || !form.email.includes('@')) {
    formError.value = '请填写有效的姓名和邮箱'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    if (editing.value) {
      await $fetch(`/api/v1/school-admin/users/${editing.value.id}`, {
        method: 'PATCH',
        query: { expectedUpdatedAt: editing.value.updatedAt },
        body: {
          name: form.name,
          email: form.email,
          role: form.role,
          status: editing.value.status === 'disabled' && form.reactivate ? 'active' : undefined,
        },
      })
    } else {
      invitation.value = await $fetch<InvitationResult>('/api/v1/school-admin/users', {
        method: 'POST',
        body: { name: form.name, email: form.email, role: form.role },
      })
    }
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { statusCode?: number; data?: { message?: string } }
    formError.value = response.statusCode === 409
      ? response.data?.message || '账号状态已变化，请刷新后重试'
      : response.data?.message || '账号保存失败'
  } finally {
    saving.value = false
  }
}

function openDisable(id: string) {
  const row = list.rows.value.find(item => item.id === id)
  if (!row) return
  disableTarget.value = row
  Object.assign(disableForm, { toUserId: '', newPsychologistId: '__none__', reason: '' })
  formError.value = ''
}

function closeDisable() {
  disableTarget.value = null
}

async function transferAndDisable() {
  if (!disableTarget.value || !disableForm.toUserId || disableForm.reason.trim().length < 10) {
    formError.value = '请选择业务接收教师，并填写至少 10 个字符的停用事由'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    await $fetch(`/api/v1/school-admin/users/${disableTarget.value.id}/transfer-and-disable`, {
      method: 'POST',
      body: {
        toUserId: disableForm.toUserId,
        newPsychologistId: disableForm.newPsychologistId === '__none__' ? undefined : disableForm.newPsychologistId,
        reason: disableForm.reason,
      },
    })
    disableTarget.value = null
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '业务移交和账号停用失败'
  } finally {
    saving.value = false
  }
}

async function deleteInvitation(reason: string) {
  if (!deleteTarget.value) return
  saving.value = true
  formError.value = ''
  try {
    await $fetch(`/api/v1/school-admin/users/${deleteTarget.value.id}`, { method: 'DELETE' })
    deleteTarget.value = null
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || `邀请删除失败：${reason}`
  } finally {
    saving.value = false
  }
}

async function copyActivationLink() {
  if (!import.meta.client) return
  await navigator.clipboard.writeText(`${window.location.origin}${activationLink.value}`)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <ManagementPage title="账号管理" description="邀请、编辑、移交和停用本校教师及心理专员账号。" :can-create="list.pageCapabilities.value.includes('create')" create-label="邀请用户" @create="openCreate">
    <TableToolbar :search-value="list.q.value" :status-filter="list.statusFilter.value" :status-options="statusOptions" search-placeholder="搜索姓名或邮箱..." :loading="list.loading.value" @search="list.onSearch" @update:status-filter="list.onStatusChange" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange" @row-click="openEdit">
      <template #role-data="{ row }">{{ roleLabels[row.role] || row.role }}</template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : row.status === 'invited' ? 'info' : 'neutral'" variant="subtle">{{ statusLabels[row.status] || row.status }}</UBadge></template>
      <template #lastLoginAt-data="{ value }">{{ value ? new Date(String(value)).toLocaleString('zh-CN') : '从未登录' }}</template>
      <template #actions-data="{ row }">
        <RowActions
          :capabilities="row._capabilities"
          :row-id="row.id"
          @view="openEdit"
          @edit="openEdit"
          @disable="openDisable"
          @delete="deleteTarget = row"
        />
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <EntityFormDrawer :open="drawerOpen" :title="editing ? '编辑账号' : '邀请用户'" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="saveUser">
        <UFormField label="姓名" required><UInput v-model="form.name" class="w-full" /></UFormField>
        <UFormField label="邮箱" required><UInput v-model="form.email" type="email" class="w-full" /></UFormField>
        <UFormField label="角色" required><USelect v-model="form.role" :items="roleOptions" :disabled="Boolean(editing && editing.status !== 'invited')" class="w-full" /></UFormField>
        <UCheckbox v-if="editing?.status === 'disabled'" v-model="form.reactivate" label="重新启用该账号" />
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" @click="closeDrawer">取消</UButton><UButton type="submit" :loading="saving">{{ editing ? '保存' : '生成邀请' }}</UButton></div>
      </form>
    </EntityFormDrawer>

    <UModal :open="Boolean(invitation)" @update:open="value => { if (!value) invitation = null }">
      <template #header><h3 class="text-lg font-semibold">邀请已创建</h3></template>
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-gray-600">请通过校内安全渠道发送激活链接。链接 72 小时内有效，关闭后不再展示令牌。</p>
          <UInput :model-value="activationLink" readonly class="w-full" />
          <UButton icon="i-lucide-copy" variant="outline" @click="copyActivationLink">{{ copied ? '已复制' : '复制完整链接' }}</UButton>
        </div>
      </template>
    </UModal>

    <UModal :open="Boolean(disableTarget)" @update:open="value => { if (!value) disableTarget = null }">
      <template #header><h3 class="text-lg font-semibold">移交业务并停用账号</h3></template>
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-600">将 {{ disableTarget?.name }} 的全部业务责任链移交后，撤销其登录会话并停用账号。</p>
          <UFormField label="业务接收教师" required><USelect v-model="disableForm.toUserId" :items="teacherOptions" class="w-full" /></UFormField>
          <UFormField v-if="disableTarget?.role === 'psychologist'" label="未结转介接收心理专员"><USelect v-model="disableForm.newPsychologistId" :items="[{ label: '无未结转介', value: '__none__' }, ...psychologistOptions]" class="w-full" /></UFormField>
          <UFormField label="操作事由" required><UTextarea v-model="disableForm.reason" :rows="3" placeholder="至少 10 个字符" class="w-full" /></UFormField>
          <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        </div>
      </template>
      <template #footer><div class="flex justify-end gap-2"><UButton variant="outline" @click="closeDisable">取消</UButton><UButton color="error" :loading="saving" @click="transferAndDisable">确认移交并停用</UButton></div></template>
    </UModal>

    <LifecycleDialog
      :open="Boolean(deleteTarget)"
      action="删除未激活邀请"
      :target-name="deleteTarget?.name"
      confirm-label="确认删除"
      :loading="saving"
      @close="deleteTarget = null"
      @confirm="deleteInvitation"
    />
  </ManagementPage>
</template>

<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import type { ManagedListResult } from '~~/shared/management'

interface SchoolAdminRow {
  id: string
  schoolId: string
  schoolName: string
  name: string
  phone: string
  role: 'school_admin'
  status: 'active' | 'invited' | 'disabled'
  activatedAt: string | null
  lastLoginAt: string | null
  employeeNo: string | null
  updatedAt: string
}
interface CreateResult {
  ok: boolean
  id: string
  initialPassword?: string
}

const list = useManagedList<SchoolAdminRow>('/api/v1/platform-admin/users')
const columns = [
  { key: 'schoolName', label: '学校', sortable: true },
  { key: 'name', label: '姓名', sortable: true },
  { key: 'phone', label: '手机号', sortable: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'lastLoginAt', label: '最近登录', sortable: true, mobileHidden: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '正常', value: 'active' },
  { label: '已停用', value: 'disabled' },
]
const statusLabels: Record<string, string> = { active: '正常', invited: '待激活', disabled: '已停用' }
const statusColors: Record<string, 'success' | 'warning' | 'neutral'> = { active: 'success', invited: 'warning', disabled: 'neutral' }

const schoolOptions = ref<{ label: string; value: string }[]>([])
const drawerOpen = ref(false)
const editing = ref<SchoolAdminRow | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({
  schoolId: '', name: '', phone: '', employeeNo: '', password: '',
  status: 'active' as 'active' | 'disabled', disableReason: '',
})
const createdResult = ref<CreateResult | null>(null)
const copied = ref(false)

const disableTarget = ref<SchoolAdminRow | null>(null)
const disableReason = ref('')

async function loadSchools() {
  if (schoolOptions.value.length) return
  const res = await $fetch<ManagedListResult<{ id: string; name: string }>>('/api/v1/platform-admin/schools', {
    query: { page: 1, pageSize: 100 },
  })
  schoolOptions.value = (res.rows || []).map(s => ({ label: s.name, value: s.id }))
}

function openCreate() {
  editing.value = null
  Object.assign(form, { schoolId: '', name: '', phone: '', employeeNo: '', password: '', status: 'active', disableReason: '' })
  formError.value = ''
  void loadSchools()
  drawerOpen.value = true
}

function openEdit(rowOrId: SchoolAdminRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  editing.value = row
  Object.assign(form, {
    schoolId: row.schoolId, name: row.name, phone: row.phone,
    employeeNo: row.employeeNo || '', password: '',
    status: row.status === 'active' ? 'active' : 'disabled', disableReason: '',
  })
  formError.value = ''
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
}

async function saveUser() {
  if (form.name.trim().length < 2 || !/^1[3-9]\d{9}$/.test(form.phone)) {
    formError.value = '请填写有效的姓名和手机号'
    return
  }
  if (form.password && form.password.length < 8) {
    formError.value = '密码至少 8 位；编辑时留空表示不修改'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    if (editing.value) {
      const body: Record<string, unknown> = { name: form.name, phone: form.phone }
      if (form.employeeNo) body.employeeNo = form.employeeNo
      if (form.password) body.password = form.password
      if (form.status !== (editing.value.status === 'active' ? 'active' : 'disabled')) {
        body.status = form.status
        if (form.status === 'disabled' && form.disableReason) body.reason = form.disableReason
      }
      await $fetch(`/api/v1/platform-admin/users/${editing.value.id}`, {
        method: 'PATCH',
        query: { expectedUpdatedAt: editing.value.updatedAt },
        body,
      })
    } else {
      if (!form.schoolId) {
        formError.value = '请选择所属学校'
        return
      }
      if (form.password && form.password.length < 8) {
        formError.value = '初始密码至少 8 位；留空将自动生成'
        return
      }
      const body: Record<string, unknown> = {
        schoolId: form.schoolId, name: form.name, phone: form.phone,
      }
      if (form.employeeNo) body.employeeNo = form.employeeNo
      if (form.password) body.password = form.password
      createdResult.value = await $fetch<CreateResult>('/api/v1/platform-admin/users', { method: 'POST', body })
    }
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { statusCode?: number; data?: { message?: string } }
    formError.value = response.statusCode === 409
      ? response.data?.message || '记录状态已变化，请刷新后重试'
      : response.data?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

function openDisable(row: SchoolAdminRow) {
  disableTarget.value = row
  disableReason.value = ''
  formError.value = ''
}

async function confirmDisable() {
  if (!disableTarget.value) return
  saving.value = true
  formError.value = ''
  try {
    await $fetch(`/api/v1/platform-admin/users/${disableTarget.value.id}`, {
      method: 'PATCH',
      query: { expectedUpdatedAt: disableTarget.value.updatedAt },
      body: { status: 'disabled', reason: disableReason.value || undefined },
    })
    disableTarget.value = null
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '停用失败'
  } finally {
    saving.value = false
  }
}

async function reactivate(row: SchoolAdminRow) {
  saving.value = true
  formError.value = ''
  try {
    await $fetch(`/api/v1/platform-admin/users/${row.id}`, {
      method: 'PATCH',
      query: { expectedUpdatedAt: row.updatedAt },
      body: { status: 'active' },
    })
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '启用失败'
  } finally {
    saving.value = false
  }
}

async function copyInitialPassword() {
  if (!import.meta.client || !createdResult.value?.initialPassword) return
  await navigator.clipboard.writeText(createdResult.value.initialPassword)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <ManagementPage
    title="学校管理员账户"
    description="查看并管理所有学校的学校管理员账号：创建（指定学校）、编辑资料、启用与停用。"
    :can-create="list.pageCapabilities.value.includes('create')"
    create-label="添加学校管理员"
    @create="openCreate"
  >
    <TableToolbar
      :search-value="list.q.value"
      :status-filter="list.statusFilter.value"
      :status-options="statusOptions"
      search-placeholder="搜索姓名或手机号..."
      :loading="list.loading.value"
      @search="list.onSearch"
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
      @row-click="openEdit"
    >
      <template #status-data="{ row }">
        <UBadge :color="statusColors[row.status] || 'neutral'" variant="subtle">{{ statusLabels[row.status] || row.status }}</UBadge>
      </template>
      <template #lastLoginAt-data="{ value }">{{ value ? new Date(String(value)).toLocaleString('zh-CN') : '从未登录' }}</template>
      <template #actions-data="{ row }">
        <div class="flex items-center gap-1">
          <RowActions
            :capabilities="row._capabilities"
            :row-id="row.id"
            @view="openEdit"
            @edit="openEdit"
          />
          <UButton
            v-if="row.status === 'active'"
            size="xs"
            variant="soft"
            color="error"
            @click="openDisable(row)"
          >停用</UButton>
          <UButton
            v-else-if="row.status === 'disabled'"
            size="xs"
            variant="soft"
            color="success"
            @click="reactivate(row)"
          >启用</UButton>
        </div>
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination
      :page="list.page.value"
      :page-size="list.pageSize.value"
      :total="list.total.value"
      @update:page="list.onPageChange"
      @update:page-size="list.onPageSizeChange"
    />

    <EntityFormDrawer :open="drawerOpen" :title="editing ? '编辑学校管理员' : '添加学校管理员'" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="saveUser">
        <UFormField v-if="!editing" label="所属学校" required>
          <USelect v-model="form.schoolId" :items="schoolOptions" placeholder="选择学校..." class="w-full" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="姓名" required><UInput v-model="form.name" class="w-full" /></UFormField>
          <UFormField label="手机号" required><UInput v-model="form.phone" inputmode="numeric" maxlength="11" class="w-full" /></UFormField>
          <UFormField label="工号" hint="选填"><UInput v-model="form.employeeNo" class="w-full" /></UFormField>
          <UFormField v-if="!editing" label="初始密码" hint="留空将自动生成，仅展示一次">
            <UInput v-model="form.password" type="password" autocomplete="new-password" class="w-full" />
          </UFormField>
          <UFormField v-else label="重置密码" hint="留空表示不修改；重置后该账号现有会话将失效">
            <UInput v-model="form.password" type="password" autocomplete="new-password" class="w-full" />
          </UFormField>
          <UFormField v-if="editing" label="账号状态">
            <USelect
              v-model="form.status"
              :items="[{ label: '正常', value: 'active' }, { label: '停用', value: 'disabled' }]"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField v-if="editing && form.status === 'disabled'" label="停用事由" hint="选填">
          <UInput v-model="form.disableReason" class="w-full" />
        </UFormField>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="closeDrawer">取消</UButton>
          <UButton type="submit" :loading="saving">{{ editing ? '保存' : '创建账号' }}</UButton>
        </div>
      </form>
    </EntityFormDrawer>

    <UModal :open="Boolean(createdResult)" @update:open="value => { if (!value) createdResult = null }">
      <template #header><h3 class="text-lg font-semibold">学校管理员已创建</h3></template>
      <template #body>
        <div v-if="createdResult?.initialPassword" class="space-y-3">
          <p class="text-sm text-gray-600">账号已创建并可直接登录。系统生成的初始密码<strong>仅展示这一次</strong>，关闭后不可恢复，请立即复制并安全转交。</p>
          <UInput :model-value="createdResult.initialPassword" readonly class="w-full font-mono" />
          <UButton icon="i-lucide-copy" variant="outline" @click="copyInitialPassword">{{ copied ? '已复制' : '复制初始密码' }}</UButton>
        </div>
        <p v-else class="text-sm text-gray-600">账号已创建，可使用设置的密码直接登录。</p>
      </template>
    </UModal>

    <UModal :open="Boolean(disableTarget)" @update:open="value => { if (!value) disableTarget = null }">
      <template #header><h3 class="text-lg font-semibold">停用学校管理员</h3></template>
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-600">停用后 {{ disableTarget?.name }}（{{ disableTarget?.schoolName }}）将无法登录。school_admin 无业务移交问题，可直接停用。</p>
          <UFormField label="停用事由" hint="选填">
            <UInput v-model="disableReason" class="w-full" />
          </UFormField>
          <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="outline" @click="disableTarget = null">取消</UButton>
          <UButton color="error" :loading="saving" @click="confirmDisable">确认停用</UButton>
        </div>
      </template>
    </UModal>
  </ManagementPage>
</template>
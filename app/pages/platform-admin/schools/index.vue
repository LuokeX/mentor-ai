<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'

interface SchoolRow {
  id: string
  name: string
  code: string
  status: 'active' | 'disabled'
  updatedAt: string
}
interface SchoolCreateResult {
  schoolAdmin: { name: string; phone: string }
  initialPassword?: string
}

const list = useManagedList<SchoolRow>('/api/v1/platform-admin/schools')
const columns = [
  { key: 'name', label: '学校名称' },
  { key: 'code', label: '编码' },
  { key: 'status', label: '状态' },
  { key: 'updatedAt', label: '最近更新', mobileHidden: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '正常', value: 'active' },
  { label: '停用', value: 'disabled' },
]
const drawerOpen = ref(false)
const editing = ref<SchoolRow | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({ name: '', code: '', status: 'active' as 'active' | 'disabled', adminName: '', adminPhone: '', adminPassword: '' })
const created = ref<SchoolCreateResult | null>(null)
const copied = ref(false)

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', code: '', status: 'active', adminName: '', adminPhone: '', adminPassword: '' })
  formError.value = ''
  drawerOpen.value = true
}

function openEdit(rowOrId: SchoolRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  editing.value = row
  Object.assign(form, { name: row.name, code: row.code, status: row.status, adminName: '', adminPhone: '', adminPassword: '' })
  formError.value = ''
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
}

async function saveSchool() {
  if (!form.name.trim() || !/^[a-z0-9-]{2,40}$/.test(form.code)) {
    formError.value = '请填写学校名称；编码仅允许小写字母、数字和连字符'
    return
  }
  if (!editing.value && (form.adminName.trim().length < 2 || !/^1[3-9]\d{9}$/.test(form.adminPhone))) {
    formError.value = '请填写首位学校管理员姓名和手机号'
    return
  }
  if (!editing.value && form.adminPassword && form.adminPassword.length < 8) {
    formError.value = '管理员初始密码至少 8 位；留空将自动生成'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    if (editing.value) {
      await $fetch(`/api/v1/platform-admin/schools/${editing.value.id}`, {
        method: 'PATCH',
        query: { expectedUpdatedAt: editing.value.updatedAt },
        body: { name: form.name, code: form.code, status: form.status },
      })
    } else {
      created.value = await $fetch<SchoolCreateResult>('/api/v1/platform-admin/schools', {
        method: 'POST',
        body: {
          name: form.name,
          code: form.code,
          adminName: form.adminName,
          adminPhone: form.adminPhone,
          adminPassword: form.adminPassword || undefined,
        },
      })
    }
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { statusCode?: number; data?: { message?: string } }
    formError.value = response.data?.message || (response.statusCode === 409 ? '学校记录已变化，请刷新后重试' : '学校保存失败')
  } finally {
    saving.value = false
  }
}

async function copyInitialPassword() {
  if (!import.meta.client || !created.value?.initialPassword) return
  await navigator.clipboard.writeText(created.value.initialPassword)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <ManagementPage title="学校管理" description="注册学校并创建首位学校管理员，控制学校启停状态。" :can-create="list.pageCapabilities.value.includes('create')" create-label="注册学校" @create="openCreate">
    <TableToolbar :search-value="list.q.value" :status-filter="list.statusFilter.value" :status-options="statusOptions" search-placeholder="搜索学校名称..." :loading="list.loading.value" @search="list.onSearch" @update:status-filter="list.onStatusChange" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange" @row-click="openEdit">
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle">{{ row.status === 'active' ? '正常' : '停用' }}</UBadge></template>
      <template #updatedAt-data="{ value }">{{ new Date(String(value)).toLocaleString('zh-CN') }}</template>
      <template #actions-data="{ row }">
        <RowActions :capabilities="row._capabilities" :row-id="row.id" @view="openEdit" @edit="openEdit" />
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <EntityFormDrawer :open="drawerOpen" :title="editing ? '编辑学校' : '注册学校'" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="saveSchool">
        <UFormField label="学校名称" required><UInput v-model="form.name" class="w-full" /></UFormField>
        <UFormField label="学校编码" required><UInput v-model="form.code" class="w-full" /></UFormField>
        <USelect v-if="editing" v-model="form.status" :items="[{ label: '正常', value: 'active' }, { label: '停用', value: 'disabled' }]" class="w-full" />
        <template v-else>
          <UFormField label="首位管理员姓名" required><UInput v-model="form.adminName" class="w-full" /></UFormField>
          <UFormField label="首位管理员手机号" required><UInput v-model="form.adminPhone" inputmode="numeric" maxlength="11" class="w-full" /></UFormField>
          <UFormField label="管理员初始密码" hint="留空则系统自动生成 16 位随机密码，创建成功后一次性展示">
            <UInput v-model="form.adminPassword" type="password" minlength="8" maxlength="200" autocomplete="new-password" class="w-full" />
          </UFormField>
        </template>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2"><UButton variant="outline" @click="closeDrawer">取消</UButton><UButton type="submit" :loading="saving">保存</UButton></div>
      </form>
    </EntityFormDrawer>

    <UModal :open="Boolean(created)" @update:open="value => { if (!value) created = null }">
      <template #header><h3 class="text-lg font-semibold">学校与管理员已创建</h3></template>
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-gray-600">学校管理员 <strong>{{ created?.schoolAdmin.name }}</strong>（{{ created?.schoolAdmin.phone }}）已创建并可直接登录。</p>
          <div v-if="created?.initialPassword" class="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p class="text-sm font-medium text-amber-800">系统生成的初始密码仅展示一次，关闭后不再显示，请立即复制并安全转交。</p>
            <code class="mt-2 block break-all rounded bg-white px-3 py-2 font-mono text-sm">{{ created.initialPassword }}</code>
            <UButton size="sm" icon="i-lucide-copy" variant="outline" class="mt-2" @click="copyInitialPassword">{{ copied ? '已复制' : '复制密码' }}</UButton>
          </div>
          <p v-else class="text-sm text-gray-600">已使用管理员设置的初始密码，可直接登录。</p>
        </div>
      </template>
    </UModal>
  </ManagementPage>
</template>
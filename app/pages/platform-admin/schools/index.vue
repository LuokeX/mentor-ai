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
  activationToken: string
  expiresAt: string
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
const form = reactive({ name: '', code: '', status: 'active' as 'active' | 'disabled', adminName: '', adminPhone: '' })
const invitation = ref<SchoolCreateResult | null>(null)
const activationLink = computed(() => invitation.value ? `/activate?token=${encodeURIComponent(invitation.value.activationToken)}` : '')
const copied = ref(false)

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', code: '', status: 'active', adminName: '', adminPhone: '' })
  formError.value = ''
  drawerOpen.value = true
}

function openEdit(rowOrId: SchoolRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  editing.value = row
  Object.assign(form, { name: row.name, code: row.code, status: row.status, adminName: '', adminPhone: '' })
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
      invitation.value = await $fetch<SchoolCreateResult>('/api/v1/platform-admin/schools', {
        method: 'POST',
        body: { name: form.name, code: form.code, adminName: form.adminName, adminPhone: form.adminPhone },
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

async function copyActivationLink() {
  if (!import.meta.client) return
  await navigator.clipboard.writeText(`${window.location.origin}${activationLink.value}`)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <ManagementPage title="学校管理" description="注册学校、邀请首位学校管理员，并控制学校启停状态。" :can-create="list.pageCapabilities.value.includes('create')" create-label="注册学校" @create="openCreate">
    <TableToolbar :search-value="list.q.value" :status-filter="list.statusFilter.value" :status-options="statusOptions" search-placeholder="搜索学校名称..." :loading="list.loading.value" @search="list.onSearch" @update:status-filter="list.onStatusChange" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange" @row-click="openEdit">
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle">{{ row.status === 'active' ? '正常' : '停用' }}</UBadge></template>
      <template #updatedAt-data="{ value }">{{ new Date(String(value)).toLocaleString('zh-CN') }}</template>
      <template #actions-data="{ row }"><RowActions :capabilities="row._capabilities" :row-id="row.id" @view="openEdit" @edit="openEdit" /></template>
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
          <UFormField label="首位管理员手机号" required><UInput v-model="form.adminPhone" type="tel" inputmode="numeric" maxlength="11" class="w-full" /></UFormField>
        </template>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2"><UButton variant="outline" @click="closeDrawer">取消</UButton><UButton type="submit" :loading="saving">保存</UButton></div>
      </form>
    </EntityFormDrawer>

    <UModal :open="Boolean(invitation)" @update:open="value => { if (!value) invitation = null }">
      <template #header><h3 class="text-lg font-semibold">学校和管理员邀请已创建</h3></template>
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-gray-600">请通过校内安全渠道发送激活链接；关闭后不再展示令牌。</p>
          <UInput :model-value="activationLink" readonly class="w-full" />
          <UButton icon="i-lucide-copy" variant="outline" @click="copyActivationLink">{{ copied ? '已复制' : '复制完整链接' }}</UButton>
        </div>
      </template>
    </UModal>
  </ManagementPage>
</template>

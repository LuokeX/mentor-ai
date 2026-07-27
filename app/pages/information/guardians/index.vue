<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'

interface GuardianRow {
  id: string
  name: string
  phoneMasked: string | null
  relation: string | null
  status: string
  updatedAt: string
}

const list = useManagedList<GuardianRow>('/api/v1/information/guardians')
const columns = [
  { key: 'name', label: '家长姓名' },
  { key: 'relation', label: '关系', sortable: true },
  { key: 'phoneMasked', label: '联系电话', mobileHidden: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'updatedAt', label: '最近更新', sortable: true, mobileHidden: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '有效', value: 'active' },
  { label: '已归档', value: 'archived' },
]
const drawerOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const form = reactive({ name: '', phone: '', relation: '' })

function openCreate() {
  Object.assign(form, { name: '', phone: '', relation: '' })
  formError.value = ''
  drawerOpen.value = true
}

async function createGuardian() {
  if (!form.name.trim()) {
    formError.value = '请填写家长姓名'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    await $fetch('/api/v1/information/entities', {
      method: 'POST',
      body: {
        type: 'guardian',
        name: form.name,
        phone: form.phone || undefined,
        relation: form.relation || undefined,
      },
    })
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '家长创建失败'
  } finally {
    saving.value = false
  }
}

function openGuardian(id: string) {
  void navigateTo(`/information/guardians/${id}`)
}

function openGuardianRow(row: GuardianRow) {
  openGuardian(row.id)
}

function closeDrawer() {
  drawerOpen.value = false
}
</script>

<template>
  <ManagementPage
    title="关联家长"
    description="维护与当前学生相关的家长档案和关联关系。"
    :can-create="list.pageCapabilities.value.includes('create')"
    create-label="添加家长"
    @create="openCreate"
  >
    <TableToolbar
      :search-value="list.q.value"
      :status-filter="list.statusFilter.value"
      :status-options="statusOptions"
      search-placeholder="输入完整姓名搜索..."
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
      @row-click="openGuardianRow"
    >
      <template #status-data="{ row }">
        <UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle" size="xs">
          {{ row.status === 'active' ? '有效' : '已归档' }}
        </UBadge>
      </template>
      <template #updatedAt-data="{ value }">{{ new Date(String(value)).toLocaleDateString('zh-CN') }}</template>
      <template #actions-data="{ row }">
        <RowActions
          :capabilities="row._capabilities"
          :row-id="row.id"
          @view="openGuardian"
          @edit="openGuardian"
        />
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ list.error.value }}</div>
    <TablePagination
      :page="list.page.value"
      :page-size="list.pageSize.value"
      :total="list.total.value"
      @update:page="list.onPageChange"
      @update:page-size="list.onPageSizeChange"
    />

    <EntityFormDrawer :open="drawerOpen" title="添加家长" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="createGuardian">
        <UFormField label="家长姓名" required><UInput v-model="form.name" class="w-full" /></UFormField>
        <UFormField label="与学生关系"><UInput v-model="form.relation" class="w-full" /></UFormField>
        <UFormField label="联系电话"><UInput v-model="form.phone" class="w-full" /></UFormField>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="closeDrawer">取消</UButton>
          <UButton type="submit" :loading="saving">保存</UButton>
        </div>
      </form>
    </EntityFormDrawer>
  </ManagementPage>
</template>

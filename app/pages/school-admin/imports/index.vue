<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'

type ImportType = 'users' | 'classes' | 'students' | 'guardians'
interface ImportRow {
  id: string
  importType: ImportType
  status: string
  totalRows: number
  createdRows: number
  updatedRows: number
  skippedRows: number
  errorCount: number
  createdAt: string
}
interface PreviewResult {
  previewId: string
  checksum: string
  totalRows: number
  validRows: number
  errors: Array<{ row: number; code: string; message: string }>
  sample: Array<Record<string, string>>
}
interface CommitResult {
  created: number
  updated: number
  skipped: number
  invitations: Array<{ email: string; name: string; activationToken: string; expiresAt: string }>
}

const list = useManagedList<ImportRow>('/api/v1/school-admin/imports')
const columns = [
  { key: 'importType', label: '导入类型' },
  { key: 'status', label: '状态' },
  { key: 'totalRows', label: '总行数' },
  { key: 'createdRows', label: '新增' },
  { key: 'updatedRows', label: '更新' },
  { key: 'skippedRows', label: '跳过' },
  { key: 'errorCount', label: '错误' },
  { key: 'createdAt', label: '导入时间', mobileHidden: true },
]
const typeOptions = [
  { label: '账号', value: 'users' },
  { label: '班级', value: 'classes' },
  { label: '学生', value: 'students' },
  { label: '家长', value: 'guardians' },
]
const typeLabels = Object.fromEntries(typeOptions.map(item => [item.value, item.label]))
const drawerOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const importType = ref<ImportType>('users')
const contentBase64 = ref('')
const filename = ref('')
const preview = ref<PreviewResult | null>(null)
const committed = ref<CommitResult | null>(null)

function openImport() {
  importType.value = 'users'
  contentBase64.value = ''
  filename.value = ''
  preview.value = null
  committed.value = null
  formError.value = ''
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
}

async function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 2 * 1024 * 1024) {
    formError.value = '文件不能超过 2 MB'
    return
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  contentBase64.value = btoa(binary)
  filename.value = file.name
  preview.value = null
  committed.value = null
  formError.value = ''
}

async function previewImport() {
  if (!contentBase64.value) {
    formError.value = '请先选择 CSV 文件'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    preview.value = await $fetch<PreviewResult>('/api/v1/school-admin/imports/preview', {
      method: 'POST',
      body: { type: importType.value, contentBase64: contentBase64.value },
    })
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '预检失败'
  } finally {
    saving.value = false
  }
}

async function commitImport() {
  if (!preview.value || preview.value.errors.length) return
  saving.value = true
  formError.value = ''
  try {
    committed.value = await $fetch<CommitResult>('/api/v1/school-admin/imports/commit', {
      method: 'POST',
      body: {
        previewId: preview.value.previewId,
        type: importType.value,
        checksum: preview.value.checksum,
        contentBase64: contentBase64.value,
      },
    })
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '导入提交失败'
  } finally {
    saving.value = false
  }
}

function activationLink(token: string) {
  return `/activate?token=${encodeURIComponent(token)}`
}
</script>

<template>
  <ManagementPage title="导入管理" description="使用标准 CSV 模板预检后导入；账号导入统一生成 72 小时激活邀请。" :can-create="list.pageCapabilities.value.includes('create')" create-label="新建导入" @create="openImport">
    <TableToolbar :loading="list.loading.value" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value">
      <template #importType-data="{ value }">{{ typeLabels[String(value)] || value }}</template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'committed' ? 'success' : row.status === 'invalid' ? 'error' : 'warning'" variant="subtle">{{ row.status }}</UBadge></template>
      <template #createdAt-data="{ value }">{{ new Date(String(value)).toLocaleString('zh-CN') }}</template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <EntityFormDrawer :open="drawerOpen" title="新建数据导入" @close="drawerOpen = false">
      <div class="space-y-4">
        <UFormField label="导入类型" required><USelect v-model="importType" :items="typeOptions" :disabled="Boolean(preview)" class="w-full" /></UFormField>
        <a :href="`/api/v1/school-admin/imports/templates/${importType}`" class="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline"><UIcon name="i-lucide-download" />下载对应 CSV 模板</a>
        <UFormField label="CSV 文件" required>
          <input type="file" accept=".csv,text/csv" class="block w-full rounded-lg border border-gray-200 p-3 text-sm" :disabled="Boolean(committed)" @change="onFileChange">
          <p v-if="filename" class="mt-1 text-xs text-gray-500">{{ filename }}</p>
        </UFormField>
        <UButton v-if="!preview" :loading="saving" :disabled="!contentBase64" @click="previewImport">执行预检</UButton>

        <div v-if="preview" class="space-y-3 rounded-lg border border-gray-200 p-4">
          <div class="flex gap-4 text-sm"><span>总行数：{{ preview.totalRows }}</span><span class="text-emerald-700">有效：{{ preview.validRows }}</span><span :class="preview.errors.length ? 'text-red-700' : 'text-gray-500'">错误：{{ preview.errors.length }}</span></div>
          <div v-if="preview.errors.length" class="max-h-48 overflow-auto rounded bg-red-50 p-3 text-xs text-red-700">
            <p v-for="error in preview.errors" :key="`${error.row}-${error.code}`">第 {{ error.row }} 行：{{ error.message }}（{{ error.code }}）</p>
          </div>
          <UButton v-else-if="!committed" :loading="saving" @click="commitImport">确认提交导入</UButton>
        </div>

        <div v-if="committed" class="space-y-3 rounded-lg bg-emerald-50 p-4 text-sm">
          <p class="font-medium text-emerald-800">导入完成：新增 {{ committed.created }}，更新 {{ committed.updated }}，跳过 {{ committed.skipped }}</p>
          <div v-if="committed.invitations.length" class="space-y-2">
            <p class="text-amber-800">以下激活链接仅本次展示，请通过安全渠道发送：</p>
            <div v-for="item in committed.invitations" :key="item.email" class="rounded bg-white p-2">
              <p>{{ item.name }} · {{ item.email }}</p>
              <code class="break-all text-xs">{{ activationLink(item.activationToken) }}</code>
            </div>
          </div>
        </div>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end"><UButton variant="outline" @click="closeDrawer">{{ committed ? '完成' : '关闭' }}</UButton></div>
      </div>
    </EntityFormDrawer>
  </ManagementPage>
</template>

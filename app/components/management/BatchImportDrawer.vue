<script setup lang="ts">
/**
 * 信息中心批量导入抽屉：下载模板 → 选择 Excel → 预检 → 确认导入。
 * 学生/家长两个列表页共用；预检与提交均为两阶段（服务端严格模式，有错误整批不写入）。
 */
interface ImportRowError {
  row: number
  code: string
  message: string
}
interface PreviewResult {
  checksum: string
  totalRows: number
  validRows: number
  errors: ImportRowError[]
  sample: Array<Record<string, string>>
}
interface CommitResult {
  created: number
  totalRows: number
}

const emit = defineEmits<{ close: []; imported: [] }>()
const contentBase64 = ref('')
const filename = ref('')
const preview = ref<PreviewResult | null>(null)
const committed = ref<CommitResult | null>(null)
const saving = ref(false)
const formError = ref('')
const props = defineProps<{
  open: boolean
  title: string
  templateUrl: string
  previewUrl: string
  commitUrl: string
  /** 预检示例行的展示字段（如 ['name', 'className']），保持列顺序 */
  sampleFields: string[]
}>()

function reset() {
  contentBase64.value = ''
  filename.value = ''
  preview.value = null
  committed.value = null
  formError.value = ''
}

watch(() => props.open, (value) => {
  if (value) reset()
})

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
    formError.value = '请先选择 Excel 文件'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    preview.value = await $fetch<PreviewResult>(props.previewUrl, {
      method: 'POST',
      body: { contentBase64: contentBase64.value },
    })
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
    committed.value = await $fetch<CommitResult>(props.commitUrl, {
      method: 'POST',
      body: { checksum: preview.value.checksum, contentBase64: contentBase64.value },
    })
    emit('imported')
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '导入提交失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <EntityFormDrawer :open="open" :title="title" @close="emit('close')">
    <div class="space-y-4">
      <a :href="templateUrl" class="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline">
        <UIcon name="i-lucide-download" />下载 Excel 导入模板
      </a>
      <UFormField label="Excel 文件" required>
        <input type="file" accept=".xlsx" class="block w-full rounded-lg border border-gray-200 p-3 text-sm" :disabled="Boolean(committed)" @change="onFileChange">
        <p v-if="filename" class="mt-1 text-xs text-gray-500">{{ filename }}</p>
      </UFormField>
      <UButton v-if="!preview" :loading="saving" :disabled="!contentBase64" @click="previewImport">执行预检</UButton>

      <div v-if="preview" class="space-y-3 rounded-lg border border-gray-200 p-4">
        <div class="flex gap-4 text-sm">
          <span>总行数：{{ preview.totalRows }}</span>
          <span class="text-emerald-700">有效：{{ preview.validRows }}</span>
          <span :class="preview.errors.length ? 'text-red-700' : 'text-gray-500'">错误：{{ preview.errors.length }}</span>
        </div>
        <div v-if="preview.errors.length" class="max-h-48 overflow-auto rounded bg-red-50 p-3 text-xs text-red-700">
          <p v-for="error in preview.errors" :key="`${error.row}-${error.code}`">第 {{ error.row }} 行：{{ error.message }}（{{ error.code }}）</p>
          <p class="mt-1 font-medium">存在错误时整批不会导入，请修正文件后重新预检。</p>
        </div>
        <div v-else-if="!committed" class="space-y-3">
          <div class="rounded bg-slate-50 p-3 text-xs text-slate-600">
            <p class="font-medium">预检通过，将导入以下记录（示例）：</p>
            <p v-for="item in preview.sample" :key="item.row" class="mt-1">第 {{ item.row }} 行：{{ sampleFields.map(field => item[field] || '').join(' · ') }}</p>
          </div>
          <UButton :loading="saving" @click="commitImport">确认提交导入</UButton>
        </div>
      </div>

      <div v-if="committed" class="space-y-3 rounded-lg bg-emerald-50 p-4 text-sm">
        <p class="font-medium text-emerald-800">导入完成：新增 {{ committed.created }} 条记录，全部共 {{ committed.totalRows }} 行。</p>
      </div>
      <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
      <div class="flex justify-end"><UButton variant="outline" @click="emit('close')">{{ committed ? '完成' : '关闭' }}</UButton></div>
    </div>
  </EntityFormDrawer>
</template>
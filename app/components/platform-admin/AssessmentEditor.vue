<script setup lang="ts">
import type { AssessmentPayload } from '#shared/contracts'
import { moduleIdSchema, type ModuleId } from '#shared/contracts'

const props = defineProps<{
  payload: AssessmentPayload
  code: string
  name: string
  version: string
}>()

const emit = defineEmits<{
  'update:payload': [value: AssessmentPayload]
  'update:code': [value: string]
  'update:name': [value: string]
  'update:version': [value: string]
}>()

// ---- 本地编辑副本 ----
const safePayload = JSON.parse(JSON.stringify(props.payload))
if (!Array.isArray(safePayload.questions)) safePayload.questions = []
const editing = reactive<AssessmentPayload>(safePayload)

const selectedIndex = ref(0)
const selected = computed(() => editing.questions?.[selectedIndex.value] ?? null)

const modules: Array<{ label: string; value: ModuleId }> = [
  { label: '自我成长', value: 'self_growth' },
  { label: '班级系统', value: 'class_system' },
  { label: '家校沟通', value: 'home_school' },
  { label: '学生个案', value: 'student_case' }
]

// ---- 题目操作 ----
function addQuestion() {
  editing.questions.push({
    id: `q${editing.questions.length + 1}`,
    dimension: '',
    text: '',
    options: [
      { label: '完全不符合', value: 1 }, { label: '比较不符合', value: 2 },
      { label: '一般', value: 3 }, { label: '比较符合', value: 4 }, { label: '非常符合', value: 5 }
    ]
  })
  selectedIndex.value = editing.questions.length - 1
  emitUpdate()
}

function removeQuestion(index: number) {
  editing.questions.splice(index, 1)
  if (selectedIndex.value >= editing.questions.length) selectedIndex.value = Math.max(0, editing.questions.length - 1)
  emitUpdate()
}

function moveQuestion(from: number, to: number) {
  const item = editing.questions.splice(from, 1)[0]
  if (item) editing.questions.splice(to, 0, item)
  emitUpdate()
}

// ---- 选项操作 ----
function addOption(questionIndex: number) {
  const q = editing.questions[questionIndex]
  if (!q) return
  q.options.push({ label: '', value: q.options.length + 1 })
  emitUpdate()
}

function removeOption(qIdx: number, optIdx: number) {
  editing.questions[qIdx]?.options.splice(optIdx, 1)
  emitUpdate()
}

// ---- 导入/导出 ----
const importText = ref('')
function doImport() {
  try {
    const parsed = JSON.parse(importText.value)
    Object.assign(editing, { questions: parsed.questions || parsed })
    selectedIndex.value = 0
    importText.value = ''
    emitUpdate()
  } catch { alert('JSON 解析失败') }
}

function doExport() {
  const blob = new Blob([JSON.stringify(editing, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${editing.code || 'assessment'}.json`; a.click()
  URL.revokeObjectURL(url)
}

function emitUpdate() {
  emit('update:payload', { ...editing })
}

watch(() => props.payload, (v) => {
  Object.assign(editing, JSON.parse(JSON.stringify(v)))
}, { deep: true })

// ---- 预览用答案 ----
const previewAnswers = reactive<Record<string, number>>({})
watch(() => editing.questions, (qs) => {
  if (!Array.isArray(qs)) return
  for (const q of qs) { if (!(q.id in previewAnswers)) previewAnswers[q.id] = 3 }
}, { immediate: true, deep: true })
</script>

<template>
  <div class="space-y-6">
    <!-- 元数据区 -->
    <div class="grid gap-4 sm:grid-cols-4">
      <UFormField label="模块">
        <USelect v-model="editing.module" :items="modules" class="w-full" @update:model-value="emitUpdate()" />
      </UFormField>
      <UFormField label="代码">
        <UInput :model-value="code" class="w-full font-mono" @update:model-value="v => emit('update:code', String(v))" />
      </UFormField>
      <UFormField label="版本">
        <UInput :model-value="version" class="w-full font-mono" @update:model-value="v => emit('update:version', String(v))" />
      </UFormField>
      <UFormField label="预估时长(分钟)">
        <UInput v-model.number="editing.estimatedMinutes" type="number" min="1" max="30" class="w-full" @update:model-value="emitUpdate()" />
      </UFormField>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField label="标题">
        <UInput v-model="editing.title" class="w-full" @update:model-value="emitUpdate()" />
      </UFormField>
      <UFormField label="描述">
        <UInput v-model="editing.description" class="w-full" @update:model-value="emitUpdate()" />
      </UFormField>
    </div>

    <!-- 三栏布局: 题目列表 | 编辑器 | 预览 -->
    <div class="grid gap-4 min-h-[420px] lg:grid-cols-[14rem_1fr_18rem]">
      <!-- 左: 题目列表 -->
      <div class="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-semibold text-slate-500">{{ editing.questions.length }} 题</span>
          <UButton size="xs" icon="i-lucide-plus" @click="addQuestion">添加</UButton>
        </div>
        <div class="space-y-1 max-h-[380px] overflow-y-auto">
          <button
            v-for="(q, idx) in editing.questions" :key="q.id"
            class="w-full rounded-xl px-3 py-2 text-left text-xs transition"
            :class="selectedIndex === idx ? 'bg-indigo-100 text-indigo-800 font-medium' : 'hover:bg-slate-100 text-slate-600'"
            @click="selectedIndex = idx"
          >
            <div class="flex items-center justify-between">
              <span class="truncate">{{ q.id }} · {{ q.dimension || '未分类' }}</span>
              <button class="text-slate-400 hover:text-red-600" @click.stop="removeQuestion(idx)">&times;</button>
            </div>
            <span class="mt-0.5 block truncate text-slate-400">{{ q.text || '空题目' }}</span>
          </button>
        </div>
        <!-- 排序按钮 -->
        <div class="mt-3 flex gap-1">
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :disabled="selectedIndex === 0" @click="moveQuestion(selectedIndex, selectedIndex - 1)" />
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :disabled="selectedIndex >= editing.questions.length - 1" @click="moveQuestion(selectedIndex, selectedIndex + 1)" />
        </div>
      </div>

      <!-- 中: 题目编辑器 -->
      <div class="rounded-2xl border border-slate-200 p-4 space-y-4" v-if="selected">
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="ID">
            <UInput v-model="selected.id" class="w-full font-mono text-xs" @update:model-value="emitUpdate()" />
          </UFormField>
          <UFormField label="维度">
            <UInput v-model="selected.dimension" class="w-full" @update:model-value="emitUpdate()" />
          </UFormField>
        </div>
        <UFormField label="题目文本">
          <UTextarea v-model="selected.text" :rows="2" class="w-full" @update:model-value="emitUpdate()" />
        </UFormField>
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="辅助说明">
            <UInput v-model="selected.help" class="w-full" @update:model-value="emitUpdate()" />
          </UFormField>
          <UFormField label="反向计分">
            <div class="mt-2">
              <UToggle v-model="selected.reverse" @update:model-value="emitUpdate()" />
            </div>
          </UFormField>
        </div>
        <!-- 选项列表 -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-semibold text-slate-500">选项</span>
            <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addOption(selectedIndex)">添加选项</UButton>
          </div>
          <div class="space-y-2">
            <div v-for="(opt, oi) in selected.options" :key="oi" class="flex items-center gap-2">
              <UInput v-model="opt.label" size="xs" class="flex-1" placeholder="选项标签" @update:model-value="emitUpdate()" />
              <UInput v-model.number="opt.value" size="xs" type="number" class="w-16" @update:model-value="emitUpdate()" />
              <button class="text-slate-400 hover:text-red-600 text-sm" @click="removeOption(selectedIndex, oi)">&times;</button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="flex items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
        选择一个题目进行编辑
      </div>

      <!-- 右: 预览 -->
      <div class="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 class="text-xs font-semibold text-slate-400 mb-3">预览</h3>
        <div class="space-y-5">
          <div>
            <h4 class="font-semibold text-base">{{ editing.title || '题库标题' }}</h4>
            <p class="mt-1 text-xs text-slate-400">{{ editing.description }}</p>
          </div>
          <div v-for="q in editing.questions" :key="q.id" class="rounded-xl border border-slate-100 p-3">
            <div class="flex items-start justify-between gap-2">
              <p class="text-sm font-medium">{{ q.text || '题目文本预览' }}</p>
              <UBadge size="sm" variant="soft" color="neutral">{{ q.dimension || '维度' }}</UBadge>
            </div>
            <p v-if="q.help" class="mt-1 text-xs text-slate-400">{{ q.help }}</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                v-for="opt in q.options" :key="opt.value"
                class="rounded-full border px-3 py-1 text-xs"
                :class="previewAnswers[q.id] === opt.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'"
                @click="previewAnswers[q.id] = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部工具栏: 导入/导出 -->
    <div class="flex items-center justify-between border-t border-slate-100 pt-4">
      <div class="flex gap-2">
        <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-download" @click="doExport">导出 JSON</UButton>
        <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-upload" @click="importText = ''; /* opens import area */">导入 JSON</UButton>
      </div>
    </div>
    <!-- 导入区 -->
    <div v-if="importText !== undefined && importText === ''" class="rounded-2xl border border-dashed border-indigo-300 bg-indigo-50/30 p-4">
      <UTextarea v-model="importText" :rows="4" class="w-full font-mono text-xs" placeholder="粘贴 JSON..."/>
      <div class="mt-2 flex gap-2">
        <UButton size="xs" @click="doImport">确认导入</UButton>
        <UButton size="xs" color="neutral" variant="ghost" @click="importText = undefined as any">取消</UButton>
      </div>
    </div>
  </div>
</template>
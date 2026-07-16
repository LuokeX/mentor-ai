<script setup lang="ts">
import type { RuleConfig, ModuleId } from '#shared/contracts'

const props = defineProps<{
  payload: RuleConfig
}>()

const emit = defineEmits<{
  'update:payload': [value: RuleConfig]
}>()

// ---- 本地编辑副本 ----
const editing = reactive<RuleConfig>(JSON.parse(JSON.stringify(props.payload)))

// ---- computed 变量编辑 ----
const newComputedKey = ref('')
const newComputedExpr = ref('')
function addComputed() {
  if (!newComputedKey.value.trim() || !newComputedExpr.value.trim()) return
  editing.computed[newComputedKey.value.trim()] = newComputedExpr.value.trim()
  newComputedKey.value = ''
  newComputedExpr.value = ''
  emitUpdate()
}
function removeComputed(key: string) {
  delete editing.computed[key]
  emitUpdate()
}

// ---- 分支编辑 ----
function addBranch() {
  editing.branches.push({
    pri: editing.branches.length + 1,
    when: '',
    level: 'green',
    blocked: false,
    ruleId: `RULE-${editing.branches.length + 1}`,
    reasons: ['']
  })
  emitUpdate()
}
function removeBranch(idx: number) {
  editing.branches.splice(idx, 1)
  emitUpdate()
}
function addReason(branchIdx: number) {
  editing.branches[branchIdx]?.reasons.push('')
  emitUpdate()
}
function removeReason(branchIdx: number, reasonIdx: number) {
  editing.branches[branchIdx]?.reasons.splice(reasonIdx, 1)
  emitUpdate()
}

// ---- action / tool 编辑 ----
function addAction() {
  editing.actions.push({ title: '', detail: '', status: 'pending' })
  emitUpdate()
}
function removeAction(idx: number) { editing.actions.splice(idx, 1); emitUpdate() }
function addTool() {
  editing.tools.push({ title: '', content: '' })
  emitUpdate()
}
function removeTool(idx: number) { editing.tools.splice(idx, 1); emitUpdate() }

// ---- Crisis 编辑 ----
function toggleCrisis() {
  if (editing.crisis) { editing.crisis = undefined }
  else { editing.crisis = { when: '', blocked: true } }
  emitUpdate()
}

function emitUpdate() {
  emit('update:payload', { ...editing })
}

watch(() => props.payload, (v) => {
  Object.assign(editing, JSON.parse(JSON.stringify(v)))
}, { deep: true })

// ---- mock 测试 ----
const testAnswers = ref('{}')
const testResult = ref<any>(null)
const testError = ref('')

async function runTest() {
  testError.value = ''
  testResult.value = null
  try {
    const answers = JSON.parse(testAnswers.value)
    const res = await $fetch('/api/v1/assessments/test-rules', {
      method: 'POST',
      body: { module: editing.module, answers, config: editing }
    })
    testResult.value = res
  } catch (e: any) {
    testError.value = e?.data?.message || e?.message || '测试执行失败'
  }
}

// level 选项
const levelOptions = ['green', 'blue', 'yellow', 'orange', 'red', 'purple', 'survival', 'norming', 'operating', 'mature', 'L1', 'L2', 'L3', 'E']
</script>

<template>
  <div class="space-y-6">
    <!-- 模块 & 版本 -->
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField label="模块">
        <USelect v-model="editing.module" :items="[
          { label:'自我成长', value:'self_growth' },
          { label:'班级系统', value:'class_system' },
          { label:'家校沟通', value:'home_school' },
          { label:'学生个案', value:'student_case' }
        ]" class="w-full" @update:model-value="emitUpdate()" />
      </UFormField>
      <UFormField label="版本">
        <UInput v-model="editing.version" class="w-full font-mono" @update:model-value="emitUpdate()" />
      </UFormField>
    </div>

    <!-- Computed 变量区 -->
    <div class="rounded-2xl border border-slate-200 p-4">
      <h3 class="text-sm font-semibold mb-3">中间变量 (computed)</h3>
      <div class="space-y-2 mb-3">
        <div v-for="(expr, name) in editing.computed" :key="name" class="flex items-center gap-2 text-sm">
          <code class="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs font-mono">{{ name }}</code>
          <code class="flex-1 truncate rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-500">{{ expr }}</code>
          <button class="text-slate-400 hover:text-red-600 text-xs" @click="removeComputed(String(name))">&times;</button>
        </div>
      </div>
      <div class="flex gap-2">
        <UInput v-model="newComputedKey" size="xs" class="w-28 font-mono" placeholder="变量名" />
        <UInput v-model="newComputedExpr" size="xs" class="flex-1 font-mono" placeholder="表达式，如 SUM(scores)" />
        <UButton size="xs" icon="i-lucide-plus" @click="addComputed">添加</UButton>
      </div>
    </div>

    <!-- 分支编辑器 -->
    <div class="rounded-2xl border border-slate-200 p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold">条件分支 (branches)</h3>
        <UButton size="xs" icon="i-lucide-plus" @click="addBranch">添加分支</UButton>
      </div>
      <div class="space-y-4">
        <div v-for="(branch, bi) in editing.branches" :key="bi" class="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
          <div class="flex items-start justify-between mb-2">
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono font-semibold text-indigo-600">P{{ branch.pri }}</span>
              <UBadge size="sm" variant="soft">{{ branch.ruleId }}</UBadge>
            </div>
            <button class="text-slate-400 hover:text-red-600" @click="removeBranch(bi)">&times;</button>
          </div>
          <div class="grid gap-3 sm:grid-cols-4">
            <UFormField label="优先级">
              <UInput v-model.number="branch.pri" type="number" size="xs" class="w-full" @update:model-value="emitUpdate()" />
            </UFormField>
            <UFormField label="规则 ID">
              <UInput v-model="branch.ruleId" size="xs" class="w-full font-mono" @update:model-value="emitUpdate()" />
            </UFormField>
            <UFormField label="结果等级">
              <USelect v-model="branch.level" :items="levelOptions" size="xs" class="w-full" @update:model-value="emitUpdate()" />
            </UFormField>
            <UFormField label="阻断">
              <div class="mt-2"><UToggle v-model="branch.blocked" size="sm" @update:model-value="emitUpdate()" /></div>
            </UFormField>
          </div>
          <UFormField label="When 条件 (留空=总是匹配)" class="mt-3">
            <UInput v-model="branch.when" size="xs" class="w-full font-mono" placeholder="exhaustion >= 4 && meaningRisk >= 4" @update:model-value="emitUpdate()" />
          </UFormField>
          <!-- Reasons -->
          <div class="mt-3">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs text-slate-500">判断理由</span>
              <button class="text-xs text-indigo-600 hover:text-indigo-800" @click="addReason(bi)">+</button>
            </div>
            <div class="space-y-1">
              <div v-for="(r, ri) in branch.reasons" :key="ri" class="flex items-center gap-1">
                <UInput v-model="branch.reasons[ri]" size="xs" class="flex-1" @update:model-value="emitUpdate()" />
                <button class="text-slate-400 hover:text-red-600 text-xs" @click="removeReason(bi, ri)">&times;</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Actions & Tools -->
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="rounded-2xl border border-slate-200 p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold">行动建议 (actions)</h3>
          <UButton size="xs" icon="i-lucide-plus" @click="addAction">添加</UButton>
        </div>
        <div class="space-y-3">
          <div v-for="(act, ai) in editing.actions" :key="ai" class="rounded-xl border border-slate-100 p-2">
            <div class="flex justify-between mb-1">
              <span class="text-xs text-slate-400">#{{ ai + 1 }}</span>
              <button class="text-slate-400 hover:text-red-600 text-xs" @click="removeAction(ai)">&times;</button>
            </div>
            <UInput v-model="act.title" size="xs" class="w-full mb-1" placeholder="标题" @update:model-value="emitUpdate()" />
            <UTextarea v-model="act.detail" size="xs" :rows="2" class="w-full" placeholder="详细说明" @update:model-value="emitUpdate()" />
            <USelect v-model="act.status" size="xs" :items="['pending', 'in_progress', 'done']" class="w-full mt-1" @update:model-value="emitUpdate()" />
          </div>
        </div>
      </div>
      <div class="rounded-2xl border border-slate-200 p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold">工具卡片 (tools)</h3>
          <UButton size="xs" icon="i-lucide-plus" @click="addTool">添加</UButton>
        </div>
        <div class="space-y-3">
          <div v-for="(tool, ti) in editing.tools" :key="ti" class="rounded-xl border border-slate-100 p-2">
            <div class="flex justify-between mb-1">
              <span class="text-xs text-slate-400">#{{ ti + 1 }}</span>
              <button class="text-slate-400 hover:text-red-600 text-xs" @click="removeTool(ti)">&times;</button>
            </div>
            <UInput v-model="tool.title" size="xs" class="w-full mb-1" placeholder="工具名称" @update:model-value="emitUpdate()" />
            <UTextarea v-model="tool.content" size="xs" :rows="2" class="w-full" placeholder="工具内容" @update:model-value="emitUpdate()" />
          </div>
        </div>
      </div>
    </div>

    <!-- Crisis 安全红线 -->
    <div class="rounded-2xl border border-red-200 bg-red-50/30 p-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-red-700">安全红线 (crisis)</h3>
        <UToggle :model-value="!!editing.crisis" size="sm" @update:model-value="toggleCrisis()" />
      </div>
      <div v-if="editing.crisis" class="mt-3 grid gap-3">
        <UFormField label="When 条件">
          <UInput v-model="editing.crisis.when" size="xs" class="w-full font-mono" placeholder='level == "red" || level == "purple"' @update:model-value="emitUpdate()" />
        </UFormField>
      </div>
    </div>

    <!-- Mock 测试面板 -->
    <div class="rounded-2xl border border-indigo-200 bg-indigo-50/20 p-4">
      <h3 class="text-sm font-semibold text-indigo-700 mb-3">规则测试</h3>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <UTextarea v-model="testAnswers" :rows="5" class="w-full font-mono text-xs" placeholder='{"q1": 4, "q2": 3, "q3": 1, "q4": 3, "q5": 2}' />
          <UButton size="sm" class="mt-2" icon="i-lucide-play" @click="runTest">执行测试</UButton>
        </div>
        <div>
          <div v-if="testError" class="rounded-xl bg-red-50 p-3 text-xs text-red-700">{{ testError }}</div>
          <pre v-else-if="testResult" class="rounded-xl bg-slate-950 p-3 text-xs text-slate-100 max-h-[200px] overflow-y-auto">{{ JSON.stringify(testResult, null, 2) }}</pre>
          <div v-else class="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400">
            输入 mock 答案后点击执行测试
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
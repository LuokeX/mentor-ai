<script setup lang="ts">
const route = useRoute()
const id = String(route.params.id)
const { data, error, refresh } = await useFetch<any>(`/api/v1/information/classes/${id}`)
const pending = ref(false)
const { classStageLabel, classStageColor, caseSolutionStatusLabel } = useDisplayLabels()

// 班级事件
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({
  title: '',
  eventType: '班级建设',
  severity: '低',
  description: '',
  resolution: '',
  status: 'open',
  occurredAt: '',
})
const eventTypes = ['德育活动', '班级冲突', '集体异常', '班级建设', '其他'].map(value => ({ label: value, value }))
const severities = ['低', '中', '高', '严重'].map(value => ({ label: value, value }))
const statuses = [
  { label: '待处理', value: 'open' },
  { label: '已解决', value: 'resolved' },
  { label: '已关闭', value: 'closed' },
]
const eventStatusLabel = (s: string) => s === 'open' ? '待处理' : s === 'resolved' ? '已解决' : s === 'closed' ? '已关闭' : s

function openCreate() {
  editingId.value = null
  Object.assign(form, {
    title: '', eventType: '班级建设', severity: '低',
    description: '', resolution: '', status: 'open',
    occurredAt: new Date().toISOString().slice(0, 16),
  })
  formError.value = ''
  drawerOpen.value = true
}

function openEdit(row: any) {
  editingId.value = row.id
  Object.assign(form, {
    title: row.title,
    eventType: row.eventType,
    severity: row.severity,
    description: row.description || '',
    resolution: row.resolution || '',
    status: row.status,
    occurredAt: row.occurredAt ? String(row.occurredAt).slice(0, 16) : '',
  })
  formError.value = ''
  drawerOpen.value = true
}

async function saveEvent() {
  if (!form.title.trim()) {
    formError.value = '请填写事件标题'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    if (editingId.value) {
      const row = (data.value?.events || []).find((e: any) => e.id === editingId.value)
      await $fetch(`/api/v1/information/class-events/${editingId.value}`, {
        method: 'PATCH',
        query: { expectedUpdatedAt: row?.updatedAt },
        body: {
          title: form.title, eventType: form.eventType, severity: form.severity,
          description: form.description || null, resolution: form.resolution || null,
          status: form.status, occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : undefined,
        },
      })
    } else {
      await $fetch('/api/v1/information/class-events', {
        method: 'POST',
        body: {
          classId: id, title: form.title, eventType: form.eventType, severity: form.severity,
          description: form.description || undefined,
          occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : undefined,
        },
      })
    }
    drawerOpen.value = false
    await refresh()
  } catch (err: any) {
    formError.value = err?.data?.message || '保存失败，请重试'
  } finally { saving.value = false }
}

async function archiveEvent(eventId: string) {
  if (!confirm('确定归档这条班级事件吗？')) return
  pending.value = true
  try {
    await $fetch(`/api/v1/information/class-events/${eventId}`, { method: 'DELETE' })
    await refresh()
  } finally { pending.value = false }
}

const dimensionLabel: Record<string, string> = {
  '关系系统': '关系', '组织系统': '组织', '规范系统': '规范', '目标系统': '目标', '情感系统': '情感',
  '情感': '情感', '认知': '认知', '行为': '行为', '关系': '关系', '环境': '环境',
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-5 py-10">
    <template v-if="error">
      <div class="panel mx-auto max-w-2xl p-8 text-center">
        <UIcon name="i-lucide-school" class="mx-auto size-10 text-amber-500" />
        <h1 class="mt-4 text-2xl font-semibold">班级档案无法打开</h1>
        <p class="mt-3 text-sm leading-6 text-slate-500">该班级可能不存在，或当前登录账号不是这名班级的负责教师。</p>
        <div class="mt-6 flex justify-center gap-3">
          <UButton to="/information/classes">返回班级列表</UButton>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <UButton to="/information/classes" icon="i-lucide-arrow-left" color="neutral" variant="ghost">返回班级列表</UButton>
          <p class="mt-5 text-sm font-semibold text-sky-700">班级档案</p>
          <h1 class="mt-2 text-3xl font-semibold">{{ data?.class?.name || '班级详情' }}</h1>
          <p class="mt-2 text-sm text-slate-500">
            {{ data?.class?.grade ? `${data.class.grade} 年级` : '年级未填' }}
            <template v-if="data?.class?.externalCode"> · 编码 {{ data.class.externalCode }}</template>
            <template v-if="data?.class?.classTeacherName"> · 班主任 {{ data.class.classTeacherName }}</template>
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <UBadge v-if="data?.class?.stage" :color="classStageColor(data.class.stage)" variant="soft">
              <UIcon name="i-lucide-flag" class="size-3.5" /> 当前阶段：{{ classStageLabel(data.class.stage) }}
            </UBadge>
            <UBadge v-if="data?.class?.weakestSystem" color="info" variant="subtle">
              最薄弱系统：{{ data.class.weakestSystem }}
            </UBadge>
          </div>
        </div>
      </div>

      <div class="mt-8 grid gap-6 lg:grid-cols-2">
        <!-- 班级基础信息 -->
        <section class="panel p-6">
          <h2 class="text-xl font-semibold">班级基础信息</h2>
          <dl class="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div><dt class="text-slate-400">班级编码</dt><dd class="mt-1 font-medium">{{ data?.class?.externalCode || '—' }}</dd></div>
            <div><dt class="text-slate-400">年级</dt><dd class="mt-1 font-medium">{{ data?.class?.grade ? `${data.class.grade} 年级` : '—' }}</dd></div>
            <div><dt class="text-slate-400">班主任</dt><dd class="mt-1 font-medium">{{ data?.class?.classTeacherName || '—' }}</dd></div>
            <div><dt class="text-slate-400">学生人数</dt><dd class="mt-1 font-medium">{{ data?.class?.studentCount ?? '—' }}</dd></div>
            <div><dt class="text-slate-400">男女比例</dt><dd class="mt-1 font-medium">{{ data?.class?.genderRatio ? `${data.class.genderRatio.male} : ${data.class.genderRatio.female}` : '—' }}</dd></div>
            <div><dt class="text-slate-400">最近评估</dt><dd class="mt-1 font-medium">{{ data?.class?.assessedAt ? new Date(data.class.assessedAt).toLocaleDateString('zh-CN') : '未评估' }}</dd></div>
          </dl>
        </section>

        <!-- 测评结果 -->
        <section class="panel p-6">
          <h2 class="text-xl font-semibold">测评结果</h2>
          <p class="mt-2 text-sm text-slate-500">五系统自评维度均分（评估快照）</p>
          <div v-if="data?.class?.dimensions && Object.keys(data.class.dimensions).length" class="mt-5 space-y-3">
            <div v-for="(value, key) in data.class.dimensions" :key="key" class="flex items-center gap-3">
              <span class="w-16 shrink-0 text-sm text-slate-600">{{ dimensionLabel[key] || key }}</span>
              <div class="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div class="h-full rounded-full bg-sky-400" :style="{ width: `${Math.min(100, (Number(value) / 5) * 100)}%` }" />
              </div>
              <span class="w-8 text-right text-sm font-medium">{{ Number(value).toFixed(1) }}</span>
            </div>
            <p class="rounded-xl bg-sky-50 p-3 text-xs leading-5 text-sky-700">
              最薄弱系统：{{ data.class.weakestSystem || '—' }}。<template v-if="data?.class?.attentionDimensions?.length">需关注维度：{{ data.class.attentionDimensions.join('、') }}（均分 &lt; 3.0）。</template><template v-else>系统均分低于 3.0 的维度建议标注「需关注」并优先建设。</template>
            </p>
          </div>
          <p v-else class="mt-5 rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-400">尚未完成班级五系统评估，暂无测评结果</p>
        </section>
      </div>

      <!-- 近期事件 -->
      <section class="panel mt-6 p-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-xl font-semibold">近期事件</h2>
            <p class="mt-2 text-sm text-slate-500">德育或班级重点事件</p>
          </div>
          <UButton icon="i-lucide-plus" @click="openCreate">新增班级事件</UButton>
        </div>
        <div class="mt-5 space-y-3">
          <div v-for="item in data?.events" :key="item.id" class="flex items-start justify-between gap-4 rounded-2xl border border-slate-100 p-4">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <strong class="text-sm">{{ item.title }}</strong>
                <UBadge color="neutral" variant="subtle" size="xs">{{ item.eventType }}</UBadge>
                <UBadge :color="item.severity === '严重' ? 'error' : item.severity === '高' ? 'warning' : 'neutral'" variant="subtle" size="xs">{{ item.severity }}</UBadge>
                <UBadge :color="item.status === 'resolved' ? 'success' : item.status === 'closed' ? 'neutral' : 'warning'" variant="subtle" size="xs">{{ eventStatusLabel(item.status) }}</UBadge>
              </div>
              <p v-if="item.description" class="mt-2 text-sm leading-6 text-slate-600">{{ item.description }}</p>
              <p class="mt-2 text-xs text-slate-400">{{ item.occurredAt ? new Date(item.occurredAt).toLocaleString('zh-CN') : '' }}</p>
            </div>
            <div class="flex shrink-0 gap-2">
              <UButton size="xs" color="neutral" variant="ghost" @click="openEdit(item)">编辑</UButton>
              <UButton size="xs" color="neutral" variant="ghost" :loading="pending" @click="archiveEvent(item.id)">归档</UButton>
            </div>
          </div>
          <p v-if="!data?.events?.length" class="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-400">暂无班级事件记录</p>
        </div>
      </section>

      <!-- 事件抽屉 -->
      <USlideover v-model="drawerOpen">
        <div class="p-5">
          <h3 class="text-lg font-semibold">{{ editingId ? '编辑班级事件' : '新增班级事件' }}</h3>
          <div class="mt-5 space-y-4">
            <UFormField label="事件标题 *"><UInput v-model="form.title" class="w-full" placeholder="如：本月德育主题班会 / 班级冲突事件" /></UFormField>
            <div class="grid gap-3 md:grid-cols-3">
              <UFormField label="类型"><USelect v-model="form.eventType" :items="eventTypes" class="w-full" /></UFormField>
              <UFormField label="严重程度"><USelect v-model="form.severity" :items="severities" class="w-full" /></UFormField>
              <UFormField label="状态"><USelect v-model="form.status" :items="statuses" class="w-full" /></UFormField>
            </div>
            <UFormField label="发生时间"><UInput v-model="form.occurredAt" type="datetime-local" class="w-full" /></UFormField>
            <UFormField label="事件描述"><UTextarea v-model="form.description" :rows="4" class="w-full" placeholder="记录事件经过、涉及范围与初步判断" /></UFormField>
            <UFormField v-if="editingId" label="处理结果"><UTextarea v-model="form.resolution" :rows="3" class="w-full" placeholder="处理措施与结果" /></UFormField>
            <p v-if="formError" class="text-sm text-red-500">{{ formError }}</p>
            <button type="button" class="w-full rounded-lg bg-[var(--ui-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50" :disabled="saving" @click="saveEvent">保存</button>
          </div>
        </div>
      </USlideover>
    </template>
  </div>
</template>
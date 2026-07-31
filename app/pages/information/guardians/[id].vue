<script setup lang="ts">
const route = useRoute()
const id = String(route.params.id)
const { data, error, refresh } = await useFetch<any>(`/api/v1/information/guardians/${id}`)
const pending = ref(false)
const { moduleLabel, planStatusLabel, planStatusColor, riskLevelLabel } = useDisplayLabels()
const form = reactive({ name: '', phone: '', relation: '' })
const linkStudentId = ref('')
const communication = reactive({ studentId: '', summary: '', parentType: '', attitudeType: '', riskLevel: '低风险' })
const NONE_VALUE = '__none__'
const communicationStudentSelect = computed({
  get: () => communication.studentId || NONE_VALUE,
  set: value => { communication.studentId = value === NONE_VALUE ? '' : value }
})

watchEffect(() => {
  if (!data.value?.guardian) return
  form.name = data.value.guardian.name || ''
  form.phone = data.value.guardian.phone || ''
  form.relation = data.value.guardian.relation || ''
})

async function saveGuardian() {
  pending.value = true
  try {
    await $fetch(`/api/v1/information/guardians/${id}`, { method: 'PATCH', body: form })
    await refresh()
  } finally { pending.value = false }
}

async function linkStudent() {
  if (!linkStudentId.value) return
  pending.value = true
  try {
    await $fetch(`/api/v1/information/guardians/${id}/students`, { method: 'POST', body: { studentId: linkStudentId.value } })
    linkStudentId.value = ''
    await refresh()
  } finally { pending.value = false }
}

async function unlinkStudent(studentId: string) {
  pending.value = true
  try {
    await $fetch(`/api/v1/information/guardians/${id}/students/${studentId}`, { method: 'DELETE' })
    await refresh()
  } finally { pending.value = false }
}

async function createCommunication() {
  if (communication.summary.trim().length < 5) return
  pending.value = true
  try {
    await $fetch(`/api/v1/information/guardians/${id}/communications`, {
      method: 'POST',
      body: {
        studentId: communication.studentId || undefined,
        summary: communication.summary,
        parentType: communication.parentType || undefined,
        attitudeType: communication.attitudeType || undefined,
        riskLevel: communication.riskLevel || undefined
      }
    })
    Object.assign(communication, { studentId: '', summary: '', parentType: '', attitudeType: '', riskLevel: '低风险' })
    await refresh()
  } finally { pending.value = false }
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-5 py-10">
    <template v-if="error"><div class="panel mx-auto max-w-2xl p-8 text-center"><UIcon name="i-lucide-lock-keyhole" class="mx-auto size-10 text-amber-500" /><h1 class="mt-4 text-2xl font-semibold">家长档案无法打开</h1><p class="mt-3 text-sm leading-6 text-slate-500">该家长可能不存在，或当前登录账号不是这位家长的当前负责教师。请切换到负责教师账号，或让学校管理员调整负责教师。</p><p class="mt-3 font-mono text-xs text-slate-400">{{ error.statusCode || error.status }} · {{ error.statusMessage || error.message }}</p><div class="mt-6 flex justify-center gap-3"><UButton to="/information/guardians">返回信息中心</UButton><UButton to="/login" color="neutral" variant="soft">重新登录</UButton></div></div></template>
    <template v-else>
    <div class="flex flex-wrap items-start justify-between gap-4"><div><UButton to="/information/guardians" icon="i-lucide-arrow-left" color="neutral" variant="ghost">返回信息中心</UButton><p class="mt-5 text-sm font-semibold text-emerald-700">家长档案</p><h1 class="mt-2 text-3xl font-semibold">{{ data?.guardian?.name || '家长详情' }}</h1><p class="mt-2 text-sm text-slate-500">{{ data?.guardian?.relation || '关系未填' }} · 当前关联档案</p></div><div class="flex flex-wrap justify-end gap-2"><UButton :to="{ path: '/', query: { contextType: 'guardian', contextId: id } }" icon="i-lucide-sparkles">向 AI 咨询该家长</UButton><UBadge color="neutral" variant="soft">关联 {{ data?.students?.length || 0 }} 名学生</UBadge></div></div>
    <div class="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section class="panel p-6"><h2 class="text-xl font-semibold">基础信息</h2><div class="mt-5 space-y-4"><UFormField label="姓名"><UInput v-model="form.name" class="w-full" /></UFormField><UFormField label="电话"><UInput v-model="form.phone" class="w-full" /></UFormField><UFormField label="关系"><UInput v-model="form.relation" class="w-full" /></UFormField><UButton :loading="pending" @click="saveGuardian">保存家长信息</UButton></div></section>
      <section class="panel p-6"><h2 class="text-xl font-semibold">关联学生</h2><div class="mt-5 space-y-3"><div v-for="student in data?.students" :key="student.id" class="rounded-2xl border border-slate-100 p-4"><div class="flex items-start justify-between gap-3"><div><NuxtLink :to="`/information/students/${student.id}`" class="font-semibold hover:text-emerald-700">{{ student.name }}</NuxtLink><p class="mt-1 text-xs text-slate-500">{{ student.className || '未分班' }} · {{ student.gender || '性别未填' }}</p></div><UButton size="xs" color="neutral" variant="ghost" :loading="pending" @click="unlinkStudent(student.id)">解除</UButton></div></div><p v-if="!data?.students?.length" class="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-400">暂无关联学生</p></div><div class="mt-5 flex gap-2"><USelect v-model="linkStudentId" :items="(data?.studentOptions || []).filter((item:any)=>!(data?.students || []).some((s:any)=>s.id===item.id)).map((item:any)=>({label:`${item.name}${item.className ? ` · ${item.className}` : ''}`,value:item.id}))" placeholder="选择已有学生" class="min-w-0 flex-1" /><UButton :disabled="!linkStudentId" :loading="pending" @click="linkStudent">关联</UButton></div></section>
    </div>
    <section class="panel mt-6 p-6"><div class="flex items-center justify-between"><h2 class="text-xl font-semibold">家校沟通时间线</h2><UBadge color="neutral" variant="soft">{{ data?.communications?.length || 0 }} 条</UBadge></div><div class="mt-5 grid gap-4 lg:grid-cols-[1fr_.9fr]"><div class="space-y-4"><div v-for="item in data?.communications" :key="item.id" class="rounded-2xl border border-amber-100 bg-amber-50/50 p-4"><div class="flex flex-wrap gap-2"><UBadge v-if="item.studentName" color="neutral" variant="soft">学生：{{ item.studentName }}</UBadge><UBadge v-if="item.className" color="neutral" variant="soft">{{ item.className }}</UBadge><UBadge v-if="item.riskLevel" color="error" variant="soft">{{ riskLevelLabel(item.riskLevel) }}</UBadge></div><p class="mt-3 text-sm leading-7">{{ item.summary }}</p><p class="mt-2 text-xs text-slate-400">{{ new Date(item.occurredAt).toLocaleString('zh-CN') }}</p></div><p v-if="!data?.communications?.length" class="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-400">暂无沟通记录</p></div><div class="rounded-2xl border border-slate-100 p-4"><h3 class="font-semibold">新增沟通记录</h3><div class="mt-4 space-y-3"><USelect v-model="communicationStudentSelect" :items="[{label:'不指定学生',value:NONE_VALUE}, ...(data?.students || []).map((item:any)=>({label:item.name,value:item.id}))]" class="w-full" /><div class="grid gap-3 md:grid-cols-3"><UInput v-model="communication.parentType" placeholder="家长类型" /><UInput v-model="communication.attitudeType" placeholder="态度类型" /><UInput v-model="communication.riskLevel" placeholder="风险等级" /></div><UTextarea v-model="communication.summary" :rows="6" class="w-full" placeholder="记录沟通背景、家长诉求、教师回应和后续动作" /><button type="button" class="w-full rounded-lg bg-[var(--ui-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50" :disabled="communication.summary.trim().length < 5" @click="createCommunication">保存沟通记录</button></div></div></div></section>
    <section class="panel mt-6 p-6"><div class="flex items-center justify-between"><h2 class="text-xl font-semibold">相关方案记录</h2><UBadge color="neutral" variant="soft">{{ data?.plans?.length || 0 }} 个</UBadge></div><div class="mt-5 grid gap-4 md:grid-cols-2"><NuxtLink v-for="plan in data?.plans" :key="plan.id" :to="`/information/plans/${plan.id}`" class="block rounded-2xl border border-slate-100 p-4 transition hover:border-emerald-300 hover:bg-emerald-50/40"><div class="flex items-start justify-between gap-3"><div><strong>{{ plan.title }}</strong><p class="mt-1 text-xs text-slate-400">{{ plan.sourceLabel }} · {{ plan.riskLabel || moduleLabel(plan.module) }}</p></div><UBadge :color="planStatusColor(plan.status)" variant="soft">{{ planStatusLabel(plan.status) }}</UBadge></div><p class="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{{ plan.summary }}</p></NuxtLink><p v-if="!data?.plans?.length" class="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-400 md:col-span-2">暂无与该家长关联的方案</p></div></section>
    </template>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const id = String(route.params.id)
const { data, error, refresh } = await useFetch<any>(`/api/v1/information/guardians/${id}`)
const pending = ref(false)
const { moduleLabel, planStatusLabel, planStatusColor, riskLevelLabel, commRiskLevelLabel, commRiskLevelColor, severityLabel } = useDisplayLabels()
const form = reactive({ name: '', phone: '', relation: '', externalRef: '', profile: { parentProfileType: '', parentProfileSubtype: '', relationLevel: '', workshopParticipation: '', parentMeetingParticipation: '', onlineCourseParticipation: '', consultation: '' } })
const linkStudentId = ref('')
const communication = reactive({ studentId: '', summary: '', parentType: '', attitudeType: '', riskLevel: '低风险' })
const NONE_VALUE = '__none__'
const communicationStudentSelect = computed({
  get: () => communication.studentId || NONE_VALUE,
  set: value => { communication.studentId = value === NONE_VALUE ? '' : value }
})
/** 家校沟通评估快照（home_school 评估回写） */
const commSnapshot = computed(() => (data.value?.guardian?.guardianSnapshot as any)?.module === 'home_school' ? (data.value.guardian.guardianSnapshot as any) || null : null)
const commBadgeValue = computed(() => commSnapshot.value?.levelName || data.value?.guardian?.commRiskLevel || null)
const commColorValue = computed(() => commSnapshot.value?.level || data.value?.guardian?.commRiskLevel || null)
/** 家校沟通模块最近方案（工具清单/复评日期来源） */
const commPlan = computed(() => (data.value?.plans || []).find((plan: any) => plan.module === 'home_school'))
const parentProfileTypeOptions = [
  { label: 'P1-A 协同·积极高效', value: 'P1-A' }, { label: 'P1-B 协同·积极低效', value: 'P1-B' },
  { label: 'P1-C 协同·被动高效', value: 'P1-C' }, { label: 'P1-D 协同·被动低效', value: 'P1-D' },
  { label: 'P2 过度干预型', value: 'P2' }, { label: 'P3 缺位型', value: 'P3' },
  { label: 'P4 溺爱包庇型', value: 'P4' }, { label: 'P5 简单粗暴型', value: 'P5' }
]
const relationLevelOptions = [
  { label: 'A · 核心标杆型', value: 'A' }, { label: 'B · 积极配合型', value: 'B' }, { label: 'C · 中性观望型', value: 'C' },
  { label: 'D · 重点关注型', value: 'D' }, { label: 'E · 负面干扰型', value: 'E' }
]
const emptyProfile = () => ({ parentProfileType: '', parentProfileSubtype: '', relationLevel: '', workshopParticipation: '', parentMeetingParticipation: '', onlineCourseParticipation: '', consultation: '' })
const parentProfileTypeSelect = computed({
  get: () => form.profile.parentProfileType || NONE_VALUE,
  set: value => { form.profile.parentProfileType = value === NONE_VALUE ? '' : value }
})
const relationLevelSelect = computed({
  get: () => form.profile.relationLevel || NONE_VALUE,
  set: value => { form.profile.relationLevel = value === NONE_VALUE ? '' : value }
})

watchEffect(() => {
  if (!data.value?.guardian) return
  form.name = data.value.guardian.name || ''
  form.phone = data.value.guardian.phone || ''
  form.relation = data.value.guardian.relation || ''
  form.externalRef = data.value.guardian.externalRef || ''
  Object.assign(form.profile, emptyProfile(), data.value.guardian.profile || {})
})

async function saveGuardian() {
  pending.value = true
  try {
    await $fetch(`/api/v1/information/guardians/${id}`, { method: 'PATCH', body: { ...form, externalRef: form.externalRef || null, profile: { ...form.profile } } })
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
    <div class="flex flex-wrap items-start justify-between gap-4"><div><UButton to="/information/guardians" icon="i-lucide-arrow-left" color="neutral" variant="ghost">返回信息中心</UButton><p class="mt-5 text-sm font-semibold text-emerald-700">家长档案</p><h1 class="mt-2 text-3xl font-semibold">{{ data?.guardian?.name || '家长详情' }}</h1><p class="mt-2 text-sm text-slate-500">{{ data?.guardian?.relation || '关系未填' }} · 当前关联档案</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <UBadge v-if="commBadgeValue" :color="commRiskLevelColor(commColorValue || commBadgeValue)" variant="soft">
            <UIcon name="i-lucide-messages-square" class="size-3.5" /> 家校沟通 {{ commRiskLevelLabel(commBadgeValue) }}
          </UBadge>
          <UBadge v-if="commSnapshot?.blocked" color="error" variant="soft"><UIcon name="i-lucide-alert-octagon" class="size-3.5" /> 红线熔断·需危机介入</UBadge>
        </div>
      </div><div class="flex flex-wrap justify-end gap-2"><UButton :to="{ path: '/', query: { contextType: 'guardian', contextId: id } }" icon="i-lucide-sparkles">向 AI 咨询该家长</UButton><UBadge color="neutral" variant="soft">关联 {{ data?.students?.length || 0 }} 名学生</UBadge></div></div>
    <div class="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section class="panel p-6"><h2 class="text-xl font-semibold">基础信息</h2><div class="mt-5 space-y-4"><UFormField label="姓名"><UInput v-model="form.name" class="w-full" /></UFormField><UFormField label="电话"><UInput v-model="form.phone" class="w-full" /></UFormField><UFormField label="关系"><UInput v-model="form.relation" class="w-full" /></UFormField>
        <div class="rounded-2xl border border-slate-100 p-4"><h3 class="text-sm font-semibold">家校关系档案</h3><div class="mt-4 space-y-4">
          <UFormField label="关系档案编码"><UInput v-model="form.externalRef" class="w-full" placeholder="如 HS-2026-0001" /></UFormField>
          <div class="grid gap-3 md:grid-cols-2"><UFormField label="家长分型"><USelect v-model="parentProfileTypeSelect" :items="[{label:'未填写',value:NONE_VALUE}, ...parentProfileTypeOptions]" class="w-full" /></UFormField><UFormField label="分型亚型说明"><UInput v-model="form.profile.parentProfileSubtype" class="w-full" placeholder="如 P3-C，选填" /></UFormField></div>
          <UFormField label="家校关系等级"><USelect v-model="relationLevelSelect" :items="[{label:'未填写',value:NONE_VALUE}, ...relationLevelOptions]" class="w-full" /></UFormField>
        </div></div>
        <div class="rounded-2xl border border-slate-100 p-4"><h3 class="text-sm font-semibold">参与情况（二期）</h3><p class="mt-1 text-xs text-slate-400">记录家长参与工作坊、家长会、线上课与会商的实际情况</p><div class="mt-4 space-y-4">
          <UFormField label="家长工作坊参与情况"><UInput v-model="form.profile.workshopParticipation" class="w-full" placeholder="如：已参加 2 次/未参加" /></UFormField>
          <UFormField label="家长会参与情况"><UInput v-model="form.profile.parentMeetingParticipation" class="w-full" placeholder="如：全勤/缺席 1 次" /></UFormField>
          <UFormField label="线上家长课参与情况"><UInput v-model="form.profile.onlineCourseParticipation" class="w-full" placeholder="如：已完成 3 节" /></UFormField>
          <UFormField label="家长会商"><UInput v-model="form.profile.consultation" class="w-full" placeholder="是·详细说明 / 否" /></UFormField>
        </div></div>
        <UButton :loading="pending" @click="saveGuardian">保存家长信息</UButton></div></section>
      <section class="panel p-6"><h2 class="text-xl font-semibold">关联学生</h2><div class="mt-5 space-y-3"><div v-for="student in data?.students" :key="student.id" class="rounded-2xl border border-slate-100 p-4"><div class="flex items-start justify-between gap-3"><div><NuxtLink :to="`/information/students/${student.id}`" class="font-semibold hover:text-emerald-700">{{ student.name }}</NuxtLink><p class="mt-1 text-xs text-slate-500">{{ student.className || '未分班' }} · {{ student.gender || '性别未填' }}</p></div><UButton size="xs" color="neutral" variant="ghost" :loading="pending" @click="unlinkStudent(student.id)">解除</UButton></div></div><p v-if="!data?.students?.length" class="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-400">暂无关联学生</p></div><div class="mt-5 flex gap-2"><USelect v-model="linkStudentId" :items="(data?.studentOptions || []).filter((item:any)=>!(data?.students || []).some((s:any)=>s.id===item.id)).map((item:any)=>({label:`${item.name}${item.className ? ` · ${item.className}` : ''}`,value:item.id}))" placeholder="选择已有学生" class="min-w-0 flex-1" /><UButton :disabled="!linkStudentId" :loading="pending" @click="linkStudent">关联</UButton></div></section>
    </div>
    <section v-if="commSnapshot" class="panel mt-6 p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h2 class="text-xl font-semibold">家校沟通档案</h2><p class="mt-2 text-sm text-slate-500">六维诊断评估（评估量表 V2.0）的测评投影与分级结果；不构成关系或心理诊断。</p></div>
        <p v-if="commSnapshot?.assessedAt" class="text-xs text-slate-400">最近评估：{{ new Date(commSnapshot.assessedAt).toLocaleString('zh-CN') }}</p>
      </div>
      <div class="mt-5 grid gap-6 lg:grid-cols-2">
        <div class="rounded-2xl border border-slate-100 p-5">
          <h3 class="font-semibold">六维测评结果</h3>
          <div class="mt-4 space-y-3">
            <div v-for="dim in (commSnapshot?.dimensionScores || [])" :key="dim.code" class="flex items-center gap-3">
              <span class="w-24 shrink-0 text-sm text-slate-600">{{ dim.label }}</span>
              <div class="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100"><div class="h-full rounded-full" :class="dim.attention ? 'bg-red-400' : dim.score >= 4 ? 'bg-emerald-400' : 'bg-amber-400'" :style="{ width: `${(dim.score / 5) * 100}%` }" /></div>
              <span class="w-10 text-right text-sm font-medium">{{ dim.score.toFixed(1) }}</span>
              <UBadge v-if="dim.attention" color="error" variant="soft" size="xs">需关注</UBadge>
            </div>
            <p v-if="!commSnapshot?.dimensionScores?.length" class="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-400">暂无维度得分明细</p>
          </div>
          <div class="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm md:grid-cols-3">
            <div><p class="text-xs text-slate-400">六维度总分</p><p class="mt-1 font-semibold">{{ commSnapshot?.totalScore ?? '—' }}</p></div>
            <div><p class="text-xs text-slate-400">最薄弱维度</p><p class="mt-1 font-semibold">{{ commSnapshot?.weakestDimension?.label || '—' }}<template v-if="commSnapshot?.weakestDimension">（{{ commSnapshot.weakestDimension.score.toFixed(1) }} 分）</template></p></div>
            <div><p class="text-xs text-slate-400">需关注维度</p><p class="mt-1 font-semibold">{{ commSnapshot?.attentionDimensions?.length ? `${commSnapshot.attentionDimensions.length} 个 · ${commSnapshot.attentionDimensions.join('、')}` : '无' }}</p></div>
          </div>
        </div>
        <div class="rounded-2xl border border-slate-100 p-5">
          <h3 class="font-semibold">分级与危机状态</h3>
          <div class="mt-4 space-y-4 text-sm">
            <div class="flex flex-wrap items-center gap-2"><span class="w-24 text-slate-500">综合风险等级</span>
              <UBadge :color="commRiskLevelColor(commColorValue || commBadgeValue)" variant="subtle">{{ commRiskLevelLabel(commBadgeValue) }}</UBadge>
              <UBadge v-if="commSnapshot?.severity" color="neutral" variant="soft">严重度 {{ severityLabel(commSnapshot.severity) }}</UBadge>
            </div>
            <div class="flex flex-wrap items-start gap-2"><span class="w-24 shrink-0 text-slate-500">触发条件命中</span>
              <span v-if="commSnapshot?.reasons?.length" class="leading-6 text-slate-600">{{ commSnapshot.reasons.join('；') }}</span>
              <span v-else class="text-slate-400">—</span>
            </div>
            <div class="rounded-2xl border p-4" :class="commSnapshot?.blocked ? 'border-red-200 bg-red-50/60' : 'border-slate-100'">
              <p class="flex items-center gap-2 font-semibold" :class="commSnapshot?.blocked ? 'text-red-600' : 'text-slate-600'"><UIcon :name="commSnapshot?.blocked ? 'i-lucide-alert-octagon' : 'i-lucide-shield-check'" class="size-4" /> 红线熔断标记：{{ commSnapshot?.blocked ? '命中红线·极重·需危机介入' : '未命中红线' }}</p>
              <div v-if="commSnapshot?.matchedRedLines?.length" class="mt-3 space-y-3">
                <div v-for="(redLine, index) in commSnapshot.matchedRedLines" :key="index" class="rounded-xl bg-white/70 p-3 text-xs leading-5 text-slate-600">
                  <p class="font-medium text-red-600">红线条件：{{ redLine.condition }}</p>
                  <p v-if="redLine.description" class="mt-1">{{ redLine.description }}</p>
                  <p v-if="redLine.requiredActions" class="mt-1">处置要求：{{ redLine.requiredActions }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="mt-6 grid gap-6 lg:grid-cols-2">
        <div class="rounded-2xl border border-slate-100 p-5">
          <h3 class="font-semibold">归因结论</h3>
          <div class="mt-4 space-y-3 text-sm">
            <div class="flex flex-wrap items-center gap-2"><span class="w-24 text-slate-500">核心归因</span><span class="font-medium">{{ commSnapshot?.primaryAttribution || '—' }}</span></div>
            <div class="flex flex-wrap items-start gap-2"><span class="w-24 shrink-0 text-slate-500">归因构成</span>
              <span v-if="commSnapshot?.attributions?.length" class="leading-6 text-slate-600">{{ commSnapshot.attributions.map((a: any) => typeof a === 'string' ? a : a.name).join('、') }}</span>
              <span v-else class="text-slate-400">—</span>
            </div>
          </div>
        </div>
        <div class="rounded-2xl border border-slate-100 p-5">
          <h3 class="font-semibold">推荐工具与复评</h3>
          <div class="mt-4 space-y-3 text-sm">
            <div class="flex flex-wrap items-start gap-2"><span class="w-24 shrink-0 text-slate-500">工具清单</span>
              <span v-if="commPlan?.tools?.length" class="leading-6 text-slate-600">{{ commPlan.tools.map((tool: any) => tool.title).join('、') }}</span>
              <span v-else class="text-slate-400">随评估生成方案后推荐</span>
            </div>
            <div class="flex flex-wrap items-center gap-2"><span class="w-24 text-slate-500">复评安排</span>
              <span v-if="commPlan?.nextReviewAt" class="text-slate-600">下次复评 {{ new Date(commPlan.nextReviewAt).toLocaleDateString('zh-CN') }}</span>
              <span v-else class="text-slate-400">—</span>
            </div>
            <div class="flex flex-wrap items-start gap-2"><span class="w-24 shrink-0 text-slate-500">执行状态</span>
              <span v-if="commPlan" class="text-slate-600">方案 {{ planStatusLabel(commPlan.status) }}（复评记录在方案页查看）</span>
              <span v-else class="text-slate-400">尚未生成方案</span>
            </div>
            <UButton v-if="commPlan" :to="`/information/plans/${commPlan.id}`" icon="i-lucide-file-text" size="sm" color="neutral" variant="soft">查看方案与复评记录</UButton>
          </div>
        </div>
      </div>
    </section>
    <section class="panel mt-6 p-6"><div class="flex items-center justify-between"><h2 class="text-xl font-semibold">家校沟通时间线</h2><UBadge color="neutral" variant="soft">{{ data?.communications?.length || 0 }} 条</UBadge></div><div class="mt-5 grid gap-4 lg:grid-cols-[1fr_.9fr]"><div class="space-y-4"><div v-for="item in data?.communications" :key="item.id" class="rounded-2xl border border-amber-100 bg-amber-50/50 p-4"><div class="flex flex-wrap gap-2"><UBadge v-if="item.studentName" color="neutral" variant="soft">学生：{{ item.studentName }}</UBadge><UBadge v-if="item.className" color="neutral" variant="soft">{{ item.className }}</UBadge><UBadge v-if="item.riskLevel" color="error" variant="soft">{{ riskLevelLabel(item.riskLevel) }}</UBadge></div><p class="mt-3 text-sm leading-7">{{ item.summary }}</p><p class="mt-2 text-xs text-slate-400">{{ new Date(item.occurredAt).toLocaleString('zh-CN') }}</p></div><p v-if="!data?.communications?.length" class="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-400">暂无沟通记录</p></div><div class="rounded-2xl border border-slate-100 p-4"><h3 class="font-semibold">新增沟通记录</h3><div class="mt-4 space-y-3"><USelect v-model="communicationStudentSelect" :items="[{label:'不指定学生',value:NONE_VALUE}, ...(data?.students || []).map((item:any)=>({label:item.name,value:item.id}))]" class="w-full" /><div class="grid gap-3 md:grid-cols-3"><UInput v-model="communication.parentType" placeholder="家长类型" /><UInput v-model="communication.attitudeType" placeholder="态度类型" /><UInput v-model="communication.riskLevel" placeholder="风险等级" /></div><UTextarea v-model="communication.summary" :rows="6" class="w-full" placeholder="记录沟通背景、家长诉求、教师回应和后续动作" /><button type="button" class="w-full rounded-lg bg-[var(--ui-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50" :disabled="communication.summary.trim().length < 5" @click="createCommunication">保存沟通记录</button></div></div></div></section>
    <section class="panel mt-6 p-6"><div class="flex items-center justify-between"><h2 class="text-xl font-semibold">相关方案记录</h2><UBadge color="neutral" variant="soft">{{ data?.plans?.length || 0 }} 个</UBadge></div><div class="mt-5 grid gap-4 md:grid-cols-2"><NuxtLink v-for="plan in data?.plans" :key="plan.id" :to="`/information/plans/${plan.id}`" class="block rounded-2xl border border-slate-100 p-4 transition hover:border-emerald-300 hover:bg-emerald-50/40"><div class="flex items-start justify-between gap-3"><div><strong>{{ plan.title }}</strong><p class="mt-1 text-xs text-slate-400">{{ plan.sourceLabel }} · {{ plan.riskLabel || moduleLabel(plan.module) }}</p></div><UBadge :color="planStatusColor(plan.status)" variant="soft">{{ planStatusLabel(plan.status) }}</UBadge></div><p class="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{{ plan.summary }}</p></NuxtLink><p v-if="!data?.plans?.length" class="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-400 md:col-span-2">暂无与该家长关联的方案</p></div></section>
    </template>
  </div>
</template>

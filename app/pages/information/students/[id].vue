<script setup lang="ts">
const route = useRoute()
const id = String(route.params.id)
const { data, error, refresh } = await useFetch<any>(`/api/v1/information/students/${id}`)
const pending = ref(false)
const emptyProfile = () => ({
  studentNo: '',
  birthDate: '',
  ethnicity: '',
  residenceType: '',
  boardingStatus: '',
  classRole: '',
  attendanceStatus: '',
  academicLevel: '',
  classroomBehavior: '',
  emotionStatus: '',
  peerRelation: '',
  familyStructure: '',
  primaryCaregiver: '',
  strengths: '',
  mainDifficulties: '',
  supportNeeds: '',
  riskAttentionLevel: ''
})
const form = reactive({ name: '', gender: '', notes: '', classId: '', profile: emptyProfile() })
const linkGuardianId = ref('')
const communication = reactive({ guardianId: '', summary: '', parentType: '', attitudeType: '', riskLevel: '低风险' })
const NONE_VALUE = '__none__'
const genderSelect = computed({
  get: () => form.gender || NONE_VALUE,
  set: value => { form.gender = value === NONE_VALUE ? '' : value }
})
const classSelect = computed({
  get: () => form.classId || NONE_VALUE,
  set: value => { form.classId = value === NONE_VALUE ? '' : value }
})
const communicationGuardianSelect = computed({
  get: () => communication.guardianId || NONE_VALUE,
  set: value => { communication.guardianId = value === NONE_VALUE ? '' : value }
})
const genderOptions = [
  { label: '未填写', value: NONE_VALUE },
  { label: '男', value: '男' },
  { label: '女', value: '女' }
]
const boardingOptions = ['走读', '住宿', '午托', '暂未确认'].map(value => ({ label: value, value }))
const attentionOptions = ['常规关注', '需要跟进', '重点关注', '危机/转介中'].map(value => ({ label: value, value }))
const academicOptions = ['优势明显', '稳定中等', '波动较大', '需要学习支持', '暂未评估'].map(value => ({ label: value, value }))
const profileFields = [
  'studentNo', 'birthDate', 'ethnicity', 'residenceType', 'boardingStatus', 'classRole', 'attendanceStatus',
  'academicLevel', 'classroomBehavior', 'emotionStatus', 'peerRelation', 'familyStructure', 'primaryCaregiver',
  'strengths', 'mainDifficulties', 'supportNeeds', 'riskAttentionLevel'
]
const profileCompletion = computed(() => {
  const filled = profileFields.filter(field => String((form.profile as any)[field] || '').trim()).length
  return Math.round((filled / profileFields.length) * 100)
})

watchEffect(() => {
  if (!data.value?.student) return
  form.name = data.value.student.name || ''
  form.gender = data.value.student.gender || ''
  form.notes = data.value.student.notes || ''
  form.classId = data.value.student.classId || ''
  Object.assign(form.profile, emptyProfile(), data.value.student.profile || {})
})

async function saveStudent() {
  pending.value = true
  try {
    await $fetch(`/api/v1/information/students/${id}`, { method: 'PATCH', body: { ...form, classId: form.classId || null, profile: { ...form.profile } } })
    await refresh()
  } finally { pending.value = false }
}

async function linkGuardian() {
  if (!linkGuardianId.value) return
  pending.value = true
  try {
    await $fetch(`/api/v1/information/students/${id}/guardians`, { method: 'POST', body: { guardianId: linkGuardianId.value } })
    linkGuardianId.value = ''
    await refresh()
  } finally { pending.value = false }
}

async function unlinkGuardian(guardianId: string) {
  pending.value = true
  try {
    await $fetch(`/api/v1/information/students/${id}/guardians/${guardianId}`, { method: 'DELETE' })
    await refresh()
  } finally { pending.value = false }
}

async function createCommunication() {
  if (communication.summary.trim().length < 5) return
  pending.value = true
  try {
    await $fetch(`/api/v1/information/students/${id}/communications`, {
      method: 'POST',
      body: {
        guardianId: communication.guardianId || undefined,
        summary: communication.summary,
        parentType: communication.parentType || undefined,
        attitudeType: communication.attitudeType || undefined,
        riskLevel: communication.riskLevel || undefined
      }
    })
    Object.assign(communication, { guardianId: '', summary: '', parentType: '', attitudeType: '', riskLevel: '低风险' })
    await refresh()
  } finally { pending.value = false }
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-5 py-10">
    <template v-if="error"><div class="panel mx-auto max-w-2xl p-8 text-center"><UIcon name="i-lucide-lock-keyhole" class="mx-auto size-10 text-amber-500" /><h1 class="mt-4 text-2xl font-semibold">学生档案无法打开</h1><p class="mt-3 text-sm leading-6 text-slate-500">该学生可能不存在，或当前登录账号不是这名学生的当前负责教师。请切换到负责教师账号，或让学校管理员在“班级学生管理”里调整负责教师。</p><p class="mt-3 font-mono text-xs text-slate-400">{{ error.statusCode || error.status }} · {{ error.statusMessage || error.message }}</p><div class="mt-6 flex justify-center gap-3"><UButton to="/information?tab=students">返回信息中心</UButton><UButton to="/login" color="neutral" variant="soft">重新登录</UButton></div></div></template>
    <template v-else>
    <div class="flex flex-wrap items-start justify-between gap-4"><div><UButton to="/information?tab=students" icon="i-lucide-arrow-left" color="neutral" variant="ghost">返回信息中心</UButton><p class="mt-5 text-sm font-semibold text-emerald-700">学生档案</p><h1 class="mt-2 text-3xl font-semibold">{{ data?.student?.name || '学生详情' }}</h1><p class="mt-2 text-sm text-slate-500">{{ data?.student?.className || '未分配班级' }} · 当前负责档案</p></div><div class="flex flex-wrap justify-end gap-2"><UButton :to="{ path: '/', query: { contextType: 'student', contextId: id } }" icon="i-lucide-sparkles">向 AI 咨询该学生</UButton><UBadge color="primary" variant="soft">档案完整度 {{ profileCompletion }}%</UBadge><UBadge color="neutral" variant="soft">沟通 {{ data?.communications?.length || 0 }}</UBadge></div></div>
    <div class="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section class="panel p-6 lg:col-span-2"><div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-xl font-semibold">基础信息</h2><p class="mt-2 text-sm text-slate-500">用于班主任日常跟进、转班移交和家校沟通前的信息对齐；不作为医学或心理诊断。</p></div><UButton :loading="pending" @click="saveStudent">保存学生信息</UButton></div><div class="mt-6 grid gap-6 xl:grid-cols-3">
        <div class="rounded-3xl border border-slate-100 p-5"><h3 class="font-semibold">学籍与班级</h3><div class="mt-4 space-y-4"><UFormField label="姓名"><UInput v-model="form.name" class="w-full" /></UFormField><div class="grid gap-3 md:grid-cols-2"><UFormField label="性别"><USelect v-model="genderSelect" :items="genderOptions" class="w-full" /></UFormField><UFormField label="学号/编号"><UInput v-model="form.profile.studentNo" class="w-full" placeholder="如 2026070301" /></UFormField></div><div class="grid gap-3 md:grid-cols-2"><UFormField label="出生日期"><UInput v-model="form.profile.birthDate" type="date" class="w-full" /></UFormField><UFormField label="民族"><UInput v-model="form.profile.ethnicity" class="w-full" placeholder="选填" /></UFormField></div><UFormField label="所属班级"><USelect v-model="classSelect" :items="[{label:'暂不分配',value:NONE_VALUE}, ...(data?.classOptions || []).map((item:any)=>({label:item.name,value:item.id}))]" class="w-full" /></UFormField><div class="grid gap-3 md:grid-cols-2"><UFormField label="居住/户籍情况"><UInput v-model="form.profile.residenceType" class="w-full" placeholder="本地/随迁/寄宿等" /></UFormField><UFormField label="走读/住宿"><USelect v-model="form.profile.boardingStatus" :items="boardingOptions" class="w-full" /></UFormField></div></div></div>
        <div class="rounded-3xl border border-slate-100 p-5"><h3 class="font-semibold">在校观察</h3><div class="mt-4 space-y-4"><UFormField label="班级角色"><UInput v-model="form.profile.classRole" class="w-full" placeholder="班干部/小组长/普通成员等" /></UFormField><UFormField label="出勤状态"><UInput v-model="form.profile.attendanceStatus" class="w-full" placeholder="稳定/迟到较多/请假较多等" /></UFormField><UFormField label="学业状态"><USelect v-model="form.profile.academicLevel" :items="academicOptions" class="w-full" /></UFormField><UFormField label="课堂表现"><UInput v-model="form.profile.classroomBehavior" class="w-full" placeholder="专注、参与、作业完成等" /></UFormField><UFormField label="情绪状态"><UInput v-model="form.profile.emotionStatus" class="w-full" placeholder="近期观察到的情绪表现" /></UFormField><UFormField label="同伴关系"><UInput v-model="form.profile.peerRelation" class="w-full" placeholder="融入度、冲突、支持同伴等" /></UFormField></div></div>
        <div class="rounded-3xl border border-slate-100 p-5"><h3 class="font-semibold">家庭与支持画像</h3><div class="mt-4 space-y-4"><UFormField label="家庭结构"><UInput v-model="form.profile.familyStructure" class="w-full" placeholder="如双亲、单亲、隔代照护等" /></UFormField><UFormField label="主要照护人"><UInput v-model="form.profile.primaryCaregiver" class="w-full" placeholder="日常主要沟通对象" /></UFormField><UFormField label="关注等级"><USelect v-model="form.profile.riskAttentionLevel" :items="attentionOptions" class="w-full" /></UFormField><UFormField label="优势资源"><UTextarea v-model="form.profile.strengths" :rows="3" class="w-full" placeholder="兴趣、能力、支持关系、积极经验" /></UFormField><UFormField label="主要困难"><UTextarea v-model="form.profile.mainDifficulties" :rows="3" class="w-full" placeholder="当前最需要老师关注的问题" /></UFormField><UFormField label="支持需求"><UTextarea v-model="form.profile.supportNeeds" :rows="3" class="w-full" placeholder="后续需要的班级、家校或专业支持" /></UFormField></div></div>
        <div class="rounded-3xl border border-slate-100 p-5 xl:col-span-3"><UFormField label="综合备注"><UTextarea v-model="form.notes" :rows="4" class="w-full" placeholder="记录不适合拆字段的背景信息、移交说明或阶段性观察" /></UFormField></div>
      </div></section>
      <section class="panel p-6"><h2 class="text-xl font-semibold">关联家长</h2><div class="mt-5 space-y-3"><div v-for="guardian in data?.guardians" :key="guardian.id" class="rounded-2xl border border-slate-100 p-4"><div class="flex items-start justify-between gap-3"><div><NuxtLink :to="`/information/guardians/${guardian.id}`" class="font-semibold hover:text-emerald-700">{{ guardian.name }}</NuxtLink><p class="mt-1 text-xs text-slate-500">{{ guardian.relation || '关系未填' }} · {{ guardian.phone || '电话未填' }}</p></div><UButton size="xs" color="neutral" variant="ghost" :loading="pending" @click="unlinkGuardian(guardian.id)">解除</UButton></div></div><p v-if="!data?.guardians?.length" class="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-400">暂无关联家长</p></div><div class="mt-5 flex gap-2"><USelect v-model="linkGuardianId" :items="(data?.guardianOptions || []).filter((item:any)=>!(data?.guardians || []).some((g:any)=>g.id===item.id)).map((item:any)=>({label:`${item.name}${item.relation ? ` · ${item.relation}` : ''}`,value:item.id}))" placeholder="选择已有家长" class="min-w-0 flex-1" /><UButton :disabled="!linkGuardianId" :loading="pending" @click="linkGuardian">关联</UButton></div></section>
    </div>
    <section class="panel mt-6 p-6"><div class="flex items-center justify-between"><h2 class="text-xl font-semibold">家校沟通时间线</h2><UBadge color="neutral" variant="soft">{{ data?.communications?.length || 0 }} 条</UBadge></div><div class="mt-5 grid gap-4 lg:grid-cols-[1fr_.9fr]"><div class="space-y-4"><div v-for="item in data?.communications" :key="item.id" class="rounded-2xl border border-amber-100 bg-amber-50/50 p-4"><div class="flex flex-wrap gap-2"><UBadge v-if="item.guardianName" color="neutral" variant="soft">{{ item.relation || '家长' }}：{{ item.guardianName }}</UBadge><UBadge v-if="item.riskLevel" color="error" variant="soft">{{ item.riskLevel }}</UBadge></div><p class="mt-3 text-sm leading-7">{{ item.summary }}</p><p class="mt-2 text-xs text-slate-400">{{ new Date(item.occurredAt).toLocaleString('zh-CN') }}</p></div><p v-if="!data?.communications?.length" class="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-400">暂无沟通记录</p></div><div class="rounded-2xl border border-slate-100 p-4"><h3 class="font-semibold">新增沟通记录</h3><div class="mt-4 space-y-3"><USelect v-model="communicationGuardianSelect" :items="[{label:'不指定家长',value:NONE_VALUE}, ...(data?.guardians || []).map((item:any)=>({label:item.name,value:item.id}))]" class="w-full" /><div class="grid gap-3 md:grid-cols-3"><UInput v-model="communication.parentType" placeholder="家长类型" /><UInput v-model="communication.attitudeType" placeholder="态度类型" /><UInput v-model="communication.riskLevel" placeholder="风险等级" /></div><UTextarea v-model="communication.summary" :rows="6" class="w-full" placeholder="记录沟通背景、家长诉求、教师回应和后续动作" /><UButton block :loading="pending" :disabled="communication.summary.trim().length < 5" @click="createCommunication">保存沟通记录</UButton></div></div></div></section>
    <section class="panel mt-6 p-6"><div class="flex items-center justify-between"><h2 class="text-xl font-semibold">相关方案记录</h2><UBadge color="neutral" variant="soft">{{ data?.plans?.length || 0 }} 个</UBadge></div><div class="mt-5 grid gap-4 md:grid-cols-2"><article v-for="plan in data?.plans" :key="plan.id" class="rounded-2xl border border-slate-100 p-4"><div class="flex items-start justify-between gap-3"><div><strong>{{ plan.title }}</strong><p class="mt-1 text-xs text-slate-400">{{ plan.sourceLabel }} · {{ plan.riskLabel || plan.module }}</p></div><UBadge color="neutral" variant="soft">{{ plan.status }}</UBadge></div><p class="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{{ plan.summary }}</p></article><p v-if="!data?.plans?.length" class="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-400 md:col-span-2">暂无与该学生关联的方案</p></div></section>
    </template>
  </div>
</template>

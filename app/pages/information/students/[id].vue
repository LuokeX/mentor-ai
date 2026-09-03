<script setup lang="ts">
const route = useRoute()
const id = String(route.params.id)
const { data, error, refresh } = await useFetch<any>(`/api/v1/information/students/${id}`)
const pending = ref(false)
const { moduleLabel, planStatusLabel, planStatusColor, riskLevelLabel, caseLevelLabel, caseLevelColor, caseSolutionStatusLabel, caseSolutionStatusColor, learningLevelLabel, learningLevelColor, severityLabel } = useDisplayLabels()
/** 学习问题评估快照（learning_problem 评估回写），含严重程度/归因/责任人/复评结论 */
const learningSnapshot = computed(() => (data.value?.student?.studentSnapshot as any)?.module === 'learning_problem' ? (data.value.student.studentSnapshot as any) || null : null)
/** 学习问题模块的最近进行中方案（复评日期来源） */
const learningPlan = computed(() => (data.value?.plans || []).find((plan: any) => plan.module === 'learning_problem'))
const learningBadgeValue = computed(() => learningSnapshot.value?.levelName || data.value?.student?.learningLevel || null)
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
const form = reactive({ name: '', gender: '', notes: '', classId: '', enrolledAt: '', address: '', caseSolutionStatus: 'unresolved', profile: emptyProfile() })
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
const solutionStatusSelect = computed({
  get: () => form.caseSolutionStatus || NONE_VALUE,
  set: value => { form.caseSolutionStatus = value === NONE_VALUE ? 'unresolved' : value }
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
const solutionStatusOptions = [
  { label: '未解决', value: 'unresolved' },
  { label: '进行中', value: 'in_progress' },
  { label: '已解决', value: 'resolved' }
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
  form.enrolledAt = data.value.student.enrolledAt ? String(data.value.student.enrolledAt).slice(0, 10) : ''
  form.address = data.value.student.address || ''
  form.caseSolutionStatus = data.value.student.caseSolutionStatus || 'unresolved'
  Object.assign(form.profile, emptyProfile(), data.value.student.profile || {})
})

async function saveStudent() {
  pending.value = true
  try {
    await $fetch(`/api/v1/information/students/${id}`, { method: 'PATCH', body: { ...form, classId: form.classId || null, enrolledAt: form.enrolledAt ? new Date(form.enrolledAt).toISOString() : null, address: form.address || null, profile: { ...form.profile } } })
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
    <template v-if="error"><div class="panel mx-auto max-w-2xl p-8 text-center"><UIcon name="i-lucide-lock-keyhole" class="mx-auto size-10 text-amber-500" /><h1 class="mt-4 text-2xl font-semibold">学生档案无法打开</h1><p class="mt-3 text-sm leading-6 text-slate-500">该学生可能不存在，或当前登录账号不是这名学生的当前负责教师。请切换到负责教师账号，或让学校管理员在“班级学生管理”里调整负责教师。</p><p class="mt-3 font-mono text-xs text-slate-400">{{ error.statusCode || error.status }} · {{ error.statusMessage || error.message }}</p><div class="mt-6 flex justify-center gap-3"><UButton to="/information/students">返回信息中心</UButton><UButton to="/login" color="neutral" variant="soft">重新登录</UButton></div></div></template>
    <template v-else>
    <div class="flex flex-wrap items-start justify-between gap-4"><div><UButton to="/information/students" icon="i-lucide-arrow-left" color="neutral" variant="ghost">返回信息中心</UButton><p class="mt-5 text-sm font-semibold text-emerald-700">学生档案</p><h1 class="mt-2 text-3xl font-semibold">{{ data?.student?.name || '学生详情' }}</h1><p class="mt-2 text-sm text-slate-500">{{ data?.student?.className || '未分配班级' }}<template v-if="data?.student?.classTeacherName"> · 班主任 {{ data.student.classTeacherName }}</template> · 当前负责档案</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <UBadge v-if="data?.student?.caseLevelName" :color="caseLevelColor(data.student.caseLevelName)" variant="soft">
            <UIcon name="i-lucide-triangle-alert" class="size-3.5" /> {{ caseLevelLabel(data.student.caseLevelName) }}
          </UBadge>
          <UBadge v-for="code in (data?.student?.caseCodes || [])" :key="code.code" color="primary" variant="subtle" size="sm" :title="`编码 ${code.code}`">
            {{ code.name }}
          </UBadge>
          <UBadge :color="caseSolutionStatusColor(data?.student?.caseSolutionStatus)" variant="soft">
            <span class="mr-1 inline-block size-2 rounded-full" :class="{
              'bg-red-500': data?.student?.caseSolutionStatus === 'unresolved',
              'bg-yellow-400': data?.student?.caseSolutionStatus === 'in_progress',
              'bg-green-500': data?.student?.caseSolutionStatus === 'resolved',
            }" />{{ caseSolutionStatusLabel(data?.student?.caseSolutionStatus) }}
          </UBadge>
          <UBadge v-if="learningBadgeValue" :color="learningLevelColor(learningBadgeValue)" variant="soft">
            <UIcon name="i-lucide-brain" class="size-3.5" /> 学习问题 {{ learningLevelLabel(learningBadgeValue) }}
          </UBadge>
        </div>
      </div><div class="flex flex-wrap justify-end gap-2"><UButton :to="{ path: '/', query: { contextType: 'student', contextId: id } }" icon="i-lucide-sparkles">向 AI 咨询该学生</UButton><UBadge color="primary" variant="soft">档案完整度 {{ profileCompletion }}%</UBadge><UBadge color="neutral" variant="soft">沟通 {{ data?.communications?.length || 0 }}</UBadge></div></div>
    <div class="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section class="panel p-6 lg:col-span-2"><div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-xl font-semibold">基础信息</h2><p class="mt-2 text-sm text-slate-500">用于班主任日常跟进、转班移交和家校沟通前的信息对齐；不作为医学或心理诊断。</p></div><UButton :loading="pending" @click="saveStudent">保存学生信息</UButton></div><div class="mt-6 grid gap-6 xl:grid-cols-3">
        <div class="rounded-3xl border border-slate-100 p-5"><h3 class="font-semibold">学籍与班级</h3><div class="mt-4 space-y-4"><UFormField label="姓名"><UInput v-model="form.name" class="w-full" /></UFormField><div class="grid gap-3 md:grid-cols-2"><UFormField label="性别"><USelect v-model="genderSelect" :items="genderOptions" class="w-full" /></UFormField><UFormField label="学号/编号"><UInput v-model="form.profile.studentNo" class="w-full" placeholder="如 2026070301" /></UFormField></div><div class="grid gap-3 md:grid-cols-2"><UFormField label="出生日期"><UInput v-model="form.profile.birthDate" type="date" class="w-full" /></UFormField><UFormField label="入学日期"><UInput v-model="form.enrolledAt" type="date" class="w-full" /></UFormField></div><div class="grid gap-3 md:grid-cols-2"><UFormField label="民族"><UInput v-model="form.profile.ethnicity" class="w-full" placeholder="选填" /></UFormField><UFormField label="解决方案状态"><USelect v-model="solutionStatusSelect" :items="solutionStatusOptions" class="w-full" /></UFormField></div><UFormField label="所属班级"><USelect v-model="classSelect" :items="[{label:'暂不分配',value:NONE_VALUE}, ...(data?.classOptions || []).map((item:any)=>({label:item.name,value:item.id}))]" class="w-full" /></UFormField><div class="grid gap-3 md:grid-cols-2"><UFormField label="居住/户籍情况"><UInput v-model="form.profile.residenceType" class="w-full" placeholder="本地/随迁/寄宿等" /></UFormField><UFormField label="走读/住宿"><USelect v-model="form.profile.boardingStatus" :items="boardingOptions" class="w-full" /></UFormField></div><UFormField label="现住址"><UInput v-model="form.address" class="w-full" placeholder="选填，如 XX 市 XX 区 XX 街道 1 号" /></UFormField></div></div>
        <div class="rounded-3xl border border-slate-100 p-5"><h3 class="font-semibold">在校观察</h3><div class="mt-4 space-y-4"><UFormField label="班级角色"><UInput v-model="form.profile.classRole" class="w-full" placeholder="班干部/小组长/普通成员等" /></UFormField><UFormField label="出勤状态"><UInput v-model="form.profile.attendanceStatus" class="w-full" placeholder="稳定/迟到较多/请假较多等" /></UFormField><UFormField label="学业状态"><USelect v-model="form.profile.academicLevel" :items="academicOptions" class="w-full" /></UFormField><UFormField label="课堂表现"><UInput v-model="form.profile.classroomBehavior" class="w-full" placeholder="专注、参与、作业完成等" /></UFormField><UFormField label="情绪状态"><UInput v-model="form.profile.emotionStatus" class="w-full" placeholder="近期观察到的情绪表现" /></UFormField><UFormField label="同伴关系"><UInput v-model="form.profile.peerRelation" class="w-full" placeholder="融入度、冲突、支持同伴等" /></UFormField></div></div>
        <div class="rounded-3xl border border-slate-100 p-5"><h3 class="font-semibold">家庭与支持画像</h3><div class="mt-4 space-y-4"><UFormField label="家庭结构"><UInput v-model="form.profile.familyStructure" class="w-full" placeholder="如双亲、单亲、隔代照护等" /></UFormField><UFormField label="主要照护人"><UInput v-model="form.profile.primaryCaregiver" class="w-full" placeholder="日常主要沟通对象" /></UFormField><UFormField label="关注等级"><USelect v-model="form.profile.riskAttentionLevel" :items="attentionOptions" class="w-full" /></UFormField><UFormField label="优势资源"><UTextarea v-model="form.profile.strengths" :rows="3" class="w-full" placeholder="兴趣、能力、支持关系、积极经验" /></UFormField><UFormField label="主要困难"><UTextarea v-model="form.profile.mainDifficulties" :rows="3" class="w-full" placeholder="当前最需要老师关注的问题" /></UFormField><UFormField label="支持需求"><UTextarea v-model="form.profile.supportNeeds" :rows="3" class="w-full" placeholder="后续需要的班级、家校或专业支持" /></UFormField></div></div>
        <div class="rounded-3xl border border-slate-100 p-5 xl:col-span-3"><UFormField label="综合备注"><UTextarea v-model="form.notes" :rows="4" class="w-full" placeholder="记录不适合拆字段的背景信息、移交说明或阶段性观察" /></UFormField></div>
      </div></section>
      <section class="panel p-6"><h2 class="text-xl font-semibold">关联家长</h2><div class="mt-5 space-y-3"><div v-for="guardian in data?.guardians" :key="guardian.id" class="rounded-2xl border border-slate-100 p-4"><div class="flex items-start justify-between gap-3"><div><NuxtLink :to="`/information/guardians/${guardian.id}`" class="font-semibold hover:text-emerald-700">{{ guardian.name }}</NuxtLink><p class="mt-1 text-xs text-slate-500">{{ guardian.relation || '关系未填' }} · {{ guardian.phone || '电话未填' }}</p></div><UButton size="xs" color="neutral" variant="ghost" :loading="pending" @click="unlinkGuardian(guardian.id)">解除</UButton></div></div><p v-if="!data?.guardians?.length" class="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-400">暂无关联家长</p></div><div class="mt-5 flex gap-2"><USelect v-model="linkGuardianId" :items="(data?.guardianOptions || []).filter((item:any)=>!(data?.guardians || []).some((g:any)=>g.id===item.id)).map((item:any)=>({label:`${item.name}${item.relation ? ` · ${item.relation}` : ''}`,value:item.id}))" placeholder="选择已有家长" class="min-w-0 flex-1" /><UButton :disabled="!linkGuardianId" :loading="pending" @click="linkGuardian">关联</UButton></div></section>
    </div>
    <section class="panel mt-6 p-6"><div class="flex items-center justify-between"><h2 class="text-xl font-semibold">家校沟通时间线</h2><UBadge color="neutral" variant="soft">{{ data?.communications?.length || 0 }} 条</UBadge></div><div class="mt-5 grid gap-4 lg:grid-cols-[1fr_.9fr]"><div class="space-y-4"><div v-for="item in data?.communications" :key="item.id" class="rounded-2xl border border-amber-100 bg-amber-50/50 p-4"><div class="flex flex-wrap gap-2"><UBadge v-if="item.guardianName" color="neutral" variant="soft">{{ item.relation || '家长' }}：{{ item.guardianName }}</UBadge><UBadge v-if="item.riskLevel" color="error" variant="soft">{{ riskLevelLabel(item.riskLevel) }}</UBadge></div><p class="mt-3 text-sm leading-7">{{ item.summary }}</p><p class="mt-2 text-xs text-slate-400">{{ formatDateTime(item.occurredAt) }}</p></div><p v-if="!data?.communications?.length" class="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-400">暂无沟通记录</p></div><div class="rounded-2xl border border-slate-100 p-4"><h3 class="font-semibold">新增沟通记录</h3><div class="mt-4 space-y-3"><USelect v-model="communicationGuardianSelect" :items="[{label:'不指定家长',value:NONE_VALUE}, ...(data?.guardians || []).map((item:any)=>({label:item.name,value:item.id}))]" class="w-full" /><div class="grid gap-3 md:grid-cols-3"><UInput v-model="communication.parentType" placeholder="家长类型" /><UInput v-model="communication.attitudeType" placeholder="态度类型" /><UInput v-model="communication.riskLevel" placeholder="风险等级" /></div><UTextarea v-model="communication.summary" :rows="6" class="w-full" placeholder="记录沟通背景、家长诉求、教师回应和后续动作" /><button type="button" class="w-full rounded-lg bg-[var(--ui-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50" :disabled="communication.summary.trim().length < 5" @click="createCommunication">保存沟通记录</button></div></div></div></section>
    <section v-if="learningSnapshot" class="panel mt-6 p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h2 class="text-xl font-semibold">学习问题档案</h2><p class="mt-2 text-sm text-slate-500">来自学习问题三层诊断评估的投影与干预追踪；不构成学习障碍诊断。</p></div>
        <UBadge v-if="learningSnapshot?.blocked" color="error" variant="soft"><UIcon name="i-lucide-alert-octagon" class="size-3.5" /> 已触发安全熔断</UBadge>
      </div>
      <div class="mt-5 grid gap-6 lg:grid-cols-2">
        <div class="rounded-2xl border border-slate-100 p-5">
          <h3 class="font-semibold">分析与归因</h3>
          <div class="mt-4 space-y-4 text-sm">
            <div class="flex flex-wrap items-center gap-2"><span class="w-24 text-slate-500">严重程度</span>
              <UBadge :color="learningLevelColor(learningBadgeValue)" variant="subtle">{{ learningLevelLabel(learningBadgeValue) }}</UBadge>
              <UBadge v-if="learningSnapshot?.severity" color="neutral" variant="soft">严重度 {{ severityLabel(learningSnapshot.severity) }}</UBadge>
            </div>
            <div class="flex flex-wrap items-start gap-2"><span class="w-24 shrink-0 text-slate-500">核心归因</span>
              <span v-if="learningSnapshot?.primaryAttribution" class="font-medium">{{ learningSnapshot.primaryAttribution }}</span>
              <span v-else class="text-slate-400">—</span>
            </div>
            <div class="flex flex-wrap items-start gap-2"><span class="w-24 shrink-0 text-slate-500">次要归因</span>
              <span v-if="learningSnapshot?.secondaryAttributions?.length">{{ learningSnapshot.secondaryAttributions.join('、') }}</span>
              <span v-else class="text-slate-400">—</span>
            </div>
            <div class="flex flex-wrap items-start gap-2"><span class="w-24 shrink-0 text-slate-500">责任人</span>
              <span v-if="learningSnapshot?.escalationTarget" class="font-medium">{{ learningSnapshot.escalationTarget }}</span>
              <span v-else class="text-slate-400">—</span>
            </div>
            <div class="flex flex-wrap items-start gap-2"><span class="w-24 shrink-0 text-slate-500">评估结论</span>
              <span v-if="learningSnapshot?.reasons?.length" class="leading-6 text-slate-600">{{ learningSnapshot.reasons.join('；') }}</span>
              <span v-else class="text-slate-400">—</span>
            </div>
            <div class="flex flex-wrap items-start gap-2"><span class="w-24 shrink-0 text-slate-500">评估时间</span>
              <span v-if="learningSnapshot?.assessedAt" class="text-slate-600">{{ formatDateTime(learningSnapshot.assessedAt) }}</span>
              <span v-else class="text-slate-400">—</span>
            </div>
          </div>
        </div>
        <div class="rounded-2xl border border-slate-100 p-5">
          <h3 class="font-semibold">方案与复评</h3>
          <p v-if="!learningPlan" class="mt-4 rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-400">尚无学习问题干预方案，可向 AI 咨询或进行三层诊断评估后生成</p>
          <template v-else>
            <div class="mt-4 space-y-4 text-sm">
              <div class="flex flex-wrap items-center gap-2"><span class="w-24 text-slate-500">方案状态</span>
                <UBadge :color="planStatusColor(learningPlan.status)" variant="soft">{{ planStatusLabel(learningPlan.status) }}</UBadge>
              </div>
              <div class="flex flex-wrap items-start gap-2"><span class="w-24 shrink-0 text-slate-500">复评周期</span>
                <span v-if="learningPlan.nextReviewAt" class="text-slate-600">下次复评 {{ formatDate(learningPlan.nextReviewAt) }}</span>
                <span v-else class="text-slate-400">未设定</span>
              </div>
              <div class="flex flex-wrap items-start gap-2"><span class="w-24 shrink-0 text-slate-500">效果评估</span>
                <span class="text-slate-600">在方案页记录复评（效果评分与结论），随复评持续更新</span>
              </div>
              <UButton :to="`/plans/${learningPlan.id}`" icon="i-lucide-file-text" size="sm" color="neutral" variant="soft">查看完整方案与复评记录</UButton>
            </div>
          </template>
        </div>
      </div>
    </section>
    <section class="panel mt-6 p-6"><div class="flex items-center justify-between"><h2 class="text-xl font-semibold">相关方案记录</h2><UBadge color="neutral" variant="soft">{{ data?.plans?.length || 0 }} 个</UBadge></div><div class="mt-5 grid gap-4 md:grid-cols-2"><NuxtLink v-for="plan in data?.plans" :key="plan.id" :to="`/plans/${plan.id}`" class="block rounded-2xl border border-slate-100 p-4 transition hover:border-emerald-300 hover:bg-emerald-50/40"><div class="flex items-start justify-between gap-3"><div><strong>{{ plan.title }}</strong><p class="mt-1 text-xs text-slate-400">{{ plan.sourceLabel }} · {{ plan.riskLabel || moduleLabel(plan.module) }}</p></div><UBadge :color="planStatusColor(plan.status)" variant="soft">{{ planStatusLabel(plan.status) }}</UBadge></div><p class="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{{ plan.summary }}</p></NuxtLink><p v-if="!data?.plans?.length" class="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-400 md:col-span-2">暂无与该学生关联的方案</p></div></section>
    </template>
  </div>
</template>

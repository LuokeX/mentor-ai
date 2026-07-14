<script setup lang="ts">
import { moduleMeta } from '#shared/assessments'

const { data, refresh } = await useFetch<any>('/api/v1/information/overview')
const route = useRoute()
const active = ref(String(route.query.tab || 'status'))
const showForm = ref(false)
const selectedPlan = ref<any>(null)
const selectedPlanOpen = ref(false)
const formType = ref<'class' | 'student' | 'guardian' | 'communication'>('class')
const form = reactive<any>({ name: '', grade: 1, studentCount: 0, classId: '', studentId: '', guardianId: '', gender: '', notes: '', phone: '', relation: '', summary: '' })
const reviewForm = reactive({ effectScore: 3, progressNote: '', nextAction: '' })
const pending = ref(false)
const tabs = [
  { id: 'status', label: '我的状态', icon: 'i-lucide-heart-pulse' }, { id: 'classes', label: '负责班级', icon: 'i-lucide-school' }, { id: 'students', label: '负责学生', icon: 'i-lucide-users' },
  { id: 'guardians', label: '关联家长', icon: 'i-lucide-contact' }, { id: 'communications', label: '家校沟通', icon: 'i-lucide-messages-square' }, { id: 'plans', label: '方案记录', icon: 'i-lucide-clipboard-list' }
]
function openCreate() { showForm.value = true }

function moduleTitle(module: string) {
  return (moduleMeta as Record<string, { title: string }>)[module]?.title || module
}

async function openPlan(id: string) {
  selectedPlan.value = await $fetch(`/api/v1/plans/${id}`)
  selectedPlanOpen.value = true
}

async function createReview() {
  if (!selectedPlan.value) return
  pending.value = true
  try {
    await $fetch(`/api/v1/plans/${selectedPlan.value.id}/reviews`, {
      method: 'POST',
      body: {
        effectScore: Number(reviewForm.effectScore),
        progressNote: reviewForm.progressNote,
        nextAction: reviewForm.nextAction
      }
    })
    Object.assign(reviewForm, { effectScore: 3, progressNote: '', nextAction: '' })
    await openPlan(selectedPlan.value.id)
    await refresh()
  } finally { pending.value = false }
}

async function createEntity() {
  pending.value = true
  try {
    const body: any = { type: formType.value }
    if (formType.value === 'class') Object.assign(body, { name: form.name, grade: Number(form.grade), studentCount: Number(form.studentCount) })
    if (formType.value === 'student') Object.assign(body, { name: form.name, classId: form.classId || undefined, guardianIds: form.guardianId ? [form.guardianId] : undefined, gender: form.gender || undefined, notes: form.notes || undefined })
    if (formType.value === 'guardian') Object.assign(body, { name: form.name, phone: form.phone || undefined, relation: form.relation || undefined, studentIds: form.studentId ? [form.studentId] : undefined })
    if (formType.value === 'communication') Object.assign(body, { summary: form.summary, studentId: form.studentId || undefined, guardianId: form.guardianId || undefined })
    await $fetch('/api/v1/information/entities', { method: 'POST', body })
    Object.assign(form, { name: '', grade: 1, studentCount: 0, classId: '', studentId: '', guardianId: '', gender: '', notes: '', phone: '', relation: '', summary: '' })
    showForm.value = false
    await refresh()
  } finally { pending.value = false }
}

onMounted(() => {
  const planId = route.query.plan
  if (route.query.tab === 'plans') active.value = 'plans'
  if (typeof planId === 'string') void openPlan(planId)
})
</script>

<template>
  <div class="mx-auto max-w-7xl px-5 py-10">
    <div class="flex flex-wrap items-end justify-between gap-4"><div><p class="text-sm font-semibold text-emerald-700">当前负责档案</p><h1 class="mt-2 text-3xl font-semibold">信息管理中心</h1><p class="mt-2 text-sm text-slate-500">{{ data?.ownershipNote || '班级、学生、家长、沟通和方案是学校业务档案；这里展示当前由你负责的记录。' }}</p></div><div class="flex gap-2"><UButton to="/api/v1/information/export" external color="neutral" variant="soft" icon="i-lucide-download">导出当前负责数据</UButton><UButton icon="i-lucide-plus" @click="openCreate">新增资料</UButton></div></div>
    <div class="mt-8 grid gap-6 lg:grid-cols-[15rem_1fr]">
      <aside class="panel h-fit p-3"><button v-for="tab in tabs" :key="tab.id" class="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm transition" :class="active === tab.id ? 'bg-emerald-800 text-white' : 'text-slate-600 hover:bg-slate-100'" @click="() => { active = tab.id }"><UIcon :name="tab.icon" class="size-4" />{{ tab.label }}</button></aside>
      <section class="panel min-h-[32rem] p-6 sm:p-8">
        <template v-if="active === 'status'"><h2 class="text-xl font-semibold">我的状态</h2><div class="mt-5 grid gap-4 md:grid-cols-2"><div v-for="item in data?.assessments" :key="item.id" class="rounded-2xl border border-slate-100 p-5"><div class="flex justify-between"><strong>{{ item.module }}</strong><UBadge variant="soft">{{ item.result?.level }}</UBadge></div><p class="mt-2 text-xs text-slate-400">{{ new Date(item.submittedAt).toLocaleString('zh-CN') }}</p><p class="mt-3 text-sm text-slate-600">{{ item.result?.reasons?.join('；') }}</p></div></div></template>
        <template v-if="active === 'classes'"><h2 class="text-xl font-semibold">当前负责班级</h2><div class="mt-5 space-y-4"><div v-for="item in data?.classTree" :key="item.id" class="rounded-2xl bg-slate-50 p-5"><div class="flex flex-wrap justify-between gap-3"><div><strong>{{ item.name }}</strong><p class="mt-2 text-sm text-slate-500">{{ item.grade }} 年级 · 登记 {{ item.studentCount }} 人</p></div><div class="flex gap-2"><UBadge color="neutral" variant="soft">{{ item.students.length }} 学生</UBadge><UBadge color="neutral" variant="soft">{{ item.guardians.length }} 家长</UBadge><UBadge color="neutral" variant="soft">{{ item.communications.length }} 沟通</UBadge></div></div><div class="mt-4 grid gap-3 md:grid-cols-2"><div v-for="student in item.students" :key="student.id" class="rounded-xl bg-white p-3"><p class="text-sm font-semibold">{{ student.name }}</p><p class="mt-1 text-xs text-slate-400">{{ student.gender || '性别未填' }} · {{ student.notes || '暂无备注' }}</p></div></div></div></div></template>
        <template v-if="active === 'students'"><h2 class="text-xl font-semibold">当前负责学生</h2><div class="mt-5 divide-y divide-slate-100"><div v-for="item in data?.students" :key="item.id" class="flex items-center justify-between py-4"><div><strong>{{ item.name }}</strong><p class="mt-1 text-xs text-slate-500">{{ item.className || '未分配班级' }} · {{ item.gender || '未填写性别' }} · {{ item.notes || '暂无备注' }}</p></div><UBadge color="neutral" variant="soft">学校档案</UBadge></div></div></template>
        <template v-if="active === 'guardians'"><h2 class="text-xl font-semibold">当前关联家长</h2><div class="mt-5 divide-y divide-slate-100"><div v-for="item in data?.guardians" :key="item.id" class="py-4"><strong>{{ item.name }}</strong><p class="mt-1 text-xs text-slate-500">{{ item.relation || '关系未填写' }} · {{ item.phone || '电话未填写' }}</p><div v-if="item.linkedStudents?.length" class="mt-2 flex flex-wrap gap-2"><UBadge v-for="student in item.linkedStudents" :key="student.id" color="neutral" variant="soft">{{ student.name }} · {{ student.className || '未分班' }}</UBadge></div></div></div></template>
        <template v-if="active === 'communications'"><h2 class="text-xl font-semibold">家校沟通档案</h2><div class="mt-5 space-y-4"><div v-for="item in data?.communications" :key="item.id" class="rounded-2xl border border-amber-100 bg-amber-50/50 p-5"><div class="flex flex-wrap gap-2"><UBadge v-if="item.studentName" color="neutral" variant="soft">学生：{{ item.studentName }}</UBadge><UBadge v-if="item.guardianName" color="neutral" variant="soft">家长：{{ item.guardianName }}</UBadge><UBadge v-if="item.parentType" color="warning" variant="soft">{{ item.parentType }}</UBadge><UBadge v-if="item.riskLevel" color="error" variant="soft">{{ item.riskLevel }}</UBadge></div><p class="mt-3 text-sm leading-6">{{ item.summary }}</p></div></div></template>
        <template v-if="active === 'plans'"><div class="flex items-center justify-between"><h2 class="text-xl font-semibold">方案记录</h2><span class="text-xs text-slate-400">{{ data?.plans?.length || 0 }} 份报告</span></div><div class="mt-5 space-y-4"><button v-for="item in data?.plans" :key="item.id" type="button" class="w-full rounded-2xl border border-emerald-100 p-5 text-left transition hover:border-emerald-300 hover:bg-emerald-50/40" @click="openPlan(item.id)"><div class="flex flex-wrap justify-between gap-3"><div><strong>{{ item.title }}</strong><p class="mt-1 text-xs text-slate-400">{{ moduleTitle(item.module) }} · {{ new Date(item.updatedAt).toLocaleString('zh-CN') }}</p></div><div class="flex gap-2"><UBadge color="primary" variant="soft">{{ item.riskLabel || item.level || item.status }}</UBadge><UBadge color="neutral" variant="soft">复盘 {{ item.reviewCount || 0 }}</UBadge></div></div><p class="mt-3 line-clamp-2 text-sm text-slate-600">{{ item.summary }}</p><p v-if="item.latestReviewAt" class="mt-3 text-xs text-emerald-700">最近复盘：{{ new Date(item.latestReviewAt).toLocaleString('zh-CN') }}</p></button></div></template>
        <div v-if="!data?.[active]?.length && active !== 'status'" class="grid min-h-72 place-items-center text-center text-sm text-slate-400"><div><UIcon name="i-lucide-inbox" class="mx-auto mb-3 size-8" /><p>这里还没有记录</p></div></div>
      </section>
    </div>

    <UModal v-model:open="showForm" title="新增资料" description="资料仅用于教师工作支持和安全流程。">
      <template #body>
        <div class="space-y-4">
          <UFormField label="资料类型"><USelect v-model="formType" :items="[{label:'班级',value:'class'},{label:'学生',value:'student'},{label:'家长',value:'guardian'},{label:'沟通记录',value:'communication'}]" class="w-full" /></UFormField>
          <template v-if="formType !== 'communication'"><UFormField label="名称"><UInput v-model="form.name" class="w-full" /></UFormField></template>
          <template v-if="formType === 'class'"><div class="grid grid-cols-2 gap-3"><UFormField label="年级"><UInput v-model.number="form.grade" type="number" /></UFormField><UFormField label="人数"><UInput v-model.number="form.studentCount" type="number" /></UFormField></div></template>
          <template v-if="formType === 'student'"><UFormField label="所属班级"><USelect v-model="form.classId" :items="[{label:'暂不分配',value:''}, ...(data?.classes || []).map((item:any)=>({label:item.name,value:item.id}))]" class="w-full" /></UFormField><UFormField label="关联家长"><USelect v-model="form.guardianId" :items="[{label:'暂不关联',value:''}, ...(data?.guardians || []).map((item:any)=>({label:item.name,value:item.id}))]" class="w-full" /></UFormField><UFormField label="性别"><UInput v-model="form.gender" class="w-full" /></UFormField><UFormField label="备注"><UTextarea v-model="form.notes" class="w-full" /></UFormField></template>
          <template v-if="formType === 'guardian'"><UFormField label="关联学生"><USelect v-model="form.studentId" :items="[{label:'暂不关联',value:''}, ...(data?.students || []).map((item:any)=>({label:`${item.name}${item.className ? ` · ${item.className}` : ''}`,value:item.id}))]" class="w-full" /></UFormField><UFormField label="关系"><UInput v-model="form.relation" class="w-full" /></UFormField><UFormField label="电话"><UInput v-model="form.phone" class="w-full" /></UFormField></template>
          <template v-if="formType === 'communication'"><div class="grid gap-3 md:grid-cols-2"><UFormField label="关联学生"><USelect v-model="form.studentId" :items="[{label:'不关联学生',value:''}, ...(data?.students || []).map((item:any)=>({label:`${item.name}${item.className ? ` · ${item.className}` : ''}`,value:item.id}))]" class="w-full" /></UFormField><UFormField label="关联家长"><USelect v-model="form.guardianId" :items="[{label:'不关联家长',value:''}, ...(data?.guardians || []).map((item:any)=>({label:item.name,value:item.id}))]" class="w-full" /></UFormField></div><UFormField label="沟通摘要"><UTextarea v-model="form.summary" :rows="5" class="w-full" /></UFormField></template>
          <UButton block :loading="pending" @click="createEntity">保存</UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="selectedPlanOpen" :title="selectedPlan?.title || '方案详情'" description="正式报告与后续复盘时间线">
      <template #body>
        <div v-if="selectedPlan" class="space-y-6">
          <section class="rounded-2xl bg-slate-50 p-5">
            <div class="flex flex-wrap items-start justify-between gap-3"><div><p class="text-xs font-semibold text-emerald-700">正式评估报告</p><h3 class="mt-1 text-lg font-semibold">{{ selectedPlan.report?.profile?.title || selectedPlan.title }}</h3></div><UBadge color="primary" variant="soft">{{ selectedPlan.report?.risk?.label || selectedPlan.status }}</UBadge></div>
            <p class="mt-3 text-sm leading-7 text-slate-600">{{ selectedPlan.report?.profile?.summary || selectedPlan.summary }}</p>
            <div class="mt-4 grid gap-3 md:grid-cols-2"><div v-for="item in selectedPlan.report?.evidence || []" :key="item.title + item.detail" class="rounded-xl bg-white p-3"><p class="text-sm font-semibold">{{ item.title }}</p><p class="mt-1 text-xs leading-5 text-slate-500">{{ item.detail }}</p></div></div>
          </section>
          <section>
            <h3 class="font-semibold">3 天行动方案</h3>
            <div class="mt-3 grid gap-3 md:grid-cols-3"><div v-for="day in selectedPlan.report?.threeDayPlan || []" :key="day.day" class="rounded-xl border border-emerald-100 p-3"><p class="text-sm font-semibold">第 {{ day.day }} 天 · {{ day.title }}</p><p v-for="action in day.actions" :key="action.title" class="mt-2 text-xs leading-5 text-slate-600">{{ action.title }}：{{ action.detail }}</p></div></div>
          </section>
          <section>
            <h3 class="font-semibold">复盘时间线</h3>
            <div class="mt-3 space-y-3"><div v-for="review in selectedPlan.reviews" :key="review.id" class="rounded-xl border border-slate-100 p-4"><div class="flex justify-between gap-3"><strong class="text-sm">效果 {{ review.effectScore }}/5</strong><span class="text-xs text-slate-400">{{ new Date(review.reviewAt).toLocaleString('zh-CN') }}</span></div><p class="mt-2 text-sm leading-6 text-slate-600">{{ review.progressNote }}</p><p class="mt-2 text-xs text-emerald-700">下一步：{{ review.nextAction }}</p></div><p v-if="!selectedPlan.reviews?.length" class="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-400">还没有复盘记录</p></div>
          </section>
          <section class="rounded-2xl border border-slate-100 p-4">
            <h3 class="font-semibold">新增复盘</h3>
            <div class="mt-4 grid gap-4 md:grid-cols-[8rem_1fr]"><UFormField label="效果评分"><USelect v-model="reviewForm.effectScore" :items="[1,2,3,4,5].map(value=>({label:`${value} / 5`,value}))" class="w-full" /></UFormField><UFormField label="下一步动作"><UInput v-model="reviewForm.nextAction" class="w-full" /></UFormField></div>
            <UFormField class="mt-4" label="进展说明"><UTextarea v-model="reviewForm.progressNote" :rows="3" class="w-full" /></UFormField>
            <div class="mt-4 flex justify-end"><UButton :loading="pending" :disabled="reviewForm.progressNote.trim().length<4 || reviewForm.nextAction.trim().length<2" @click="createReview">保存复盘</UButton></div>
          </section>
        </div>
      </template>
    </UModal>
  </div>
</template>

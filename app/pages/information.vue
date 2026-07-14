<script setup lang="ts">
const { data, refresh } = await useFetch<any>('/api/v1/information/overview')
const active = ref('status')
const showForm = ref(false)
const formType = ref<'class' | 'student' | 'guardian' | 'communication'>('class')
const form = reactive<any>({ name: '', grade: 1, studentCount: 0, gender: '', notes: '', phone: '', relation: '', summary: '' })
const pending = ref(false)
const tabs = [
  { id: 'status', label: '我的状态', icon: 'i-lucide-heart-pulse' }, { id: 'classes', label: '我的班级', icon: 'i-lucide-school' }, { id: 'students', label: '我的学生', icon: 'i-lucide-users' },
  { id: 'guardians', label: '我的家长', icon: 'i-lucide-contact' }, { id: 'communications', label: '家校沟通', icon: 'i-lucide-messages-square' }, { id: 'plans', label: '方案记录', icon: 'i-lucide-clipboard-list' }
]
function openCreate() { showForm.value = true }

async function createEntity() {
  pending.value = true
  try {
    const body: any = { type: formType.value }
    if (formType.value === 'class') Object.assign(body, { name: form.name, grade: Number(form.grade), studentCount: Number(form.studentCount) })
    if (formType.value === 'student') Object.assign(body, { name: form.name, gender: form.gender || undefined, notes: form.notes || undefined })
    if (formType.value === 'guardian') Object.assign(body, { name: form.name, phone: form.phone || undefined, relation: form.relation || undefined })
    if (formType.value === 'communication') Object.assign(body, { summary: form.summary })
    await $fetch('/api/v1/information/entities', { method: 'POST', body })
    Object.assign(form, { name: '', grade: 1, studentCount: 0, gender: '', notes: '', phone: '', relation: '', summary: '' })
    showForm.value = false
    await refresh()
  } finally { pending.value = false }
}
</script>

<template>
  <div class="mx-auto max-w-7xl px-5 py-10">
    <div class="flex flex-wrap items-end justify-between gap-4"><div><p class="text-sm font-semibold text-emerald-700">个人数据空间</p><h1 class="mt-2 text-3xl font-semibold">信息管理中心</h1><p class="mt-2 text-sm text-slate-500">评估、班级、学生、家长、沟通和方案统一沉淀。</p></div><div class="flex gap-2"><UButton to="/api/v1/information/export" external color="neutral" variant="soft" icon="i-lucide-download">导出我的数据</UButton><UButton icon="i-lucide-plus" @click="openCreate">新增资料</UButton></div></div>
    <div class="mt-8 grid gap-6 lg:grid-cols-[15rem_1fr]">
      <aside class="panel h-fit p-3"><button v-for="tab in tabs" :key="tab.id" class="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm transition" :class="active === tab.id ? 'bg-emerald-800 text-white' : 'text-slate-600 hover:bg-slate-100'" @click="() => { active = tab.id }"><UIcon :name="tab.icon" class="size-4" />{{ tab.label }}</button></aside>
      <section class="panel min-h-[32rem] p-6 sm:p-8">
        <template v-if="active === 'status'"><h2 class="text-xl font-semibold">我的状态</h2><div class="mt-5 grid gap-4 md:grid-cols-2"><div v-for="item in data?.assessments" :key="item.id" class="rounded-2xl border border-slate-100 p-5"><div class="flex justify-between"><strong>{{ item.module }}</strong><UBadge variant="soft">{{ item.result?.level }}</UBadge></div><p class="mt-2 text-xs text-slate-400">{{ new Date(item.submittedAt).toLocaleString('zh-CN') }}</p><p class="mt-3 text-sm text-slate-600">{{ item.result?.reasons?.join('；') }}</p></div></div></template>
        <template v-if="active === 'classes'"><h2 class="text-xl font-semibold">我的班级</h2><div class="mt-5 grid gap-4 md:grid-cols-2"><div v-for="item in data?.classes" :key="item.id" class="rounded-2xl bg-slate-50 p-5"><strong>{{ item.name }}</strong><p class="mt-2 text-sm text-slate-500">{{ item.grade }} 年级 · {{ item.studentCount }} 人</p></div></div></template>
        <template v-if="active === 'students'"><h2 class="text-xl font-semibold">我的学生</h2><div class="mt-5 divide-y divide-slate-100"><div v-for="item in data?.students" :key="item.id" class="flex items-center justify-between py-4"><div><strong>{{ item.name }}</strong><p class="mt-1 text-xs text-slate-500">{{ item.gender || '未填写性别' }} · {{ item.notes || '暂无备注' }}</p></div><UBadge color="neutral" variant="soft">个案档案</UBadge></div></div></template>
        <template v-if="active === 'guardians'"><h2 class="text-xl font-semibold">我的家长</h2><div class="mt-5 divide-y divide-slate-100"><div v-for="item in data?.guardians" :key="item.id" class="py-4"><strong>{{ item.name }}</strong><p class="mt-1 text-xs text-slate-500">{{ item.relation || '关系未填写' }} · {{ item.phone || '电话未填写' }}</p></div></div></template>
        <template v-if="active === 'communications'"><h2 class="text-xl font-semibold">家校沟通档案</h2><div class="mt-5 space-y-4"><div v-for="item in data?.communications" :key="item.id" class="rounded-2xl border border-amber-100 bg-amber-50/50 p-5"><div class="flex gap-2"><UBadge v-if="item.parentType" color="warning" variant="soft">{{ item.parentType }}</UBadge><UBadge v-if="item.riskLevel" color="error" variant="soft">{{ item.riskLevel }}</UBadge></div><p class="mt-3 text-sm leading-6">{{ item.summary }}</p></div></div></template>
        <template v-if="active === 'plans'"><h2 class="text-xl font-semibold">方案记录</h2><div class="mt-5 space-y-4"><div v-for="item in data?.plans" :key="item.id" class="rounded-2xl border border-emerald-100 p-5"><div class="flex justify-between"><strong>{{ item.title }}</strong><UBadge color="primary" variant="soft">{{ item.status }}</UBadge></div><p class="mt-3 text-sm text-slate-600">{{ item.summary }}</p><div class="mt-3 flex flex-wrap gap-2"><UBadge v-for="source in item.sourceVersions" :key="source" color="neutral" variant="soft">{{ source }}</UBadge></div></div></div></template>
        <div v-if="!data?.[active]?.length && active !== 'status'" class="grid min-h-72 place-items-center text-center text-sm text-slate-400"><div><UIcon name="i-lucide-inbox" class="mx-auto mb-3 size-8" /><p>这里还没有记录</p></div></div>
      </section>
    </div>

    <UModal v-model:open="showForm" title="新增资料" description="资料仅用于教师工作支持和安全流程。">
      <template #body>
        <div class="space-y-4">
          <UFormField label="资料类型"><USelect v-model="formType" :items="[{label:'班级',value:'class'},{label:'学生',value:'student'},{label:'家长',value:'guardian'},{label:'沟通记录',value:'communication'}]" class="w-full" /></UFormField>
          <template v-if="formType !== 'communication'"><UFormField label="名称"><UInput v-model="form.name" class="w-full" /></UFormField></template>
          <template v-if="formType === 'class'"><div class="grid grid-cols-2 gap-3"><UFormField label="年级"><UInput v-model.number="form.grade" type="number" /></UFormField><UFormField label="人数"><UInput v-model.number="form.studentCount" type="number" /></UFormField></div></template>
          <template v-if="formType === 'student'"><UFormField label="性别"><UInput v-model="form.gender" class="w-full" /></UFormField><UFormField label="备注"><UTextarea v-model="form.notes" class="w-full" /></UFormField></template>
          <template v-if="formType === 'guardian'"><UFormField label="关系"><UInput v-model="form.relation" class="w-full" /></UFormField><UFormField label="电话"><UInput v-model="form.phone" class="w-full" /></UFormField></template>
          <template v-if="formType === 'communication'"><UFormField label="沟通摘要"><UTextarea v-model="form.summary" :rows="5" class="w-full" /></UFormField></template>
          <UButton block :loading="pending" @click="createEntity">保存</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

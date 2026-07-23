<script setup lang="ts">
import { moduleMeta } from '#shared/assessments'

const { data, refresh } = await useFetch<any>('/api/v1/information/overview')
const { data: statsData } = await useFetch<any>('/api/v1/information/stats')
const { data: eventsData, refresh: refreshEvents } = await useFetch<any>('/api/v1/information/student-events')
const toast = useToast()
const route = useRoute()
const active = ref(String(route.query.tab || 'status'))
const showForm = ref(false)
const showEventForm = ref(false)
const formType = ref<'guardian' | 'communication'>('guardian')
const form = reactive<any>({ name: '', studentId: '', guardianId: '', phone: '', relation: '', summary: '' })
const eventForm = reactive({ studentId: '', eventType: '其他', severity: '低', title: '', description: '', occurredAt: '' })
const pending = ref(false)
const assessmentToDelete = ref<string | null>(null)

// 稳定的 select items，避免内联 .map() 每次生成新数组引用导致 USelect 状态异常
const studentOptions = computed(() => [
  { label: '不关联学生', value: '' },
  ...((data.value as any)?.students || []).map((item: any) => ({
    label: `${item.name}${item.className ? ` · ${item.className}` : ''}`,
    value: item.id,
  })),
])

const guardianOptions = computed(() => [
  { label: '不关联家长', value: '' },
  ...((data.value as any)?.guardians || []).map((item: any) => ({
    label: item.name,
    value: item.id,
  })),
])

const tabs = [
  { id: 'status', label: '我的状态', icon: 'i-lucide-heart-pulse' }, { id: 'classes', label: '负责班级', icon: 'i-lucide-school' }, { id: 'students', label: '负责学生', icon: 'i-lucide-users' },
  { id: 'communications', label: '家校沟通', icon: 'i-lucide-messages-square' }, { id: 'events', label: '事件记录', icon: 'i-lucide-clipboard-list' }, { id: 'cases', label: '支持案例', icon: 'i-lucide-folder-heart' }
]
function openCreate() { showForm.value = true }

function moduleTitle(module: string) {
  return (moduleMeta as Record<string, { title: string }>)[module]?.title || module
}

function switchTab(tab: string) {
  active.value = tab
}

async function submitEvent() {
  if (!eventForm.studentId || !eventForm.title.trim()) return
  pending.value = true
  try {
    await $fetch('/api/v1/information/student-events', { method: 'POST', body: eventForm })
    Object.assign(eventForm, { studentId: '', eventType: '其他', severity: '低', title: '', description: '', occurredAt: '' })
    showEventForm.value = false
    await refreshEvents()
    toast.add({ title: '事件已记录', color: 'success' })
  } catch (err: any) {
    toast.add({ title: err?.data?.message || '操作失败', color: 'error' })
  } finally { pending.value = false }
}

async function deleteEvent(id: string) {
  pending.value = true
  try {
    await $fetch(`/api/v1/information/student-events/${id}`, { method: 'DELETE' })
    await refreshEvents()
    toast.add({ title: '事件已删除', color: 'success' })
  } catch (err: any) {
    toast.add({ title: err?.data?.message || '操作失败', color: 'error' })
  } finally { pending.value = false }
}

function handleAssessmentClick(item: any) {
  if (item.planId) {
    navigateTo(`/information/plans/${item.planId}`)
  } else {
    navigateTo(`/module/${item.module}`)
  }
}

async function deleteAssessment(id: string) {
  pending.value = true
  try {
    await $fetch(`/api/v1/assessments/attempts/${id}`, { method: 'DELETE' })
    assessmentToDelete.value = null
    await refresh()
    toast.add({ title: '评估记录已删除', color: 'success' })
  } catch (error: any) {
    toast.add({ title: '删除失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  } finally {
    pending.value = false
  }
}

const mergedMonths = computed(() => {
  if (!statsData.value) return []
  const { monthlyAssessments = [], monthlyCommunications = [] } = statsData.value
  const aMap = new Map<string, number>(monthlyAssessments.map((r: any) => [r.month, r.count]))
  const cMap = new Map<string, number>(monthlyCommunications.map((r: any) => [r.month, r.count]))
  const months = [...new Set([...aMap.keys(), ...cMap.keys()])].sort()
  return months.map(m => ({
    month: m.substring(5),
    assessmentCount: aMap.get(m) || 0,
    communicationCount: cMap.get(m) || 0,
  }))
})
const maxAssessment = computed(() => Math.max(...mergedMonths.value.map(m => m.assessmentCount), 1))
const maxCommunication = computed(() => Math.max(...mergedMonths.value.map(m => m.communicationCount), 1))
const maxAlert = computed(() => Math.max(...(statsData.value?.alertDistribution || []).map((r: any) => r.count), 1))
function alertBarColor(level: string) {
  return { low: 'bg-emerald-200', medium: 'bg-amber-200', high: 'bg-orange-200', crisis: 'bg-red-200' }[level] || 'bg-slate-200'
}

async function createEntity() {
  pending.value = true
  try {
    const body: any = { type: formType.value }
    if (formType.value === 'guardian') Object.assign(body, { name: form.name, phone: form.phone || undefined, relation: form.relation || undefined, studentIds: form.studentId ? [form.studentId] : undefined })
    if (formType.value === 'communication') Object.assign(body, { summary: form.summary, studentId: form.studentId || undefined, guardianId: form.guardianId || undefined })
    await $fetch('/api/v1/information/entities', { method: 'POST', body })
    Object.assign(form, { name: '', studentId: '', guardianId: '', phone: '', relation: '', summary: '' })
    showForm.value = false
    await refresh()
  } finally { pending.value = false }
}

onMounted(() => {
  if (route.query.tab === 'plans' || route.query.tab === 'cases') active.value = 'cases'
  const planId = route.query.plan
  if (typeof planId === 'string') navigateTo(`/information/plans/${planId}`)
})
</script>

<template>
  <div class="mx-auto max-w-7xl px-5 py-10">
    <div class="flex flex-wrap items-end justify-between gap-4"><div><p class="text-sm font-semibold text-emerald-700">当前负责档案</p><h1 class="mt-2 text-3xl font-semibold">信息管理中心</h1><p class="mt-2 text-sm text-slate-500">{{ data?.ownershipNote || '班级、学生、家长、沟通和方案是学校业务档案；这里展示当前由你负责的记录。' }}</p></div><div class="flex gap-2"><UButton to="/api/v1/information/export" external color="neutral" variant="soft" icon="i-lucide-download">导出当前负责数据</UButton><UButton icon="i-lucide-plus" @click="openCreate">新增记录</UButton></div></div>
    <div class="mt-8 grid gap-6 lg:grid-cols-[15rem_1fr]">
      <aside class="panel h-fit p-3"><button v-for="tab in tabs" :key="tab.id" class="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm transition" :class="active === tab.id ? 'bg-emerald-800 text-white' : 'text-slate-600 hover:bg-slate-100'" @click="switchTab(tab.id)"><UIcon :name="tab.icon" class="size-4" />{{ tab.label }}</button></aside>
      <section class="panel min-h-[32rem] p-6 sm:p-8">
        <template v-if="active === 'status'"><h2 class="text-xl font-semibold">档案总览</h2><div class="mt-5 grid gap-4 md:grid-cols-4"><button v-for="item in data?.overviewCards" :key="item.label" type="button" class="rounded-2xl border border-slate-100 bg-slate-50 p-5 text-left transition hover:border-emerald-200 hover:bg-emerald-50/50" @click="switchTab(item.label === '负责班级' ? 'classes' : item.label === '关联家长' ? 'students' : item.label === '家校沟通' ? 'communications' : 'cases')"><p class="text-sm text-slate-500">{{ item.label }}</p><strong class="mt-2 block text-3xl">{{ item.value }}</strong><p class="mt-2 line-clamp-1 text-xs text-slate-400">{{ item.hint }}</p></button></div><h3 class="mt-8 font-semibold">最近评估</h3><div class="mt-4 grid gap-4 md:grid-cols-2"><div v-for="item in data?.assessments" :key="item.id" class="group relative"><button type="button" class="w-full text-left rounded-2xl border border-slate-100 p-5 transition hover:border-emerald-200 hover:bg-emerald-50/40" @click="handleAssessmentClick(item)"><div class="flex justify-between"><strong>{{ moduleTitle(item.module) }}</strong><UBadge variant="soft" :color="item.levelColor || 'neutral'">{{ item.levelLabel || item.result?.level || item.status }}</UBadge></div><p class="mt-2 text-xs text-slate-400">{{ item.submittedAt ? new Date(item.submittedAt).toLocaleString('zh-CN') : '草稿' }}</p><p class="mt-3 text-sm text-slate-600">{{ item.result?.reasons?.join('；') || '暂无结果摘要' }}</p><div v-if="item.planId" class="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700"><UIcon name="i-lucide-file-text" class="size-3.5" />已有方案</div></button><button class="absolute right-1.5 top-2 grid size-6 place-items-center rounded-md text-slate-400 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100" title="删除评估" @click.stop="assessmentToDelete = item.id"><UIcon name="i-lucide-x" class="size-3.5" /></button></div></div>

<h3 class="mt-8 font-semibold">趋势与统计</h3>
<div class="mt-4 grid gap-6 md:grid-cols-2">
  <div class="rounded-2xl border border-slate-100 p-5">
    <h4 class="text-sm font-semibold text-slate-700">评估与沟通趋势（近6个月）</h4>
    <div class="mt-4 space-y-2">
      <div v-for="row in mergedMonths" :key="row.month" class="flex items-center gap-2">
        <span class="w-10 text-xs text-slate-400">{{ row.month }}月</span>
        <div class="flex-1">
          <div class="flex h-4 items-center gap-1">
            <div class="h-3 rounded-sm bg-emerald-200 transition-all" :style="{ width: (row.assessmentCount / maxAssessment * 100) + '%' }" />
            <span class="text-xs text-emerald-600 w-5 text-right">{{ row.assessmentCount }}</span>
          </div>
          <div class="mt-1 flex h-4 items-center gap-1">
            <div class="h-3 rounded-sm bg-amber-200 transition-all" :style="{ width: (row.communicationCount / maxCommunication * 100) + '%' }" />
            <span class="text-xs text-amber-600 w-5 text-right">{{ row.communicationCount }}</span>
          </div>
        </div>
      </div>
      <div class="flex gap-4 pt-2 text-xs text-slate-400">
        <span class="flex items-center gap-1"><span class="inline-block size-2 rounded-sm bg-emerald-200"></span>评估</span>
        <span class="flex items-center gap-1"><span class="inline-block size-2 rounded-sm bg-amber-200"></span>沟通</span>
      </div>
    </div>
  </div>
  <div class="rounded-2xl border border-slate-100 p-5">
    <h4 class="text-sm font-semibold text-slate-700">方案完成率</h4>
    <div class="mt-4 flex items-center justify-center">
      <div class="relative size-32">
        <svg viewBox="0 0 36 36" class="size-full -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" stroke-width="3" />
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#059669" stroke-width="3" stroke-linecap="round"
            :stroke-dasharray="`${statsData?.planCompletion?.rate || 0} ${100 - (statsData?.planCompletion?.rate || 0)}`" />
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <span class="text-2xl font-bold text-emerald-700">{{ statsData?.planCompletion?.rate ?? 0 }}%</span>
          <span class="text-xs text-slate-400">{{ statsData?.planCompletion?.completed ?? 0 }}/{{ statsData?.planCompletion?.total ?? 0 }}</span>
        </div>
      </div>
    </div>
  </div>
  <div class="rounded-2xl border border-slate-100 p-5">
    <h4 class="text-sm font-semibold text-slate-700">预警分布</h4>
    <div class="mt-4 space-y-2">
      <div v-for="item in statsData?.alertDistribution" :key="item.level" class="flex items-center gap-2">
        <span class="w-14 text-xs text-slate-500">{{ item.label }}</span>
        <div class="flex-1 h-4 rounded-sm transition-all" :class="alertBarColor(item.level)"
          :style="{ width: (item.count / maxAlert * 100) + '%', minWidth: item.count > 0 ? '0.75rem' : '0' }" />
        <span class="text-xs font-semibold text-slate-600 w-5 text-right">{{ item.count }}</span>
      </div>
    </div>
  </div>
  <div class="rounded-2xl border border-red-100 bg-red-50/30 p-5">
    <h4 class="text-sm font-semibold text-red-700">超期方案提醒</h4>
    <p v-if="!statsData?.overduePlans?.length" class="mt-3 text-center text-sm text-slate-400">暂无超期方案</p>
    <div v-else class="mt-3 space-y-2">
      <div v-for="item in statsData?.overduePlans" :key="item.id"
        class="flex items-center justify-between rounded-xl bg-white p-3 border border-red-100 gap-3">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-slate-800">{{ item.title }}</p>
          <p class="text-xs text-slate-500">{{ item.studentName || '未关联学生' }}</p>
        </div>
        <UBadge color="error" variant="soft">{{ item.daysSinceUpdate }}天</UBadge>
      </div>
    </div>
  </div>
</div>
</template>
        <template v-if="active === 'classes'"><div class="flex items-center justify-between"><div><h2 class="text-xl font-semibold">当前负责班级</h2><p class="mt-1 text-sm text-slate-500">班级下直接串联学生、家长和最近沟通。</p></div><UBadge color="neutral" variant="soft">{{ data?.classTree?.length || 0 }} 个班级</UBadge></div><div class="mt-5 space-y-5"><div v-for="item in data?.classTree" :key="item.id" class="rounded-3xl border border-slate-100 bg-slate-50 p-5"><div class="flex flex-wrap justify-between gap-3"><div><strong class="text-lg">{{ item.name }}</strong><p class="mt-2 text-sm text-slate-500">{{ item.grade }} 年级 · 登记 {{ item.studentCount }} 人</p></div><div class="flex flex-wrap gap-2"><UBadge color="neutral" variant="soft">{{ item.students.length }} 学生</UBadge><UBadge color="neutral" variant="soft">{{ item.guardians.length }} 家长</UBadge><UBadge color="neutral" variant="soft">{{ item.communications.length }} 沟通</UBadge></div></div><div v-if="item.latestCommunication" class="mt-4 rounded-2xl border border-amber-100 bg-white p-4"><p class="text-xs font-semibold text-amber-700">最近沟通</p><p class="mt-2 text-sm leading-6 text-slate-600">{{ item.latestCommunication.studentName || '未关联学生' }} / {{ item.latestCommunication.guardianName || '未关联家长' }}：{{ item.latestCommunication.summary }}</p></div><div class="mt-4 grid gap-3 md:grid-cols-2"><div v-for="student in item.students" :key="student.id" class="rounded-2xl bg-white p-4"><div class="flex items-start justify-between gap-3"><div><NuxtLink :to="`/information/students/${student.id}`" class="text-sm font-semibold hover:text-emerald-700">{{ student.name }}</NuxtLink><p class="mt-1 text-xs text-slate-400">{{ student.gender || '性别未填' }} · 沟通 {{ student.communicationCount || 0 }} 次</p></div><UBadge color="neutral" variant="soft">{{ student.linkedGuardians?.length || 0 }} 家长</UBadge></div><p class="mt-3 line-clamp-2 text-xs leading-5 text-slate-500">{{ student.notes || '暂无备注' }}</p><div v-if="student.linkedGuardians?.length" class="mt-3 flex flex-wrap gap-2"><NuxtLink v-for="guardian in student.linkedGuardians" :key="guardian.id" :to="`/information/guardians/${guardian.id}`" class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition">{{ guardian.relation || '家长' }}：{{ guardian.name }}<span v-if="guardian.phone" class="text-emerald-400">· {{ guardian.phone }}</span></NuxtLink></div></div></div></div></div></template>
        <template v-if="active === 'students'"><div class="flex items-center justify-between"><div><h2 class="text-xl font-semibold">当前负责学生</h2><p class="mt-1 text-sm text-slate-500">每个学生卡片展示班级、家长、关注等级和沟通进展。</p></div><UBadge color="neutral" variant="soft">{{ data?.students?.length || 0 }} 名学生</UBadge></div><div class="mt-5 grid gap-4 md:grid-cols-2"><div v-for="item in data?.students" :key="item.id" class="rounded-3xl border border-slate-100 p-5"><div class="flex items-start justify-between gap-3"><div><NuxtLink :to="`/information/students/${item.id}`" class="font-semibold hover:text-emerald-700">{{ item.name }}</NuxtLink><p class="mt-1 text-xs text-slate-500">{{ item.className || '未分配班级' }} · {{ item.gender || '未填写性别' }}</p></div><div class="flex items-center gap-2"><UBadge v-if="item.riskAttentionLevel" :color="item.riskAttentionLevel === '危机' || item.riskAttentionLevel === '转介中' ? 'error' : item.riskAttentionLevel === '重点关注' ? 'warning' : item.riskAttentionLevel === '需要跟进' ? 'info' : 'neutral'" variant="soft">{{ item.riskAttentionLevel }}</UBadge><UBadge color="neutral" variant="soft">沟通 {{ item.communicationCount || 0 }}</UBadge></div></div><p class="mt-3 text-sm leading-6 text-slate-600">{{ item.notes || '暂无备注' }}</p><div class="mt-4 rounded-2xl bg-slate-50 p-3"><p class="text-xs font-semibold text-slate-500">关联家长</p><div class="mt-2 flex flex-wrap gap-2"><NuxtLink v-for="guardian in item.linkedGuardians" :key="guardian.id" :to="`/information/guardians/${guardian.id}`" class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition">{{ guardian.relation || '家长' }}：{{ guardian.name }}<span v-if="guardian.phone" class="text-emerald-400">· {{ guardian.phone }}</span></NuxtLink><span v-if="!item.linkedGuardians?.length" class="text-xs text-slate-400">暂无关联家长</span></div></div><div v-if="item.latestCommunication" class="mt-3 rounded-2xl bg-amber-50 p-3"><p class="text-xs font-semibold text-amber-700">最近沟通</p><p class="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{{ item.latestCommunication.guardianName || '未关联家长' }}：{{ item.latestCommunication.summary }}</p></div></div></div></template>
        <template v-if="active === 'communications'"><div class="flex items-center justify-between"><div><h2 class="text-xl font-semibold">家校沟通档案</h2><p class="mt-1 text-sm text-slate-500">每条沟通都带班级、学生、家长和风险上下文。</p></div><UBadge color="neutral" variant="soft">{{ data?.communications?.length || 0 }} 条沟通</UBadge></div><div class="mt-5 space-y-4"><div v-for="item in data?.communications" :key="item.id" class="rounded-3xl border border-amber-100 bg-amber-50/50 p-5"><div class="flex flex-wrap gap-2"><UBadge v-if="item.className" color="neutral" variant="soft">{{ item.className }}</UBadge><UBadge v-if="item.studentName" color="neutral" variant="soft">学生：{{ item.studentName }}</UBadge><UBadge v-if="item.guardianName" color="neutral" variant="soft">{{ item.relation || '家长' }}：{{ item.guardianName }}</UBadge><UBadge v-if="item.parentType" color="warning" variant="soft">{{ item.parentType }}</UBadge><UBadge v-if="item.riskLevel" color="error" variant="soft">{{ item.riskLevel }}</UBadge></div><p class="mt-3 text-sm leading-7">{{ item.summary }}</p><p class="mt-3 text-xs text-slate-400">{{ new Date(item.occurredAt).toLocaleString('zh-CN') }}</p></div></div></template>
        <template v-if="active === 'events'"><div class="flex items-center justify-between"><div><h2 class="text-xl font-semibold">事件记录</h2><p class="mt-1 text-sm text-slate-500">记录与学生关联的违纪、冲突等事件，支持快速录入和处置跟踪。</p></div><div class="flex items-center gap-2"><UBadge color="neutral" variant="soft">{{ eventsData?.events?.length || 0 }} 条记录</UBadge><UButton color="primary" size="sm" icon="i-lucide-plus" @click="() => { showEventForm = true }">快速录入</UButton></div></div><div class="mt-5 space-y-4"><div v-for="item in eventsData?.events" :key="item.id" class="rounded-3xl border border-slate-100 p-5"><div class="flex flex-wrap items-start justify-between gap-3"><div><div class="flex flex-wrap items-center gap-2"><strong class="text-lg">{{ item.title }}</strong><UBadge :color="item.severity === '严重' ? 'error' : item.severity === '高' ? 'warning' : item.severity === '中' ? 'info' : 'neutral'" variant="soft">{{ item.severity }}</UBadge><UBadge color="neutral" variant="soft">{{ item.eventType }}</UBadge></div><p class="mt-2 text-sm text-slate-500">{{ item.studentName }} · {{ new Date(item.occurredAt).toLocaleString('zh-CN') }}</p></div><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="deleteEvent(item.id)">删除</UButton></div><p v-if="item.description" class="mt-3 text-sm leading-7 text-slate-600">{{ item.description }}</p><p v-if="item.resolution" class="mt-3 rounded-2xl bg-green-50 p-3 text-sm leading-6 text-green-800"><strong>处置措施：</strong>{{ item.resolution }}</p></div><p v-if="!eventsData?.events?.length" class="rounded-3xl bg-slate-50 p-10 text-center text-sm text-slate-400">暂无事件记录</p></div></template>
        <template v-if="active === 'cases'">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-xl font-semibold">支持案例</h2>
              <p class="mt-1 text-sm text-slate-500">评估 → 方案 → 执行，每个案例一条线。</p>
            </div>
            <UBadge color="neutral" variant="soft">{{ data?.cases?.length || 0 }} 个案例</UBadge>
          </div>
          <div class="mt-5 space-y-4">
            <button
              v-for="item in data?.cases"
              :key="item.planId || item.assessment.id"
              type="button"
              class="w-full rounded-2xl border p-5 text-left transition"
              :class="item.type === 'plan'
                ? 'border-emerald-100 hover:border-emerald-300 hover:bg-emerald-50/40'
                : 'border-amber-100 hover:border-amber-300 hover:bg-amber-50/40'"
              @click="item.planId ? navigateTo(`/information/plans/${item.planId}`) : navigateTo(`/module/${item.assessment.module}`)"
            >
              <!-- 对象标签 -->
              <div v-if="item.objectLabel" class="mb-3 flex items-center gap-2">
                <UBadge color="neutral" variant="soft" size="sm">
                  {{ item.objectType === 'student' ? '学生' : item.objectType === 'class' ? '班级' : '' }}
                  {{ item.objectLabel }}
                </UBadge>
                <span v-if="item.objectGender" class="text-xs text-slate-400">{{ item.objectGender }}</span>
                <span v-if="!item.planId" class="ml-auto">
                  <UBadge color="warning" variant="soft" size="sm">待生成方案</UBadge>
                </span>
              </div>

              <!-- 评估链路 -->
              <div v-if="item.assessment" class="mb-3 flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-2.5">
                <span class="text-xs text-slate-400">评估</span>
                <span class="text-sm font-medium">{{ moduleTitle(item.assessment.module) }}</span>
                <UBadge v-if="item.assessment.levelLabel" :color="item.assessment.levelColor || 'neutral'" variant="soft" size="sm">
                  {{ item.assessment.levelLabel }}
                </UBadge>
                <span class="ml-auto text-xs text-slate-400">
                  {{ item.assessment.submittedAt ? new Date(item.assessment.submittedAt).toLocaleString('zh-CN') : '-' }}
                </span>
              </div>

              <!-- 方案行 -->
              <div v-if="item.type === 'plan'" class="mb-3 flex items-center gap-3">
                <span class="text-xs text-slate-400">方案</span>
                <strong class="text-sm">{{ item.planTitle }}</strong>
                <UBadge v-if="item.riskLabel" color="primary" variant="soft" size="sm">{{ item.riskLabel }}</UBadge>
                <UBadge :color="item.planStatus === 'completed' ? 'success' : item.planStatus === 'in_progress' ? 'info' : 'neutral'" variant="soft" size="sm">
                  {{ item.planStatus === 'completed' ? '已完成' : item.planStatus === 'in_progress' ? '进行中' : item.planStatus }}
                </UBadge>
                <span class="ml-auto text-xs text-slate-400">
                  {{ new Date(item.updatedAt).toLocaleString('zh-CN') }}
                </span>
              </div>

              <!-- 执行进度 -->
              <div v-if="item.type === 'plan'" class="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
                <span>
                  动作
                  <span class="font-semibold text-slate-700">{{ item.completedActions }}/{{ item.totalActions }}</span>
                </span>
                <span>
                  复盘
                  <span class="font-semibold text-slate-700">{{ item.reviewCount }}</span> 次
                </span>
                <span v-if="item.latestReviewAt" class="text-emerald-600">
                  最近：{{ new Date(item.latestReviewAt).toLocaleString('zh-CN') }}
                </span>
                <span v-else class="text-slate-400">暂无复盘</span>
              </div>
            </button>
          </div>
        </template>
        <div v-if="!data?.[active]?.length && active !== 'status'" class="grid min-h-72 place-items-center text-center text-sm text-slate-400"><div><UIcon name="i-lucide-inbox" class="mx-auto mb-3 size-8" /><p>这里还没有记录</p></div></div>
      </section>
    </div>

    <UModal v-model:open="showEventForm" title="快速录入事件" description="记录与学生相关的具体事件，支持后续处置跟踪。">
      <template #body>
        <form class="space-y-4" @submit.prevent="submitEvent">
          <UFormField label="关联学生" required>
            <USelect v-model="eventForm.studentId" :items="(data?.students || []).map((s: any) => ({ label: s.name, value: s.id }))" class="w-full" />
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="事件类型" required>
              <USelect v-model="eventForm.eventType" :items="['违纪', '冲突', '异常行为', '学业波动', '其他']" class="w-full" />
            </UFormField>
            <UFormField label="严重程度" required>
              <USelect v-model="eventForm.severity" :items="['低', '中', '高', '严重']" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="事件标题" required>
            <UInput v-model="eventForm.title" class="w-full" placeholder="简要描述事件" />
          </UFormField>
          <UFormField label="详细描述">
            <UTextarea v-model="eventForm.description" :rows="4" class="w-full" placeholder="事件的具体情况和背景" />
          </UFormField>
          <UFormField label="发生日期">
            <UInput v-model="eventForm.occurredAt" type="datetime-local" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="() => { showEventForm = false }">取消</UButton>
            <UButton type="submit" :loading="pending" :disabled="!eventForm.studentId || !eventForm.title.trim()">保存事件</UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal v-model:open="showForm" title="新增记录" description="记录家长档案和家校沟通内容。">
      <template #body>
        <div class="space-y-4">
          <UFormField label="资料类型"><USelect v-model="formType" :items="[{label:'家长',value:'guardian'},{label:'沟通记录',value:'communication'}]" class="w-full" /></UFormField>
          <div v-show="formType === 'guardian'">
            <UFormField label="名称"><UInput v-model="form.name" class="w-full" /></UFormField>
            <UFormField label="关联学生"><USelect v-model="form.studentId" :items="studentOptions" class="w-full" /></UFormField>
            <div class="grid grid-cols-2 gap-3">
              <UFormField label="关系"><UInput v-model="form.relation" class="w-full" /></UFormField>
              <UFormField label="电话"><UInput v-model="form.phone" class="w-full" /></UFormField>
            </div>
          </div>
          <div v-show="formType === 'communication'">
            <div class="grid gap-3 md:grid-cols-2">
              <UFormField label="关联学生"><USelect v-model="form.studentId" :items="studentOptions" class="w-full" /></UFormField>
              <UFormField label="关联家长"><USelect v-model="form.guardianId" :items="guardianOptions" class="w-full" /></UFormField>
            </div>
            <UFormField label="沟通摘要"><UTextarea v-model="form.summary" :rows="5" class="w-full" /></UFormField>
          </div>
          <UButton block :loading="pending" @click="createEntity">保存</UButton>
        </div>
      </template>
    </UModal>
    <UModal :open="Boolean(assessmentToDelete)" title="删除评估记录" description="删除后无法恢复，请确认这条记录不再需要。" @update:open="value => { if (!value) assessmentToDelete = null }">
      <template #body>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="() => { assessmentToDelete = null }">取消</UButton>
          <UButton color="error" :loading="pending" @click="() => { if (assessmentToDelete) void deleteAssessment(assessmentToDelete) }">确认删除</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
const { data, refresh } = await useFetch<any>('/api/v1/platform-admin/dashboard')
const active = ref('overview')
const pending = ref(false)
const schoolForm = reactive({ name: '', code: '', adminName: '', adminEmail: '', temporaryPassword: 'Welcome@2026' })
const selectedSchoolId = ref('')
const selectedSchoolDetail = ref<any>(null)
const schoolEditForm = reactive({ name: '', code: '', status: 'active' })
const schoolAdminForm = reactive({ name: '', email: '' })
const schoolActivationResult = ref<any>(null)
const delegationForm = reactive({ schoolId: '', scopes: ['users', 'teachers', 'departments', 'classes', 'students', 'guardians'], reason: '' })
const delegatedSession = ref<any>(null)
const schoolActivationLink = computed(() => schoolActivationResult.value?.activationToken
  ? `${window.location.origin}/activate?token=${encodeURIComponent(schoolActivationResult.value.activationToken)}` : '')
const contentForm = reactive<any>({ code: '', name: '', version: '1.0.0', type: 'tool', payloadText: '{}' })
const toast = useToast()
const {
  accessStatusLabel,
  accessStatusColor,
  accountStatusLabel,
  accountStatusColor,
  schoolStatusLabel,
  schoolStatusColor,
  resourceStatusLabel,
  resourceStatusColor,
  libraryTypeLabel,
  targetTypeLabel,
  auditActionLabel
} = useDisplayLabels()
const targetTypeOptions = ['teacher_profile', 'assessment', 'conversation', 'student_case', 'guardian_communication', 'plan'].map(value => ({ label: targetTypeLabel(value), value }))
const contentTypeOptions = ['assessment', 'attribution', 'tool'].map(value => ({ label: libraryTypeLabel(value), value }))
// ---- 内容编辑 ----
const editContentOpen = ref(false)
const editingContent = ref<any>(null)
const editingPayload = ref<any>({})
const editingCode = ref('')
const editingName = ref('')
const editingVersion = ref('')
const diffContentOpen = ref(false)
const diffSourceId = ref('')
const diffTargetId = ref('')
const diffSource = ref<any>(null)
const diffTarget = ref<any>(null)
function openEditor(item: any) {
  editingContent.value = item
  editingPayload.value = JSON.parse(JSON.stringify(item.payload || {}))
  editingCode.value = item.code
  editingName.value = item.name
  editingVersion.value = item.version
  editContentOpen.value = true
}

function openDiff(sourceItem: any) {
  const sameCode = (data.value?.contentPackages || []).filter((x: any) => x.code === sourceItem.code && x.id !== sourceItem.id)
  if (sameCode.length === 0) { showStatusMessage('当前内容暂无其他版本可对比。', 'warning'); return }
  diffSourceId.value = sourceItem.id
  diffTargetId.value = sameCode[0].id
  diffSource.value = sourceItem
  diffTarget.value = sameCode[0]
  diffContentOpen.value = true
}

function loadDiffVersions() {
  const items = data.value?.contentPackages || []
  if (diffSourceId.value) diffSource.value = items.find((x: any) => x.id === diffSourceId.value) || null
  if (diffTargetId.value) diffTarget.value = items.find((x: any) => x.id === diffTargetId.value) || null
}

const diffResult = computed(() => {
  if (!diffSource.value?.payload || !diffTarget.value?.payload) return []
  const src = diffSource.value.payload
  const tgt = diffTarget.value.payload
  const allKeys = new Set([...Object.keys(src), ...Object.keys(tgt)])
  const rows: Array<{ key: string, source: any, target: any, changed: boolean }> = []
  for (const key of allKeys) {
    const sv = src[key], tv = tgt[key]
    const changed = JSON.stringify(sv) !== JSON.stringify(tv)
    rows.push({ key, source: sv, target: tv, changed })
  }
  return rows
})

const accessForm = reactive({ schoolId: '', targetType: 'teacher_profile', targetId: '', reasonCategory: 'data_correction_verification', reasonText: '' })
const sensitive = ref<any>(null)
const watermark = ref('')
const activeGrant = ref<any>(null)
const nav = [{id:'overview',label:'平台总览',icon:'i-lucide-layout-dashboard'},{id:'schools',label:'学校管理',icon:'i-lucide-building-2'},{id:'content',label:'内容版本',icon:'i-lucide-package-open'},{id:'resources',label:'三库运营台',icon:'i-lucide-library',to:'/platform-admin/resources'},{id:'access',label:'应急访问',icon:'i-lucide-key-round'},{id:'audit',label:'操作审计',icon:'i-lucide-scroll-text'}]

function setActive(item: any) {
  if (item.to) {
    void navigateTo(item.to)
    return
  }
  const section = typeof item === 'string' ? item : item.id
  active.value = section
}
function showStatusMessage(message: string, color: 'info' | 'success' | 'error' | 'warning' = 'info') {
  toast.add({ title: message, color })
}

async function createSchool() {
  pending.value = true
  try { await $fetch('/api/v1/platform-admin/schools', { method: 'POST', body: schoolForm }); Object.assign(schoolForm,{name:'',code:'',adminName:'',adminEmail:'',temporaryPassword:'Welcome@2026'}); await refresh() } finally { pending.value = false }
}
async function toggleSchool(item:any) { await $fetch(`/api/v1/platform-admin/schools/${item.id}`,{method:'PATCH',body:{status:item.status==='active'?'disabled':'active'}}); await refresh() }
async function selectSchool(item:any) {
  selectedSchoolId.value = item.id
  selectedSchoolDetail.value = await $fetch(`/api/v1/platform-admin/schools/${item.id}`)
  Object.assign(schoolEditForm, { name: selectedSchoolDetail.value.school.name, code: selectedSchoolDetail.value.school.code, status: selectedSchoolDetail.value.school.status })
  delegationForm.schoolId = item.id
}
async function updateSelectedSchool() {
  if (!selectedSchoolId.value) return
  pending.value = true
  try {
    await $fetch(`/api/v1/platform-admin/schools/${selectedSchoolId.value}`, { method: 'PATCH', body: schoolEditForm })
    await Promise.all([refresh(), selectSchool({ id: selectedSchoolId.value })])
  } finally { pending.value = false }
}
async function inviteSchoolAdmin() {
  if (!selectedSchoolId.value) return
  pending.value = true
  try {
    schoolActivationResult.value = await $fetch(`/api/v1/platform-admin/schools/${selectedSchoolId.value}/admins`, { method: 'POST', body: schoolAdminForm })
    Object.assign(schoolAdminForm, { name: '', email: '' })
    await selectSchool({ id: selectedSchoolId.value })
  } finally { pending.value = false }
}
async function requestDelegation() {
  pending.value = true
  try {
    const request = await $fetch<any>('/api/v1/platform-admin/delegated-management/requests', { method: 'POST', body: delegationForm })
    await refresh()
    showStatusMessage(`代管申请已提交：${request.id}`, 'success')
  } catch (error:any) { showStatusMessage(error?.data?.message || '代管申请失败', 'error') }
  finally { pending.value = false }
}
async function openDelegatedSession(grant:any) {
  delegatedSession.value = await $fetch(`/api/v1/platform-admin/delegated-management/${grant.id}/school-admin-data`)
}
async function createContent() {
  pending.value = true
  try { await $fetch('/api/v1/platform-admin/content', { method: 'POST', body: { action:'create', code:contentForm.code, name:contentForm.name, version:contentForm.version, type:contentForm.type, payload:JSON.parse(contentForm.payloadText) } }); await refresh() } finally { pending.value = false }
}
async function contentAction(id:string, action:'publish'|'retire'|'rollback') { await $fetch('/api/v1/platform-admin/content',{method:'POST',body:{action,id}}); await refresh() }
async function requestAccess() { pending.value=true; try { await $fetch('/api/v1/admin-access/requests',{method:'POST',body:accessForm}); await refresh() } finally { pending.value=false } }
async function openApproved(request:any) {
  const grant = data.value?.accessGrants?.find((item:any)=>item.requestId===request.id && new Date(item.expiresAt)>new Date())
  if (!grant) return
  const result = await $fetch<any>(`/api/v1/admin-access/records/${request.targetType}/${request.targetId}`, { headers: {'x-admin-access-grant':grant.id} })
  sensitive.value=result.record; watermark.value=result.access.watermark; activeGrant.value=grant
}
function recordPrintAttempt() {
  if (!sensitive.value || !activeGrant.value) return
  void $fetch('/api/v1/admin-access/events', {
    method: 'POST', headers: {'x-admin-access-grant':activeGrant.value.id},
    body: { targetType:activeGrant.value.targetType, targetId:activeGrant.value.targetId, action:'print_attempt' }
  }).catch(()=>undefined)
}
onMounted(()=>window.addEventListener('beforeprint',recordPrintAttempt))
onBeforeUnmount(()=>window.removeEventListener('beforeprint',recordPrintAttempt))
</script>

<template>
  <div class="mx-auto max-w-7xl px-5 py-9">
    <div class="flex flex-wrap items-end justify-between gap-4"><div><p class="text-sm font-semibold text-indigo-700">平台治理空间</p><h1 class="mt-2 text-3xl font-semibold">平台管理后台</h1><p class="mt-2 text-sm text-slate-500">租户、内容版本、服务状态与受控应急访问。</p></div><div class="flex flex-wrap items-center gap-3"><UBadge color="warning" variant="soft">默认不接触学校业务数据</UBadge></div></div>
    <div class="mt-8 grid gap-6 lg:grid-cols-[15rem_1fr]">
      <aside class="panel h-fit p-3"><button v-for="item in nav" :key="item.id" class="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm" :class="active===item.id?'bg-indigo-800 text-white':'text-slate-600 hover:bg-slate-100'" @click="setActive(item)"><UIcon :name="item.icon" />{{ item.label }}</button></aside>
      <section class="min-w-0">
        <template v-if="active==='overview'"><div class="grid gap-4 sm:grid-cols-3"><button class="panel cursor-pointer p-6 text-left transition hover:-translate-y-0.5 hover:shadow-lg" @click="setActive('schools')"><p class="text-sm text-slate-500">学校租户</p><strong class="mt-2 block text-3xl">{{ data?.schools?.length||0 }}</strong></button><button class="panel cursor-pointer p-6 text-left transition hover:-translate-y-0.5 hover:shadow-lg" @click="setActive('content')"><p class="text-sm text-slate-500">已发布内容</p><strong class="mt-2 block text-3xl">{{ data?.contentPackages?.filter((x:any)=>x.status==='published').length||0 }}</strong></button><button class="panel cursor-pointer p-6 text-left transition hover:-translate-y-0.5 hover:shadow-lg" @click="setActive('access')"><p class="text-sm text-slate-500">应急访问申请</p><strong class="mt-2 block text-3xl">{{ data?.accessRequests?.length||0 }}</strong></button></div><div class="panel mt-5 p-6"><h2 class="font-semibold">服务状态</h2><div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div class="rounded-2xl bg-emerald-50 p-4 text-sm">数据库 · {{ data?.health.database }}</div><div class="rounded-2xl p-4 text-sm" :class="data?.health.modelConfigured?'bg-emerald-50':'bg-amber-50'">DeepSeek · {{ data?.health.modelConfigured?'已配置':'降级模式' }}</div><div class="rounded-2xl p-4 text-sm" :class="data?.health.embeddingEnabled?'bg-emerald-50':'bg-amber-50'">向量检索 · {{ data?.health.embeddingEnabled ? data?.health.embeddingModel : '关键词模式' }}</div><div class="rounded-2xl bg-slate-50 p-4 text-sm">短信 · {{ data?.health.smsProvider }}</div></div></div></template>
        <template v-if="active==='schools'"><div class="grid gap-5 xl:grid-cols-[.9fr_1.1fr]"><div class="space-y-5"><div class="panel p-6"><h2 class="text-xl font-semibold">学校列表</h2><p class="mt-2 text-sm text-slate-500">平台只管理租户、学校管理员和授权代管入口。</p><div class="mt-5 divide-y divide-slate-100"><button v-for="item in data?.schools" :key="item.id" type="button" class="flex w-full justify-between gap-3 py-4 text-left" @click="selectSchool(item)"><div><strong>{{ item.name }}</strong><p class="mt-1 text-xs text-slate-400">{{ item.code }} · {{ item.id }}</p></div><div class="flex items-center gap-2"><UBadge :color="schoolStatusColor(item.status)" variant="soft">{{ schoolStatusLabel(item.status) }}</UBadge><UButton size="xs" color="neutral" variant="ghost" @click.stop="toggleSchool(item)">{{ item.status==='active'?'停用':'启用' }}</UButton></div></button></div></div><form class="panel h-fit space-y-4 p-6" @submit.prevent="createSchool"><h2 class="text-xl font-semibold">创建学校及首位管理员</h2><UFormField label="学校名称"><UInput v-model="schoolForm.name" class="w-full" /></UFormField><UFormField label="学校代码"><UInput v-model="schoolForm.code" class="w-full" placeholder="school-code" /></UFormField><UFormField label="管理员姓名"><UInput v-model="schoolForm.adminName" class="w-full" /></UFormField><UFormField label="管理员邮箱"><UInput v-model="schoolForm.adminEmail" class="w-full" /></UFormField><UFormField label="临时密码"><UInput v-model="schoolForm.temporaryPassword" class="w-full" /></UFormField><UButton type="submit" block :loading="pending">创建租户</UButton></form></div><div v-if="selectedSchoolDetail" class="space-y-5"><div class="panel p-6"><div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-xl font-semibold">{{ selectedSchoolDetail.school.name }}</h2><p class="mt-1 text-xs text-slate-400">{{ selectedSchoolDetail.school.id }}</p></div><UBadge :color="schoolStatusColor(selectedSchoolDetail.school.status)" variant="soft">{{ schoolStatusLabel(selectedSchoolDetail.school.status) }}</UBadge></div><div class="mt-5 grid gap-3 sm:grid-cols-4"><div class="rounded-2xl bg-slate-50 p-4 text-sm">账号 <strong class="block text-2xl">{{ selectedSchoolDetail.stats.users }}</strong></div><div class="rounded-2xl bg-slate-50 p-4 text-sm">教师 <strong class="block text-2xl">{{ selectedSchoolDetail.stats.teachers }}</strong></div><div class="rounded-2xl bg-slate-50 p-4 text-sm">班级 <strong class="block text-2xl">{{ selectedSchoolDetail.stats.classes }}</strong></div><div class="rounded-2xl bg-slate-50 p-4 text-sm">学生 <strong class="block text-2xl">{{ selectedSchoolDetail.stats.students }}</strong></div></div><form class="mt-5 grid gap-3 sm:grid-cols-3" @submit.prevent="updateSelectedSchool"><UFormField label="学校名称"><UInput v-model="schoolEditForm.name" /></UFormField><UFormField label="代码"><UInput v-model="schoolEditForm.code" /></UFormField><UFormField label="状态"><USelect v-model="schoolEditForm.status" :items="[{label:'启用',value:'active'},{label:'停用',value:'disabled'}]" /></UFormField><UButton type="submit" class="sm:col-span-3" :loading="pending">保存学校信息</UButton></form></div><div class="panel p-6"><h3 class="font-semibold">学校管理员</h3><div class="mt-3 divide-y divide-slate-100"><div v-for="admin in selectedSchoolDetail.admins" :key="admin.id" class="grid gap-2 py-3 text-sm md:grid-cols-[1fr_.5fr_.6fr]"><span>{{ admin.name }} · {{ admin.email }}</span><UBadge class="w-fit" :color="accountStatusColor(admin.status)" variant="soft">{{ accountStatusLabel(admin.status) }}</UBadge><span class="text-xs text-slate-400 md:text-right">{{ admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString('zh-CN') : '未登录' }}</span></div></div><form class="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" @submit.prevent="inviteSchoolAdmin"><UInput v-model="schoolAdminForm.name" placeholder="管理员姓名" /><UInput v-model="schoolAdminForm.email" placeholder="管理员邮箱" /><UButton type="submit" :disabled="!schoolAdminForm.name || !schoolAdminForm.email" :loading="pending">邀请管理员</UButton></form><UAlert v-if="schoolActivationLink" class="mt-4" color="warning" variant="soft" title="一次性激活链接" :description="schoolActivationLink" /></div><div class="panel p-6"><h3 class="font-semibold">平台代管申请</h3><p class="mt-2 text-sm text-slate-500">代管只覆盖基础资料，不包含评估、聊天、危机、方案正文。</p><UFormField class="mt-4" label="申请原因"><UTextarea v-model="delegationForm.reason" :rows="3" class="w-full" /></UFormField><UButton class="mt-3" :disabled="delegationForm.reason.length<10" :loading="pending" @click="requestDelegation">提交代管申请</UButton><div class="mt-5 divide-y divide-slate-100"><div v-for="grant in selectedSchoolDetail.delegatedManagement" :key="grant.id" class="grid gap-2 py-3 text-sm md:grid-cols-[1fr_.5fr_auto]"><span>{{ grant.reason }}</span><UBadge class="w-fit" :color="accessStatusColor(grant.status)" variant="soft">{{ accessStatusLabel(grant.status) }}</UBadge><UButton v-if="grant.status==='approved' && new Date(grant.expiresAt)>new Date()" size="xs" @click="openDelegatedSession(grant)">进入代管</UButton></div></div></div><div v-if="delegatedSession" class="panel p-6"><h3 class="font-semibold">代管会话 · {{ delegatedSession.school?.name }}</h3><p class="mt-2 text-sm text-slate-500">请在调用基础管理接口时携带授权号：{{ delegatedSession.grant.id }}</p><div class="mt-4 grid gap-3 sm:grid-cols-3"><div class="rounded-2xl bg-slate-50 p-4 text-sm">教师 {{ delegatedSession.teachers?.length || 0 }}</div><div class="rounded-2xl bg-slate-50 p-4 text-sm">班级 {{ delegatedSession.classes?.length || 0 }}</div><div class="rounded-2xl bg-slate-50 p-4 text-sm">学生 {{ delegatedSession.students?.length || 0 }}</div></div></div></div><div v-else class="panel p-10 text-center text-sm text-slate-400">选择左侧学校后查看详情、管理员和代管申请。</div></div></template>
        <template v-if="active==='content'"><div class="grid gap-5 xl:grid-cols-[1.2fr_.8fr]"><div class="panel p-6"><h2 class="text-xl font-semibold">内容版本</h2><div class="mt-5 space-y-3"><div v-for="item in data?.contentPackages" :key="item.id" class="rounded-2xl border border-slate-100 p-4 hover:border-indigo-200 cursor-pointer transition-colors" @click="openEditor(item)"><div class="flex items-start justify-between gap-3"><div><strong>{{ item.name }}</strong><p class="mt-1 text-xs text-slate-400">{{ item.code }}@{{ item.version }} · {{ libraryTypeLabel(item.type) }}</p></div><UBadge :color="resourceStatusColor(item.status)" variant="soft">{{ resourceStatusLabel(item.status) }}</UBadge></div><div class="mt-3 flex gap-2" @click.stop><UButton v-if="item.status==='draft'" size="xs" @click="contentAction(item.id,'publish')">发布</UButton><UButton v-if="item.status==='retired'" size="xs" variant="soft" @click="contentAction(item.id,'rollback')">回滚到此版</UButton><UButton v-if="item.status==='published'" size="xs" color="neutral" variant="soft" @click="contentAction(item.id,'retire')">停用</UButton><UButton size="xs" color="neutral" variant="ghost" @click.stop="openDiff(item)">对比</UButton></div></div></div></div><form class="panel h-fit space-y-4 p-6" @submit.prevent="createContent"><h2 class="text-xl font-semibold">新增内容包</h2><UFormField label="代码"><UInput v-model="contentForm.code" class="w-full" /></UFormField><UFormField label="名称"><UInput v-model="contentForm.name" class="w-full" /></UFormField><div class="grid grid-cols-2 gap-3"><UFormField label="版本"><UInput v-model="contentForm.version" /></UFormField><UFormField label="类型"><USelect v-model="contentForm.type" :items="contentTypeOptions" /></UFormField></div><UFormField label="JSON 内容"><UTextarea v-model="contentForm.payloadText" :rows="6" class="w-full font-mono text-xs" /></UFormField><UButton type="submit" block :loading="pending">保存草稿</UButton></form></div></template>
        <template v-if="active==='access'"><div class="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><form class="panel h-fit space-y-4 p-6" @submit.prevent="requestAccess"><h2 class="text-xl font-semibold">申请目标级应急访问</h2><UAlert color="warning" variant="soft" description="申请必须由对应学校管理员批准，授权最长 30 分钟。" /><UFormField label="学校"><USelect v-model="accessForm.schoolId" :items="data?.schools?.map((s:any)=>({label:s.name,value:s.id}))" class="w-full" /></UFormField><UFormField label="目标类型"><USelect v-model="accessForm.targetType" :items="targetTypeOptions" class="w-full" /></UFormField><UFormField label="目标 UUID"><UInput v-model="accessForm.targetId" class="w-full font-mono" /></UFormField><UFormField label="详细原因"><UTextarea v-model="accessForm.reasonText" :rows="4" class="w-full" /></UFormField><button type="submit" class="w-full rounded-lg bg-[var(--ui-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50" :disabled="accessForm.reasonText.length<10">提交学校审批</button></form><div class="panel p-6"><h2 class="text-xl font-semibold">我的申请</h2><div class="mt-5 space-y-3"><div v-for="item in data?.accessRequests" :key="item.id" class="rounded-2xl border p-4"><div class="flex justify-between"><div><strong>{{ targetTypeLabel(item.targetType) }}</strong><p class="mt-1 font-mono text-xs text-slate-400">{{ item.targetId }}</p></div><UBadge :color="accessStatusColor(item.status)" variant="soft">{{ accessStatusLabel(item.status) }}</UBadge></div><UButton v-if="item.status==='approved' && data?.accessGrants?.some((g:any)=>g.requestId===item.id && new Date(g.expiresAt)>new Date())" class="mt-3" size="xs" @click="openApproved(item)">在授权时间内查看</UButton></div></div></div></div></template>
        <template v-if="active==='audit'"><div class="panel p-6"><div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="text-xl font-semibold">平台操作审计</h2><p class="mt-1 text-sm text-slate-500">最近 50 条平台管理员的操作记录。</p></div><UBadge color="neutral" variant="soft">{{ data?.auditLogs?.length || 0 }} 条</UBadge></div><div class="mt-5 overflow-x-auto"><table class="w-full text-left text-sm"><thead class="text-xs text-slate-400"><tr><th class="py-3 w-24">操作</th><th>目标类型</th><th>目标 ID</th><th>操作者</th><th>结果</th><th class="text-right w-40">时间</th></tr></thead><tbody><tr v-for="item in data?.auditLogs" :key="item.id" class="border-t border-slate-100"><td class="py-3"><UBadge size="xs" color="primary" variant="soft">{{ auditActionLabel(item.action) }}</UBadge></td><td class="text-xs text-slate-600">{{ targetTypeLabel(item.targetType) }}</td><td class="font-mono text-xs text-slate-400">{{ item.targetId?.slice(0, 8) || '—' }}{{ item.targetId ? '...' : '' }}</td><td class="text-xs">{{ item.actorName || '—' }}</td><td class="text-xs"><UBadge size="xs" :color="item.result==='success'?'success':item.result==='denied'?'warning':'error'" variant="soft">{{ item.result==='success'?'成功':item.result==='denied'?'拒绝':'失败' }}</UBadge></td><td class="text-right text-xs text-slate-400">{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</td></tr></tbody></table><p v-if="!data?.auditLogs?.length" class="py-12 text-center text-sm text-slate-400">暂无审计记录</p></div></div></template>
      </section>
    </div>
    <UModal :open="Boolean(sensitive)" title="应急只读数据" description="授权到期后将自动失效。" @update:open="v=>{if(!v)sensitive=null}"><template #body><div class="sensitive-content max-h-[65vh] overflow-auto rounded-2xl bg-slate-950 p-5 text-xs leading-6 text-slate-100"><pre class="whitespace-pre-wrap">{{ JSON.stringify(sensitive,null,2) }}</pre></div><div class="sensitive-watermark"><span v-for="i in 20" :key="i">{{ watermark }}</span></div></template></UModal>
  </div>
    <!-- 内容编辑器模态框 -->
    <UModal :open="editContentOpen" :title="`编辑 ${editingContent?.name || ''}`" description="修改内容包定义，更改不会自动保存为版本。" @update:open="v => { if(!v) editContentOpen = false }" class="w-full max-w-6xl">
      <template #body>
        <div v-if="editingContent" class="max-h-[75vh] overflow-y-auto pr-1">
          <PlatformAdminAssessmentEditor
            v-if="editingContent.type === 'assessment'"
            :payload="editingPayload"
            :code="editingCode"
            :name="editingName"
            :version="editingVersion"
            @update:payload="v => editingPayload = v"
            @update:code="v => editingCode = v"
            @update:name="v => editingName = v"
            @update:version="v => editingVersion = v"
 />
          <PlatformAdminRulesEditor
            v-else-if="editingContent.type === 'attribution'"
            :payload="editingPayload"
            @update:payload="v => editingPayload = v"
 />
          <div v-else class="py-8 text-center text-sm text-slate-400">
            暂不支持 {{ libraryTypeLabel(editingContent.type) }} 类型的可视化编辑。请使用 JSON 编辑。
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-4 border-t border-slate-100 mt-4">
          <UButton color="neutral" variant="ghost" @click="() => { editContentOpen = false }">关闭</UButton>
        </div>
      </template>
    </UModal>
    <!-- 版本对比模态框 -->
    <UModal :open="diffContentOpen" title="版本对比" description="对比两个版本的 payload 差异" @update:open="v => { if(!v) diffContentOpen = false }">
      <template #body>
        <div class="grid grid-cols-2 gap-3 mb-4">
          <UFormField label="源版本">
            <ModalSelect v-model="diffSourceId" :items="(data?.contentPackages || []).filter((x:any) => x.code === diffSource?.code).map((x:any) => ({ label: `${x.version} (${resourceStatusLabel(x.status)})`, value: x.id }))" class="w-full" @update:model-value="loadDiffVersions()" />
          </UFormField>
          <UFormField label="目标版本">
            <ModalSelect v-model="diffTargetId" :items="(data?.contentPackages || []).filter((x:any) => x.code === diffSource?.code && x.id !== diffSourceId).map((x:any) => ({ label: `${x.version} (${resourceStatusLabel(x.status)})`, value: x.id }))" class="w-full" @update:model-value="loadDiffVersions()" />
          </UFormField>
        </div>
        <div v-if="diffResult.length" class="max-h-[50vh] overflow-y-auto rounded-2xl border border-slate-200">
          <div v-for="row in diffResult" :key="row.key" class="border-b border-slate-100 p-3 last:border-0" :class="row.changed ? 'bg-amber-50' : ''">
            <div class="flex items-center justify-between">
              <code class="text-xs font-mono font-semibold">{{ row.key }}</code>
              <UBadge v-if="row.changed" color="warning" variant="soft" size="sm">已变更</UBadge>
              <UBadge v-else color="neutral" variant="soft" size="sm">未变更</UBadge>
            </div>
            <div v-if="row.changed" class="mt-2 grid grid-cols-2 gap-3 text-xs">
              <div class="rounded-xl bg-red-50 p-2 font-mono text-red-700 overflow-x-auto">{{ JSON.stringify(row.source) }}</div>
              <div class="rounded-xl bg-emerald-50 p-2 font-mono text-emerald-700 overflow-x-auto">{{ JSON.stringify(row.target) }}</div>
            </div>
          </div>
        </div>
        <div v-else class="py-8 text-center text-sm text-slate-400">选择两个版本后显示差异</div>
      </template>
    </UModal>
</template>

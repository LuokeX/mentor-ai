<script setup lang="ts">
const { user } = useAuth()
const { data, refresh } = await useFetch<any>('/api/v1/school-admin/dashboard')
const { data: settings, refresh: refreshSettings } = await useFetch<any>('/api/v1/school-admin/settings')
const active = ref('overview')
const showUserForm = ref(false)
const userForm = reactive({ name: '', email: '', role: 'teacher', temporaryPassword: 'Welcome@2026' })
const pending = ref(false)
const accessTarget = ref<{ type: string, id: string, label: string } | null>(null)
const accessForm = reactive({ reasonCategory: 'school_duty', reasonText: '' })
const sensitive = ref<any>(null)
const watermark = ref('')
const activeGrantId = ref('')

async function createUser() {
  pending.value = true
  try {
    const result = await $fetch<any>('/api/v1/school-admin/users', { method: 'POST', body: userForm })
    if (result.totpSecret) alert(`请安全交给心理专员的一次性 TOTP 密钥：${result.totpSecret}`)
    showUserForm.value = false
    Object.assign(userForm, { name: '', email: '', role: 'teacher', temporaryPassword: 'Welcome@2026' })
    await refresh()
  } finally { pending.value = false }
}

function requestView(target: { type: string, id: string, label: string }) {
  accessTarget.value = target
  sensitive.value = null
  accessForm.reasonText = ''
}

async function openSensitive() {
  if (!accessTarget.value) return
  pending.value = true
  try {
    const access = await $fetch<any>('/api/v1/admin-access/requests', {
      method: 'POST', body: { targetType: accessTarget.value.type, targetId: accessTarget.value.id, ...accessForm }
    })
    const result = await $fetch<any>(`/api/v1/admin-access/records/${accessTarget.value.type}/${accessTarget.value.id}`, {
      headers: { 'x-admin-access-grant': access.grant.id }
    })
    sensitive.value = result.record
    watermark.value = result.access.watermark
    activeGrantId.value = access.grant.id
  } finally { pending.value = false }
}

function recordPrintAttempt() {
  if (!accessTarget.value || !activeGrantId.value || !sensitive.value) return
  void $fetch('/api/v1/admin-access/events', {
    method: 'POST',
    headers: { 'x-admin-access-grant': activeGrantId.value },
    body: { targetType: accessTarget.value.type, targetId: accessTarget.value.id, action: 'print_attempt' }
  }).catch(() => undefined)
}

onMounted(() => window.addEventListener('beforeprint', recordPrintAttempt))
onBeforeUnmount(() => window.removeEventListener('beforeprint', recordPrintAttempt))

async function review(id: string, decision: 'approved' | 'rejected') {
  await $fetch(`/api/v1/school-admin/access-requests/${id}/review`, { method: 'POST', body: { decision } })
  await refresh()
}

async function updateSettings() {
  await $fetch('/api/v1/school-admin/settings', { method: 'PATCH', body: settings.value })
  await refreshSettings()
}

async function toggleUser(item: any) {
  await $fetch(`/api/v1/school-admin/users/${item.id}`, { method: 'PATCH', body: { status: item.status === 'active' ? 'disabled' : 'active' } })
  await refresh()
}

const nav = [
  { id: 'overview', label: '管理首页', icon: 'i-lucide-layout-dashboard' }, { id: 'users', label: '用户管理', icon: 'i-lucide-users' }, { id: 'records', label: '业务档案', icon: 'i-lucide-folders' },
  { id: 'crises', label: '危机转介', icon: 'i-lucide-siren' }, { id: 'approvals', label: '访问审批', icon: 'i-lucide-shield-check' }, { id: 'audit', label: '访问审计', icon: 'i-lucide-scroll-text' }, { id: 'settings', label: '学校配置', icon: 'i-lucide-settings' }
]
function openUserCreate() { showUserForm.value = true }
</script>

<template>
  <div class="mx-auto max-w-7xl px-5 py-9">
    <div><p class="text-sm font-semibold text-emerald-700">学校治理空间</p><h1 class="mt-2 text-3xl font-semibold">学校管理后台</h1><p class="mt-2 text-sm text-slate-500">账号、转介配置和敏感访问全部可审计。</p></div>
    <div class="mt-8 grid gap-6 lg:grid-cols-[15rem_1fr]">
      <aside class="panel h-fit p-3"><button v-for="item in nav" :key="item.id" class="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm" :class="active === item.id ? 'bg-emerald-800 text-white' : 'text-slate-600 hover:bg-slate-100'" @click="() => { active = item.id }"><UIcon :name="item.icon" />{{ item.label }}<UBadge v-if="item.id === 'approvals' && data?.pendingRequests?.length" class="ml-auto" color="error">{{ data.pendingRequests.length }}</UBadge></button></aside>
      <section class="min-w-0">
        <template v-if="active === 'overview'"><div class="grid gap-4 sm:grid-cols-3"><div class="panel p-6"><p class="text-sm text-slate-500">本校账号</p><strong class="mt-2 block text-3xl">{{ data?.metrics.users || 0 }}</strong></div><div class="panel p-6"><p class="text-sm text-slate-500">评估记录</p><strong class="mt-2 block text-3xl">{{ data?.metrics.assessments || 0 }}</strong></div><div class="panel border-red-100 p-6"><p class="text-sm text-red-600">待处理危机</p><strong class="mt-2 block text-3xl text-red-700">{{ data?.metrics.activeCrises || 0 }}</strong></div></div><div class="panel mt-5 p-6"><h2 class="font-semibold">管理原则</h2><div class="mt-4 grid gap-3 md:grid-cols-3"><div class="rounded-2xl bg-slate-50 p-4 text-sm">查看业务明细前强制填写事由</div><div class="rounded-2xl bg-slate-50 p-4 text-sm">业务数据只读且禁止批量导出</div><div class="rounded-2xl bg-slate-50 p-4 text-sm">平台应急访问必须由本校批准</div></div></div></template>
        <template v-if="active === 'users'"><div class="panel p-6"><div class="flex items-center justify-between"><h2 class="text-xl font-semibold">用户管理</h2><UButton icon="i-lucide-user-plus" @click="openUserCreate">新建账号</UButton></div><div class="mt-5 overflow-x-auto"><table class="w-full text-left text-sm"><thead class="text-xs text-slate-400"><tr><th class="py-3">姓名</th><th>邮箱</th><th>角色</th><th>状态</th><th class="text-right">操作</th></tr></thead><tbody><tr v-for="item in data?.users" :key="item.id" class="border-t border-slate-100"><td class="py-4 font-medium">{{ item.name }}</td><td>{{ item.email }}</td><td>{{ item.role }}</td><td><UBadge :color="item.status === 'active' ? 'success' : 'neutral'" variant="soft">{{ item.status }}</UBadge></td><td class="space-x-2 text-right"><UButton v-if="item.role === 'teacher'" size="xs" variant="soft" @click="requestView({type:'teacher_profile',id:item.id,label:item.name})">查看业务档案</UButton><UButton size="xs" color="neutral" variant="ghost" @click="toggleUser(item)">{{ item.status === 'active' ? '停用' : '启用' }}</UButton></td></tr></tbody></table></div></div></template>
        <template v-if="active === 'records'"><div class="panel p-6"><h2 class="text-xl font-semibold">业务档案访问</h2><p class="mt-2 text-sm text-slate-500">请从“用户管理”选择教师。每次打开都会生成单独的短时授权和访问日志。</p><UAlert class="mt-5" color="warning" variant="soft" title="只读区域" description="管理后台不提供数据修改、删除或批量导出接口。" /></div></template>
        <template v-if="active === 'crises'"><div class="panel p-6"><h2 class="text-xl font-semibold">危机转介状态</h2><p class="mt-2 text-sm text-slate-500">这里仅显示工单状态；查看关联业务正文仍需填写事由。</p><div class="mt-5 divide-y divide-slate-100"><div v-for="item in data?.referrals" :key="item.id" class="grid gap-2 py-4 text-sm md:grid-cols-[1fr_.7fr_.8fr]"><div><strong>事件 {{ item.safetyEventId.slice(0,8) }}</strong><p class="mt-1 font-mono text-xs text-slate-400">{{ item.id }}</p></div><div><UBadge :color="item.status==='created'?'error':'neutral'" variant="soft">{{ item.severity }} · {{ item.status }}</UBadge></div><span class="text-xs text-slate-400 md:text-right">{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</span></div><p v-if="!data?.referrals?.length" class="py-14 text-center text-sm text-slate-400">暂无危机转介</p></div></div></template>
        <template v-if="active === 'approvals'"><div class="panel p-6"><h2 class="text-xl font-semibold">平台应急访问审批</h2><div class="mt-5 space-y-3"><div v-for="item in data?.pendingRequests" :key="item.id" class="rounded-2xl border border-amber-100 bg-amber-50/50 p-5"><div class="flex flex-wrap justify-between gap-3"><div><strong>{{ item.targetType }}</strong><p class="mt-1 text-xs text-slate-500">{{ item.reasonCategory }} · {{ item.reasonText }}</p></div><div class="flex gap-2"><UButton size="sm" @click="review(item.id,'approved')">批准 30 分钟</UButton><UButton size="sm" color="neutral" variant="soft" @click="review(item.id,'rejected')">拒绝</UButton></div></div></div><p v-if="!data?.pendingRequests?.length" class="py-16 text-center text-sm text-slate-400">暂无待审批申请</p></div></div></template>
        <template v-if="active === 'audit'"><div class="panel p-6"><h2 class="text-xl font-semibold">敏感访问审计</h2><div class="mt-5 divide-y divide-slate-100"><div v-for="item in data?.accessEvents" :key="item.id" class="grid gap-2 py-4 text-sm md:grid-cols-[1fr_1fr_1fr]"><span>{{ item.action }} · {{ item.targetType }}</span><span class="font-mono text-xs text-slate-400">{{ item.targetId }}</span><span class="text-right text-xs text-slate-400">{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</span></div></div></div></template>
        <template v-if="active === 'settings'"><div class="panel max-w-2xl p-6"><h2 class="text-xl font-semibold">学校与转介配置</h2><div v-if="settings" class="mt-6 space-y-4"><UFormField label="默认危机接收心理专员"><USelect v-model="settings.referralPsychologistId" :items="settings.psychologists?.map((p:any)=>({label:p.name,value:p.id})) || []" class="w-full" /></UFormField><UFormField label="校内求助电话"><UInput v-model="settings.helpPhone" class="w-full" /></UFormField><UFormField label="短信接收号码（逗号分隔）"><UInput :model-value="settings.smsRecipients?.join(',')" class="w-full" @update:model-value="settings.smsRecipients = String($event).split(',').map(v=>v.trim()).filter(Boolean)" /></UFormField><UFormField label="危机指引"><UTextarea v-model="settings.crisisGuide" :rows="5" class="w-full" /></UFormField><UButton @click="updateSettings">保存配置</UButton></div></div></template>
      </section>
    </div>

    <UModal v-model:open="showUserForm" title="新建校内账号"><template #body><div class="space-y-4"><UFormField label="姓名"><UInput v-model="userForm.name" class="w-full" /></UFormField><UFormField label="邮箱"><UInput v-model="userForm.email" class="w-full" /></UFormField><UFormField label="角色"><USelect v-model="userForm.role" :items="[{label:'班主任',value:'teacher'},{label:'心理专员',value:'psychologist'}]" class="w-full" /></UFormField><UFormField label="临时密码"><UInput v-model="userForm.temporaryPassword" class="w-full" /></UFormField><UButton block :loading="pending" @click="createUser">创建账号</UButton></div></template></UModal>

    <UModal :open="Boolean(accessTarget)" :title="`查看 ${accessTarget?.label || ''} 的敏感档案`" description="授权只在当前目标上生效 15 分钟。" @update:open="value => { if (!value) { accessTarget = null; sensitive = null } }"><template #body><div class="space-y-4"><template v-if="!sensitive"><UFormField label="访问事由"><USelect v-model="accessForm.reasonCategory" :items="[{label:'风险复核',value:'risk_review'},{label:'投诉处理',value:'complaint_handling'},{label:'学校职责',value:'school_duty'},{label:'其他',value:'other'}]" class="w-full" /></UFormField><UFormField label="详细说明" help="至少 10 个字符，将写入不可变审计记录"><UTextarea v-model="accessForm.reasonText" :rows="4" class="w-full" /></UFormField><UButton block :disabled="accessForm.reasonText.length < 10" :loading="pending" @click="openSensitive">创建只读授权并查看</UButton></template><template v-else><div class="sensitive-content max-h-[65vh] overflow-auto rounded-2xl bg-slate-950 p-5 text-xs leading-6 text-slate-100"><pre class="whitespace-pre-wrap">{{ JSON.stringify(sensitive, null, 2) }}</pre></div><div class="sensitive-watermark"><span v-for="i in 20" :key="i">{{ watermark }}</span></div></template></div></template></UModal>
  </div>
</template>

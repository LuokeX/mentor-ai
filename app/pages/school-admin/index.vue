<script setup lang="ts">
const { user } = useAuth()
const { data, refresh } = await useFetch<any>('/api/v1/school-admin/dashboard')
const { data: settings, refresh: refreshSettings } = await useFetch<any>('/api/v1/school-admin/settings')
const { data: schoolInfo, refresh: refreshSchoolInfo } = await useFetch<any>('/api/v1/school-admin/information')
const { data: invitations, refresh: refreshInvitations } = await useFetch<any[]>('/api/v1/school-admin/invitations')
const { data: pilotMetrics, refresh: refreshPilotMetrics } = await useFetch<any>('/api/v1/school-admin/pilot-metrics')
const { data: referrals, refresh: refreshReferrals } = await useFetch<any[]>('/api/v1/school-admin/referrals')
const active = ref('overview')
const showUserForm = ref(false)
const userForm = reactive({ name: '', email: '', role: 'teacher' })
const assignment = reactive<Record<string, string>>({})
const studentClass = reactive<Record<string, string>>({})
const studentOwner = reactive<Record<string, string>>({})
const assignmentReason = ref('')
const pending = ref(false)
const accessTarget = ref<{ type: string, id: string, label: string } | null>(null)
const accessForm = reactive({ reasonCategory: 'school_duty', reasonText: '' })
const sensitive = ref<any>(null)
const watermark = ref('')
const activeGrantId = ref('')
const toast = useToast()
const activationResult = ref<any>(null)
const importType = ref<'users' | 'classes' | 'students' | 'guardians'>('users')
const importFile = ref<File | null>(null)
const importContentBase64 = ref('')
const importPreview = ref<any>(null)
const importResult = ref<any>(null)
const referralAssignee = reactive<Record<string, string>>({})

async function createUser() {
  pending.value = true
  try {
    const result = await $fetch<any>('/api/v1/school-admin/users', { method: 'POST', body: userForm })
    activationResult.value = result
    showUserForm.value = false
    Object.assign(userForm, { name: '', email: '', role: 'teacher' })
    await Promise.all([refresh(), refreshInvitations()])
    toast.add({ title: '邀请已创建', description: '激活链接有效期为 72 小时，请通过校方认可渠道发送。', color: 'success' })
  } catch (error: any) { toast.add({ title: '创建失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
  finally { pending.value = false }
}

const activationLink = computed(() => activationResult.value?.activationToken
  ? `${window.location.origin}/activate?token=${encodeURIComponent(activationResult.value.activationToken)}` : '')

async function copyActivationLink() {
  if (!activationLink.value) return
  await navigator.clipboard.writeText(activationLink.value)
  toast.add({ title: '激活链接已复制', color: 'success' })
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
  pending.value = true
  try {
    await $fetch('/api/v1/school-admin/settings', {
      method: 'PATCH', body: {
        helpPhone: settings.value.helpPhone || null,
        smsRecipients: settings.value.smsRecipients,
        safetyContactRecipients: settings.value.safetyContactRecipients,
        referralPsychologistId: settings.value.referralPsychologistId || null,
        crisisGuide: settings.value.crisisGuide,
        aiDataMode: settings.value.aiDataMode,
        aiApprovalReference: settings.value.aiApprovalReference || null,
        aiNoticeVersion: settings.value.aiNoticeVersion,
        approveFullContext: settings.value.aiDataMode === 'full_context' ? Boolean(settings.value.approveFullContext) : undefined,
        referralAckMinutes: Number(settings.value.referralAckMinutes),
        referralEscalationMinutes: Number(settings.value.referralEscalationMinutes)
      }
    })
    await refreshSettings()
    toast.add({ title: '学校配置已保存', color: 'success' })
  } catch (error: any) { toast.add({ title: '保存失败', description: error?.data?.message || '请检查配置', color: 'error' }) }
  finally { pending.value = false }
}

async function toggleUser(item: any) {
  try {
    const result = await $fetch<any>(`/api/v1/school-admin/users/${item.id}`, {
      method: 'PATCH', body: item.status === 'active' ? { status: 'disabled' } : { reissueInvitation: true }
    })
    if (result.activationToken) activationResult.value = result
    await Promise.all([refresh(), refreshInvitations()])
  } catch (error: any) { toast.add({ title: '操作失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
}

async function resetMfa(item: any) {
  try {
    const result = await $fetch<any>(`/api/v1/school-admin/users/${item.id}`, { method: 'PATCH', body: { resetMfa: true } })
    activationResult.value = result
    toast.add({ title: 'MFA 已重置', description: '旧会话和旧恢复码已失效，请发送新的激活链接。', color: 'success' })
    await Promise.all([refresh(), refreshInvitations()])
  } catch (error: any) { toast.add({ title: '重置失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
}

async function regenerateInvitation(item: any) {
  try {
    const result = await $fetch<any>(`/api/v1/school-admin/invitations/${item.id}/regenerate`, { method: 'POST' })
    activationResult.value = result
    await refreshInvitations()
    toast.add({ title: '邀请已重新生成', color: 'success' })
  } catch (error: any) { toast.add({ title: '重新邀请失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
}

async function onImportFile(file?: File) {
  importFile.value = file || null; importPreview.value = null; importResult.value = null
  if (!file) return
  if (file.size > 2 * 1024 * 1024) { toast.add({ title: '文件过大', description: '单个 CSV 不能超过 2 MB', color: 'error' }); return }
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  importContentBase64.value = btoa(binary)
}

async function previewImport() {
  if (!importContentBase64.value) return
  pending.value = true
  try {
    importPreview.value = await $fetch('/api/v1/school-admin/imports/preview', {
      method: 'POST', body: { type: importType.value, contentBase64: importContentBase64.value }
    })
  } catch (error: any) { toast.add({ title: '预检失败', description: error?.data?.message || '请检查文件', color: 'error' }) }
  finally { pending.value = false }
}

async function commitImport() {
  if (!importPreview.value || importPreview.value.errors.length) return
  pending.value = true
  try {
    importResult.value = await $fetch('/api/v1/school-admin/imports/commit', {
      method: 'POST', body: {
        previewId: importPreview.value.previewId, type: importType.value,
        checksum: importPreview.value.checksum, contentBase64: importContentBase64.value
      }
    })
    toast.add({ title: '导入完成', description: `新增 ${importResult.value.created} 条，更新 ${importResult.value.updated} 条`, color: 'success' })
    await Promise.all([refresh(), refreshSchoolInfo(), refreshInvitations(), refreshPilotMetrics()])
  } catch (error: any) { toast.add({ title: '导入失败，未写入任何记录', description: error?.data?.message || '请重新预检', color: 'error' }) }
  finally { pending.value = false }
}

async function reassignReferral(item: any) {
  const psychologistId = referralAssignee[item.id]
  if (!psychologistId) return
  try {
    await $fetch(`/api/v1/school-admin/referrals/${item.id}/assign`, { method: 'PATCH', body: { psychologistId, reason: '学校管理员处置转派' } })
    toast.add({ title: '工单已转派', color: 'success' })
    await refreshReferrals()
  } catch (error: any) { toast.add({ title: '转派失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
}

async function assignRecord(targetType: 'class' | 'student' | 'guardian' | 'communication' | 'plan', targetId: string) {
  const ownerUserId = assignment[`${targetType}:${targetId}`]
  if (!ownerUserId) return
  pending.value = true
  try {
    await $fetch('/api/v1/school-admin/information/assign', { method: 'POST', body: { targetType, targetId, ownerUserId, reason: assignmentReason.value || undefined } })
    await Promise.all([refreshSchoolInfo(), refresh()])
  } finally { pending.value = false }
}

async function updateStudentClass(studentId: string) {
  pending.value = true
  try {
    await $fetch(`/api/v1/school-admin/information/students/${studentId}/class`, {
      method: 'PATCH',
      body: { classId: studentClass[studentId] || null, reason: assignmentReason.value || undefined }
    })
    await Promise.all([refreshSchoolInfo(), refresh()])
  } finally { pending.value = false }
}

async function updateStudentOwner(studentId: string) {
  const ownerUserId = studentOwner[studentId]
  if (!ownerUserId) return
  pending.value = true
  try {
    await $fetch(`/api/v1/school-admin/information/students/${studentId}/owner`, {
      method: 'PATCH',
      body: { ownerUserId, reason: assignmentReason.value || undefined }
    })
    await Promise.all([refreshSchoolInfo(), refresh()])
  } finally { pending.value = false }
}

const nav = [
  { id: 'overview', label: '管理首页', icon: 'i-lucide-layout-dashboard' }, { id: 'users', label: '用户与邀请', icon: 'i-lucide-users' }, { id: 'imports', label: '数据导入', icon: 'i-lucide-file-up' }, { id: 'metrics', label: '试点指标', icon: 'i-lucide-chart-no-axes-combined' }, { id: 'records', label: '业务档案', icon: 'i-lucide-folders' },
  { id: 'assignment', label: '负责教师分配', icon: 'i-lucide-git-branch' }, { id: 'class_students', label: '班级学生管理', icon: 'i-lucide-list-tree' }, { id: 'crises', label: '危机转介', icon: 'i-lucide-siren' }, { id: 'approvals', label: '访问审批', icon: 'i-lucide-shield-check' }, { id: 'audit', label: '访问审计', icon: 'i-lucide-scroll-text' }, { id: 'settings', label: '学校配置', icon: 'i-lucide-settings' }
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
        <template v-if="active === 'users'"><div class="space-y-5"><div class="panel p-6"><div class="flex items-center justify-between"><div><h2 class="text-xl font-semibold">用户与激活</h2><p class="mt-1 text-sm text-slate-500">新账号通过 72 小时一次性链接激活；心理专员自行绑定 MFA。</p></div><UButton icon="i-lucide-user-plus" @click="openUserCreate">邀请账号</UButton></div><div class="mt-5 overflow-x-auto"><table class="w-full text-left text-sm"><thead class="text-xs text-slate-400"><tr><th class="py-3">姓名</th><th>邮箱</th><th>角色</th><th>状态</th><th class="text-right">操作</th></tr></thead><tbody><tr v-for="item in data?.users" :key="item.id" class="border-t border-slate-100"><td class="py-4 font-medium">{{ item.name }}</td><td>{{ item.email }}</td><td>{{ item.role }}</td><td><UBadge :color="item.status === 'active' ? 'success' : item.status === 'invited' ? 'warning' : 'neutral'" variant="soft">{{ item.status }}</UBadge></td><td class="space-x-2 text-right"><UButton v-if="item.role === 'teacher'" size="xs" variant="soft" @click="requestView({type:'teacher_profile',id:item.id,label:item.name})">查看业务档案</UButton><UButton v-if="item.role === 'psychologist' && item.status === 'active'" size="xs" color="warning" variant="ghost" @click="resetMfa(item)">重置 MFA</UButton><UButton size="xs" color="neutral" variant="ghost" @click="toggleUser(item)">{{ item.status === 'active' ? '停用' : '重新邀请' }}</UButton></td></tr></tbody></table></div></div><div class="panel p-6"><h3 class="font-semibold">最近邀请</h3><div class="mt-4 divide-y divide-slate-100"><div v-for="item in invitations?.slice(0,10)" :key="item.id" class="grid items-center gap-2 py-3 text-sm sm:grid-cols-[1fr_.7fr_.4fr_auto]"><span>{{ item.name }} · {{ item.email }}</span><span class="text-slate-500">{{ new Date(item.expiresAt).toLocaleString('zh-CN') }}</span><UBadge class="w-fit" :color="item.status==='pending'?'warning':item.status==='accepted'?'success':'neutral'" variant="soft">{{ item.status }}</UBadge><UButton v-if="item.status==='expired'" size="xs" color="neutral" variant="soft" @click="regenerateInvitation(item)">重新生成</UButton></div></div></div></div></template>
        <template v-if="active === 'imports'"><div class="panel p-6"><div><h2 class="text-xl font-semibold">CSV 数据入校</h2><p class="mt-2 text-sm text-slate-500">按用户 → 班级 → 学生 → 家长顺序导入。预检不写业务数据，确认提交采用单事务。</p></div><div class="mt-6 grid gap-4 sm:grid-cols-2"><UFormField label="数据类型"><USelect v-model="importType" :items="[{label:'用户 users.csv',value:'users'},{label:'班级 classes.csv',value:'classes'},{label:'学生 students.csv',value:'students'},{label:'家长 guardians.csv',value:'guardians'}]" class="w-full" /></UFormField><div class="flex items-end"><UButton :to="`/api/v1/school-admin/imports/templates/${importType}`" external color="neutral" variant="soft" icon="i-lucide-download">下载固定模板</UButton></div><UFormField class="sm:col-span-2" label="选择 CSV" help="支持 UTF-8/BOM 和 GB18030；最大 2 MB、2,000 行"><input type="file" accept=".csv,text/csv" class="block w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" @change="onImportFile(($event.target as HTMLInputElement).files?.[0])" /></UFormField></div><UButton class="mt-5" :disabled="!importContentBase64" :loading="pending" @click="previewImport">上传并预检</UButton><div v-if="importPreview" class="mt-6 rounded-2xl border p-5" :class="importPreview.errors.length?'border-red-200 bg-red-50':'border-emerald-200 bg-emerald-50'"><div class="flex flex-wrap gap-4 text-sm"><strong>{{ importPreview.totalRows }} 行</strong><span>编码 {{ importPreview.encoding }}</span><span>{{ importPreview.validRows }} 行可导入</span><span v-if="importPreview.errors.length" class="text-red-700">{{ importPreview.errors.length }} 个错误</span></div><div v-if="importPreview.errors.length" class="mt-4 max-h-56 overflow-auto"><p v-for="error in importPreview.errors" :key="`${error.row}:${error.code}`" class="py-1 text-xs text-red-700">第 {{ error.row }} 行 · {{ error.code }} · {{ error.message }}</p></div><UButton v-else class="mt-5" :loading="pending" @click="commitImport">人工确认并写入</UButton></div></div></template>
        <template v-if="active === 'metrics'"><div class="space-y-5"><div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-6"><div class="panel p-5"><p class="text-sm text-slate-500">账号激活率</p><strong class="mt-2 block text-3xl">{{ Math.round((pilotMetrics?.activation?.rate || 0) * 100) }}%</strong></div><div class="panel p-5"><p class="text-sm text-slate-500">10 分钟首任务</p><strong class="mt-2 block text-3xl">{{ Math.round((pilotMetrics?.firstTask?.rate || 0) * 100) }}%</strong></div><div class="panel p-5"><p class="text-sm text-slate-500">周活跃教师</p><strong class="mt-2 block text-3xl">{{ pilotMetrics?.weeklyActiveTeachers || 0 }}</strong></div><div class="panel p-5"><p class="text-sm text-slate-500">AI 有帮助率</p><strong class="mt-2 block text-3xl">{{ Math.round((pilotMetrics?.assistant?.helpfulRate || 0) * 100) }}%</strong></div><div class="panel p-5"><p class="text-sm text-slate-500">7 日方案执行率</p><strong class="mt-2 block text-3xl">{{ Math.round((pilotMetrics?.planExecution?.rate || 0) * 100) }}%</strong></div><div class="panel p-5"><p class="text-sm text-slate-500">7 日复盘率</p><strong class="mt-2 block text-3xl">{{ Math.round((pilotMetrics?.reviews?.rate || 0) * 100) }}%</strong></div></div><UAlert color="primary" variant="soft" title="隐私保护指标" description="这里只统计激活、操作、方案和 SLA 等产品事件，不采集或展示教师聊天正文。" /><div class="grid gap-5 lg:grid-cols-2"><div class="panel p-6"><h3 class="font-semibold">AI 回答质量（近 7 天）</h3><div class="mt-4 grid gap-4 sm:grid-cols-3"><div><span class="text-sm text-slate-500">回答 / 反馈</span><strong class="block text-2xl">{{ pilotMetrics?.assistant?.answers || 0 }}/{{ pilotMetrics?.assistant?.feedbackTotal || 0 }}</strong></div><div><span class="text-sm text-slate-500">来源不足 / 降级</span><strong class="block text-2xl">{{ pilotMetrics?.assistant?.withoutSources || 0 }}/{{ pilotMetrics?.assistant?.localFallback || 0 }}</strong></div><div><span class="text-sm text-slate-500">超时 / 失败</span><strong class="block text-2xl">{{ pilotMetrics?.assistant?.timeouts || 0 }}/{{ pilotMetrics?.assistant?.failures || 0 }}</strong></div></div></div><div class="panel p-6"><h3 class="font-semibold">危机 SLA</h3><div class="mt-4 grid gap-4 sm:grid-cols-3"><div><span class="text-sm text-slate-500">工单分配</span><strong class="block text-2xl">{{ pilotMetrics?.crisis?.assigned || 0 }}/{{ pilotMetrics?.crisis?.total || 0 }}</strong></div><div><span class="text-sm text-slate-500">5 分钟内确认</span><strong class="block text-2xl">{{ Math.round((pilotMetrics?.crisis?.ackWithinSlaRate || 0) * 100) }}%</strong></div><div><span class="text-sm text-slate-500">升级记录</span><strong class="block text-2xl">{{ pilotMetrics?.crisis?.escalated || 0 }}</strong></div></div></div></div></div></template>
        <template v-if="active === 'records'"><div class="panel p-6"><h2 class="text-xl font-semibold">业务档案访问</h2><p class="mt-2 text-sm text-slate-500">请从“用户管理”选择教师。每次打开都会生成单独的短时授权和访问日志。</p><UAlert class="mt-5" color="warning" variant="soft" title="只读区域" description="管理后台不提供数据修改、删除或批量导出接口。" /></div></template>
        <template v-if="active === 'class_students'"><div class="panel p-6"><div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-xl font-semibold">班级学生管理</h2><p class="mt-2 text-sm text-slate-500">用于学生分班、转班、移出班级和调整当前负责教师。转班到目标班级后，会同步学生和相关沟通记录的负责教师。</p></div><UBadge color="neutral" variant="soft">{{ schoolInfo?.students?.length || 0 }} 名学生</UBadge></div><UFormField class="mt-5" label="操作说明（可选）" help="会写入转班/移交历史。"><UInput v-model="assignmentReason" class="w-full" placeholder="例如：学生转班、班主任更换、临时协同处理" /></UFormField><div class="mt-6 space-y-6"><section v-for="klass in schoolInfo?.classes" :key="klass.id" class="rounded-3xl border border-slate-100 p-5"><div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="font-semibold">{{ klass.name }}</h3><p class="mt-1 text-xs text-slate-500">{{ klass.grade }} 年级 · 当前负责：{{ klass.ownerName }}</p></div><UBadge color="neutral" variant="soft">{{ klass.students?.length || 0 }} 名学生</UBadge></div><div class="mt-4 divide-y divide-slate-100"><div v-for="student in klass.students" :key="student.id" class="grid gap-3 py-4 text-sm lg:grid-cols-[1fr_.9fr_.9fr_auto_auto]"><div><strong>{{ student.name }}</strong><p class="mt-1 text-xs text-slate-400">{{ student.notes || '暂无备注' }}</p></div><span class="text-slate-500">当前负责：{{ student.ownerName }}</span><USelect v-model="studentClass[student.id]" :items="[{label:'移出班级',value:''}, ...(schoolInfo?.classes || []).map((item:any)=>({label:item.name,value:item.id}))]" :placeholder="student.className || '选择班级'" class="w-full" /><UButton size="sm" color="neutral" variant="soft" :loading="pending" @click="updateStudentClass(student.id)">转班</UButton><div class="flex gap-2"><USelect v-model="studentOwner[student.id]" :items="schoolInfo?.teachers?.map((teacher:any)=>({label:teacher.name,value:teacher.id})) || []" placeholder="负责教师" class="w-36" /><UButton size="sm" :disabled="!studentOwner[student.id]" :loading="pending" @click="updateStudentOwner(student.id)">调整</UButton></div></div><p v-if="!klass.students?.length" class="py-6 text-center text-sm text-slate-400">该班暂无学生</p></div></section><section class="rounded-3xl border border-dashed border-slate-200 p-5"><div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="font-semibold">未分班学生</h3><p class="mt-1 text-xs text-slate-500">可分配到任一班级；如果目标班级有负责教师，会同步学生负责教师。</p></div><UBadge color="neutral" variant="soft">{{ schoolInfo?.unassignedStudents?.length || 0 }} 名</UBadge></div><div class="mt-4 divide-y divide-slate-100"><div v-for="student in schoolInfo?.unassignedStudents" :key="student.id" class="grid gap-3 py-4 text-sm lg:grid-cols-[1fr_.9fr_.9fr_auto]"><div><strong>{{ student.name }}</strong><p class="mt-1 text-xs text-slate-400">{{ student.notes || '暂无备注' }}</p></div><span class="text-slate-500">当前负责：{{ student.ownerName }}</span><USelect v-model="studentClass[student.id]" :items="(schoolInfo?.classes || []).map((item:any)=>({label:item.name,value:item.id}))" placeholder="选择班级" class="w-full" /><UButton size="sm" :disabled="!studentClass[student.id]" :loading="pending" @click="updateStudentClass(student.id)">分班</UButton></div><p v-if="!schoolInfo?.unassignedStudents?.length" class="py-6 text-center text-sm text-slate-400">暂无未分班学生</p></div></section></div></div></template>
        <template v-if="active === 'assignment'"><div class="panel p-6"><div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-xl font-semibold">负责教师分配</h2><p class="mt-2 text-sm text-slate-500">这些是学校业务档案，不是教师个人私有数据。这里维护当前负责教师；班级移交会同步班级下学生、关联家长和相关沟通记录，并写入移交历史。</p></div><UBadge color="neutral" variant="soft">{{ schoolInfo?.teachers?.length || 0 }} 位教师</UBadge></div><UFormField class="mt-5" label="本次移交说明（可选）" help="例如：班主任更换、学生转班、临时协同处理。会写入移交审计记录。"><UInput v-model="assignmentReason" class="w-full" placeholder="填写移交原因" /></UFormField><div class="mt-6 space-y-7"><section><h3 class="font-semibold">班级</h3><div class="mt-3 divide-y divide-slate-100"><div v-for="item in schoolInfo?.classes" :key="item.id" class="grid gap-3 py-4 text-sm lg:grid-cols-[1fr_.7fr_.9fr_auto]"><div><strong>{{ item.name }}</strong><p class="mt-1 text-xs text-slate-400">{{ item.grade }} 年级 · 登记 {{ item.studentCount }} 人</p></div><span class="text-slate-500">当前负责：{{ item.ownerName }}</span><USelect v-model="assignment[`class:${item.id}`]" :items="schoolInfo?.teachers?.map((teacher:any)=>({label:teacher.name,value:teacher.id})) || []" placeholder="选择教师" class="w-full" /><UButton size="sm" :loading="pending" :disabled="!assignment[`class:${item.id}`]" @click="assignRecord('class', item.id)">分配</UButton></div></div></section><section><h3 class="font-semibold">学生</h3><div class="mt-3 divide-y divide-slate-100"><div v-for="item in schoolInfo?.students" :key="item.id" class="grid gap-3 py-4 text-sm lg:grid-cols-[1fr_.7fr_.9fr_auto]"><div><strong>{{ item.name }}</strong><p class="mt-1 text-xs text-slate-400">{{ item.className || '未分班' }} · {{ item.notes || '暂无备注' }}</p></div><span class="text-slate-500">当前负责：{{ item.ownerName }}</span><USelect v-model="assignment[`student:${item.id}`]" :items="schoolInfo?.teachers?.map((teacher:any)=>({label:teacher.name,value:teacher.id})) || []" placeholder="选择教师" class="w-full" /><UButton size="sm" :loading="pending" :disabled="!assignment[`student:${item.id}`]" @click="assignRecord('student', item.id)">分配</UButton></div></div></section><section><h3 class="font-semibold">家长</h3><div class="mt-3 divide-y divide-slate-100"><div v-for="item in schoolInfo?.guardians" :key="item.id" class="grid gap-3 py-4 text-sm lg:grid-cols-[1fr_.7fr_.9fr_auto]"><div><strong>{{ item.name }}</strong><p class="mt-1 text-xs text-slate-400">{{ item.relation || '关系未填' }} · 关联 {{ item.linkedStudents?.map((student:any)=>student.name).join('、') || '暂无学生' }}</p></div><span class="text-slate-500">当前负责：{{ item.ownerName }}</span><USelect v-model="assignment[`guardian:${item.id}`]" :items="schoolInfo?.teachers?.map((teacher:any)=>({label:teacher.name,value:teacher.id})) || []" placeholder="选择教师" class="w-full" /><UButton size="sm" :loading="pending" :disabled="!assignment[`guardian:${item.id}`]" @click="assignRecord('guardian', item.id)">分配</UButton></div></div></section><section><h3 class="font-semibold">家校沟通</h3><div class="mt-3 divide-y divide-slate-100"><div v-for="item in schoolInfo?.communications" :key="item.id" class="grid gap-3 py-4 text-sm lg:grid-cols-[1fr_.7fr_.9fr_auto]"><div><strong>{{ item.studentName || '未关联学生' }} / {{ item.guardianName || '未关联家长' }}</strong><p class="mt-1 line-clamp-2 text-xs text-slate-400">{{ item.summary }}</p></div><span class="text-slate-500">当前负责：{{ item.ownerName }}</span><USelect v-model="assignment[`communication:${item.id}`]" :items="schoolInfo?.teachers?.map((teacher:any)=>({label:teacher.name,value:teacher.id})) || []" placeholder="选择教师" class="w-full" /><UButton size="sm" :loading="pending" :disabled="!assignment[`communication:${item.id}`]" @click="assignRecord('communication', item.id)">分配</UButton></div></div></section><section><h3 class="font-semibold">方案记录</h3><div class="mt-3 divide-y divide-slate-100"><div v-for="item in schoolInfo?.plans" :key="item.id" class="grid gap-3 py-4 text-sm lg:grid-cols-[1fr_.7fr_.9fr_auto]"><div><strong>{{ item.title }}</strong><p class="mt-1 line-clamp-2 text-xs text-slate-400">{{ item.riskLabel }} · {{ item.summary }}</p></div><span class="text-slate-500">当前负责：{{ item.ownerName }}</span><USelect v-model="assignment[`plan:${item.id}`]" :items="schoolInfo?.teachers?.map((teacher:any)=>({label:teacher.name,value:teacher.id})) || []" placeholder="选择教师" class="w-full" /><UButton size="sm" :loading="pending" :disabled="!assignment[`plan:${item.id}`]" @click="assignRecord('plan', item.id)">分配</UButton></div><p v-if="!schoolInfo?.plans?.length" class="py-6 text-center text-sm text-slate-400">暂无方案记录</p></div></section><section><h3 class="font-semibold">最近移交历史</h3><div class="mt-3 divide-y divide-slate-100"><div v-for="item in schoolInfo?.assignments" :key="item.id" class="grid gap-2 py-3 text-xs text-slate-500 md:grid-cols-[.6fr_1fr_1fr]"><span>{{ item.targetType }} · {{ item.fromUserName }} → {{ item.toUserName }}</span><span>{{ item.reason || '未填写原因' }}</span><span class="md:text-right">{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</span></div><p v-if="!schoolInfo?.assignments?.length" class="py-6 text-center text-sm text-slate-400">暂无移交历史</p></div></section></div></div></template>
        <template v-if="active === 'crises'"><div class="panel p-6"><h2 class="text-xl font-semibold">危机转介调度</h2><p class="mt-2 text-sm text-slate-500">只显示事件编号、SLA 和工单状态，不展示业务正文。未确认工单可转派。</p><div class="mt-5 divide-y divide-slate-100"><div v-for="item in referrals" :key="item.id" class="grid gap-3 py-4 text-sm lg:grid-cols-[1fr_.6fr_.8fr_auto]"><div><strong>事件 {{ item.safetyEventId.slice(0,8) }}</strong><p class="mt-1 font-mono text-xs text-slate-400">{{ item.id }}</p></div><div><UBadge :color="item.status==='created'||item.status==='escalated'?'error':'neutral'" variant="soft">{{ item.priority }} · {{ item.status }}</UBadge><p class="mt-1 text-xs text-slate-400">确认截止 {{ item.acknowledgeDueAt ? new Date(item.acknowledgeDueAt).toLocaleTimeString('zh-CN') : '—' }}</p></div><USelect v-model="referralAssignee[item.id]" :items="settings?.psychologists?.map((p:any)=>({label:p.name,value:p.id})) || []" :disabled="Boolean(item.acknowledgedAt)||item.status==='closed'" placeholder="转派心理专员" class="w-full" /><UButton size="sm" :disabled="!referralAssignee[item.id] || Boolean(item.acknowledgedAt) || item.status==='closed'" @click="reassignReferral(item)">转派</UButton></div><p v-if="!referrals?.length" class="py-14 text-center text-sm text-slate-400">暂无危机转介</p></div></div></template>
        <template v-if="active === 'approvals'"><div class="panel p-6"><h2 class="text-xl font-semibold">平台应急访问审批</h2><div class="mt-5 space-y-3"><div v-for="item in data?.pendingRequests" :key="item.id" class="rounded-2xl border border-amber-100 bg-amber-50/50 p-5"><div class="flex flex-wrap justify-between gap-3"><div><strong>{{ item.targetType }}</strong><p class="mt-1 text-xs text-slate-500">{{ item.reasonCategory }} · {{ item.reasonText }}</p></div><div class="flex gap-2"><UButton size="sm" @click="review(item.id,'approved')">批准 30 分钟</UButton><UButton size="sm" color="neutral" variant="soft" @click="review(item.id,'rejected')">拒绝</UButton></div></div></div><p v-if="!data?.pendingRequests?.length" class="py-16 text-center text-sm text-slate-400">暂无待审批申请</p></div></div></template>
        <template v-if="active === 'audit'"><div class="panel p-6"><h2 class="text-xl font-semibold">敏感访问审计</h2><div class="mt-5 divide-y divide-slate-100"><div v-for="item in data?.accessEvents" :key="item.id" class="grid gap-2 py-4 text-sm md:grid-cols-[1fr_1fr_1fr]"><span>{{ item.action }} · {{ item.targetType }}</span><span class="font-mono text-xs text-slate-400">{{ item.targetId }}</span><span class="text-right text-xs text-slate-400">{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</span></div></div></div></template>
        <template v-if="active === 'settings'"><div class="space-y-5"><div class="panel max-w-3xl p-6"><h2 class="text-xl font-semibold">危机转介配置</h2><div v-if="settings" class="mt-6 grid gap-4 sm:grid-cols-2"><UFormField label="默认危机接收心理专员"><USelect v-model="settings.referralPsychologistId" :items="settings.psychologists?.map((p:any)=>({label:p.name,value:p.id})) || []" class="w-full" /></UFormField><UFormField label="校内求助电话"><UInput v-model="settings.helpPhone" class="w-full" /></UFormField><UFormField label="危机首报短信号码（逗号分隔）"><UInput :model-value="settings.smsRecipients?.join(',')" class="w-full" @update:model-value="settings.smsRecipients = String($event).split(',').map(v=>v.trim()).filter(Boolean)" /></UFormField><UFormField label="超时升级安全联系人（逗号分隔）"><UInput :model-value="settings.safetyContactRecipients?.join(',')" class="w-full" @update:model-value="settings.safetyContactRecipients = String($event).split(',').map(v=>v.trim()).filter(Boolean)" /></UFormField><UFormField label="确认 SLA（分钟）"><UInput v-model.number="settings.referralAckMinutes" type="number" min="1" max="30" class="w-full" /></UFormField><UFormField label="升级 SLA（分钟）"><UInput v-model.number="settings.referralEscalationMinutes" type="number" min="5" max="60" class="w-full" /></UFormField><UFormField class="sm:col-span-2" label="危机指引"><UTextarea v-model="settings.crisisGuide" :rows="4" class="w-full" /></UFormField></div></div><div v-if="settings" class="panel max-w-3xl p-6"><h2 class="text-xl font-semibold">AI 数据治理</h2><UAlert class="mt-4" :color="settings.aiProviderAgreementReady?'success':'warning'" variant="soft" :title="settings.aiProviderAgreementReady?`供应商协议已登记：${settings.aiProviderAgreementVersion}`:'供应商协议未登记'" description="协议未登记时完整上下文无法启用，并自动回退到严格脱敏模式。" /><div class="mt-5 space-y-4"><UFormField label="学校 AI 数据模式"><USelect v-model="settings.aiDataMode" :items="[{label:'仅本地 local',value:'local'},{label:'严格脱敏 redacted',value:'redacted'},{label:'授权完整上下文 full_context',value:'full_context'}]" class="w-full" /></UFormField><template v-if="settings.aiDataMode==='full_context'"><UFormField label="学校审批依据" help="至少 10 个字符，写入审计记录"><UTextarea v-model="settings.aiApprovalReference" :rows="3" class="w-full" /></UFormField><UFormField label="教师隐私告知版本"><UInput v-model="settings.aiNoticeVersion" class="w-full" /></UFormField><label class="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm"><UCheckbox v-model="settings.approveFullContext" /><span>我确认学校已完成授权审批。教师未确认对应告知版本前仍使用严格脱敏；电话、邮箱、账号、系统 UUID、密钥和 TOTP 永不发送。</span></label></template><UButton :loading="pending" @click="updateSettings">保存全部配置</UButton></div></div></div></template>
      </section>
    </div>

    <UModal v-model:open="showUserForm" title="邀请校内账号"><template #body><div class="space-y-4"><UFormField label="姓名"><UInput v-model="userForm.name" class="w-full" /></UFormField><UFormField label="邮箱"><UInput v-model="userForm.email" type="email" class="w-full" /></UFormField><UFormField label="角色"><USelect v-model="userForm.role" :items="[{label:'班主任',value:'teacher'},{label:'心理专员',value:'psychologist'}]" class="w-full" /></UFormField><UAlert color="primary" variant="soft" description="平台将生成 72 小时一次性激活链接。用户自行设置密码；心理专员自行绑定 MFA，管理员不会看到 TOTP 密钥。" /><UButton block :loading="pending" @click="createUser">创建邀请</UButton></div></template></UModal>
    <UModal :open="Boolean(activationResult)" title="一次性激活链接" @update:open="value => { if (!value) activationResult = null }"><template #body><div class="space-y-4"><UAlert color="warning" variant="soft" description="链接只展示本次，请通过校方认可渠道发送给本人。不要发送 TOTP 密钥或恢复码。" /><UTextarea :model-value="activationLink" readonly :rows="4" class="w-full" /><UButton block icon="i-lucide-copy" @click="copyActivationLink">复制激活链接</UButton></div></template></UModal>

    <UModal :open="Boolean(accessTarget)" :title="`查看 ${accessTarget?.label || ''} 的敏感档案`" description="授权只在当前目标上生效 15 分钟。" @update:open="value => { if (!value) { accessTarget = null; sensitive = null } }"><template #body><div class="space-y-4"><template v-if="!sensitive"><UFormField label="访问事由"><USelect v-model="accessForm.reasonCategory" :items="[{label:'风险复核',value:'risk_review'},{label:'投诉处理',value:'complaint_handling'},{label:'学校职责',value:'school_duty'},{label:'其他',value:'other'}]" class="w-full" /></UFormField><UFormField label="详细说明" help="至少 10 个字符，将写入不可变审计记录"><UTextarea v-model="accessForm.reasonText" :rows="4" class="w-full" /></UFormField><UButton block :disabled="accessForm.reasonText.length < 10" :loading="pending" @click="openSensitive">创建只读授权并查看</UButton></template><template v-else><div class="sensitive-content max-h-[65vh] overflow-auto rounded-2xl bg-slate-950 p-5 text-xs leading-6 text-slate-100"><pre class="whitespace-pre-wrap">{{ JSON.stringify(sensitive, null, 2) }}</pre></div><div class="sensitive-watermark"><span v-for="i in 20" :key="i">{{ watermark }}</span></div></template></div></template></UModal>
  </div>
</template>

<script setup lang="ts">
const { data, refresh } = await useFetch<any>('/api/v1/platform-admin/dashboard')
const { data: resourceData, refresh: refreshResources } = await useFetch<any>('/api/v1/platform-admin/module-resources')
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
const knowledgeForm = reactive({ name: '', description: '', scope: 'global', schoolId: '' })
const knowledgeDocumentForm = reactive({ knowledgeBaseId: '', title: '', confirmNoPersonalData: false })
const knowledgeFile = ref<File | null>(null)
const knowledgeMessage = ref('')
const knowledgeMessageColor = ref<'info' | 'success' | 'error' | 'warning'>('info')
const knowledgeSearch = ref('')
const knowledgeStatusFilter = ref('all')
const knowledgeScopeFilter = ref('all')
const selectedKnowledgeBaseId = ref('')
const knowledgeDetail = ref<any>(null)
const knowledgeDetailPending = ref(false)
const createKnowledgeOpen = ref(false)
const importKnowledgeOpen = ref(false)
const previewDocument = ref<any>(null)
const documentToDelete = ref<any>(null)
const confirmKnowledgeAction = ref<{ id: string, action: 'publish' | 'archive' | 'restore', name: string } | null>(null)
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
const resourceForm = reactive<any>({ module: 'home_school', libraryType: 'professional_knowledge', name: '', description: '', scope: 'global', schoolId: '' })
const resourceVersionForm = reactive<any>({ libraryId: '', version: '1.0.0', payloadText: '{}', notes: '' })
const resourceDocumentForm = reactive<any>({ versionId: '', title: '', confirmNoPersonalData: false })
const resourceFile = ref<File | null>(null)
const moduleOptions = [
  { label: '自我成长', value: 'self_growth' },
  { label: '班级系统', value: 'class_system' },
  { label: '家校沟通', value: 'home_school' },
  { label: '学生个案', value: 'student_case' },
  { label: '学习问题', value: 'learning_problem' }
]
const libraryTypeOptions = [
  { label: '评估库', value: 'assessment' },
  { label: '规则库', value: 'rules' },
  { label: '工具库', value: 'tool' },
  { label: '专业知识库', value: 'professional_knowledge' },
  { label: 'SOP', value: 'sop' },
  { label: '话术库', value: 'script' },
  { label: '案例库', value: 'case' },
  { label: '提示词库', value: 'prompt' }
]

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
  if (sameCode.length === 0) { showKnowledgeMessage('当前内容暂无其他版本可对比。', 'warning'); return }
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

const importStage = ref<'idle' | 'reading' | 'uploading' | 'done'>('idle')
const accessForm = reactive({ schoolId: '', targetType: 'teacher_profile', targetId: '', reasonCategory: 'data_correction_verification', reasonText: '' })
const sensitive = ref<any>(null)
const watermark = ref('')
const activeGrant = ref<any>(null)
const nav = [{id:'overview',label:'平台总览',icon:'i-lucide-layout-dashboard'},{id:'schools',label:'学校管理',icon:'i-lucide-building-2'},{id:'content',label:'内容版本',icon:'i-lucide-package-open'},{id:'resources',label:'模块资源中心',icon:'i-lucide-library'},{id:'knowledge',label:'AI 知识库',icon:'i-lucide-library-big'},{id:'access',label:'应急访问',icon:'i-lucide-key-round'},{id:'audit',label:'操作审计',icon:'i-lucide-scroll-text'}]

const knowledgeStats = computed(() => {
  const bases = data.value?.knowledgeBases || []
  const documents = data.value?.knowledgeDocuments || []
  return {
    total: bases.length,
    published: bases.filter((item:any) => item.status === 'published').length,
    drafts: bases.filter((item:any) => item.status === 'draft').length,
    documents: documents.length,
    chunks: documents.reduce((sum:number, item:any) => sum + Number(item.metadata?.chunkCount || 0), 0)
  }
})
const filteredKnowledgeBases = computed(() => {
  const keyword = knowledgeSearch.value.trim().toLowerCase()
  return (data.value?.knowledgeBases || []).filter((item:any) => {
    const matchesKeyword = !keyword || `${item.name} ${item.description || ''}`.toLowerCase().includes(keyword)
    const matchesStatus = knowledgeStatusFilter.value === 'all' || item.status === knowledgeStatusFilter.value
    const matchesScope = knowledgeScopeFilter.value === 'all' || item.scope === knowledgeScopeFilter.value
    return matchesKeyword && matchesStatus && matchesScope
  })
})
const selectedKnowledgeBase = computed(() => data.value?.knowledgeBases?.find((item:any) => item.id === selectedKnowledgeBaseId.value))
const knowledgeStatusMeta: Record<string, { label: string, color: 'success' | 'warning' | 'neutral' }> = {
  published: { label: '已发布', color: 'success' }, draft: { label: '草稿', color: 'warning' }, archived: { label: '已停用', color: 'neutral' }
}
function formatFileSize(size: number) { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB` }
function formatKnowledgeDate(value: string) { return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }
function knowledgeDocumentCount(id: string) { return data.value?.knowledgeDocuments?.filter((item:any) => item.knowledgeBaseId === id).length || 0 }
function knowledgeChunkCount(id: string) { return data.value?.knowledgeDocuments?.filter((item:any) => item.knowledgeBaseId === id).reduce((sum:number, item:any) => sum + Number(item.metadata?.chunkCount || 0), 0) || 0 }
async function selectKnowledgeBase(id: string) {
  selectedKnowledgeBaseId.value = id
  knowledgeDetailPending.value = true
  try { knowledgeDetail.value = await $fetch(`/api/v1/platform-admin/knowledge-bases/${id}`) }
  catch (error:any) { showKnowledgeMessage(error?.data?.message || '知识库详情加载失败', 'error') }
  finally { knowledgeDetailPending.value = false }
}
function setActive(section: string) {
  active.value = section
  if (section === 'knowledge' && !selectedKnowledgeBaseId.value && data.value?.knowledgeBases?.[0]) void selectKnowledgeBase(data.value.knowledgeBases[0].id)
}
function showKnowledgeMessage(message: string, color: typeof knowledgeMessageColor.value = 'info') {
  knowledgeMessage.value = message
  knowledgeMessageColor.value = color
}
function openKnowledgeImport(item: any) {
  knowledgeDocumentForm.knowledgeBaseId = item.id
  importKnowledgeOpen.value = true
  importStage.value = 'idle'
}
function openDocumentPreview(document: any) { previewDocument.value = document }

const selectedResourceLibrary = computed(() => (resourceData.value?.libraries || []).find((item:any) => item.id === resourceVersionForm.libraryId) || null)
const resourceVersions = computed(() => (resourceData.value?.versions || []).filter((item:any) => !resourceVersionForm.libraryId || item.libraryId === resourceVersionForm.libraryId))
const resourceDocuments = computed(() => (resourceData.value?.documents || []).filter((item:any) => !resourceVersionForm.libraryId || item.libraryId === resourceVersionForm.libraryId))
const publishedResourceCount = computed(() => (resourceData.value?.versions || []).filter((item:any) => item.status === 'published').length)

async function createResourceLibrary() {
  pending.value = true
  try {
    const created = await $fetch<any>('/api/v1/platform-admin/module-resources', { method: 'POST', body: { ...resourceForm, schoolId: resourceForm.scope === 'school' ? resourceForm.schoolId : undefined } })
    resourceVersionForm.libraryId = created.id
    resourceForm.name = ''
    resourceForm.description = ''
    await refreshResources()
    showKnowledgeMessage('模块资源库已创建', 'success')
  } catch (error:any) { showKnowledgeMessage(error?.data?.message || '模块资源库创建失败', 'error') }
  finally { pending.value = false }
}

async function createResourceVersion() {
  pending.value = true
  try {
    await $fetch('/api/v1/platform-admin/module-resources/versions', {
      method: 'POST',
      body: { libraryId: resourceVersionForm.libraryId, version: resourceVersionForm.version, payload: JSON.parse(resourceVersionForm.payloadText || '{}'), notes: resourceVersionForm.notes || undefined }
    })
    resourceVersionForm.payloadText = '{}'
    await refreshResources()
    showKnowledgeMessage('资源版本已创建', 'success')
  } catch (error:any) { showKnowledgeMessage(error?.data?.message || error?.message || '资源版本创建失败', 'error') }
  finally { pending.value = false }
}

async function resourceVersionAction(id: string, action: 'publish' | 'retire' | 'rollback') {
  pending.value = true
  try {
    await $fetch(`/api/v1/platform-admin/module-resources/versions/${id}`, { method: 'PATCH', body: { action } })
    await refreshResources()
    showKnowledgeMessage(action === 'retire' ? '资源版本已停用' : '资源版本已发布', 'success')
  } catch (error:any) { showKnowledgeMessage(error?.data?.message || '资源版本操作失败', 'error') }
  finally { pending.value = false }
}

function selectResourceFile(event: Event) {
  resourceFile.value = (event.target as HTMLInputElement).files?.[0] || null
}

async function importResourceDocument() {
  if (!resourceFile.value) return
  pending.value = true
  try {
    const content = await resourceFile.value.text()
    await $fetch('/api/v1/platform-admin/module-resources/documents', {
      method: 'POST',
      body: {
        versionId: resourceDocumentForm.versionId,
        title: resourceDocumentForm.title,
        sourceType: resourceFile.value.name.endsWith('.json') ? 'json' : resourceFile.value.name.endsWith('.md') || resourceFile.value.name.endsWith('.markdown') ? 'markdown' : 'text',
        originalFilename: resourceFile.value.name,
        mimeType: resourceFile.value.type,
        content,
        confirmNoPersonalData: resourceDocumentForm.confirmNoPersonalData
      }
    })
    resourceDocumentForm.title = ''
    resourceDocumentForm.confirmNoPersonalData = false
    resourceFile.value = null
    await refreshResources()
    showKnowledgeMessage('资源文档已导入', 'success')
  } catch (error:any) { showKnowledgeMessage(error?.data?.message || '资源文档导入失败', 'error') }
  finally { pending.value = false }
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
    showKnowledgeMessage(`代管申请已提交：${request.id}`, 'success')
  } catch (error:any) { showKnowledgeMessage(error?.data?.message || '代管申请失败', 'error') }
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
async function createKnowledgeBase() {
  pending.value = true
  knowledgeMessage.value = ''
  try {
    const created = await $fetch<any>('/api/v1/platform-admin/knowledge-bases', {
      method: 'POST',
      body: {
        name: knowledgeForm.name,
        description: knowledgeForm.description || undefined,
        scope: knowledgeForm.scope,
        schoolId: knowledgeForm.scope === 'school' ? knowledgeForm.schoolId : undefined
      }
    })
    knowledgeDocumentForm.knowledgeBaseId = created.id
    Object.assign(knowledgeForm, { name: '', description: '', scope: 'global', schoolId: '' })
    showKnowledgeMessage('知识库已创建，可以继续导入文档。', 'success')
    await refresh()
    createKnowledgeOpen.value = false
    await selectKnowledgeBase(created.id)
    openKnowledgeImport(created)
  } catch (error: any) {
    showKnowledgeMessage(error?.data?.message || error?.message || '创建失败', 'error')
  } finally { pending.value = false }
}
function selectKnowledgeFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] || null
  if (file && file.size > 1_000_000) {
    knowledgeFile.value = null
    showKnowledgeMessage('单个文件不能超过 1 MB。', 'error')
    ;(event.target as HTMLInputElement).value = ''
    return
  }
  knowledgeFile.value = file
  if (file && !knowledgeDocumentForm.title) knowledgeDocumentForm.title = file.name.replace(/\.(md|markdown|txt|json)$/i, '')
}
async function importKnowledgeDocument() {
  if (!knowledgeFile.value) return
  pending.value = true
  knowledgeMessage.value = ''
  importStage.value = 'reading'
  try {
    const extension = knowledgeFile.value.name.split('.').pop()?.toLowerCase()
    const sourceType = extension === 'json' ? 'json' : extension === 'txt' ? 'text' : 'markdown'
    const content = await knowledgeFile.value.text()
    importStage.value = 'uploading'
    await $fetch(`/api/v1/platform-admin/knowledge-bases/${knowledgeDocumentForm.knowledgeBaseId}/documents`, {
      method: 'POST',
      body: {
        title: knowledgeDocumentForm.title,
        sourceType,
        originalFilename: knowledgeFile.value.name,
        mimeType: knowledgeFile.value.type || 'text/plain',
        content,
        confirmNoPersonalData: knowledgeDocumentForm.confirmNoPersonalData
      }
    })
    knowledgeFile.value = null
    knowledgeDocumentForm.title = ''
    knowledgeDocumentForm.confirmNoPersonalData = false
    importStage.value = 'done'
    showKnowledgeMessage('文档已完成解析和分块。发布知识库后，教师助手才会检索到新内容。', 'success')
    await refresh()
    await selectKnowledgeBase(knowledgeDocumentForm.knowledgeBaseId)
    importKnowledgeOpen.value = false
  } catch (error: any) {
    importStage.value = 'idle'
    showKnowledgeMessage(error?.data?.message || error?.message || '导入失败', 'error')
  } finally { pending.value = false }
}
async function knowledgeAction(id: string, action: 'publish' | 'archive' | 'restore') {
  pending.value = true
  try {
    await $fetch(`/api/v1/platform-admin/knowledge-bases/${id}`, { method: 'PATCH', body: { action } })
    await refresh()
    await selectKnowledgeBase(id)
    showKnowledgeMessage(action === 'publish' ? '知识库已发布，教师助手现在可以检索其中内容。' : action === 'archive' ? '知识库已停用，教师助手将不再检索其中内容。' : '知识库已恢复为草稿。', 'success')
  } catch (error:any) { showKnowledgeMessage(error?.data?.message || '操作失败', 'error') }
  finally { pending.value = false; confirmKnowledgeAction.value = null }
}
async function deleteKnowledgeDocument(document: any) {
  pending.value = true
  try {
    await $fetch(`/api/v1/platform-admin/knowledge-bases/${selectedKnowledgeBaseId.value}/documents/${document.id}`, { method: 'DELETE' })
    await refresh()
    await selectKnowledgeBase(selectedKnowledgeBaseId.value)
    previewDocument.value = null
    documentToDelete.value = null
    showKnowledgeMessage('文档已删除。', 'success')
  } catch (error:any) { showKnowledgeMessage(error?.data?.message || '删除失败', 'error') }
  finally { pending.value = false }
}
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
    <div class="flex flex-wrap items-end justify-between gap-4"><div><p class="text-sm font-semibold text-indigo-700">平台治理空间</p><h1 class="mt-2 text-3xl font-semibold">平台管理后台</h1><p class="mt-2 text-sm text-slate-500">租户、内容版本、服务状态与受控应急访问。</p></div><UBadge color="warning" variant="soft">默认不接触学校业务数据</UBadge></div>
    <div class="mt-8 grid gap-6 lg:grid-cols-[15rem_1fr]">
      <aside class="panel h-fit p-3"><button v-for="item in nav" :key="item.id" class="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm" :class="active===item.id?'bg-indigo-800 text-white':'text-slate-600 hover:bg-slate-100'" @click="setActive(item.id)"><UIcon :name="item.icon" />{{ item.label }}</button></aside>
      <section class="min-w-0">
        <template v-if="active==='overview'"><div class="grid gap-4 sm:grid-cols-3"><div class="panel p-6"><p class="text-sm text-slate-500">学校租户</p><strong class="mt-2 block text-3xl">{{ data?.schools?.length||0 }}</strong></div><div class="panel p-6"><p class="text-sm text-slate-500">已发布内容</p><strong class="mt-2 block text-3xl">{{ data?.contentPackages?.filter((x:any)=>x.status==='published').length||0 }}</strong></div><div class="panel p-6"><p class="text-sm text-slate-500">应急访问申请</p><strong class="mt-2 block text-3xl">{{ data?.accessRequests?.length||0 }}</strong></div></div><div class="panel mt-5 p-6"><h2 class="font-semibold">服务状态</h2><div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div class="rounded-2xl bg-emerald-50 p-4 text-sm">数据库 · {{ data?.health.database }}</div><div class="rounded-2xl p-4 text-sm" :class="data?.health.modelConfigured?'bg-emerald-50':'bg-amber-50'">DeepSeek · {{ data?.health.modelConfigured?'已配置':'降级模式' }}</div><div class="rounded-2xl p-4 text-sm" :class="data?.health.embeddingEnabled?'bg-emerald-50':'bg-amber-50'">向量检索 · {{ data?.health.embeddingEnabled ? data?.health.embeddingModel : '关键词模式' }}</div><div class="rounded-2xl bg-slate-50 p-4 text-sm">短信 · {{ data?.health.smsProvider }}</div></div></div></template>
        <template v-if="active==='schools'"><div class="grid gap-5 xl:grid-cols-[.9fr_1.1fr]"><div class="space-y-5"><div class="panel p-6"><h2 class="text-xl font-semibold">学校列表</h2><p class="mt-2 text-sm text-slate-500">平台只管理租户、学校管理员和授权代管入口。</p><div class="mt-5 divide-y divide-slate-100"><button v-for="item in data?.schools" :key="item.id" type="button" class="flex w-full justify-between gap-3 py-4 text-left" @click="selectSchool(item)"><div><strong>{{ item.name }}</strong><p class="mt-1 text-xs text-slate-400">{{ item.code }} · {{ item.id }}</p></div><div class="flex items-center gap-2"><UBadge :color="item.status==='active'?'success':'neutral'" variant="soft">{{ item.status }}</UBadge><UButton size="xs" color="neutral" variant="ghost" @click.stop="toggleSchool(item)">{{ item.status==='active'?'停用':'启用' }}</UButton></div></button></div></div><form class="panel h-fit space-y-4 p-6" @submit.prevent="createSchool"><h2 class="text-xl font-semibold">创建学校及首位管理员</h2><UFormField label="学校名称"><UInput v-model="schoolForm.name" class="w-full" /></UFormField><UFormField label="学校代码"><UInput v-model="schoolForm.code" class="w-full" placeholder="school-code" /></UFormField><UFormField label="管理员姓名"><UInput v-model="schoolForm.adminName" class="w-full" /></UFormField><UFormField label="管理员邮箱"><UInput v-model="schoolForm.adminEmail" class="w-full" /></UFormField><UFormField label="临时密码"><UInput v-model="schoolForm.temporaryPassword" class="w-full" /></UFormField><UButton type="submit" block :loading="pending">创建租户</UButton></form></div><div v-if="selectedSchoolDetail" class="space-y-5"><div class="panel p-6"><div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-xl font-semibold">{{ selectedSchoolDetail.school.name }}</h2><p class="mt-1 text-xs text-slate-400">{{ selectedSchoolDetail.school.id }}</p></div><UBadge :color="selectedSchoolDetail.school.status==='active'?'success':'neutral'" variant="soft">{{ selectedSchoolDetail.school.status }}</UBadge></div><div class="mt-5 grid gap-3 sm:grid-cols-4"><div class="rounded-2xl bg-slate-50 p-4 text-sm">账号 <strong class="block text-2xl">{{ selectedSchoolDetail.stats.users }}</strong></div><div class="rounded-2xl bg-slate-50 p-4 text-sm">教师 <strong class="block text-2xl">{{ selectedSchoolDetail.stats.teachers }}</strong></div><div class="rounded-2xl bg-slate-50 p-4 text-sm">班级 <strong class="block text-2xl">{{ selectedSchoolDetail.stats.classes }}</strong></div><div class="rounded-2xl bg-slate-50 p-4 text-sm">学生 <strong class="block text-2xl">{{ selectedSchoolDetail.stats.students }}</strong></div></div><form class="mt-5 grid gap-3 sm:grid-cols-3" @submit.prevent="updateSelectedSchool"><UFormField label="学校名称"><UInput v-model="schoolEditForm.name" /></UFormField><UFormField label="代码"><UInput v-model="schoolEditForm.code" /></UFormField><UFormField label="状态"><USelect v-model="schoolEditForm.status" :items="[{label:'启用',value:'active'},{label:'停用',value:'disabled'}]" /></UFormField><UButton type="submit" class="sm:col-span-3" :loading="pending">保存学校信息</UButton></form></div><div class="panel p-6"><h3 class="font-semibold">学校管理员</h3><div class="mt-3 divide-y divide-slate-100"><div v-for="admin in selectedSchoolDetail.admins" :key="admin.id" class="grid gap-2 py-3 text-sm md:grid-cols-[1fr_.5fr_.6fr]"><span>{{ admin.name }} · {{ admin.email }}</span><UBadge class="w-fit" :color="admin.status==='active'?'success':admin.status==='invited'?'warning':'neutral'" variant="soft">{{ admin.status }}</UBadge><span class="text-xs text-slate-400 md:text-right">{{ admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString('zh-CN') : '未登录' }}</span></div></div><form class="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" @submit.prevent="inviteSchoolAdmin"><UInput v-model="schoolAdminForm.name" placeholder="管理员姓名" /><UInput v-model="schoolAdminForm.email" placeholder="管理员邮箱" /><UButton type="submit" :disabled="!schoolAdminForm.name || !schoolAdminForm.email" :loading="pending">邀请管理员</UButton></form><UAlert v-if="schoolActivationLink" class="mt-4" color="warning" variant="soft" title="一次性激活链接" :description="schoolActivationLink" /></div><div class="panel p-6"><h3 class="font-semibold">平台代管申请</h3><p class="mt-2 text-sm text-slate-500">代管只覆盖基础资料，不包含评估、聊天、危机、方案正文。</p><UFormField class="mt-4" label="申请原因"><UTextarea v-model="delegationForm.reason" :rows="3" class="w-full" /></UFormField><UButton class="mt-3" :disabled="delegationForm.reason.length<10" :loading="pending" @click="requestDelegation">提交代管申请</UButton><div class="mt-5 divide-y divide-slate-100"><div v-for="grant in selectedSchoolDetail.delegatedManagement" :key="grant.id" class="grid gap-2 py-3 text-sm md:grid-cols-[1fr_.5fr_auto]"><span>{{ grant.reason }}</span><UBadge class="w-fit" :color="grant.status==='approved'?'success':grant.status==='pending'?'warning':'neutral'" variant="soft">{{ grant.status }}</UBadge><UButton v-if="grant.status==='approved' && new Date(grant.expiresAt)>new Date()" size="xs" @click="openDelegatedSession(grant)">进入代管</UButton></div></div></div><div v-if="delegatedSession" class="panel p-6"><h3 class="font-semibold">代管会话 · {{ delegatedSession.school?.name }}</h3><p class="mt-2 text-sm text-slate-500">请在调用基础管理接口时携带授权号：{{ delegatedSession.grant.id }}</p><div class="mt-4 grid gap-3 sm:grid-cols-3"><div class="rounded-2xl bg-slate-50 p-4 text-sm">教师 {{ delegatedSession.teachers?.length || 0 }}</div><div class="rounded-2xl bg-slate-50 p-4 text-sm">班级 {{ delegatedSession.classes?.length || 0 }}</div><div class="rounded-2xl bg-slate-50 p-4 text-sm">学生 {{ delegatedSession.students?.length || 0 }}</div></div></div></div><div v-else class="panel p-10 text-center text-sm text-slate-400">选择左侧学校后查看详情、管理员和代管申请。</div></div></template>
        <template v-if="active==='content'"><div class="grid gap-5 xl:grid-cols-[1.2fr_.8fr]"><div class="panel p-6"><h2 class="text-xl font-semibold">内容版本</h2><div class="mt-5 space-y-3"><div v-for="item in data?.contentPackages" :key="item.id" class="rounded-2xl border border-slate-100 p-4 hover:border-indigo-200 cursor-pointer transition-colors" @click="openEditor(item)"><div class="flex items-start justify-between gap-3"><div><strong>{{ item.name }}</strong><p class="mt-1 text-xs text-slate-400">{{ item.code }}@{{ item.version }} · {{ item.type }}</p></div><UBadge :color="item.status==='published'?'success':'neutral'" variant="soft">{{ item.status }}</UBadge></div><div class="mt-3 flex gap-2" @click.stop><UButton v-if="item.status==='draft'" size="xs" @click="contentAction(item.id,'publish')">发布</UButton><UButton v-if="item.status==='retired'" size="xs" variant="soft" @click="contentAction(item.id,'rollback')">回滚到此版</UButton><UButton v-if="item.status==='published'" size="xs" color="neutral" variant="soft" @click="contentAction(item.id,'retire')">停用</UButton><UButton size="xs" color="neutral" variant="ghost" @click.stop="openDiff(item)">对比</UButton></div></div></div></div><form class="panel h-fit space-y-4 p-6" @submit.prevent="createContent"><h2 class="text-xl font-semibold">新增内容包</h2><UFormField label="代码"><UInput v-model="contentForm.code" class="w-full" /></UFormField><UFormField label="名称"><UInput v-model="contentForm.name" class="w-full" /></UFormField><div class="grid grid-cols-2 gap-3"><UFormField label="版本"><UInput v-model="contentForm.version" /></UFormField><UFormField label="类型"><USelect v-model="contentForm.type" :items="['assessment','rules','tool','sop','prompt']" /></UFormField></div><UFormField label="JSON 内容"><UTextarea v-model="contentForm.payloadText" :rows="6" class="w-full font-mono text-xs" /></UFormField><UButton type="submit" block :loading="pending">保存草稿</UButton></form></div></template>
        <template v-if="active==='resources'"><div class="space-y-5"><div class="grid gap-4 sm:grid-cols-3"><div class="panel p-5"><p class="text-sm text-slate-500">资源库</p><strong class="mt-2 block text-3xl">{{ resourceData?.libraries?.length || 0 }}</strong></div><div class="panel p-5"><p class="text-sm text-slate-500">已发布版本</p><strong class="mt-2 block text-3xl">{{ publishedResourceCount }}</strong></div><div class="panel p-5"><p class="text-sm text-slate-500">资源文档</p><strong class="mt-2 block text-3xl">{{ resourceData?.documents?.length || 0 }}</strong></div></div><div class="grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><div class="panel p-6"><div class="flex items-center justify-between"><div><h2 class="text-xl font-semibold">模块资源库</h2><p class="mt-2 text-sm text-slate-500">按模块、库类型和平台/校本范围运营资源。教师端优先使用校本发布版本。</p></div><UButton color="neutral" variant="soft" icon="i-lucide-refresh-cw" @click="() => refreshResources()">刷新</UButton></div><div class="mt-5 space-y-3"><button v-for="item in resourceData?.libraries" :key="item.id" type="button" class="w-full rounded-2xl border p-4 text-left transition" :class="resourceVersionForm.libraryId===item.id?'border-indigo-300 bg-indigo-50':'border-slate-100 hover:bg-slate-50'" @click="resourceVersionForm.libraryId=item.id"><div class="flex flex-wrap items-start justify-between gap-2"><div><strong>{{ item.name }}</strong><p class="mt-1 text-xs text-slate-400">{{ item.module }} · {{ item.libraryType }} · {{ item.scope === 'global' ? '平台默认' : '校本覆盖' }}</p></div><UBadge color="neutral" variant="soft">{{ resourceData?.versions?.filter((version:any)=>version.libraryId===item.id).length || 0 }} 版</UBadge></div><p class="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{{ item.description || '暂无说明' }}</p></button><div v-if="!resourceData?.libraries?.length" class="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">暂无模块资源库</div></div></div><div class="space-y-5"><form class="panel space-y-4 p-6" @submit.prevent="createResourceLibrary"><h2 class="text-xl font-semibold">创建资源库</h2><div class="grid gap-3 sm:grid-cols-2"><UFormField label="模块"><USelect v-model="resourceForm.module" :items="moduleOptions" class="w-full" /></UFormField><UFormField label="库类型"><USelect v-model="resourceForm.libraryType" :items="libraryTypeOptions" class="w-full" /></UFormField></div><UFormField label="名称"><UInput v-model="resourceForm.name" class="w-full" /></UFormField><UFormField label="说明"><UTextarea v-model="resourceForm.description" :rows="3" class="w-full" /></UFormField><div class="grid gap-3 sm:grid-cols-2"><UFormField label="范围"><USelect v-model="resourceForm.scope" :items="[{label:'平台默认',value:'global'},{label:'校本覆盖',value:'school'}]" class="w-full" /></UFormField><UFormField v-if="resourceForm.scope==='school'" label="学校"><USelect v-model="resourceForm.schoolId" :items="data?.schools?.map((school:any)=>({label:school.name,value:school.id})) || []" class="w-full" /></UFormField></div><UButton type="submit" block :disabled="resourceForm.name.trim().length<2 || (resourceForm.scope==='school' && !resourceForm.schoolId)" :loading="pending">创建资源库</UButton></form><form class="panel space-y-4 p-6" @submit.prevent="createResourceVersion"><h2 class="text-xl font-semibold">创建版本</h2><UFormField label="资源库"><USelect v-model="resourceVersionForm.libraryId" :items="resourceData?.libraries?.map((item:any)=>({label:`${item.name} · ${item.module}/${item.libraryType}`,value:item.id})) || []" class="w-full" /></UFormField><UFormField label="版本号"><UInput v-model="resourceVersionForm.version" class="w-full" /></UFormField><UFormField label="JSON Payload"><UTextarea v-model="resourceVersionForm.payloadText" :rows="5" class="w-full font-mono text-xs" /></UFormField><UFormField label="版本说明"><UInput v-model="resourceVersionForm.notes" class="w-full" /></UFormField><UButton type="submit" block :disabled="!resourceVersionForm.libraryId || !resourceVersionForm.version" :loading="pending">保存草稿版本</UButton></form></div></div><div v-if="selectedResourceLibrary" class="grid gap-5 xl:grid-cols-[1fr_.9fr]"><div class="panel p-6"><h2 class="text-xl font-semibold">{{ selectedResourceLibrary.name }} · 版本</h2><div class="mt-5 space-y-3"><div v-for="version in resourceVersions" :key="version.id" class="rounded-2xl border border-slate-100 p-4"><div class="flex flex-wrap items-start justify-between gap-3"><div><strong>{{ version.version }}</strong><p class="mt-1 text-xs text-slate-400">{{ version.notes || '暂无说明' }}</p></div><UBadge :color="version.status==='published'?'success':version.status==='draft'?'warning':'neutral'" variant="soft">{{ version.status }}</UBadge></div><div class="mt-3 flex flex-wrap gap-2"><UButton v-if="version.status!=='published'" size="xs" @click="resourceVersionAction(version.id, 'publish')">发布</UButton><UButton v-if="version.status==='published'" size="xs" color="neutral" variant="soft" @click="resourceVersionAction(version.id, 'retire')">停用</UButton><UButton v-if="version.status==='retired'" size="xs" color="neutral" variant="soft" @click="resourceVersionAction(version.id, 'rollback')">回滚发布</UButton></div></div><div v-if="!resourceVersions.length" class="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">该资源库暂无版本</div></div></div><form class="panel h-fit space-y-4 p-6" @submit.prevent="importResourceDocument"><h2 class="text-xl font-semibold">导入资源文档</h2><UAlert color="warning" variant="soft" description="仅专业知识、SOP、工具、话术、案例、提示词支持文档导入；文档不得包含真实个人业务数据。" /><UFormField label="目标版本"><USelect v-model="resourceDocumentForm.versionId" :items="resourceVersions.map((item:any)=>({label:`${item.version} (${item.status})`,value:item.id}))" class="w-full" /></UFormField><UFormField label="文档标题"><UInput v-model="resourceDocumentForm.title" class="w-full" /></UFormField><UFormField label="选择文件"><input type="file" accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json" @change="selectResourceFile" /></UFormField><UCheckbox v-model="resourceDocumentForm.confirmNoPersonalData" label="我确认文档不包含学生、家长或教师个人业务数据" /><UButton type="submit" block :disabled="!resourceFile || !resourceDocumentForm.versionId || resourceDocumentForm.title.trim().length<2 || !resourceDocumentForm.confirmNoPersonalData" :loading="pending">导入并分块</UButton><div v-if="resourceDocuments.length" class="border-t border-slate-100 pt-4"><p class="text-sm font-semibold">已导入文档</p><div class="mt-2 space-y-2"><div v-for="document in resourceDocuments" :key="document.id" class="rounded-xl bg-slate-50 p-3 text-sm"><strong>{{ document.title }}</strong><p class="mt-1 text-xs text-slate-400">{{ document.status }} · {{ document.metadata?.chunkCount || 0 }} 片段</p></div></div></div></form></div></div></template>
        <template v-if="active==='knowledge'">
          <div class="space-y-5">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div><h2 class="text-2xl font-semibold">AI 业务知识库</h2><p class="mt-2 text-sm text-slate-500">管理教师助手可引用的业务规则、SOP 与平台资料。仅已发布内容参与回答。</p></div>
              <div class="flex gap-2"><UButton color="neutral" variant="soft" icon="i-lucide-plus" @click="() => { createKnowledgeOpen=true }">新建知识库</UButton><UButton icon="i-lucide-file-up" :disabled="!data?.knowledgeBases?.some((item:any)=>item.status!=='archived')" @click="() => { importKnowledgeOpen=true }">导入文档</UButton></div>
            </div>
            <UAlert v-if="knowledgeMessage" :color="knowledgeMessageColor" variant="soft" :description="knowledgeMessage" :close="{ onClick: () => { knowledgeMessage='' } }" />
            <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div class="panel p-5"><div class="flex items-center justify-between"><span class="text-sm text-slate-500">知识库总数</span><UIcon name="i-lucide-library-big" class="text-indigo-600" /></div><strong class="mt-2 block text-3xl">{{ knowledgeStats.total }}</strong><span class="mt-1 block text-xs text-slate-400">{{ knowledgeStats.drafts }} 个草稿</span></div>
              <div class="panel p-5"><div class="flex items-center justify-between"><span class="text-sm text-slate-500">在线知识库</span><UIcon name="i-lucide-circle-check-big" class="text-emerald-600" /></div><strong class="mt-2 block text-3xl">{{ knowledgeStats.published }}</strong><span class="mt-1 block text-xs text-slate-400">教师端实时可检索</span></div>
              <div class="panel p-5"><div class="flex items-center justify-between"><span class="text-sm text-slate-500">已导入文档</span><UIcon name="i-lucide-files" class="text-sky-600" /></div><strong class="mt-2 block text-3xl">{{ knowledgeStats.documents }}</strong><span class="mt-1 block text-xs text-slate-400">Markdown / TXT / JSON</span></div>
              <div class="panel p-5"><div class="flex items-center justify-between"><span class="text-sm text-slate-500">知识片段</span><UIcon name="i-lucide-blocks" class="text-violet-600" /></div><strong class="mt-2 block text-3xl">{{ knowledgeStats.chunks }}</strong><span class="mt-1 block text-xs text-slate-400">{{ data?.health.embeddingEnabled ? '关键词 + 向量混合检索' : '关键词检索模式' }}</span></div>
            </div>
            <div class="panel overflow-hidden">
              <div class="grid min-h-[620px] lg:grid-cols-[22rem_1fr]">
                <div class="border-b border-slate-100 p-5 lg:border-r lg:border-b-0">
                  <div class="space-y-3">
                    <UInput v-model="knowledgeSearch" icon="i-lucide-search" placeholder="搜索名称或说明" class="w-full" />
                    <div class="grid grid-cols-2 gap-2"><USelect v-model="knowledgeStatusFilter" :items="[{label:'全部状态',value:'all'},{label:'已发布',value:'published'},{label:'草稿',value:'draft'},{label:'已停用',value:'archived'}]" class="w-full" /><USelect v-model="knowledgeScopeFilter" :items="[{label:'全部范围',value:'all'},{label:'全平台',value:'global'},{label:'指定学校',value:'school'}]" class="w-full" /></div>
                  </div>
                  <div class="mt-4 space-y-2">
                    <button v-for="item in filteredKnowledgeBases" :key="item.id" class="w-full rounded-2xl border p-4 text-left transition" :class="selectedKnowledgeBaseId===item.id?'border-indigo-300 bg-indigo-50/70 shadow-sm':'border-slate-100 hover:border-slate-200 hover:bg-slate-50'" @click="selectKnowledgeBase(item.id)">
                      <div class="flex items-start justify-between gap-3"><strong class="line-clamp-2 text-sm">{{ item.name }}</strong><UBadge :color="knowledgeStatusMeta[item.status]?.color || 'neutral'" variant="soft" size="sm">{{ knowledgeStatusMeta[item.status]?.label || item.status }}</UBadge></div>
                      <p class="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{{ item.description || '暂无说明' }}</p>
                      <div class="mt-3 flex items-center gap-3 text-xs text-slate-400"><span>{{ item.scope==='global'?'全平台':data?.schools?.find((school:any)=>school.id===item.schoolId)?.name || '指定学校' }}</span><span>{{ knowledgeDocumentCount(item.id) }} 文档</span><span>{{ knowledgeChunkCount(item.id) }} 片段</span></div>
                    </button>
                    <div v-if="!filteredKnowledgeBases.length" class="rounded-2xl border border-dashed border-slate-200 px-5 py-12 text-center"><UIcon name="i-lucide-book-open" class="text-3xl text-slate-300" /><p class="mt-3 text-sm text-slate-400">没有符合条件的知识库</p></div>
                  </div>
                </div>
                <div class="min-w-0 p-6">
                  <div v-if="knowledgeDetailPending" class="flex h-full min-h-80 items-center justify-center"><UIcon name="i-lucide-loader-circle" class="animate-spin text-3xl text-indigo-600" /></div>
                  <div v-else-if="selectedKnowledgeBase && knowledgeDetail" class="space-y-6">
                    <div class="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-6">
                      <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><h3 class="text-xl font-semibold">{{ selectedKnowledgeBase.name }}</h3><UBadge :color="knowledgeStatusMeta[selectedKnowledgeBase.status]?.color || 'neutral'" variant="soft">{{ knowledgeStatusMeta[selectedKnowledgeBase.status]?.label }}</UBadge></div><p class="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{{ selectedKnowledgeBase.description || '暂无知识库说明。' }}</p><div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400"><span>范围：{{ selectedKnowledgeBase.scope==='global'?'全平台':'指定学校' }}</span><span>版本：v{{ selectedKnowledgeBase.version }}</span><span>更新：{{ formatKnowledgeDate(selectedKnowledgeBase.updatedAt) }}</span></div></div>
                      <div class="flex flex-wrap gap-2"><UButton size="sm" color="neutral" variant="soft" icon="i-lucide-file-up" :disabled="selectedKnowledgeBase.status==='archived'" @click="openKnowledgeImport(selectedKnowledgeBase)">导入</UButton><UButton v-if="selectedKnowledgeBase.status!=='published' && selectedKnowledgeBase.status!=='archived'" size="sm" icon="i-lucide-rocket" @click="() => { confirmKnowledgeAction={id:selectedKnowledgeBase.id,action:'publish',name:selectedKnowledgeBase.name} }">发布</UButton><UButton v-if="selectedKnowledgeBase.status==='published'" size="sm" color="neutral" variant="soft" icon="i-lucide-power" @click="() => { confirmKnowledgeAction={id:selectedKnowledgeBase.id,action:'archive',name:selectedKnowledgeBase.name} }">停用</UButton><UButton v-if="selectedKnowledgeBase.status==='archived'" size="sm" color="neutral" variant="soft" icon="i-lucide-undo-2" @click="() => { confirmKnowledgeAction={id:selectedKnowledgeBase.id,action:'restore',name:selectedKnowledgeBase.name} }">恢复草稿</UButton></div>
                    </div>
                    <div><div class="flex items-center justify-between"><div><h4 class="font-semibold">知识文档</h4><p class="mt-1 text-xs text-slate-400">点击文档查看分块内容与检索预览</p></div><span class="text-sm text-slate-500">{{ knowledgeDetail.documents?.length || 0 }} 份</span></div>
                      <div class="mt-4 overflow-hidden rounded-2xl border border-slate-100">
                        <button v-for="document in knowledgeDetail.documents" :key="document.id" class="flex w-full items-center justify-between gap-4 border-b border-slate-100 px-4 py-4 text-left last:border-0 hover:bg-slate-50" @click="openDocumentPreview(document)"><div class="flex min-w-0 items-center gap-3"><span class="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><UIcon :name="document.sourceType==='json'?'i-lucide-braces':'i-lucide-file-text'" /></span><div class="min-w-0"><strong class="block truncate text-sm">{{ document.title }}</strong><p class="mt-1 truncate text-xs text-slate-400">{{ document.originalFilename || document.sourceType }} · {{ document.metadata?.characterCount || 0 }} 字符</p></div></div><div class="flex shrink-0 items-center gap-4"><span class="hidden text-xs text-slate-400 sm:inline">{{ document.metadata?.chunkCount || 0 }} 个片段 · {{ document.metadata?.embeddedChunkCount || 0 }} 已向量化</span><UBadge :color="document.status==='ready'?'success':'warning'" variant="soft" size="sm">{{ document.status==='ready'?'已上线':'待发布' }}</UBadge><UIcon name="i-lucide-chevron-right" class="text-slate-300" /></div></button>
                        <div v-if="!knowledgeDetail.documents?.length" class="px-5 py-16 text-center"><UIcon name="i-lucide-file-plus-2" class="text-3xl text-slate-300" /><p class="mt-3 text-sm text-slate-500">还没有文档</p><UButton class="mt-4" size="sm" variant="soft" @click="openKnowledgeImport(selectedKnowledgeBase)">导入第一份文档</UButton></div>
                      </div>
                    </div>
                    <UAlert v-if="selectedKnowledgeBase.status==='published'" color="success" variant="soft" title="当前知识库已在线" description="教师助手可以检索这些知识片段，并在回答中显示文档来源。若要删除文档，请先停用知识库。" />
                  </div>
                  <div v-else class="flex h-full min-h-80 flex-col items-center justify-center text-center"><span class="grid size-16 place-items-center rounded-2xl bg-indigo-50"><UIcon name="i-lucide-library-big" class="text-3xl text-indigo-500" /></span><h3 class="mt-4 font-semibold">选择一个知识库</h3><p class="mt-2 max-w-sm text-sm text-slate-400">查看文档、分块预览和发布状态，或创建新的业务知识库。</p></div>
                </div>
              </div>
            </div>
          </div>
        </template>
        <template v-if="active==='access'"><div class="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><form class="panel h-fit space-y-4 p-6" @submit.prevent="requestAccess"><h2 class="text-xl font-semibold">申请目标级应急访问</h2><UAlert color="warning" variant="soft" description="申请必须由对应学校管理员批准，授权最长 30 分钟。" /><UFormField label="学校"><USelect v-model="accessForm.schoolId" :items="data?.schools?.map((s:any)=>({label:s.name,value:s.id}))" class="w-full" /></UFormField><UFormField label="目标类型"><USelect v-model="accessForm.targetType" :items="['teacher_profile','assessment','conversation','student_case','guardian_communication','plan']" class="w-full" /></UFormField><UFormField label="目标 UUID"><UInput v-model="accessForm.targetId" class="w-full font-mono" /></UFormField><UFormField label="详细原因"><UTextarea v-model="accessForm.reasonText" :rows="4" class="w-full" /></UFormField><UButton type="submit" block :disabled="accessForm.reasonText.length<10" :loading="pending">提交学校审批</UButton></form><div class="panel p-6"><h2 class="text-xl font-semibold">我的申请</h2><div class="mt-5 space-y-3"><div v-for="item in data?.accessRequests" :key="item.id" class="rounded-2xl border p-4"><div class="flex justify-between"><div><strong>{{ item.targetType }}</strong><p class="mt-1 font-mono text-xs text-slate-400">{{ item.targetId }}</p></div><UBadge :color="item.status==='approved'?'success':item.status==='rejected'?'error':'warning'" variant="soft">{{ item.status }}</UBadge></div><UButton v-if="item.status==='approved' && data?.accessGrants?.some((g:any)=>g.requestId===item.id && new Date(g.expiresAt)>new Date())" class="mt-3" size="xs" @click="openApproved(item)">在授权时间内查看</UButton></div></div></div></div></template>
        <template v-if="active==='audit'"><div class="panel p-6"><h2 class="text-xl font-semibold">平台操作审计</h2><div class="mt-5 divide-y divide-slate-100"><div v-for="item in data?.auditLogs" :key="item.id" class="flex justify-between py-4 text-sm"><span>{{ item.action }}</span><span class="text-xs text-slate-400">{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</span></div></div></div></template>
      </section>
    </div>
    <UModal :open="Boolean(sensitive)" title="应急只读数据" description="授权到期后将自动失效。" @update:open="v=>{if(!v)sensitive=null}"><template #body><div class="sensitive-content max-h-[65vh] overflow-auto rounded-2xl bg-slate-950 p-5 text-xs leading-6 text-slate-100"><pre class="whitespace-pre-wrap">{{ JSON.stringify(sensitive,null,2) }}</pre></div><div class="sensitive-watermark"><span v-for="i in 20" :key="i">{{ watermark }}</span></div></template></UModal>
    <UModal :open="createKnowledgeOpen" title="新建知识库" description="先创建草稿，再导入经过审核的业务资料。" @update:open="createKnowledgeOpen=$event"><template #body><form class="space-y-4" @submit.prevent="createKnowledgeBase"><UFormField label="名称" required><UInput v-model="knowledgeForm.name" class="w-full" placeholder="例如：家校沟通业务手册" /></UFormField><UFormField label="用途说明"><UTextarea v-model="knowledgeForm.description" :rows="3" class="w-full" placeholder="说明知识范围、适用场景和维护责任" /></UFormField><UFormField label="可用范围"><USelect v-model="knowledgeForm.scope" :items="[{label:'全平台教师可用',value:'global'},{label:'仅指定学校可用',value:'school'}]" class="w-full" /></UFormField><UFormField v-if="knowledgeForm.scope==='school'" label="指定学校" required><USelect v-model="knowledgeForm.schoolId" :items="data?.schools?.map((school:any)=>({label:school.name,value:school.id}))" class="w-full" /></UFormField><div class="flex justify-end gap-2 pt-2"><UButton color="neutral" variant="ghost" @click="() => { createKnowledgeOpen=false }">取消</UButton><UButton type="submit" :disabled="knowledgeForm.name.trim().length<2 || (knowledgeForm.scope==='school' && !knowledgeForm.schoolId)" :loading="pending">创建并继续导入</UButton></div></form></template></UModal>
    <UModal :open="importKnowledgeOpen" title="导入业务文档" description="系统会解析文档并自动生成可检索的知识片段。" @update:open="importKnowledgeOpen=$event"><template #body><form class="space-y-4" @submit.prevent="importKnowledgeDocument"><UFormField label="目标知识库" required><USelect v-model="knowledgeDocumentForm.knowledgeBaseId" :items="data?.knowledgeBases?.filter((item:any)=>item.status!=='archived').map((item:any)=>({label:item.name,value:item.id}))" class="w-full" /></UFormField><UFormField label="文档标题" required><UInput v-model="knowledgeDocumentForm.title" class="w-full" placeholder="将在教师端作为引用来源显示" /></UFormField><UFormField label="选择文件" help="支持 Markdown、TXT、JSON，单文件最大 1 MB"><label class="mt-1 flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 hover:border-indigo-300 hover:bg-indigo-50/40"><span class="grid size-10 place-items-center rounded-xl bg-white text-indigo-600 shadow-sm"><UIcon name="i-lucide-upload-cloud" /></span><span class="min-w-0 flex-1"><strong class="block truncate text-sm">{{ knowledgeFile?.name || '点击选择本地文件' }}</strong><span class="mt-1 block text-xs text-slate-400">{{ knowledgeFile ? formatFileSize(knowledgeFile.size) : '文件内容不会作为个人业务数据导入' }}</span></span><input type="file" accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json" class="sr-only" @change="selectKnowledgeFile"></label></UFormField><UAlert v-if="importStage!=='idle'" color="info" variant="soft" :description="importStage==='reading'?'正在读取并校验文件…':importStage==='uploading'?'正在解析并生成知识片段…':'导入完成'" /><div class="rounded-xl bg-amber-50 p-4"><UCheckbox v-model="knowledgeDocumentForm.confirmNoPersonalData" label="我确认文档不包含学生、家长或教师个人业务数据" /><p class="mt-2 pl-7 text-xs leading-5 text-amber-700">请先移除姓名、电话、班级等个人信息；导入和删除操作都会进入审计日志。</p></div><div class="flex justify-end gap-2 pt-2"><UButton color="neutral" variant="ghost" @click="() => { importKnowledgeOpen=false }">取消</UButton><UButton type="submit" icon="i-lucide-wand-sparkles" :disabled="!knowledgeFile || !knowledgeDocumentForm.knowledgeBaseId || knowledgeDocumentForm.title.trim().length<2 || !knowledgeDocumentForm.confirmNoPersonalData" :loading="pending">解析并导入</UButton></div></form></template></UModal>
    <UModal :open="Boolean(previewDocument)" :title="previewDocument?.title || '文档预览'" description="以下为教师助手实际检索的分块内容预览。" @update:open="value=>{if(!value)previewDocument=null}"><template #body><div v-if="previewDocument" class="space-y-4"><div class="grid grid-cols-4 gap-3"><div class="rounded-xl bg-slate-50 p-3"><span class="text-xs text-slate-400">格式</span><strong class="mt-1 block text-sm uppercase">{{ previewDocument.sourceType }}</strong></div><div class="rounded-xl bg-slate-50 p-3"><span class="text-xs text-slate-400">字符数</span><strong class="mt-1 block text-sm">{{ previewDocument.metadata?.characterCount || 0 }}</strong></div><div class="rounded-xl bg-slate-50 p-3"><span class="text-xs text-slate-400">知识片段</span><strong class="mt-1 block text-sm">{{ previewDocument.metadata?.chunkCount || 0 }}</strong></div><div class="rounded-xl bg-slate-50 p-3"><span class="text-xs text-slate-400">已向量化</span><strong class="mt-1 block text-sm">{{ previewDocument.metadata?.embeddedChunkCount || 0 }}</strong></div></div><div class="max-h-[50vh] space-y-3 overflow-y-auto pr-1"><div v-for="chunk in previewDocument.chunks" :key="chunk.id" class="rounded-2xl border border-slate-100 p-4"><div class="flex items-center justify-between gap-3"><strong class="text-sm">{{ chunk.heading || `片段 ${chunk.chunkIndex+1}` }}</strong><span class="text-xs text-slate-400">约 {{ chunk.tokenEstimate }} tokens · {{ chunk.embeddingModel || '待向量化' }}</span></div><p class="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{{ chunk.content }}</p></div></div><div class="flex items-center justify-between border-t border-slate-100 pt-4"><span class="text-xs text-slate-400">导入于 {{ formatKnowledgeDate(previewDocument.createdAt) }}</span><UButton color="error" variant="soft" icon="i-lucide-trash-2" :disabled="selectedKnowledgeBase?.status==='published'" :loading="pending" @click="documentToDelete = previewDocument">删除文档</UButton></div></div></template></UModal>
    <UModal :open="Boolean(documentToDelete)" title="删除知识文档" :description="documentToDelete ? `确认删除“${documentToDelete.title}”？删除后无法恢复。` : ''" @update:open="value=>{if(!value)documentToDelete=null}"><template #body><div class="flex justify-end gap-2"><UButton color="neutral" variant="ghost" @click="() => { documentToDelete=null }">取消</UButton><UButton color="error" :loading="pending" @click="() => { if (documentToDelete) void deleteKnowledgeDocument(documentToDelete) }">确认删除</UButton></div></template></UModal>
    <UModal :open="Boolean(confirmKnowledgeAction)" :title="confirmKnowledgeAction?.action==='publish'?'确认发布知识库':confirmKnowledgeAction?.action==='archive'?'确认停用知识库':'恢复为草稿'" @update:open="value=>{if(!value)confirmKnowledgeAction=null}"><template #body><div v-if="confirmKnowledgeAction" class="space-y-5"><UAlert :color="confirmKnowledgeAction.action==='publish'?'warning':'info'" variant="soft" :description="confirmKnowledgeAction.action==='publish'?'发布后，教师助手将立即检索该知识库中的全部文档。请确认内容已经过业务和隐私审核。':confirmKnowledgeAction.action==='archive'?'停用后，教师助手将立即停止检索该知识库，但历史引用仍保留。':'恢复后知识库保持离线，可修改文档并重新发布。'" /><p class="text-sm text-slate-600">知识库：<strong>{{ confirmKnowledgeAction.name }}</strong></p><div class="flex justify-end gap-2"><UButton color="neutral" variant="ghost" @click="() => { confirmKnowledgeAction=null }">取消</UButton><UButton :color="confirmKnowledgeAction.action==='archive'?'error':'primary'" :loading="pending" @click="knowledgeAction(confirmKnowledgeAction.id,confirmKnowledgeAction.action)">{{ confirmKnowledgeAction.action==='publish'?'确认发布':confirmKnowledgeAction.action==='archive'?'确认停用':'恢复草稿' }}</UButton></div></div></template></UModal>
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
            v-else-if="editingContent.type === 'rules'"
            :payload="editingPayload"
            @update:payload="v => editingPayload = v"
          />
          <div v-else class="py-8 text-center text-sm text-slate-400">
            暂不支持 {{ editingContent.type }} 类型的可视化编辑。请使用 JSON 编辑。
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
            <USelect v-model="diffSourceId" :items="(data?.contentPackages || []).filter((x:any) => x.code === diffSource?.code).map((x:any) => ({ label: `${x.version} (${x.status})`, value: x.id }))" class="w-full" @update:model-value="loadDiffVersions()" />
          </UFormField>
          <UFormField label="目标版本">
            <USelect v-model="diffTargetId" :items="(data?.contentPackages || []).filter((x:any) => x.code === diffSource?.code && x.id !== diffSourceId).map((x:any) => ({ label: `${x.version} (${x.status})`, value: x.id }))" class="w-full" @update:model-value="loadDiffVersions()" />
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

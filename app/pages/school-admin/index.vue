<script setup lang="ts">
const { user } = useAuth()
const route = useRoute()
const router = useRouter()
const { data, refresh } = await useFetch<any>('/api/v1/school-admin/dashboard')
const { data: settings, refresh: refreshSettings } = await useFetch<any>('/api/v1/school-admin/settings')
const { data: schoolInfo, refresh: refreshSchoolInfo } = await useFetch<any>('/api/v1/school-admin/information')
const { data: planStats, refresh: refreshPlanStats } = await useFetch<any>('/api/v1/school-admin/plan-statistics')
const { data: planOperations, refresh: refreshPlanOperations } = await useFetch<any>('/api/v1/school-admin/plan-operations')
const { data: pilotMetrics, refresh: refreshPilotMetrics } = await useFetch<any>('/api/v1/school-admin/pilot-metrics')
const { data: referrals, refresh: refreshReferrals } = await useFetch<any[]>('/api/v1/school-admin/referrals')
const managedUsers = ref<any>({ rows: [], total: 0, page: 1, pageSize: 20 })
const userSearch = ref('')
const userRoleFilter = ref('all')
const userStatusFilter = ref('all')
const userPage = ref(1)
const showEditUser = ref(false)
const editUserForm = reactive({ id: '', name: '', email: '', role: '', status: '', _originalEmail: '', _originalRole: '' })
const showEditClass = ref(false)
const editClassForm = reactive({ id: '', name: '', grade: 7 as number, departmentId: '', ownerUserId: '', externalCode: '', studentCount: 0 })
const showEditDepartment = ref(false)
const editDepartmentForm = reactive({ id: '', name: '', code: '', type: 'other' as string, parentId: '', leaderUserId: '', description: '' })
const showClassHistory = ref(false)
const managedDepartments = ref<any>({ rows: [], total: 0, page: 1, pageSize: 20 })
const departmentSearch = ref('')
const departmentTypeFilter = ref('all')
const departmentStatusFilter = ref('all')
const departmentPage = ref(1)
let departmentFetchTimer: ReturnType<typeof setTimeout> | undefined
const managedClasses = ref<any>({ rows: [], total: 0, page: 1, pageSize: 20 })
const classSearch = ref('')
const classStatusFilter = ref('all')
const classPage = ref(1)
let classFetchTimer: ReturnType<typeof setTimeout> | undefined
const managedStudents = ref<any>({ rows: [], total: 0, page: 1, pageSize: 20 })
const studentSearch = ref('')
const studentClassFilter = ref('all')
const studentStatusFilter = ref('all')
const studentPage = ref(1)
const showEditStudent = ref(false)
const editStudentForm = reactive({ id: '', name: '', gender: '' })
let studentFetchTimer: ReturnType<typeof setTimeout> | undefined
const { data: guardianRows, refresh: refreshGuardians } = await useFetch<any>('/api/v1/school-admin/guardians?pageSize=100&status=all')
const active = ref(typeof route.query.tab === 'string' ? route.query.tab : 'overview')
const showUserForm = ref(false)
const showDepartmentForm = ref(false)
const showClassForm = ref(false)
const showStudentForm = ref(false)
const userForm = reactive({ name: '', email: '', role: 'teacher', password: '' })
const departmentForm = reactive({ name: '', code: '', type: 'other', parentId: '', leaderUserId: '', description: '' })
const departmentMember = reactive<Record<string, { userId: string, memberRole: string }>>({})
const classForm = reactive({ name: '', grade: 7, ownerUserId: '', departmentId: '', externalCode: '', studentCount: 0 })
const studentForm = reactive({ name: '', gender: '', classId: '', ownerUserId: '', notes: '', externalRef: '' })
const guardianDraft = reactive<Record<string, { name: string, phone: string, relation: string }>>({})
const assignment = reactive<Record<string, string>>({})
const assignmentReason = ref('')
const pending = ref(false)
const accessTarget = ref<{ type: string, id: string, label: string } | null>(null)
const sensitive = ref<any>(null)
const watermark = ref('')
const activeGrantId = ref('')
const archiveTab = ref('overview')
const activeDepartmentOptions = computed(() => [
  { label: '不挂靠部门', value: '' },
  ...((managedDepartments.value?.rows || [])
    .filter((department: any) => department.status === 'active')
    .map((department: any) => ({ label: department.name, value: department.id }))),
])
const activeClassOptions = computed(() => [
  { label: '暂不分班', value: '' },
  ...((managedClasses.value?.rows || [])
    .filter((klass: any) => klass.status === 'active')
    .map((klass: any) => ({ label: klass.departmentName ? `${klass.name} · ${klass.departmentName}` : klass.name, value: klass.id }))),
])
const teacherOptions = computed(() => (
  (schoolInfo.value?.teachers || []).map((teacher: any) => ({ label: teacher.name, value: teacher.id }))
))
const sensitiveStats = computed(() => {
  if (!sensitive.value) return null
  const { assessments, plans, planReviews, communications } = sensitive.value
  const assessSubmitted = (assessments || []).filter((a: any) => a.status === 'submitted').length
  const assessTotal = (assessments || []).length
  const plansActive = (plans || []).filter((p: any) => p.status === 'active' || p.status === 'in_progress').length
  const plansCompleted = (plans || []).filter((p: any) => p.status === 'completed').length
  const reviewAvg = (planReviews || []).length
    ? ((planReviews as any[]).reduce((s: number, r: any) => s + (r.effectScore || 0), 0) / (planReviews || []).length).toFixed(1)
    : '—'
  const highRiskComms = (communications || []).filter((c: any) => c.riskLevel === 'high').length
  return { assessSubmitted, assessTotal, plansActive, plansCompleted, reviewAvg, highRiskComms }
})
const toast = useToast()
const {
  targetTypeLabel,
  severityLabel,
  severityColor,
  priorityLabel,
  priorityColor,
  sourceTypeLabel,
  referralStatusLabel,
  referralStatusColor,
  planStatusLabel,
  planStatusColor,
  assessmentStatusLabel,
  assessmentStatusColor,
  moduleLabel,
  libraryTypeLabel,
  reasonCategoryLabel,
  recordStatusLabel,
  recordStatusColor,
  accountStatusLabel,
  accountStatusColor,
  auditActionLabel
} = useDisplayLabels()
const importType = ref<'users' | 'classes' | 'students' | 'guardians'>('users')
const importFile = ref<File | null>(null)
const importContentBase64 = ref('')
const importPreview = ref<any>(null)
const importResult = ref<any>(null)
const referralAssignee = reactive<Record<string, string>>({})
const acceptanceStatusText: Record<string, string> = { ready: '可进入扩大试点', watch: '可控试点观察', not_ready: '暂不建议扩大' }
const acceptanceStatusColor: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = { ready: 'success', watch: 'warning', not_ready: 'error' }
const acceptanceItemColor: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = { pass: 'success', watch: 'warning', fail: 'error' }
// 初始加载 + 搜索/筛选防抖
let userFetchTimer: ReturnType<typeof setTimeout> | undefined
function debouncedFetchUsers() {
  clearTimeout(userFetchTimer)
  userFetchTimer = setTimeout(() => { userPage.value = 1; fetchManagedUsers() }, 300)
}
fetchManagedUsers()
fetchManagedDepartments()
fetchManagedClasses()
fetchManagedStudents()

async function createUser() {
  pending.value = true
  try {
    await $fetch('/api/v1/school-admin/users', { method: 'POST', body: userForm })
    showUserForm.value = false
    Object.assign(userForm, { name: '', email: '', role: 'teacher', password: '' })
    await Promise.all([refresh(), fetchManagedUsers()])
    toast.add({ title: '账号已创建', description: '账户已直接激活，可使用设定的密码登录。', color: 'success' })
  } catch (error: any) { toast.add({ title: '创建失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
  finally { pending.value = false }
}

async function fetchManagedUsers() {
  const params = new URLSearchParams({
    pageSize: '20', page: String(userPage.value),
    role: userRoleFilter.value, status: userStatusFilter.value
  })
  if (userSearch.value.trim()) params.set('q', userSearch.value.trim())
  managedUsers.value = await $fetch<any>(`/api/v1/school-admin/users?${params}`)
}

function debouncedFetchStudents() {
  clearTimeout(studentFetchTimer)
  studentFetchTimer = setTimeout(() => { studentPage.value = 1; fetchManagedStudents() }, 300)
}

async function fetchManagedStudents() {
  const params = new URLSearchParams({
    pageSize: '20', page: String(studentPage.value),
    classId: studentClassFilter.value, status: studentStatusFilter.value
  })
  if (studentSearch.value.trim()) params.set('q', studentSearch.value.trim())
  managedStudents.value = await $fetch<any>(`/api/v1/school-admin/students?${params}`)
}

async function updateStudentName() {
  if (!editStudentForm.name.trim() || editStudentForm.name.trim().length < 2) return
  pending.value = true
  try {
    await $fetch(`/api/v1/school-admin/students/${editStudentForm.id}`, { method: 'PATCH', body: { name: editStudentForm.name.trim(), gender: editStudentForm.gender || undefined } })
    showEditStudent.value = false
    await fetchManagedStudents()
    toast.add({ title: '学生信息已更新', color: 'success' })
  } catch (error: any) { toast.add({ title: '更新失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
  finally { pending.value = false }
}

function debouncedFetchDepartments() {
  clearTimeout(departmentFetchTimer)
  departmentFetchTimer = setTimeout(() => { departmentPage.value = 1; fetchManagedDepartments() }, 300)
}

async function fetchManagedDepartments() {
  const params = new URLSearchParams({
    pageSize: '20', page: String(departmentPage.value),
    type: departmentTypeFilter.value, status: departmentStatusFilter.value
  })
  if (departmentSearch.value.trim()) params.set('q', departmentSearch.value.trim())
  managedDepartments.value = await $fetch<any>(`/api/v1/school-admin/departments?${params}`)
}

function debouncedFetchClasses() {
  clearTimeout(classFetchTimer)
  classFetchTimer = setTimeout(() => { classPage.value = 1; fetchManagedClasses() }, 300)
}

async function fetchManagedClasses() {
  const params = new URLSearchParams({
    pageSize: '20', page: String(classPage.value),
    status: classStatusFilter.value
  })
  if (classSearch.value.trim()) params.set('q', classSearch.value.trim())
  managedClasses.value = await $fetch<any>(`/api/v1/school-admin/classes?${params}`)
}

async function updateUser() {
  if (!editUserForm.name.trim() || editUserForm.name.trim().length < 2) return
  pending.value = true
  try {
    const body: Record<string, unknown> = { name: editUserForm.name.trim() }
    if (editUserForm.email !== editUserForm._originalEmail) body.email = editUserForm.email.trim()
    if (editUserForm.role !== editUserForm._originalRole) body.role = editUserForm.role
    await $fetch(`/api/v1/school-admin/users/${editUserForm.id}`, { method: 'PATCH', body })
    showEditUser.value = false
    await fetchManagedUsers()
    toast.add({ title: '用户信息已更新', color: 'success' })
  } catch (error: any) { toast.add({ title: '更新失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
  finally { pending.value = false }
}

async function toggleUserFromEdit() {
  await toggleUser({ id: editUserForm.id, status: editUserForm.status })
  showEditUser.value = false
}

async function updateClass() {
  if (!editClassForm.name.trim() || editClassForm.name.trim().length < 2) return
  pending.value = true
  try {
    const body: Record<string, unknown> = {
      name: editClassForm.name.trim(),
      grade: editClassForm.grade,
      departmentId: editClassForm.departmentId || undefined,
      ownerUserId: editClassForm.ownerUserId,
      studentCount: editClassForm.studentCount,
      externalCode: editClassForm.externalCode || undefined,
    }
    await $fetch(`/api/v1/school-admin/classes/${editClassForm.id}`, { method: 'PATCH', body })
    showEditClass.value = false
    await refreshManagement()
    toast.add({ title: '班级信息已更新', color: 'success' })
  } catch (error: any) { toast.add({ title: '更新失败', description: error?.data?.message || '请检查信息', color: 'error' }) }
  finally { pending.value = false }
}

async function refreshManagement() {
  await Promise.all([refresh(), fetchManagedUsers(), fetchManagedDepartments(), fetchManagedClasses(), fetchManagedStudents(), refreshGuardians(), refreshSchoolInfo()])
}

async function viewSensitive(target: { type: string, id: string, label: string }) {
  accessTarget.value = target
  sensitive.value = null
  pending.value = true
  try {
    const access = await $fetch<any>('/api/v1/admin-access/requests', {
      method: 'POST', body: { targetType: target.type, targetId: target.id, reasonCategory: 'school_duty', reasonText: '学校管理员查看教师档案' }
    })
    const result = await $fetch<any>(`/api/v1/admin-access/records/${target.type}/${target.id}`, {
      headers: { 'x-admin-access-grant': access.grant.id }
    })
    sensitive.value = result.record
    watermark.value = result.access.watermark
    activeGrantId.value = access.grant.id
  } catch (error: any) {
    toast.add({ title: '查看失败', description: error?.data?.message || '请稍后重试', color: 'error' })
    accessTarget.value = null
  }
  finally { pending.value = false }
}

function recordPrintAttempt() {
  if (!accessTarget.value || !activeGrantId.value || !sensitive.value) return
  void $fetch('/api/v1/admin-access/events', {
    method: 'POST',
    headers: { 'x-admin-access-grant': activeGrantId.value },
    body: { targetType: accessTarget.value.type, targetId: accessTarget.value.id, action: 'print_attempt' }
  }).catch(() => undefined)
}

function formatAcceptanceValue(item: any) {
  if (item.value === null || item.value === undefined) return '待积累'
  if (item.unit === 'ratio') return `${Math.round(item.value * 100)}%`
  if (item.unit === 'score') return Number(item.value).toFixed(1)
  return String(item.value)
}

function formatAcceptanceTarget(item: any) {
  if (item.unit === 'ratio') return `${item.direction === 'lte' ? '≤' : '≥'}${Math.round(item.target * 100)}%`
  if (item.unit === 'score') return `≥${Number(item.target).toFixed(1)}`
  return `≥${item.target}`
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
    await $fetch(`/api/v1/school-admin/users/${item.id}`, {
      method: 'PATCH', body: item.status === 'active' ? { status: 'disabled' } : { status: 'active' }
    })
    await refreshManagement()
  } catch (error: any) { toast.add({ title: '操作失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
}

async function deleteUser(item: any) {
  try {
    await $fetch(`/api/v1/school-admin/users/${item.id}`, { method: 'DELETE' })
    toast.add({ title: '用户已删除', color: 'success' })
    await refreshManagement()
  } catch (error: any) { toast.add({ title: '删除失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
}

async function createClass() {
  if (!classForm.ownerUserId && schoolInfo.value?.teachers?.[0]) classForm.ownerUserId = schoolInfo.value.teachers[0].id
  pending.value = true
  try {
    await $fetch('/api/v1/school-admin/classes', { method: 'POST', body: { ...classForm, departmentId: classForm.departmentId || null, externalCode: classForm.externalCode || undefined } })
    Object.assign(classForm, { name: '', grade: 7, ownerUserId: '', departmentId: '', externalCode: '', studentCount: 0 })
    await refreshManagement()
    toast.add({ title: '班级已创建', color: 'success' })
    showClassForm.value = false
  } catch (error: any) { toast.add({ title: '班级保存失败', description: error?.data?.message || '请检查信息', color: 'error' }) }
  finally { pending.value = false }
}

async function createDepartment() {
  pending.value = true
  try {
    await $fetch('/api/v1/school-admin/departments', {
      method: 'POST',
      body: {
        name: departmentForm.name,
        code: departmentForm.code || undefined,
        type: departmentForm.type,
        parentId: departmentForm.parentId || null,
        leaderUserId: departmentForm.leaderUserId || null,
        description: departmentForm.description || null
      }
    })
    Object.assign(departmentForm, { name: '', code: '', type: 'other', parentId: '', leaderUserId: '', description: '' })
    await refreshManagement()
    toast.add({ title: '部门已创建', color: 'success' })
    showDepartmentForm.value = false
  } catch (error: any) { toast.add({ title: '部门保存失败', description: error?.data?.message || '请检查信息', color: 'error' }) }
  finally { pending.value = false }
}

async function updateDepartmentStatus(item: any, status: 'active' | 'archived') {
  pending.value = true
  try {
    await $fetch(`/api/v1/school-admin/departments/${item.id}`, { method: 'PATCH', body: { status } })
    await refreshManagement()
  } finally { pending.value = false }
}

async function updateDepartment() {
  if (!editDepartmentForm.name.trim() || editDepartmentForm.name.trim().length < 1) return
  pending.value = true
  try {
    const body: Record<string, unknown> = {
      name: editDepartmentForm.name.trim(),
      code: editDepartmentForm.code || undefined,
      type: editDepartmentForm.type,
      parentId: editDepartmentForm.parentId || null,
      leaderUserId: editDepartmentForm.leaderUserId || null,
      description: editDepartmentForm.description || null
    }
    await $fetch(`/api/v1/school-admin/departments/${editDepartmentForm.id}`, { method: 'PATCH', body })
    showEditDepartment.value = false
    await refreshManagement()
    toast.add({ title: '部门信息已更新', color: 'success' })
  } catch (error: any) { toast.add({ title: '更新失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
  finally { pending.value = false }
}

function departmentMemberFor(departmentId: string) {
  if (!departmentMember[departmentId]) departmentMember[departmentId] = { userId: '', memberRole: '' }
  return departmentMember[departmentId]
}

async function addDepartmentMember(item: any) {
  const draft = departmentMember[item.id]
  if (!draft?.userId) return
  pending.value = true
  try {
    await $fetch(`/api/v1/school-admin/departments/${item.id}/members`, {
      method: 'POST',
      body: { userId: draft.userId, memberRole: draft.memberRole || undefined }
    })
    departmentMember[item.id] = { userId: '', memberRole: '' }
    await refreshManagement()
    toast.add({ title: '成员已加入部门', color: 'success' })
  } catch (error: any) { toast.add({ title: '加入失败', description: error?.data?.message || '请检查成员', color: 'error' }) }
  finally { pending.value = false }
}

async function updateClassStatus(item: any, status: 'active' | 'archived' | 'graduated') {
  pending.value = true
  try {
    await $fetch(`/api/v1/school-admin/classes/${item.id}`, { method: 'PATCH', body: { status, reason: assignmentReason.value || undefined } })
    await refreshManagement()
  } finally { pending.value = false }
}

async function createStudent() {
  pending.value = true
  try {
    await $fetch('/api/v1/school-admin/students', { method: 'POST', body: {
      name: studentForm.name,
      gender: studentForm.gender || undefined,
      classId: studentForm.classId || null,
      ownerUserId: studentForm.ownerUserId || undefined,
      notes: studentForm.notes || undefined,
      externalRef: studentForm.externalRef || undefined
    } })
    Object.assign(studentForm, { name: '', gender: '', classId: '', ownerUserId: '', notes: '', externalRef: '' })
    await refreshManagement()
    toast.add({ title: '学生已创建', color: 'success' })
    showStudentForm.value = false
  } catch (error: any) { toast.add({ title: '学生保存失败', description: error?.data?.message || '未分班时必须选择负责教师', color: 'error' }) }
  finally { pending.value = false }
}

async function updateStudentStatus(item: any, status: 'active' | 'archived' | 'transferred' | 'graduated') {
  pending.value = true
  try {
    await $fetch(`/api/v1/school-admin/students/${item.id}`, { method: 'PATCH', body: { status, reason: assignmentReason.value || undefined } })
    await refreshManagement()
  } finally { pending.value = false }
}

async function linkGuardian(student: any) {
  const draft = guardianDraft[student.id]
  if (!draft?.name) return
  pending.value = true
  try {
    await $fetch(`/api/v1/school-admin/students/${student.id}/guardians`, { method: 'POST', body: { guardian: draft } })
    guardianDraft[student.id] = { name: '', phone: '', relation: '' }
    await refreshManagement()
    toast.add({ title: '家长已绑定', color: 'success' })
  } catch (error: any) { toast.add({ title: '绑定失败', description: error?.data?.message || '请检查家长信息', color: 'error' }) }
  finally { pending.value = false }
}

function guardianDraftFor(studentId: string) {
  if (!guardianDraft[studentId]) guardianDraft[studentId] = { name: '', phone: '', relation: '' }
  return guardianDraft[studentId]
}

async function reviewDelegated(id: string, decision: 'approved' | 'rejected' | 'revoked') {
  await $fetch(`/api/v1/school-admin/delegated-management/${id}/review`, { method: 'POST', body: { decision } })
  await refresh()
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
    await Promise.all([refresh(), refreshSchoolInfo(), refreshPilotMetrics()])
  } catch (error: any) { toast.add({ title: '导入失败，未写入任何记录', description: error?.data?.message || '请重新预检', color: 'error' }) }
  finally { pending.value = false }
}

// SLA & 危机面板辅助
function getSlaClass(dueAt: string) {
  const remaining = new Date(dueAt).getTime() - Date.now()
  if (remaining < 0) return 'text-red-600'
  if (remaining < 2 * 60 * 1000) return 'text-red-600'
  if (remaining < 5 * 60 * 1000) return 'text-amber-600'
  return 'text-emerald-600'
}
function getSlaRemaining(dueAt: string) {
  const remaining = new Date(dueAt).getTime() - Date.now()
  if (remaining < 0) return '已超时'
  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  if (minutes < 1) return `${seconds}秒`
  if (minutes < 5) return `${minutes}分${seconds}秒`
  return `${minutes}分钟`
}
function getPsychologistName(id: string) {
  return settings?.value?.psychologists?.find((p: any) => p.id === id)?.name || id.slice(0, 8)
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

const nav = [
  { id: 'overview', label: '管理首页', icon: 'i-lucide-layout-dashboard' }, { id: 'operations', label: '方案运营', icon: 'i-lucide-activity' }, { id: 'users', label: '用户管理', icon: 'i-lucide-users' }, { id: 'departments', label: '部门管理', icon: 'i-lucide-building-2' }, { id: 'classes', label: '班级管理', icon: 'i-lucide-school' }, { id: 'students', label: '学生管理', icon: 'i-lucide-graduation-cap' }, { id: 'imports', label: '导入中心', icon: 'i-lucide-file-up' },
  { id: 'crises', label: '危机转介', icon: 'i-lucide-siren' }, { id: 'approvals', label: '权限审批', icon: 'i-lucide-shield-check' }, { id: 'audit', label: '审计日志', icon: 'i-lucide-scroll-text' }, { id: 'settings', label: '学校配置', icon: 'i-lucide-settings' }
]

function switchAdminTab(id: string) {
  active.value = id
  router.replace({ query: { ...route.query, tab: id } })
}

watch(() => route.query.tab, (tab) => {
  if (typeof tab === 'string' && tab) active.value = tab
})
function openUserCreate() { showUserForm.value = true }
function openDepartmentCreate() { showDepartmentForm.value = true }
function openClassCreate() { showClassForm.value = true }
function openStudentCreate() { showStudentForm.value = true }
function setUserFormOpen(value: boolean) { showUserForm.value = value }
function closeUserForm(close?: () => void) {
  close?.()
  showUserForm.value = false
}
function setEditUserOpen(value: boolean) { showEditUser.value = value }
function closeEditUser(close?: () => void) {
  close?.()
  showEditUser.value = false
}
function setClassFormOpen(value: boolean) { showClassForm.value = value }
function closeClassForm(close?: () => void) {
  close?.()
  showClassForm.value = false
}
function setEditClassOpen(value: boolean) { showEditClass.value = value }
function closeEditClass(close?: () => void) {
  close?.()
  showEditClass.value = false
}
function setDepartmentFormOpen(value: boolean) { showDepartmentForm.value = value }
function closeDepartmentForm(close?: () => void) {
  close?.()
  showDepartmentForm.value = false
}
function setEditDepartmentOpen(value: boolean) { showEditDepartment.value = value }
function closeEditDepartment(close?: () => void) {
  close?.()
  showEditDepartment.value = false
}
function setStudentFormOpen(value: boolean) { showStudentForm.value = value }
function closeStudentForm(close?: () => void) {
  close?.()
  showStudentForm.value = false
}
function setEditStudentOpen(value: boolean) { showEditStudent.value = value }
function closeEditStudent(close?: () => void) {
  close?.()
  showEditStudent.value = false
}
function openEditUser(item: any) { editUserForm.id = item.id; editUserForm.name = item.name; editUserForm.email = item.email; editUserForm._originalEmail = item.email; editUserForm.role = item.role; editUserForm._originalRole = item.role; editUserForm.status = item.status; showEditUser.value = true }
function openEditClass(item: any) { editClassForm.id = item.id; editClassForm.name = item.name; editClassForm.grade = item.grade ?? 7; editClassForm.departmentId = item.departmentId || ''; editClassForm.ownerUserId = item.ownerUserId; editClassForm.externalCode = item.externalCode || ''; editClassForm.studentCount = item.studentCount; showEditClass.value = true }
function openEditDepartment(item: any) { editDepartmentForm.id = item.id; editDepartmentForm.name = item.name; editDepartmentForm.code = item.code || ''; editDepartmentForm.type = item.type || 'other'; editDepartmentForm.parentId = item.parentId || ''; editDepartmentForm.leaderUserId = item.leaderUserId || ''; editDepartmentForm.description = item.description || ''; showEditDepartment.value = true }
function openEditStudent(item: any) { editStudentForm.id = item.id; editStudentForm.name = item.name; editStudentForm.gender = item.gender || ''; showEditStudent.value = true }
</script>

<template>
  <div class="mx-auto max-w-7xl px-5 py-9">
    <div><p class="text-sm font-semibold text-emerald-700">学校治理空间</p><h1 class="mt-2 text-3xl font-semibold">学校管理后台</h1><p class="mt-2 text-sm text-slate-500">账号、转介配置和敏感访问全部可审计。</p></div>
    <div class="mt-8 grid gap-6 lg:grid-cols-[15rem_1fr]">
      <aside class="panel h-fit p-3"><button v-for="item in nav" :key="item.id" class="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm" :class="(active as string) === item.id ? 'bg-emerald-800 text-white' : 'text-slate-600 hover:bg-slate-100'" @click="switchAdminTab(item.id)"><UIcon :name="item.icon" />{{ item.label }}<UBadge v-if="item.id === 'approvals' && ((data?.pendingRequests?.length || 0) + (data?.delegatedRequests?.length || 0))" class="ml-auto" color="error">{{ (data?.pendingRequests?.length || 0) + (data?.delegatedRequests?.length || 0) }}</UBadge></button></aside>
      <section class="min-w-0">
        <template v-if="(active as string) === 'overview'"><div class="grid gap-4 sm:grid-cols-3"><div class="panel p-6"><p class="text-sm text-slate-500">本校账号</p><strong class="mt-2 block text-3xl">{{ data?.metrics.users || 0 }}</strong></div><div class="panel p-6"><p class="text-sm text-slate-500">评估记录</p><strong class="mt-2 block text-3xl">{{ data?.metrics.assessments || 0 }}</strong></div><div class="panel border-red-100 p-6"><p class="text-sm text-red-600">待处理危机</p><strong class="mt-2 block text-3xl text-red-700">{{ data?.metrics.activeCrises || 0 }}</strong></div></div><div class="panel mt-5 p-6"><h2 class="font-semibold">管理原则</h2><div class="mt-4 grid gap-3 md:grid-cols-3"><div class="rounded-2xl bg-slate-50 p-4 text-sm">查看业务明细前强制填写事由</div><div class="rounded-2xl bg-slate-50 p-4 text-sm">业务数据只读且禁止批量导出</div><div class="rounded-2xl bg-slate-50 p-4 text-sm">平台应急访问必须由本校批准</div></div></div><div class="panel mt-5 p-6"><h2 class="font-semibold">方案执行统计</h2><div class="mt-4 grid gap-4 sm:grid-cols-3"><div class="rounded-2xl bg-slate-50 p-4 text-sm">方案总数 <strong class="mt-1 block text-2xl">{{ planStats?.planCompletion?.total || 0 }}</strong></div><div class="rounded-2xl bg-emerald-50 p-4 text-sm">已完成 <strong class="mt-1 block text-2xl text-emerald-700">{{ planStats?.planCompletion?.completed || 0 }}</strong></div><div class="rounded-2xl bg-amber-50 p-4 text-sm">进行中 <strong class="mt-1 block text-2xl text-amber-700">{{ planStats?.planCompletion?.inProgress || 0 }}</strong></div></div><div class="mt-4"><p class="text-sm text-slate-500">全校方案完成率</p><div class="mt-2 h-4 w-full rounded-full bg-slate-100"><div class="h-4 rounded-full bg-emerald-500 transition-all" :style="{ width: `${planStats?.planCompletion?.rate || 0}%` }" /></div><p class="mt-1 text-right text-xs text-slate-400">{{ planStats?.planCompletion?.rate || 0 }}%</p></div><div v-if="planStats?.overduePlans?.length" class="mt-5"><h3 class="font-semibold text-red-700">超期方案提醒（{{ planStats.overduePlans.length }}个）</h3><div class="mt-3 space-y-2"><div v-for="plan in planStats.overduePlans.slice(0, 10)" :key="plan.id" class="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 p-3 text-sm"><span><strong>{{ plan.title }}</strong><small class="ml-2 text-slate-400">{{ plan.teacherName }}</small></span><UBadge color="error" variant="soft">{{ plan.daysSinceUpdate }}天未更新</UBadge></div></div></div><div v-if="planStats?.teacherRanking?.length" class="mt-5"><h3 class="font-semibold">班主任执行排名（近7日）</h3><div class="mt-3 space-y-2"><div v-for="(item, idx) in planStats.teacherRanking.slice(0, 10)" :key="item.teacherId" class="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm"><span><strong class="mr-2 text-slate-400">{{ Number(idx) + 1 }}.</strong>{{ item.teacherName }}</span><span class="text-slate-500">{{ item.completedActionCount }}/{{ item.totalActionCount }} 个动作完成</span></div></div></div></div></template>
        <template v-if="(active as string) === 'operations'"><div class="space-y-5"><div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="text-xl font-semibold">方案运营看板</h2><p class="mt-1 text-sm text-slate-500">只展示脱敏运营数据；查看业务详情仍需敏感访问授权。</p></div><UButton color="neutral" variant="soft" icon="i-lucide-refresh-cw" @click="() => refreshPlanOperations()">刷新</UButton></div><div class="grid gap-4 sm:grid-cols-3 xl:grid-cols-6"><div class="panel p-4"><p class="text-xs text-slate-500">方案总数</p><strong class="mt-1 block text-2xl">{{ planOperations?.summary?.totalPlans || 0 }}</strong></div><div class="panel p-4"><p class="text-xs text-slate-500">待确认</p><strong class="mt-1 block text-2xl text-amber-700">{{ planOperations?.summary?.pendingAcceptance || 0 }}</strong></div><div class="panel p-4"><p class="text-xs text-slate-500">进行中</p><strong class="mt-1 block text-2xl text-sky-700">{{ planOperations?.summary?.inProgress || 0 }}</strong></div><div class="panel p-4"><p class="text-xs text-slate-500">需调整</p><strong class="mt-1 block text-2xl text-amber-700">{{ planOperations?.summary?.adjustmentNeeded || 0 }}</strong></div><div class="panel p-4"><p class="text-xs text-slate-500">需协同</p><strong class="mt-1 block text-2xl text-red-700">{{ planOperations?.summary?.escalated || 0 }}</strong></div><div class="panel p-4"><p class="text-xs text-slate-500">已完成</p><strong class="mt-1 block text-2xl text-emerald-700">{{ planOperations?.summary?.completed || 0 }}</strong></div></div><div class="grid gap-4 md:grid-cols-3"><div class="panel p-5"><p class="text-sm text-slate-500">动作完成率</p><strong class="mt-2 block text-3xl">{{ planOperations?.actionMetrics?.completionRate || 0 }}%</strong><p class="mt-1 text-xs text-slate-400">{{ planOperations?.actionMetrics?.completed || 0 }}/{{ planOperations?.actionMetrics?.total || 0 }}</p></div><div class="panel p-5"><p class="text-sm text-slate-500">动作受阻率</p><strong class="mt-2 block text-3xl text-red-700">{{ planOperations?.actionMetrics?.blockedRate || 0 }}%</strong><p class="mt-1 text-xs text-slate-400">{{ planOperations?.actionMetrics?.blocked || 0 }} 个受阻</p></div><div class="panel p-5"><p class="text-sm text-slate-500">动作逾期率</p><strong class="mt-2 block text-3xl text-amber-700">{{ planOperations?.actionMetrics?.overdueRate || 0 }}%</strong><p class="mt-1 text-xs text-slate-400">{{ planOperations?.actionMetrics?.overdue || 0 }} 个逾期</p></div></div><div class="grid gap-5 xl:grid-cols-2"><div class="panel p-5"><h3 class="font-semibold text-red-700">受阻动作</h3><div class="mt-3 space-y-2"><div v-for="item in planOperations?.queues?.blockedActions || []" :key="item.actionId" class="rounded-xl bg-red-50 p-3 text-sm"><strong>{{ item.planTitle }}</strong><p class="mt-1 text-xs text-slate-500">{{ item.teacherName }} · {{ item.blockReason }}</p></div><p v-if="!planOperations?.queues?.blockedActions?.length" class="py-6 text-center text-sm text-slate-400">暂无受阻动作</p></div></div><div class="panel p-5"><h3 class="font-semibold text-amber-700">逾期动作</h3><div class="mt-3 space-y-2"><div v-for="item in planOperations?.queues?.overdueActions || []" :key="item.actionId" class="flex items-center justify-between rounded-xl bg-amber-50 p-3 text-sm"><span><strong>{{ item.planTitle }}</strong><small class="ml-2 text-slate-400">{{ item.teacherName }}</small></span><UBadge color="warning" variant="soft">{{ item.overdueDays }} 天</UBadge></div><p v-if="!planOperations?.queues?.overdueActions?.length" class="py-6 text-center text-sm text-slate-400">暂无逾期动作</p></div></div><div class="panel p-5"><h3 class="font-semibold text-sky-700">待复盘方案</h3><div class="mt-3 space-y-2"><div v-for="item in planOperations?.queues?.dueReviews || []" :key="item.planId" class="rounded-xl bg-sky-50 p-3 text-sm"><strong>{{ item.planTitle }}</strong><p class="mt-1 text-xs text-slate-500">{{ item.teacherName }} · {{ item.nextReviewAt ? new Date(item.nextReviewAt).toLocaleDateString('zh-CN') : '—' }}</p></div><p v-if="!planOperations?.queues?.dueReviews?.length" class="py-6 text-center text-sm text-slate-400">暂无待复盘方案</p></div></div><div class="panel p-5"><h3 class="font-semibold">低分反馈</h3><div class="mt-3 space-y-2"><div v-for="item in planOperations?.queues?.lowFeedback || []" :key="`${item.planId}:${item.createdAt}`" class="rounded-xl bg-slate-50 p-3 text-sm"><strong>{{ item.planTitle }}</strong><p class="mt-1 text-xs text-slate-500">{{ item.teacherName }} · 归因 {{ item.attributionAccuracy }}/5 · 工具 {{ item.toolUsability }}/5 · 复盘 {{ item.reviewUsefulness }}/5</p></div><p v-if="!planOperations?.queues?.lowFeedback?.length" class="py-6 text-center text-sm text-slate-400">暂无低分反馈</p></div></div></div><div class="panel p-5"><h3 class="font-semibold">教师执行概览</h3><div class="mt-4 overflow-x-auto"><table class="w-full text-left text-sm"><thead class="text-xs text-slate-400"><tr><th class="py-2">教师</th><th>方案</th><th>待确认</th><th>待复盘</th><th>受阻</th><th>逾期</th><th class="text-right">动作完成率</th></tr></thead><tbody><tr v-for="item in planOperations?.teacherOperations || []" :key="item.teacherId" class="border-t border-slate-100"><td class="py-3">{{ item.teacherName }}</td><td>{{ item.planCount }}</td><td>{{ item.pendingCount }}</td><td>{{ item.dueReviewCount }}</td><td>{{ item.blockedActionCount }}</td><td>{{ item.overdueActionCount }}</td><td class="text-right">{{ item.actionCompletionRate }}%</td></tr></tbody></table></div></div></div></template>
        <template v-if="(active as string) === 'users'">
          <div class="space-y-5">
            <div class="grid gap-4 sm:grid-cols-3">
              <div class="panel p-4"><p class="text-xs text-slate-500">总用户</p><strong class="mt-1 block text-2xl">{{ managedUsers.total || 0 }}</strong></div>
              <div class="panel p-4"><p class="text-xs text-slate-500">已激活</p><strong class="mt-1 block text-2xl text-emerald-700">{{ managedUsers.rows?.filter((u:any)=>u.status==='active').length || 0 }}</strong></div>
              <div class="panel p-4"><p class="text-xs text-slate-500">已停用</p><strong class="mt-1 block text-2xl text-slate-500">{{ managedUsers.rows?.filter((u:any)=>u.status==='disabled').length || 0 }}</strong></div>
            </div>
            <div class="panel p-6">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div><h2 class="text-xl font-semibold">用户管理</h2><p class="mt-1 text-sm text-slate-500">账号创建、启停、姓名编辑均留痕可审计。</p></div>
                <UButton icon="i-lucide-user-plus" @click="openUserCreate">创建账号</UButton>
              </div>
              <div class="mt-5 flex flex-wrap items-center gap-3">
                <div class="relative min-w-[200px] max-w-sm flex-1"><UIcon name="i-lucide-search" class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><UInput v-model="userSearch" placeholder="搜索姓名或邮箱……" class="w-full !pl-9" @input="debouncedFetchUsers" /></div>
                <USelect v-model="userRoleFilter" :items="[{label:'全部角色',value:'all'},{label:'教师',value:'teacher'},{label:'心理专员',value:'psychologist'}]" class="w-32" @change="debouncedFetchUsers" />
                <USelect v-model="userStatusFilter" :items="[{label:'全部状态',value:'all'},{label:'已激活',value:'active'},{label:'已停用',value:'disabled'}]" class="w-32" @change="debouncedFetchUsers" />
              </div>
              <div class="mt-5 overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead class="text-xs text-slate-400"><tr><th class="py-3">姓名</th><th>邮箱</th><th>角色</th><th>状态</th><th>创建时间</th><th>最近登录</th><th class="text-right">操作</th></tr></thead>
                  <tbody>
                    <tr v-for="item in managedUsers.rows" :key="item.id" class="border-t border-slate-100">
                      <td class="py-4 font-medium">{{ item.name }}</td>
                      <td class="text-slate-600">{{ item.email }}</td>
                      <td><UBadge :color="item.role==='teacher'?'primary':'warning'" variant="soft">{{ item.role==='teacher'?'教师':item.role==='psychologist'?'心理专员':item.role }}</UBadge></td>
                      <td><UBadge :color="item.status==='active'?'success':'neutral'" variant="soft">{{ item.status==='active'?'已激活':'已停用' }}</UBadge></td>
                      <td class="text-xs text-slate-400">{{ item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : '—' }}</td>
                      <td class="text-xs text-slate-400">{{ item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleString('zh-CN') : '—' }}</td>
                      <td class="space-x-1 text-right">
                        <UButton size="xs" variant="ghost" @click="openEditUser(item)"><UIcon name="i-lucide-pencil" class="size-3" /></UButton>
                        <UButton v-if="item.role==='teacher'" size="xs" variant="soft" @click="viewSensitive({type:'teacher_profile',id:item.id,label:item.name})">档案</UButton>
                        <UButton size="xs" color="neutral" variant="ghost" @click="toggleUser(item)">{{ item.status==='active'?'停用':'激活' }}</UButton>
                        <UButton v-if="item.status!=='active'" size="xs" color="error" variant="ghost" @click="deleteUser(item)">删除</UButton>
                      </td>
                    </tr>
                    <tr v-if="!managedUsers.rows?.length"><td colspan="7" class="py-14 text-center text-sm text-slate-400">暂无匹配用户</td></tr>
                  </tbody>
                </table>
              </div>
              <div v-if="managedUsers.total > 20" class="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
                <span class="text-xs text-slate-400">共 {{ managedUsers.total }} 条，第 {{ userPage }} / {{ Math.ceil(managedUsers.total / 20) }} 页</span>
                <div class="flex gap-2">
                  <UButton size="xs" color="neutral" variant="soft" :disabled="userPage <= 1" @click="userPage--; fetchManagedUsers()">上一页</UButton>
                  <UButton size="xs" color="neutral" variant="soft" :disabled="userPage >= Math.ceil(managedUsers.total / 20)" @click="userPage++; fetchManagedUsers()">下一页</UButton>
                </div>
              </div>
            </div>
          </div>
        </template>
        <template v-if="(active as string) === 'departments'">
          <div class="space-y-5">
            <div class="grid gap-4 sm:grid-cols-3">
              <div class="panel p-4"><p class="text-xs text-slate-500">部门总数</p><strong class="mt-1 block text-2xl">{{ managedDepartments.total || 0 }}</strong></div>
              <div class="panel p-4"><p class="text-xs text-slate-500">活跃</p><strong class="mt-1 block text-2xl text-emerald-700">{{ managedDepartments.rows?.filter((d:any)=>d.status==='active').length || 0 }}</strong></div>
              <div class="panel p-4"><p class="text-xs text-slate-500">已归档</p><strong class="mt-1 block text-2xl text-slate-500">{{ managedDepartments.rows?.filter((d:any)=>d.status==='archived').length || 0 }}</strong></div>
            </div>
              <div class="panel p-6">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div><h2 class="text-xl font-semibold">部门管理</h2><p class="mt-1 text-sm text-slate-500">维护年级组、教研组、学生支持中心等组织架构。</p></div>
                  <UButton icon="i-lucide-plus" @click="openDepartmentCreate">创建部门</UButton>
                </div>
                <div class="mt-5 flex flex-wrap items-center gap-3">
                  <div class="relative min-w-[200px] max-w-sm flex-1"><UIcon name="i-lucide-search" class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><UInput v-model="departmentSearch" placeholder="搜索名称或编号……" class="w-full !pl-9" @input="debouncedFetchDepartments" /></div>
                  <USelect v-model="departmentTypeFilter" :items="[{label:'全部类型',value:'all'},{label:'行政部门',value:'administration'},{label:'年级组',value:'grade_group'},{label:'教研组',value:'subject_group'},{label:'学生支持',value:'student_support'},{label:'其他',value:'other'}]" class="w-32" @change="debouncedFetchDepartments" />
                  <USelect v-model="departmentStatusFilter" :items="[{label:'全部状态',value:'all'},{label:'活跃',value:'active'},{label:'已归档',value:'archived'}]" class="w-32" @change="debouncedFetchDepartments" />
                </div>
                <div class="mt-5 overflow-x-auto">
                  <table class="w-full text-left text-sm">
                    <thead class="text-xs text-slate-400"><tr><th class="py-3">名称</th><th>编号</th><th>类型</th><th>负责人</th><th>成员</th><th>班级数</th><th>状态</th><th class="text-right">操作</th></tr></thead>
                    <tbody>
                      <tr v-for="item in managedDepartments.rows" :key="item.id" class="border-t border-slate-100">
                        <td class="py-4 font-medium">{{ item.name }}</td>
                        <td class="text-xs text-slate-500">{{ item.code || '—' }}</td>
                        <td><UBadge color="primary" variant="soft">{{ item.type==='administration'?'行政':item.type==='grade_group'?'年级组':item.type==='subject_group'?'教研组':item.type==='student_support'?'学生支持':'其他' }}</UBadge></td>
                        <td class="text-xs text-slate-500">{{ item.leaderName || '未设' }}</td>
                        <td>{{ item.memberCount }}</td>
                        <td>{{ item.classCount }}</td>
                        <td><UBadge :color="item.status==='active'?'success':'neutral'" variant="soft">{{ item.status==='active'?'活跃':'已归档' }}</UBadge></td>
                        <td class="space-x-1 text-right">
                          <UButton size="xs" variant="ghost" @click="openEditDepartment(item)"><UIcon name="i-lucide-pencil" class="size-3" /></UButton>
                          <UButton v-if="item.status!=='active'" size="xs" color="success" variant="ghost" @click="updateDepartmentStatus(item,'active')">恢复</UButton>
                          <UButton v-if="item.status==='active'" size="xs" color="neutral" variant="ghost" @click="updateDepartmentStatus(item,'archived')">归档</UButton>
                        </td>
                      </tr>
                      <tr v-if="!managedDepartments.rows?.length"><td colspan="8" class="py-14 text-center text-sm text-slate-400">暂无匹配部门</td></tr>
                    </tbody>
                  </table>
                </div>
                <div v-if="managedDepartments.total > 20" class="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
                  <span class="text-xs text-slate-400">共 {{ managedDepartments.total }} 条，第 {{ departmentPage }} / {{ Math.ceil(managedDepartments.total / 20) }} 页</span>
                  <div class="flex gap-2">
                    <UButton size="xs" color="neutral" variant="soft" :disabled="departmentPage <= 1" @click="departmentPage--; fetchManagedDepartments()">上一页</UButton>
                    <UButton size="xs" color="neutral" variant="soft" :disabled="departmentPage >= Math.ceil(managedDepartments.total / 20)" @click="departmentPage++; fetchManagedDepartments()">下一页</UButton>
                  </div>
                </div>
                <div class="mt-5 rounded-2xl bg-slate-50 p-4">
                  <p class="text-xs font-medium text-slate-500">加入部门成员</p>
                  <div class="mt-3 space-y-3">
                    <div v-for="item in managedDepartments.rows" :key="`member-${item.id}`" class="grid gap-2 md:grid-cols-[1fr_.6fr_auto]">
                      <span class="truncate text-xs text-slate-500">{{ item.name }}</span>
                      <USelect v-model="departmentMemberFor(item.id).userId" :items="(managedUsers?.rows || []).filter((u:any)=>u.status==='active' && ['teacher','psychologist','school_admin'].includes(u.role)).map((u:any)=>({label:`${u.name} · ${u.role==='teacher'?'教师':u.role==='psychologist'?'心理专员':'管理员'}`,value:u.id}))" placeholder="选择成员" size="xs" />
                      <UInput v-model="departmentMemberFor(item.id).memberRole" placeholder="岗位" size="xs" />
                      <UButton size="xs" :disabled="!departmentMemberFor(item.id).userId" @click="addDepartmentMember(item)">加入</UButton>
                    </div>
                  </div>
                </div>
              </div>
          </div>
        </template>
        <template v-if="(active as string) === 'classes'">
          <div class="space-y-5">
            <div class="grid gap-4 sm:grid-cols-4">
              <div class="panel flex items-center gap-3 p-4"><div class="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100"><UIcon name="i-lucide-school" class="size-4.5 text-slate-600" /></div><div><strong class="block text-xl">{{ managedClasses.total || 0 }}</strong><p class="text-xs text-slate-500">班级总数</p></div></div>
              <div class="panel flex items-center gap-3 p-4"><div class="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-100"><UIcon name="i-lucide-check-circle" class="size-4.5 text-emerald-600" /></div><div><strong class="block text-xl text-emerald-700">{{ managedClasses.rows?.filter((c:any)=>c.status==='active').length || 0 }}</strong><p class="text-xs text-slate-500">在校</p></div></div>
              <div class="panel flex items-center gap-3 p-4"><div class="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100"><UIcon name="i-lucide-archive" class="size-4.5 text-slate-500" /></div><div><strong class="block text-xl text-slate-600">{{ managedClasses.rows?.filter((c:any)=>c.status==='archived').length || 0 }}</strong><p class="text-xs text-slate-500">已归档</p></div></div>
              <div class="panel flex items-center gap-3 p-4"><div class="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-100"><UIcon name="i-lucide-graduation-cap" class="size-4.5 text-amber-600" /></div><div><strong class="block text-xl text-amber-700">{{ managedClasses.rows?.filter((c:any)=>c.status==='graduated').length || 0 }}</strong><p class="text-xs text-slate-500">已毕业</p></div></div>
            </div>
              <div class="panel p-6">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div><h2 class="text-xl font-semibold">班级管理</h2><p class="mt-1 text-sm text-slate-500">创建、归档、毕业和恢复班级；负责人变更会同步学生、家长、沟通和方案归属。</p></div>
                  <UButton icon="i-lucide-plus" @click="openClassCreate">创建班级</UButton>
                </div>
                <div class="mt-5 flex flex-wrap items-center gap-3">
                  <div class="relative min-w-[200px] max-w-sm flex-1"><UIcon name="i-lucide-search" class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><UInput v-model="classSearch" placeholder="搜索名称或编号……" class="w-full !pl-9" @input="debouncedFetchClasses" /></div>
                  <USelect v-model="classStatusFilter" :items="[{label:'全部状态',value:'all'},{label:'在校',value:'active'},{label:'已归档',value:'archived'},{label:'已毕业',value:'graduated'}]" class="w-32" @change="debouncedFetchClasses" />
                </div>
                <div class="mt-5 overflow-x-auto">
                  <table class="w-full text-left text-sm">
                    <thead class="text-xs text-slate-400"><tr><th class="py-3">班级</th><th>年级</th><th>挂靠部门</th><th>负责教师</th><th>学生数</th><th>状态</th><th class="text-right">操作</th></tr></thead>
                    <tbody>
                      <tr v-for="item in managedClasses.rows" :key="item.id" class="border-t border-slate-100 transition-colors hover:bg-slate-50/50">
                        <td class="py-4 font-medium">{{ item.name }}<p v-if="item.externalCode" class="mt-0.5 text-xs text-slate-400">{{ item.externalCode }}</p></td>
                        <td>{{ item.grade }} 年级</td>
                        <td class="text-xs text-slate-500">{{ item.departmentName || '—' }}</td>
                        <td class="text-xs text-slate-500">{{ item.ownerName }}</td>
                        <td>{{ item.actualStudentCount }}/{{ item.studentCount }}</td>
                        <td><UBadge :color="item.status==='active'?'success':'neutral'" variant="soft">{{ item.status==='active'?'在校':item.status==='archived'?'已归档':'已毕业' }}</UBadge></td>
                        <td class="space-x-1 text-right">
                          <UButton size="xs" variant="ghost" @click="openEditClass(item)"><UIcon name="i-lucide-pencil" class="size-3" /></UButton>
                          <UButton v-if="item.status!=='active'" size="xs" color="success" variant="ghost" @click="updateClassStatus(item,'active')">恢复</UButton>
                          <UButton v-if="item.status==='active'" size="xs" color="neutral" variant="ghost" @click="updateClassStatus(item,'archived')">归档</UButton>
                          <UButton v-if="item.status==='active'" size="xs" color="neutral" variant="ghost" @click="updateClassStatus(item,'graduated')">毕业</UButton>
                        </td>
                      </tr>
                      <tr v-if="!managedClasses.rows?.length"><td colspan="7" class="py-14 text-center text-sm text-slate-400">暂无匹配班级</td></tr>
                    </tbody>
                  </table>
                </div>
                <div v-if="managedClasses.total > 20" class="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
                  <span class="text-xs text-slate-400">共 {{ managedClasses.total }} 条，第 {{ classPage }} / {{ Math.ceil(managedClasses.total / 20) }} 页</span>
                  <div class="flex gap-2">
                    <UButton size="xs" color="neutral" variant="soft" :disabled="classPage <= 1" @click="classPage--; fetchManagedClasses()">上一页</UButton>
                    <UButton size="xs" color="neutral" variant="soft" :disabled="classPage >= Math.ceil(managedClasses.total / 20)" @click="classPage++; fetchManagedClasses()">下一页</UButton>
                  </div>
                </div>
                <div class="border-t border-slate-100 mt-5 pt-4">
                <div class="flex cursor-pointer items-center justify-between" @click="showClassHistory = !showClassHistory">
                  <h3 class="font-semibold text-sm">最近移交记录</h3>
                  <UIcon :name="showClassHistory ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-slate-400" />
                </div>
                <div v-if="showClassHistory" class="mt-4 divide-y divide-slate-100">
                  <div v-for="item in schoolInfo?.assignments" :key="item.id" class="grid gap-2 py-3 text-xs text-slate-500 md:grid-cols-[.6fr_1fr_1fr]"><span>{{ targetTypeLabel(item.targetType) }} · {{ item.fromUserName }} → {{ item.toUserName }}</span><span>{{ item.reason || '未填写原因' }}</span><span class="md:text-right">{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</span></div>
                  <p v-if="!schoolInfo?.assignments?.length" class="py-6 text-center text-sm text-slate-400">暂无移交历史</p>
                </div>
              </div>
              </div>
          </div>
        </template>        <template v-if="(active as string) === 'students'">
          <div class="space-y-5">
            <div class="grid gap-4 sm:grid-cols-4">
              <div class="panel p-4"><p class="text-xs text-slate-500">学生总数</p><strong class="mt-1 block text-2xl">{{ managedStudents.total || 0 }}</strong></div>
              <div class="panel p-4"><p class="text-xs text-slate-500">在校</p><strong class="mt-1 block text-2xl text-emerald-700">{{ managedStudents.rows?.filter((s:any)=>s.status==='active').length || 0 }}</strong></div>
              <div class="panel p-4"><p class="text-xs text-slate-500">已归档</p><strong class="mt-1 block text-2xl text-slate-500">{{ managedStudents.rows?.filter((s:any)=>s.status==='archived').length || 0 }}</strong></div>
              <div class="panel p-4"><p class="text-xs text-slate-500">已毕业/转出</p><strong class="mt-1 block text-2xl text-amber-600">{{ managedStudents.rows?.filter((s:any)=>['graduated','transferred'].includes(s.status)).length || 0 }}</strong></div>
            </div>
              <div class="panel p-6">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div><h2 class="text-xl font-semibold">学生管理</h2><p class="mt-1 text-sm text-slate-500">维护学生基础资料、状态、分班、负责教师和家长关系；业务过程记录仍保持只读。</p></div>
                  <UButton icon="i-lucide-plus" @click="openStudentCreate">创建学生</UButton>
                </div>
                <div class="mt-5 flex flex-wrap items-center gap-3">
                  <div class="relative min-w-[200px] max-w-sm flex-1"><UIcon name="i-lucide-search" class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><UInput v-model="studentSearch" placeholder="搜索姓名或编号……" class="w-full !pl-9" @input="debouncedFetchStudents" /></div>
                  <USelect v-model="studentClassFilter" :items="[{label:'全部班级',value:'all'},{label:'未分班',value:'none'}, ...(managedClasses?.rows || []).filter((c:any)=>c.status==='active').map((c:any)=>({label:c.name,value:c.id}))]" class="w-32" @change="debouncedFetchStudents" />
                  <USelect v-model="studentStatusFilter" :items="[{label:'全部状态',value:'all'},{label:'在校',value:'active'},{label:'已归档',value:'archived'},{label:'已转出',value:'transferred'},{label:'已毕业',value:'graduated'}]" class="w-32" @change="debouncedFetchStudents" />
                </div>
                <div class="mt-5 overflow-x-auto">
                  <table class="w-full text-left text-sm">
                    <thead class="text-xs text-slate-400"><tr><th class="py-3">姓名</th><th>性别</th><th>班级</th><th>负责教师</th><th>状态</th><th>创建时间</th><th class="text-right">操作</th></tr></thead>
                    <tbody>
                      <tr v-for="item in managedStudents.rows" :key="item.id" class="border-t border-slate-100">
                        <td class="py-4 font-medium">{{ item.name }}</td>
                        <td class="text-slate-600">{{ item.gender || '—' }}</td>
                        <td class="text-xs text-slate-500">{{ item.className || '未分班' }}</td>
                        <td class="w-44"><p class="text-xs text-slate-500 truncate">{{ item.ownerName }}</p><div class="mt-0.5 flex items-center gap-1"><USelect v-model="assignment[`student:${item.id}`]" :items="schoolInfo?.teachers?.map((t:any)=>({label:t.name,value:t.id})) || []" size="xs" class="w-28" placeholder="更换教师" /><UButton size="xs" color="neutral" variant="soft" :disabled="!assignment[`student:${item.id}`]" :loading="pending" @click="assignRecord('student', item.id)">分配</UButton></div></td>
                        <td><UBadge :color="item.status==='active'?'success':'neutral'" variant="soft">{{ item.status==='active'?'在校':item.status==='archived'?'已归档':item.status==='transferred'?'已转出':'已毕业' }}</UBadge></td>
                        <td class="text-xs text-slate-400">{{ item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : '—' }}</td>
                        <td class="space-x-1 text-right">
                          <UButton size="xs" variant="ghost" @click="openEditStudent(item)"><UIcon name="i-lucide-pencil" class="size-3" /></UButton>
                          <UButton v-if="item.status!=='active'" size="xs" color="success" variant="ghost" @click="updateStudentStatus(item,'active')">恢复</UButton>
                          <UButton v-if="item.status==='active'" size="xs" color="neutral" variant="ghost" @click="updateStudentStatus(item,'archived')">归档</UButton>
                          <UButton v-if="item.status==='active'" size="xs" color="neutral" variant="ghost" @click="updateStudentStatus(item,'graduated')">毕业</UButton>
                        </td>
                      </tr>
                      <tr v-if="!managedStudents.rows?.length"><td colspan="7" class="py-14 text-center text-sm text-slate-400">暂无匹配学生</td></tr>
                    </tbody>
                  </table>
                </div>
                <div v-if="managedStudents.total > 20" class="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
                  <span class="text-xs text-slate-400">共 {{ managedStudents.total }} 条，第 {{ studentPage }} / {{ Math.ceil(managedStudents.total / 20) }} 页</span>
                  <div class="flex gap-2">
                    <UButton size="xs" color="neutral" variant="soft" :disabled="studentPage <= 1" @click="studentPage--; fetchManagedStudents()">上一页</UButton>
                    <UButton size="xs" color="neutral" variant="soft" :disabled="studentPage >= Math.ceil(managedStudents.total / 20)" @click="studentPage++; fetchManagedStudents()">下一页</UButton>
                  </div>
                </div>
                <div class="mt-5 rounded-2xl bg-slate-50 p-4">
                  <p class="text-xs font-medium text-slate-500">绑定家长</p>
                  <div class="mt-3 space-y-3">
                    <div v-for="student in managedStudents.rows" :key="`guardian-${student.id}`" class="grid gap-2 md:grid-cols-[1fr_.7fr_.5fr_auto]">
                      <span class="truncate text-xs text-slate-500">{{ student.name }}</span>
                      <UInput v-model="guardianDraftFor(student.id).name" placeholder="家长姓名" size="xs" />
                      <UInput v-model="guardianDraftFor(student.id).relation" placeholder="关系" size="xs" />
                      <UButton size="xs" :disabled="!guardianDraftFor(student.id).name" @click="linkGuardian(student)">绑定</UButton>
                    </div>
                  </div>
                </div>
              </div>
          </div>
        </template>
        <template v-if="(active as string) === 'imports'"><div class="panel p-6"><div><h2 class="text-xl font-semibold">CSV 数据入校</h2><p class="mt-2 text-sm text-slate-500">按用户 → 班级 → 学生 → 家长顺序导入。预检不写业务数据，确认提交采用单事务。</p></div><div class="mt-6 grid gap-4 sm:grid-cols-2"><UFormField label="数据类型"><USelect v-model="importType" :items="[{label:'用户 users.csv',value:'users'},{label:'班级 classes.csv',value:'classes'},{label:'学生 students.csv',value:'students'},{label:'家长 guardians.csv',value:'guardians'}]" class="w-full" /></UFormField><div class="flex items-end"><UButton :to="`/api/v1/school-admin/imports/templates/${importType}`" external color="neutral" variant="soft" icon="i-lucide-download">下载固定模板</UButton></div><UFormField class="sm:col-span-2" label="选择 CSV" help="支持 UTF-8/BOM 和 GB18030；最大 2 MB、2,000 行"><input type="file" accept=".csv,text/csv" class="block w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" @change="onImportFile(($event.target as HTMLInputElement).files?.[0])" /></UFormField></div><UButton class="mt-5" :disabled="!importContentBase64" :loading="pending" @click="previewImport">上传并预检</UButton><div v-if="importPreview" class="mt-6 rounded-2xl border p-5" :class="importPreview.errors.length?'border-red-200 bg-red-50':'border-emerald-200 bg-emerald-50'"><div class="flex flex-wrap gap-4 text-sm"><strong>{{ importPreview.totalRows }} 行</strong><span>编码 {{ importPreview.encoding }}</span><span>{{ importPreview.validRows }} 行可导入</span><span v-if="importPreview.errors.length" class="text-red-700">{{ importPreview.errors.length }} 个错误</span></div><div v-if="importPreview.errors.length" class="mt-4 max-h-56 overflow-auto"><p v-for="error in importPreview.errors" :key="`${error.row}:${error.code}`" class="py-1 text-xs text-red-700">第 {{ error.row }} 行 · {{ error.code }} · {{ error.message }}</p></div><UButton v-else class="mt-5" :loading="pending" @click="commitImport">人工确认并写入</UButton></div></div></template>
        <template v-if="(active as string) === 'metrics'">
          <div class="space-y-5">
            <div class="panel p-6">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 class="text-xl font-semibold">试点验收面板</h2>
                  <p class="mt-1 text-sm text-slate-500">近 {{ pilotMetrics?.period?.days || 7 }} 天，统计使用、方案、三库和安全指标。</p>
                </div>
                <div class="text-right">
                  <UBadge :color="acceptanceStatusColor[pilotMetrics?.acceptance?.status || 'not_ready']" variant="soft">
                    {{ acceptanceStatusText[pilotMetrics?.acceptance?.status || 'not_ready'] }}
                  </UBadge>
                  <strong class="mt-2 block text-4xl">{{ pilotMetrics?.acceptance?.score || 0 }}</strong>
                  <p class="text-xs text-slate-400">{{ pilotMetrics?.acceptance?.passed || 0 }}/{{ pilotMetrics?.acceptance?.total || 0 }} 项达标</p>
                </div>
              </div>
              <div class="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div v-for="item in pilotMetrics?.acceptance?.items || []" :key="item.key" class="rounded-lg border border-slate-100 p-4">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-sm text-slate-500">{{ item.label }}</span>
                    <UBadge size="xs" :color="acceptanceItemColor[item.status]" variant="soft">{{ item.status === 'pass' ? '达标' : item.status === 'watch' ? '观察' : '未达标' }}</UBadge>
                  </div>
                  <div class="mt-2 flex items-end justify-between gap-3">
                    <strong class="text-2xl">{{ formatAcceptanceValue(item) }}</strong>
                    <span class="text-xs text-slate-400">目标 {{ formatAcceptanceTarget(item) }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
              <div class="panel p-5"><p class="text-sm text-slate-500">账号激活率</p><strong class="mt-2 block text-3xl">{{ Math.round((pilotMetrics?.activation?.rate || 0) * 100) }}%</strong></div>
              <div class="panel p-5"><p class="text-sm text-slate-500">10 分钟首任务</p><strong class="mt-2 block text-3xl">{{ Math.round((pilotMetrics?.firstTask?.rate || 0) * 100) }}%</strong></div>
              <div class="panel p-5"><p class="text-sm text-slate-500">周活跃教师</p><strong class="mt-2 block text-3xl">{{ pilotMetrics?.weeklyActiveTeachers || 0 }}</strong></div>
              <div class="panel p-5"><p class="text-sm text-slate-500">方案反馈数</p><strong class="mt-2 block text-3xl">{{ pilotMetrics?.planQuality?.feedbackCount || 0 }}</strong></div>
              <div class="panel p-5"><p class="text-sm text-slate-500">三库覆盖率</p><strong class="mt-2 block text-3xl">{{ Math.round((pilotMetrics?.resourceQuality?.rate || 0) * 100) }}%</strong></div>
              <div class="panel p-5"><p class="text-sm text-slate-500">工作单完整率</p><strong class="mt-2 block text-3xl">{{ Math.round((pilotMetrics?.reportCompleteness?.rate || 0) * 100) }}%</strong></div>
            </div>
            <UAlert color="primary" variant="soft" title="隐私保护指标" description="这里只统计激活、操作、方案质量、资源覆盖和 SLA，不展示教师聊天正文或方案敏感正文。" />
            <div class="grid gap-5 lg:grid-cols-2">
              <div class="panel p-6">
                <h3 class="font-semibold">方案质量</h3>
                <div class="mt-4 grid gap-4 sm:grid-cols-3">
                  <div><span class="text-sm text-slate-500">归因准确</span><strong class="block text-2xl">{{ pilotMetrics?.planQuality?.attributionAccuracy ?? '—' }}</strong></div>
                  <div><span class="text-sm text-slate-500">工具可用</span><strong class="block text-2xl">{{ pilotMetrics?.planQuality?.toolUsability ?? '—' }}</strong></div>
                  <div><span class="text-sm text-slate-500">话术自然</span><strong class="block text-2xl">{{ pilotMetrics?.planQuality?.scriptNaturalness ?? '—' }}</strong></div>
                </div>
              </div>
              <div class="panel p-6">
                <h3 class="font-semibold">三库结构化</h3>
                <div class="mt-4 grid gap-4 sm:grid-cols-3">
                  <div><span class="text-sm text-slate-500">应发布</span><strong class="block text-2xl">{{ pilotMetrics?.resourceQuality?.expected || 0 }}</strong></div>
                  <div><span class="text-sm text-slate-500">已发布</span><strong class="block text-2xl">{{ pilotMetrics?.resourceQuality?.published || 0 }}</strong></div>
                  <div><span class="text-sm text-slate-500">投影就绪</span><strong class="block text-2xl">{{ pilotMetrics?.resourceQuality?.projectionReady || 0 }}</strong></div>
                </div>
                <div class="mt-4 flex flex-wrap gap-2">
                  <UBadge v-for="item in pilotMetrics?.resourceQuality?.items || []" :key="`${item.module}:${item.libraryType}`" size="xs" :color="item.projectionReady ? 'success' : item.published ? 'warning' : 'error'" variant="soft">
                    {{ moduleLabel(item.module) }}·{{ libraryTypeLabel(item.libraryType) }}
                  </UBadge>
                </div>
              </div>
              <div class="panel p-6">
                <h3 class="font-semibold">AI 回答质量</h3>
                <div class="mt-4 grid gap-4 sm:grid-cols-3">
                  <div><span class="text-sm text-slate-500">回答 / 反馈</span><strong class="block text-2xl">{{ pilotMetrics?.assistant?.answers || 0 }}/{{ pilotMetrics?.assistant?.feedbackTotal || 0 }}</strong></div>
                  <div><span class="text-sm text-slate-500">来源不足 / 降级</span><strong class="block text-2xl">{{ pilotMetrics?.assistant?.withoutSources || 0 }}/{{ pilotMetrics?.assistant?.localFallback || 0 }}</strong></div>
                  <div><span class="text-sm text-slate-500">失败率</span><strong class="block text-2xl">{{ Math.round((pilotMetrics?.assistant?.failureRate || 0) * 100) }}%</strong></div>
                </div>
              </div>
              <div class="panel p-6">
                <h3 class="font-semibold">危机 SLA</h3>
                <div class="mt-4 grid gap-4 sm:grid-cols-3">
                  <div><span class="text-sm text-slate-500">工单分配</span><strong class="block text-2xl">{{ pilotMetrics?.crisis?.assigned || 0 }}/{{ pilotMetrics?.crisis?.total || 0 }}</strong></div>
                  <div><span class="text-sm text-slate-500">5 分钟内确认</span><strong class="block text-2xl">{{ Math.round((pilotMetrics?.crisis?.ackWithinSlaRate || 0) * 100) }}%</strong></div>
                  <div><span class="text-sm text-slate-500">升级记录</span><strong class="block text-2xl">{{ pilotMetrics?.crisis?.escalated || 0 }}</strong></div>
                </div>
              </div>
            </div>
          </div>
        </template>
        <template v-if="(active as string) === 'records'"><div class="panel p-6"><h2 class="text-xl font-semibold">业务档案访问</h2><p class="mt-2 text-sm text-slate-500">请从“用户管理”选择教师。每次打开都会生成单独的短时授权和访问日志。</p><UAlert class="mt-5" color="warning" variant="soft" title="只读区域" description="管理后台不提供数据修改、删除或批量导出接口。" /></div></template>
        <template v-if="(active as string) === 'crises'"><div class="panel p-6"><h2 class="text-xl font-semibold">危机转介调度</h2><p class="mt-2 text-sm text-slate-500">按事件严重程度和 SLA 排序。展示教师、来源和时间，便于快速识别。未确认工单可转派。</p><div class="mt-5 divide-y divide-slate-100"><div v-for="item in referrals" :key="item.id" class="grid gap-4 py-4 text-sm lg:grid-cols-[1.2fr_.8fr_.9fr_auto]"><div class="min-w-0"><div class="flex items-center gap-2"><strong class="truncate">{{ item.teacherName || '未知教师' }}</strong><UBadge size="xs" :color="severityColor(item.severity)" variant="soft">{{ severityLabel(item.severity) }}</UBadge></div><p class="mt-1 text-xs text-slate-500">事件 {{ item.safetyEventId.slice(0,8) }}<span v-if="item.sourceType" class="text-slate-400"> · {{ sourceTypeLabel(item.sourceType) }}</span><span v-if="item.matchedRules?.length" class="text-slate-400"> · {{ item.matchedRules.slice(0,2).join(', ') }}{{ item.matchedRules.length > 2 ? '...' : '' }}</span></p><p class="mt-0.5 text-xs text-slate-400">{{ item.eventCreatedAt ? new Date(item.eventCreatedAt).toLocaleString('zh-CN') : '—' }}</p></div><div><div class="flex flex-wrap items-center gap-1.5"><UBadge size="xs" :color="referralStatusColor(item.status)" variant="soft">{{ referralStatusLabel(item.status) }}</UBadge><UBadge size="xs" :color="priorityColor(item.priority)" variant="soft">{{ priorityLabel(item.priority) }}</UBadge></div><p v-if="item.acknowledgeDueAt && !item.acknowledgedAt" class="mt-1.5 text-xs font-medium" :class="getSlaClass(item.acknowledgeDueAt)">{{ getSlaRemaining(item.acknowledgeDueAt) }} · 截止 {{ new Date(item.acknowledgeDueAt).toLocaleTimeString('zh-CN') }}</p><p v-else-if="item.acknowledgedAt" class="mt-1.5 text-xs text-slate-400">已确认 {{ new Date(item.acknowledgedAt).toLocaleString('zh-CN') }}</p><p v-else class="mt-1.5 text-xs text-slate-400">无 SLA 截止</p></div><div><p v-if="item.psychologistId" class="mb-1.5 text-xs text-slate-500">当前: {{ getPsychologistName(item.psychologistId) }}</p><p v-else class="mb-1.5 text-xs text-amber-600 font-medium">未分配</p><USelect v-model="referralAssignee[item.id]" :items="settings?.psychologists?.map((p:any)=>({label:p.name,value:p.id})) || []" :disabled="Boolean(item.acknowledgedAt)||item.status==='closed'" placeholder="转派心理专员" class="w-full" size="xs" /></div><UButton size="xs" :disabled="!referralAssignee[item.id] || Boolean(item.acknowledgedAt) || item.status==='closed'" @click="reassignReferral(item)">转派</UButton></div><p v-if="!referrals?.length" class="py-14 text-center text-sm text-slate-400">暂无危机转介</p></div></div></template>
        <template v-if="(active as string) === 'approvals'"><div class="space-y-5"><div class="panel p-6"><h2 class="text-xl font-semibold">平台应急访问审批</h2><div class="mt-5 space-y-3"><div v-for="item in data?.pendingRequests" :key="item.id" class="rounded-2xl border border-amber-100 bg-amber-50/50 p-5"><div class="flex flex-wrap justify-between gap-3"><div><strong>{{ targetTypeLabel(item.targetType) }}</strong><p class="mt-1 text-xs text-slate-500">{{ reasonCategoryLabel(item.reasonCategory) }} · {{ item.reasonText }}</p></div><div class="flex gap-2"><UButton size="sm" @click="review(item.id,'approved')">批准 30 分钟</UButton><UButton size="sm" color="neutral" variant="soft" @click="review(item.id,'rejected')">拒绝</UButton></div></div></div><p v-if="!data?.pendingRequests?.length" class="py-10 text-center text-sm text-slate-400">暂无敏感访问申请</p></div></div><div class="panel p-6"><h2 class="text-xl font-semibold">平台基础数据代管审批</h2><p class="mt-2 text-sm text-slate-500">批准后平台管理员可在 30 分钟内代管账号、教师、部门、班级、学生、家长基础资料；业务过程记录仍不可编辑。</p><div class="mt-5 space-y-3"><div v-for="item in data?.delegatedRequests" :key="item.id" class="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5"><div class="flex flex-wrap justify-between gap-3"><div><strong>{{ item.requesterName || item.requesterId }}</strong><p class="mt-1 text-xs text-slate-500">范围：{{ item.scopes?.map((scope: string) => targetTypeLabel(scope)).join('、') || '—' }} · {{ item.reason }}</p></div><div class="flex gap-2"><UButton size="sm" @click="reviewDelegated(item.id,'approved')">批准 30 分钟</UButton><UButton size="sm" color="neutral" variant="soft" @click="reviewDelegated(item.id,'rejected')">拒绝</UButton></div></div></div><p v-if="!data?.delegatedRequests?.length" class="py-10 text-center text-sm text-slate-400">暂无代管申请</p></div></div></div></template>
        <template v-if="(active as string) === 'audit'"><div class="panel p-6"><div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="text-xl font-semibold">敏感访问审计</h2><p class="mt-1 text-sm text-slate-500">最近 50 条学校管理员和平台管理员的敏感数据访问记录。</p></div><UBadge color="neutral" variant="soft">{{ data?.accessEvents?.length || 0 }} 条</UBadge></div><div class="mt-5 overflow-x-auto"><table class="w-full text-left text-sm"><thead class="text-xs text-slate-400"><tr><th class="py-3 w-24">操作</th><th>目标类型</th><th>目标 ID</th><th>访问字段</th><th>操作者</th><th class="text-right w-40">时间</th></tr></thead><tbody><tr v-for="item in data?.accessEvents" :key="item.id" class="border-t border-slate-100"><td class="py-3"><UBadge size="xs" :color="item.action==='read'?'primary':item.action==='print_attempt'?'warning':'neutral'" variant="soft">{{ auditActionLabel(item.action) }}</UBadge></td><td class="text-slate-600 text-xs">{{ targetTypeLabel(item.targetType) }}</td><td class="font-mono text-xs text-slate-400">{{ item.targetId?.slice(0, 8) }}...</td><td class="text-xs text-slate-500">{{ (item.fields || []).join('、') || '—' }}</td><td class="text-xs">{{ item.actorName || '—' }}<span v-if="item.metadata?.role" class="ml-1 text-slate-400">({{ item.metadata.role === 'platform_admin' ? '平台管理员' : '学校管理员' }})</span></td><td class="text-right text-xs text-slate-400">{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</td></tr></tbody></table><p v-if="!data?.accessEvents?.length" class="py-12 text-center text-sm text-slate-400">暂无审计记录</p></div></div></template>
        <template v-if="(active as string) === 'settings'"><div class="space-y-5"><div class="panel max-w-3xl p-6"><h2 class="text-xl font-semibold">危机转介配置</h2><div v-if="settings" class="mt-6 grid gap-4 sm:grid-cols-2"><UFormField label="默认危机接收心理专员"><USelect v-model="settings.referralPsychologistId" :items="settings.psychologists?.map((p:any)=>({label:p.name,value:p.id})) || []" class="w-full" /></UFormField><UFormField label="校内求助电话"><UInput v-model="settings.helpPhone" class="w-full" /></UFormField><UFormField label="危机首报短信号码（逗号分隔）"><UInput :model-value="settings.smsRecipients?.join(',')" class="w-full" @update:model-value="settings.smsRecipients = String($event).split(',').map(v=>v.trim()).filter(Boolean)" /></UFormField><UFormField label="超时升级安全联系人（逗号分隔）"><UInput :model-value="settings.safetyContactRecipients?.join(',')" class="w-full" @update:model-value="settings.safetyContactRecipients = String($event).split(',').map(v=>v.trim()).filter(Boolean)" /></UFormField><UFormField label="确认 SLA（分钟）"><UInput v-model.number="settings.referralAckMinutes" type="number" min="1" max="30" class="w-full" /></UFormField><UFormField label="升级 SLA（分钟）"><UInput v-model.number="settings.referralEscalationMinutes" type="number" min="5" max="60" class="w-full" /></UFormField><UFormField class="sm:col-span-2" label="危机指引"><UTextarea v-model="settings.crisisGuide" :rows="4" class="w-full" /></UFormField></div></div><div v-if="settings" class="panel max-w-3xl p-6"><h2 class="text-xl font-semibold">AI 数据治理</h2><UAlert class="mt-4" :color="settings.aiProviderAgreementReady?'success':'warning'" variant="soft" :title="settings.aiProviderAgreementReady?`供应商协议已登记：${settings.aiProviderAgreementVersion}`:'供应商协议未登记'" description="协议未登记时完整上下文无法启用，并自动回退到严格脱敏模式。" /><div class="mt-5 space-y-4"><UFormField label="学校 AI 数据模式"><USelect v-model="settings.aiDataMode" :items="[{label:'仅本地 local',value:'local'},{label:'严格脱敏 redacted',value:'redacted'},{label:'授权完整上下文 full_context',value:'full_context'}]" class="w-full" /></UFormField><template v-if="settings.aiDataMode==='full_context'"><UFormField label="学校审批依据" help="至少 10 个字符，写入审计记录"><UTextarea v-model="settings.aiApprovalReference" :rows="3" class="w-full" /></UFormField><UFormField label="教师隐私告知版本"><UInput v-model="settings.aiNoticeVersion" class="w-full" /></UFormField><label class="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm"><UCheckbox v-model="settings.approveFullContext" /><span>我确认学校已完成授权审批。教师未确认对应告知版本前仍使用严格脱敏；电话、邮箱、账号、系统 UUID、密钥和 TOTP 永不发送。</span></label></template><UButton :loading="pending" @click="updateSettings">保存全部配置</UButton></div></div></div></template>
      </section>
    </div>

    <UModal v-if="showUserForm" :open="showUserForm" title="创建校内账号" @update:open="setUserFormOpen">
      <template #body="{ close }">
        <div class="space-y-4">
          <UFormField label="姓名">
            <UInput v-model="userForm.name" class="w-full" />
          </UFormField>
          <UFormField label="邮箱">
            <UInput v-model="userForm.email" type="email" class="w-full" />
          </UFormField>
          <UFormField label="角色">
            <ModalSelect v-model="userForm.role" :items="[{label:'教师',value:'teacher'},{label:'心理专员',value:'psychologist'}]" class="w-full" />
          </UFormField>
          <UFormField label="登录密码" help="至少 8 位，建议混合字母、数字和符号">
            <UInput v-model="userForm.password" type="password" minlength="8" class="w-full" />
          </UFormField>
          <UAlert color="primary" variant="soft" description="账户创建后立即激活。请将密码通过校方认可渠道发送给本人。" />
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="closeUserForm(close)">取消</UButton>
            <UButton :loading="pending" @click="createUser">创建账号</UButton>
          </div>
        </div>
      </template>
    </UModal>
    <UModal v-if="showEditUser" :open="showEditUser" title="编辑用户" @update:open="setEditUserOpen">
      <template #body="{ close }">
        <div class="space-y-4">
          <UFormField label="邮箱">
            <UInput v-model="editUserForm.email" type="email" class="w-full" />
          </UFormField>
          <UFormField label="角色">
            <ModalSelect v-model="editUserForm.role" :items="[{label:'教师',value:'teacher'},{label:'心理专员',value:'psychologist'}]" class="w-full" />
          </UFormField>
          <UFormField label="姓名">
            <UInput v-model="editUserForm.name" class="w-full" />
          </UFormField>
          <UFormField label="账号状态">
            <div class="flex items-center gap-3">
              <UBadge :color="editUserForm.status==='active'?'success':'neutral'" variant="soft">{{ editUserForm.status==='active'?'已激活':'已停用' }}</UBadge>
              <UButton v-if="editUserForm.status==='active'" size="xs" color="neutral" variant="soft" @click="toggleUserFromEdit">停用账号</UButton>
              <UButton v-if="editUserForm.status==='disabled'" size="xs" color="primary" variant="soft" @click="toggleUserFromEdit">激活账号</UButton>
            </div>
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton v-if="editUserForm.status!=='active'" color="error" variant="soft" @click="deleteUser(editUserForm); closeEditUser(close)">删除用户</UButton>
            <UButton color="neutral" variant="ghost" @click="closeEditUser(close)">取消</UButton>
            <UButton :disabled="!editUserForm.name.trim() || editUserForm.name.trim().length < 2" :loading="pending" @click="updateUser">保存</UButton>
          </div>
        </div>
      </template>
    </UModal>
    <UModal v-if="showEditStudent" :open="showEditStudent" title="编辑学生信息" @update:open="setEditStudentOpen">
      <template #body="{ close }">
        <div class="space-y-4">
          <UFormField label="姓名">
            <UInput v-model="editStudentForm.name" class="w-full" />
          </UFormField>
          <UFormField label="性别">
            <UInput v-model="editStudentForm.gender" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="closeEditStudent(close)">取消</UButton>
            <UButton class="flex-1 justify-center" :disabled="!editStudentForm.name.trim() || editStudentForm.name.trim().length < 2" :loading="pending" @click="updateStudentName">保存</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-if="showEditClass" :open="showEditClass" title="编辑班级" @update:open="setEditClassOpen">
      <template #body="{ close }">
        <div class="space-y-4">
          <UFormField label="班级名称">
            <UInput v-model="editClassForm.name" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="年级">
              <ModalSelect v-model.number="editClassForm.grade" :items="Array.from({length:12},(_,i)=>({label:`${i+1} 年级`,value:i+1}))" class="w-full" />
            </UFormField>
            <UFormField label="学生容量">
              <UInput v-model.number="editClassForm.studentCount" type="number" min="0" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="负责教师">
            <ModalSelect v-model="editClassForm.ownerUserId" :items="teacherOptions" class="w-full" />
          </UFormField>
          <UFormField label="挂靠部门">
            <ModalSelect v-model="editClassForm.departmentId" :items="activeDepartmentOptions" class="w-full" />
          </UFormField>
          <UFormField label="外部编号">
            <UInput v-model="editClassForm.externalCode" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="closeEditClass(close)">取消</UButton>
            <UButton class="flex-1 justify-center" :disabled="!editClassForm.name.trim() || !editClassForm.ownerUserId" :loading="pending" @click="updateClass">保存班级</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-if="showEditDepartment" :open="showEditDepartment" title="编辑部门" @update:open="setEditDepartmentOpen">
      <template #body="{ close }">
        <div class="space-y-4">
          <UFormField label="部门名称">
            <UInput v-model="editDepartmentForm.name" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="部门编号">
              <UInput v-model="editDepartmentForm.code" />
            </UFormField>
            <UFormField label="类型">
              <ModalSelect v-model="editDepartmentForm.type" :items="[{label:'行政部门',value:'administration'},{label:'年级组',value:'grade_group'},{label:'教研组',value:'subject_group'},{label:'学生支持',value:'student_support'},{label:'其他',value:'other'}]" />
            </UFormField>
          </div>
          <UFormField label="上级部门">
            <ModalSelect v-model="editDepartmentForm.parentId" :items="[{label:'无上级部门',value:''}, ...(managedDepartments?.rows || []).filter((d:any)=>d.status==='active' && d.id !== editDepartmentForm.id).map((d:any)=>({label:d.name,value:d.id}))]" class="w-full" />
          </UFormField>
          <UFormField label="部门负责人">
            <ModalSelect v-model="editDepartmentForm.leaderUserId" :items="[{label:'暂不设置',value:''}, ...(schoolInfo?.teachers || []).filter((t:any)=>t.status==='active').map((t:any)=>({label:t.name,value:t.id}))]" class="w-full" />
          </UFormField>
          <UFormField label="说明">
            <UTextarea v-model="editDepartmentForm.description" :rows="3" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="closeEditDepartment(close)">取消</UButton>
            <UButton class="flex-1 justify-center" :disabled="!editDepartmentForm.name.trim()" :loading="pending" @click="updateDepartment">保存部门</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-if="showDepartmentForm" :open="showDepartmentForm" title="创建部门" @update:open="setDepartmentFormOpen">
      <template #body="{ close }">
        <div class="space-y-4">
          <UFormField label="部门名称">
            <UInput v-model="departmentForm.name" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="部门编号">
              <UInput v-model="departmentForm.code" />
            </UFormField>
            <UFormField label="类型">
              <ModalSelect v-model="departmentForm.type" :items="[{label:'行政部门',value:'administration'},{label:'年级组',value:'grade_group'},{label:'教研组',value:'subject_group'},{label:'学生支持',value:'student_support'},{label:'其他',value:'other'}]" />
            </UFormField>
          </div>
          <UFormField label="上级部门">
            <ModalSelect v-model="departmentForm.parentId" :items="[{label:'无上级部门',value:''}, ...(managedDepartments?.rows || []).filter((d:any)=>d.status==='active').map((d:any)=>({label:d.name,value:d.id}))]" class="w-full" />
          </UFormField>
          <UFormField label="部门负责人">
            <ModalSelect v-model="departmentForm.leaderUserId" :items="[{label:'暂不设置',value:''}, ...(schoolInfo?.teachers || []).filter((t:any)=>t.status==='active').map((t:any)=>({label:t.name,value:t.id}))]" class="w-full" />
          </UFormField>
          <UFormField label="说明">
            <UTextarea v-model="departmentForm.description" :rows="3" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="closeDepartmentForm(close)">取消</UButton>
            <UButton class="flex-1 justify-center" :disabled="!departmentForm.name" :loading="pending" @click="createDepartment">创建部门</UButton>
          </div>
        </div>
      </template>
    </UModal>
    <UModal v-if="showClassForm" :open="showClassForm" title="创建班级" @update:open="setClassFormOpen">
      <template #body="{ close }">
        <div class="space-y-4">
          <UFormField label="班级名称">
            <UInput v-model="classForm.name" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="年级">
              <UInput v-model.number="classForm.grade" type="number" min="1" max="12" />
            </UFormField>
            <UFormField label="登记人数">
              <UInput v-model.number="classForm.studentCount" type="number" min="0" />
            </UFormField>
          </div>
          <UFormField label="负责教师">
            <ModalSelect v-model="classForm.ownerUserId" :items="teacherOptions" class="w-full" />
          </UFormField>
          <UFormField label="挂靠部门">
            <ModalSelect v-model="classForm.departmentId" :items="activeDepartmentOptions" class="w-full" />
          </UFormField>
          <UFormField label="外部编号">
            <UInput v-model="classForm.externalCode" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="closeClassForm(close)">取消</UButton>
            <UButton class="flex-1 justify-center" :disabled="!classForm.name || !classForm.ownerUserId" :loading="pending" @click="createClass">创建班级</UButton>
          </div>
        </div>
      </template>
    </UModal>
    <UModal v-if="showStudentForm" :open="showStudentForm" title="创建学生" @update:open="setStudentFormOpen">
      <template #body="{ close }">
        <div class="space-y-4">
          <UFormField label="姓名">
            <UInput v-model="studentForm.name" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="性别">
              <UInput v-model="studentForm.gender" />
            </UFormField>
            <UFormField label="外部编号">
              <UInput v-model="studentForm.externalRef" />
            </UFormField>
          </div>
          <UFormField label="班级">
            <ModalSelect v-model="studentForm.classId" :items="activeClassOptions" class="w-full" />
          </UFormField>
          <UFormField label="负责教师（未分班时必填）">
            <ModalSelect v-model="studentForm.ownerUserId" :items="teacherOptions" class="w-full" />
          </UFormField>
          <UFormField label="备注">
            <UTextarea v-model="studentForm.notes" :rows="3" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="closeStudentForm(close)">取消</UButton>
            <UButton class="flex-1 justify-center" :disabled="!studentForm.name || (!studentForm.classId && !studentForm.ownerUserId)" :loading="pending" @click="createStudent">创建学生</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal :open="Boolean(accessTarget)" :title="`查看 ${accessTarget?.label || ''} 的档案`" @update:open="value => { if (!value) { accessTarget = null; sensitive = null } }"><template #body><div class="space-y-4"><template v-if="!sensitive"><div class="flex items-center justify-center gap-3 py-12"><UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-emerald-600" /><span class="text-sm text-slate-500">正在加载档案数据...</span></div></template><template v-else><div class="rounded-xl border border-slate-200 bg-white p-4"><div class="flex items-start justify-between"><div><h3 class="text-base font-semibold text-slate-900">{{ sensitive.profile?.name }}</h3><p class="mt-0.5 text-sm text-slate-500">{{ sensitive.profile?.email }}</p></div><div class="flex gap-1.5"><UBadge color="primary" variant="soft" size="sm">{{ sensitive.profile?.role==='teacher'?'教师':'心理专员' }}</UBadge><UBadge :color="accountStatusColor(sensitive.profile?.status)" variant="soft" size="sm">{{ accountStatusLabel(sensitive.profile?.status) }}</UBadge></div></div><div class="mt-2 flex gap-4 text-xs text-slate-400"><span>最近登录 {{ sensitive.profile?.lastLoginAt ? new Date(sensitive.profile.lastLoginAt).toLocaleString('zh-CN') : '—' }}</span><span>创建于 {{ sensitive.profile?.createdAt ? new Date(sensitive.profile.createdAt).toLocaleDateString('zh-CN') : '—' }}</span></div></div><div class="-mx-1 flex gap-0.5 overflow-x-auto border-b border-slate-200 px-1"><button v-for="t in [{id:'overview',label:'概览',n:sensitive.profile?1:0},{id:'assessments',label:'评估',n:sensitive.assessments?.length||0},{id:'conversations',label:'对话',n:sensitive.conversations?.length||0},{id:'cases',label:'个案',n:sensitive.cases?.length||0},{id:'communications',label:'沟通',n:sensitive.communications?.length||0},{id:'plans',label:'方案',n:sensitive.plans?.length||0},{id:'reviews',label:'复盘',n:sensitive.planReviews?.length||0}]" :key="t.id" class="shrink-0 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors" :class="archiveTab===t.id?'border-b-2 border-emerald-600 text-emerald-700 bg-emerald-50/50':'text-slate-500 hover:text-slate-700 hover:bg-slate-50'" @click="archiveTab=t.id">{{ t.label }}<span class="ml-1 opacity-60">{{ t.n }}</span></button></div><div class="max-h-[38vh] overflow-y-auto"><div v-if="archiveTab==='overview'" class="space-y-3 py-2"><div v-if="sensitiveStats" class="grid grid-cols-2 gap-2"><div class="rounded-lg bg-emerald-50 p-2.5"><p class="text-xs text-emerald-700">评估完成率</p><p class="mt-0.5 text-lg font-semibold text-emerald-800">{{ sensitiveStats.assessTotal ? Math.round(sensitiveStats.assessSubmitted/sensitiveStats.assessTotal*100)+'%' : '—' }}</p><p class="text-xs text-emerald-600">{{ sensitiveStats.assessSubmitted }}/{{ sensitiveStats.assessTotal }}</p></div><div class="rounded-lg bg-blue-50 p-2.5"><p class="text-xs text-blue-700">方案进度</p><p class="mt-0.5 text-lg font-semibold text-blue-800">{{ sensitiveStats.plansActive }}</p><p class="text-xs text-blue-600">执行中 · {{ sensitiveStats.plansCompleted }} 已完成</p></div><div class="rounded-lg bg-amber-50 p-2.5"><p class="text-xs text-amber-700">复盘均分</p><p class="mt-0.5 text-lg font-semibold text-amber-800">{{ sensitiveStats.reviewAvg }}</p><p class="text-xs text-amber-600">满分 5.0</p></div><div class="rounded-lg bg-red-50 p-2.5"><p class="text-xs text-red-700">高风险沟通</p><p class="mt-0.5 text-lg font-semibold text-red-800">{{ sensitiveStats.highRiskComms }}</p><p class="text-xs text-red-600">条</p></div></div><div v-for="s in [{key:'assessments',label:'评估记录',items:sensitive.assessments||[],il:(i:any)=>i.assessmentCode||i.module,id:(i:any)=>new Date(i.submittedAt||i.createdAt).toLocaleDateString('zh-CN')},{key:'conversations',label:'AI 对话',items:sensitive.conversations||[],il:(i:any)=>i.title,id:(i:any)=>new Date(i.createdAt).toLocaleDateString('zh-CN')},{key:'cases',label:'学生个案',items:sensitive.cases||[],il:(i:any)=>i.title,id:(i:any)=>new Date(i.createdAt).toLocaleDateString('zh-CN')},{key:'communications',label:'家校沟通',items:sensitive.communications||[],il:(i:any)=>i.summary||'(无摘要)',id:(i:any)=>new Date(i.occurredAt||i.createdAt).toLocaleDateString('zh-CN')},{key:'plans',label:'干预方案',items:sensitive.plans||[],il:(i:any)=>i.title,id:(i:any)=>new Date(i.createdAt).toLocaleDateString('zh-CN')},{key:'reviews',label:'方案复盘',items:sensitive.planReviews||[],il:(i:any)=>i.progressNote,id:(i:any)=>new Date(i.reviewAt).toLocaleDateString('zh-CN')}]" :key="s.key" class="rounded-lg bg-slate-50 p-3"><p class="text-xs font-medium text-slate-500">{{ s.label }} · {{ s.items.length }} 条</p><div v-if="s.items.length" class="mt-2 space-y-1"><div v-for="item in s.items.slice(0,3)" :key="item.id" class="flex items-center justify-between rounded bg-white px-3 py-1.5 text-sm"><span class="truncate text-slate-700">{{ s.il(item) }}</span><span class="ml-2 shrink-0 text-xs text-slate-400">{{ s.id(item) }}</span></div></div><p v-else class="mt-1 text-xs text-slate-400">暂无记录</p></div></div><div v-else-if="archiveTab==='assessments'" class="divide-y divide-slate-100"><div v-if="!sensitive.assessments?.length" class="py-10 text-center text-sm text-slate-400">暂无评估记录</div><div v-for="item in sensitive.assessments" :key="item.id" class="px-1 py-3"><div class="flex items-start justify-between"><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-slate-700">{{ item.assessmentCode }}</p><p class="text-xs text-slate-400">{{ moduleLabel(item.module) }} · {{ item.definitionVersion }}</p><div v-if="item.result" class="mt-2 flex flex-wrap items-center gap-1.5"><UBadge v-if="item.result.level" size="xs" :color="item.result.level==='高危'||item.result.level==='critical'?'error':item.result.level==='关注'||item.result.level==='medium'?'warning':'success'" variant="soft">{{ item.result.level }}</UBadge><span v-if="item.result.reasons?.length" class="text-xs text-slate-500">{{ item.result.reasons.slice(0,2).join('；') }}</span></div><div v-if="item.result?.dimensions" class="mt-1.5 flex flex-wrap gap-1"><span v-for="(v,k) in item.result.dimensions" :key="k" class="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs"><span class="text-slate-500">{{ k }}</span><span class="font-medium text-slate-700">{{ v }}</span></span></div></div><div class="ml-3 flex shrink-0 items-center gap-2"><UBadge size="xs" :color="assessmentStatusColor(item.status)" variant="soft">{{ assessmentStatusLabel(item.status) }}</UBadge><span class="text-xs text-slate-400">{{ item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('zh-CN') : '—' }}</span></div></div></div></div><div v-else-if="archiveTab==='conversations'" class="divide-y divide-slate-100"><div v-if="!sensitive.conversations?.length" class="py-10 text-center text-sm text-slate-400">暂无对话记录</div><div v-for="item in sensitive.conversations" :key="item.id" class="flex items-center justify-between px-1 py-3"><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-slate-700">{{ item.title }}</p></div><div class="ml-3 flex shrink-0 items-center gap-2"><UBadge size="xs" :color="recordStatusColor(item.status)" variant="soft">{{ recordStatusLabel(item.status) }}</UBadge><span class="text-xs text-slate-400">{{ item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : '—' }}</span></div></div></div><div v-else-if="archiveTab==='cases'" class="divide-y divide-slate-100"><div v-if="!sensitive.cases?.length" class="py-10 text-center text-sm text-slate-400">暂无个案记录</div><div v-for="item in sensitive.cases" :key="item.id" class="px-1 py-3"><div class="flex items-start justify-between"><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-slate-700">{{ item.title }}</p><p v-if="item.description" class="mt-1 line-clamp-2 text-xs text-slate-500">{{ item.description }}</p><div class="mt-1.5 flex flex-wrap items-center gap-1.5"><UBadge size="xs" variant="soft" color="primary">{{ moduleLabel(item.module) }}</UBadge><span v-for="(v,k) in item.classification||{}" :key="k" class="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{{ k }}: {{ v }}</span></div></div><div class="ml-3 shrink-0 text-right"><UBadge size="xs" variant="soft" :color="planStatusColor(item.status)">{{ planStatusLabel(item.status) }}</UBadge><p class="mt-1 text-xs text-slate-400">{{ item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : '—' }}</p></div></div></div></div><div v-else-if="archiveTab==='communications'" class="divide-y divide-slate-100"><div v-if="!sensitive.communications?.length" class="py-10 text-center text-sm text-slate-400">暂无沟通记录</div><div v-for="item in sensitive.communications" :key="item.id" class="px-1 py-3"><div class="flex items-start justify-between"><div class="min-w-0 flex-1"><p v-if="item.summary" class="line-clamp-2 text-sm text-slate-700">{{ item.summary }}</p><p v-else class="text-sm text-slate-400">(无摘要)</p><div class="mt-1.5 flex flex-wrap items-center gap-1.5"><UBadge v-if="item.parentType" size="xs" variant="soft" color="primary">{{ item.parentType==='father'?'父亲':item.parentType==='mother'?'母亲':item.parentType==='guardian'?'监护人':'其他' }}</UBadge><UBadge v-if="item.attitudeType" size="xs" variant="soft" :color="item.attitudeType==='cooperative'?'success':item.attitudeType==='resistant'?'error':'warning'">{{ item.attitudeType==='cooperative'?'合作':item.attitudeType==='neutral'?'中立':'抵触' }}</UBadge><span v-if="item.containerLevel" class="text-xs text-slate-400">容纳度 <span class="font-medium" :class="item.containerLevel>=4?'text-emerald-600':item.containerLevel>=2?'text-amber-600':'text-red-600'">{{ item.containerLevel }}/5</span></span></div></div><div class="ml-3 flex shrink-0 items-center gap-1.5"><span v-if="item.riskLevel" class="text-xs" :class="item.riskLevel==='high'?'text-red-600':item.riskLevel==='medium'?'text-amber-600':'text-slate-400'">{{ item.riskLevel==='high'?'高风险':item.riskLevel==='medium'?'中风险':'低风险' }}</span><span class="text-xs text-slate-400">{{ item.occurredAt ? new Date(item.occurredAt).toLocaleDateString('zh-CN') : '—' }}</span></div></div></div></div><div v-else-if="archiveTab==='plans'" class="divide-y divide-slate-100"><div v-if="!sensitive.plans?.length" class="py-10 text-center text-sm text-slate-400">暂无方案记录</div><div v-for="item in sensitive.plans" :key="item.id" class="px-1 py-3"><div class="flex items-start justify-between"><div class="min-w-0 flex-1"><p class="text-sm font-medium text-slate-700">{{ item.title }}</p><p v-if="item.summary" class="mt-1 line-clamp-2 text-xs text-slate-500">{{ item.summary }}</p><div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-400"><span v-if="item.actions?.length">{{ item.actions.length }} 项行动</span><span v-if="item.tools?.length">{{ item.tools.length }} 个工具</span><span v-if="item.nextReviewAt">下次复盘 {{ new Date(item.nextReviewAt).toLocaleDateString('zh-CN') }}</span><span v-if="item.completedAt">完成于 {{ new Date(item.completedAt).toLocaleDateString('zh-CN') }}</span></div></div><div class="ml-3 shrink-0 text-right"><UBadge size="xs" :color="planStatusColor(item.status)" variant="soft">{{ planStatusLabel(item.status) }}</UBadge><p class="mt-1 text-xs text-slate-400">{{ item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : '—' }}</p></div></div></div></div><div v-else-if="archiveTab==='reviews'" class="divide-y divide-slate-100"><div v-if="!sensitive.planReviews?.length" class="py-10 text-center text-sm text-slate-400">暂无复盘记录</div><div v-for="item in sensitive.planReviews" :key="item.id" class="px-1 py-3"><div class="flex items-start justify-between"><div class="min-w-0 flex-1"><p class="text-sm text-slate-700">{{ item.progressNote }}</p><p class="mt-0.5 text-xs text-slate-500">下一步: {{ item.nextAction }}</p></div><div class="ml-3 shrink-0 text-right"><div class="flex items-center justify-end gap-0.5"><span v-for="s in 5" :key="s" class="size-2.5 rounded-full" :class="s<=item.effectScore?'bg-emerald-500':'bg-slate-200'" /></div><p class="mt-0.5 text-xs"><span class="font-semibold" :class="item.effectScore>=4?'text-emerald-600':item.effectScore>=2?'text-amber-600':'text-red-600'">{{ item.effectScore }}/5</span></p><p class="text-xs text-slate-400">{{ item.reviewAt ? new Date(item.reviewAt).toLocaleDateString('zh-CN') : '—' }}</p></div></div></div></div></div><div class="sensitive-watermark"><span v-for="i in 20" :key="i">{{ watermark }}</span></div></template></div></template></UModal>
  </div>
</template>

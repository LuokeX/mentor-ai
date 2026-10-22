<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import type { ManagedListResult } from '~~/shared/management'

interface UserRow {
  id: string
  schoolId: string
  schoolName?: string
  name: string
  phone: string
  role: string
  /** 账号持有的全部角色（含兼任）；列表接口返回，缺省时按主角色处理 */
  roles?: string[]
  /** 角色级范围：年级主任的所辖年级从这里回显 */
  roleScopes?: Record<string, { grade?: number, grades?: number[] }>
  status: 'active' | 'invited' | 'disabled'
  activatedAt: string | null
  lastLoginAt: string | null
  employeeNo: string | null
  gender: string | null
  teachingGrades: number[]
  subject: string | null
  isClassTeacher: boolean
  classTeacherYears: number | null
  title: string | null
  hiredAt: string | null
  selfStatusLevel: string | null
  overrides: Record<string, string>
  updatedAt: string
  _capabilities?: string[]
}
interface OptionRow { id: string; name: string; role?: string }
interface CreateResult {
  id: string
  generatedPassword?: string
}

const props = withDefaults(defineProps<{
  title: string
  description?: string
  listEndpoint: string
  showSchool?: boolean
  canInvite?: boolean
  inviteSchoolId?: string
  extraQuery?: () => Record<string, string | undefined>
}>(), { showSchool: false, canInvite: false })

const list = useManagedList<UserRow>(props.listEndpoint, props.extraQuery ? { extraQuery: props.extraQuery } : undefined)
const columns = computed(() => [
  ...(props.showSchool ? [{ key: 'schoolName', label: '学校' }] : []),
  { key: 'name', label: '姓名', sortable: true },
  { key: 'phone', label: '手机号', sortable: true },
  { key: 'role', label: '角色', sortable: true },
  { key: 'selfStatusLevel', label: '自我状态', sortable: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'lastLoginAt', label: '最近登录', sortable: true, mobileHidden: true },
  { key: 'actions', label: '操作' },
])
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '正常', value: 'active' },
  { label: '待激活', value: 'invited' },
  { label: '已停用', value: 'disabled' },
]
const roleOptions = [
  { label: '教师', value: 'teacher' },
  { label: '心理专员', value: 'psychologist' },
  { label: '德育主任', value: 'moral_education_director' },
  { label: '年级主任', value: 'grade_director' },
]
/** 账号角色中文标签：覆盖全部角色，避免列表出现英文角色码（学校管理员/学部校长由平台侧单独开通） */
const roleLabels: Record<string, string> = {
  teacher: '教师',
  psychologist: '心理专员',
  school_admin: '学校管理员',
  division_principal: '学部校长',
  moral_education_director: '德育主任',
  grade_director: '年级主任',
  platform_admin: '平台管理员',
}
/** 有业务数据归属的角色：停用必须先做业务移交，角色也只能在未激活时调整 */
const businessRoles = ['teacher', 'psychologist']
/** 只读数据驾驶舱角色：没有业务数据，停用不需要移交 */
const dashboardRoles = ['division_principal', 'moral_education_director', 'grade_director']
/** 所辖年级下拉（1-12），年级主任必填；看板按它收窄范围 */
const scopeGradeItems = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']
  .map((label, index) => ({ label: `${label}年级`, value: index + 1 }))
function rolesOfRow(row: { role: string, roles?: string[] } | null | undefined) {
  if (!row) return []
  return row.roles?.length ? row.roles : [row.role]
}
function roleLabelOf(row: { role: string, roles?: string[] } | null | undefined) {
  return rolesOfRow(row).map(role => roleLabels[role] || role).join(' / ')
}
function hasBusinessRoleOfRow(row: { role: string, roles?: string[] } | null | undefined) {
  return rolesOfRow(row).some(role => businessRoles.includes(role))
}
const statusLabels: Record<string, string> = { active: '正常', invited: '待激活', disabled: '已停用' }
const genderOptions = [
  { label: '未知', value: '__none__' }, { label: '男', value: '男' }, { label: '女', value: '女' },
]
const titleOptions = [
  { label: '无/其他', value: '__none__' }, { label: '正高级', value: '正高级' }, { label: '副高级', value: '副高级' },
  { label: '一级', value: '一级' }, { label: '二级', value: '二级' },
]
const gradeItems = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].map(g => `${g} 年级`)
/**
 * 自我状态等级修正：未操作不发送；显式「改回按评估结果」清除；选择具体等级写入。
 * 评估五档等级中只有「需转介」对应红线（会生成转介工单），其余等级不转介，故只在该项标注。
 */
const selfStatusOptions = [
  { label: '（当前按评估结果）', value: '__auto__' },
  { label: '改回按评估结果', value: '__clear__' },
  { label: '需转介（红线·对应转介工单）', value: '需转介' }, { label: '需关注', value: '需关注' }, { label: '关注', value: '关注' }, { label: '良好', value: '良好' },
]

const teacherOptions = ref<{ label: string; value: string }[]>([])
const psychologistOptions = ref<{ label: string; value: string }[]>([])

const drawerOpen = ref(false)
const editing = ref<UserRow | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({
  name: '', phone: '', role: 'teacher' as string, reactivate: false,
  password: '',
  employeeNo: '', gender: '__none__', teachingGrades: [] as string[],
  subject: '', isClassTeacher: false, classTeacherYears: '', hiredAt: '', title: '__none__', certNote: '',
  selfStatusLevel: '__auto__',
  /** 所辖年级（年级主任必填，可多选） */
  scopeGrades: [] as number[],
})
const createdResult = ref<{ id: string, name: string, role: string, generatedPassword?: string } | null>(null)
const copied = ref(false)

/** 表单里选的是只读看板角色时不展示教师专属字段（任教年级/学科/班主任/自我状态） */
const formIsDashboardRole = computed(() => dashboardRoles.includes(form.role))
/** 已激活且带业务数据的账号不允许改角色（服务端同规则），其余情况可改 */
const roleLocked = computed(() => Boolean(editing.value && editing.value.status !== 'invited' && hasBusinessRoleOfRow(editing.value)))

const disableTarget = ref<UserRow | null>(null)
const disableForm = reactive({ toUserId: '', newPsychologistId: '__none__', reason: '' })
const deleteTarget = ref<UserRow | null>(null)
/** 停用是否需要先移交业务：教师/心理专员需要，只读看板角色不需要 */
const disableNeedsTransfer = computed(() => hasBusinessRoleOfRow(disableTarget.value))

function openCreate() {
  editing.value = null
  Object.assign(form, {
    name: '', phone: '', role: 'teacher', reactivate: false,
    password: '',
    employeeNo: '', gender: '__none__', teachingGrades: [],
    subject: '', isClassTeacher: false, classTeacherYears: '', hiredAt: '', title: '__none__', certNote: '', selfStatusLevel: '__auto__',
    scopeGrades: [],
  })
  formError.value = ''
  drawerOpen.value = true
}

/** 行内没有编辑能力（学校管理员/平台管理员/学部校长账号）时不打开编辑抽屉 */
function openRow(row: UserRow) {
  if (row._capabilities && !row._capabilities.includes('edit')) return
  openEdit(row)
}

function openEdit(rowOrId: UserRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  editing.value = row
  Object.assign(form, {
    name: row.name, phone: row.phone, role: row.role, reactivate: false,
    password: '',
    employeeNo: row.employeeNo || '', gender: row.gender || '__none__',
    teachingGrades: row.teachingGrades?.map(g => `${g} 年级`) || [],
    subject: row.subject || '', isClassTeacher: row.isClassTeacher,
    classTeacherYears: row.classTeacherYears != null ? String(row.classTeacherYears) : '',
    hiredAt: row.hiredAt ? row.hiredAt.slice(0, 10) : '', title: row.title || '__none__',
    certNote: '', selfStatusLevel: row.overrides?.selfStatusLevel || '__auto__',
    scopeGrades: row.roleScopes?.grade_director?.grades?.length
      ? [...row.roleScopes.grade_director.grades]
      : row.roleScopes?.grade_director?.grade ? [row.roleScopes.grade_director.grade] : [],
  })
  formError.value = ''
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
}

function opQuery(row: UserRow) {
  return { schoolId: row.schoolId }
}

/** 表单校验 + 请求体：创建与编辑共用（编辑时留空的加密字段不发送） */
function buildBody(): Record<string, unknown> | null {
  if (form.name.trim().length < 2 || !/^1[3-9]\d{9}$/.test(form.phone)) {
    formError.value = '请填写有效的姓名和手机号'
    return null
  }
  if (form.role === 'grade_director' && !form.scopeGrades.length) {
    formError.value = '请选择年级主任的所辖年级（可多选）'
    return null
  }
  const body: Record<string, unknown> = {
    name: form.name,
    phone: form.phone,
    role: form.role,
    employeeNo: form.employeeNo || undefined,
    gender: form.gender === '__none__' ? null : form.gender,
    teachingGrades: form.teachingGrades.map(g => Number(g.replace(' 年级', ''))),
    subject: form.subject || undefined,
    isClassTeacher: form.isClassTeacher,
    classTeacherYears: form.classTeacherYears === '' ? undefined : Number(form.classTeacherYears),
    hiredAt: form.hiredAt || undefined,
    title: form.title === '__none__' ? null : form.title,
  }
  // 所辖年级（角色级 scope）：仅年级主任写入，可多选，看板按它收窄范围
  if (form.role === 'grade_director') body.scopeGrades = form.scopeGrades
  // 电话/心理资质备注是加密字段：编辑时留空表示不修改
  if (form.phone) body.phone = form.phone
  if (form.certNote) body.certNote = form.certNote
  // 自我状态三态：未操作不发送；显式“改回按评估结果”清除；选择具体等级写入
  if (form.selfStatusLevel === '__clear__') body.overrides = { selfStatusLevel: '' }
  else if (form.selfStatusLevel !== '__auto__') body.overrides = { selfStatusLevel: form.selfStatusLevel }
  return body
}

async function saveUser() {
  const target = editing.value
  if (!target) return
  const body = buildBody()
  if (!body) return
  if (form.password) body.password = form.password
  if (target.status === 'disabled' && form.reactivate) body.status = 'active'
  saving.value = true
  formError.value = ''
  try {
    await $fetch(`/api/v1/school-admin/users/${target.id}`, {
      method: 'PATCH',
      query: { ...opQuery(target), expectedUpdatedAt: target.updatedAt },
      body,
    })
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { statusCode?: number; data?: { message?: string } }
    formError.value = response.statusCode === 409
      ? response.data?.message || '账号状态已变化，请刷新后重试'
      : response.data?.message || '账号保存失败'
  } finally {
    saving.value = false
  }
}

/** 直接创建账号（可选初始密码，留空由系统生成并一次性展示） */
async function createUser() {
  if (!props.inviteSchoolId) {
    formError.value = '缺少目标学校，无法创建账号'
    return
  }
  const body = buildBody()
  if (!body) return
  body.password = form.password || undefined
  saving.value = true
  formError.value = ''
  try {
    const result = await $fetch<CreateResult>('/api/v1/school-admin/users', {
      method: 'POST',
      query: { schoolId: props.inviteSchoolId },
      body,
    })
    createdResult.value = { id: result.id, name: form.name, role: form.role, generatedPassword: result.generatedPassword }
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '账号创建失败'
  } finally {
    saving.value = false
  }
}

/**
 * 激活待激活（invited）账号：建号接口把同名同手机号的存量邀请直接激活并重置密码，
 * 因此这里复用创建接口，把生成的初始密码一次性展示给平台管理员。
 */
async function activateInvited(row: UserRow) {
  if (row.status !== 'invited') return
  const scopeGrades = row.roleScopes?.grade_director?.grades?.length
    ? row.roleScopes.grade_director.grades
    : row.roleScopes?.grade_director?.grade ? [row.roleScopes.grade_director.grade] : []
  if (row.role === 'grade_director' && !scopeGrades.length) {
    openEdit(row)
    formError.value = '请先选择该年级主任的所辖年级，保存后再激活账号'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    const result = await $fetch<CreateResult>('/api/v1/school-admin/users', {
      method: 'POST',
      query: opQuery(row),
      body: {
        name: row.name,
        phone: row.phone,
        role: row.role,
        ...(scopeGrades.length ? { scopeGrades } : {}),
      },
    })
    createdResult.value = { id: result.id, name: row.name, role: row.role, generatedPassword: result.generatedPassword }
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '账号激活失败'
  } finally {
    saving.value = false
  }
}

function openDisable(id: string) {
  const row = list.rows.value.find(item => item.id === id)
  if (!row) return
  disableTarget.value = row
  Object.assign(disableForm, { toUserId: '', newPsychologistId: '__none__', reason: '' })
  formError.value = ''
  // 只读看板角色没有业务数据，不需要拉接收人选项
  if (hasBusinessRoleOfRow(row)) void loadTransferOptions(row)
}

async function loadTransferOptions(row: UserRow) {
  teacherOptions.value = []
  psychologistOptions.value = []
  const [teachers, psychologists] = await Promise.all([
    $fetch<ManagedListResult<OptionRow>>('/api/v1/school-admin/teachers', {
      query: { schoolId: row.schoolId, page: 1, pageSize: 100, status: 'active' },
    }),
    $fetch<ManagedListResult<OptionRow>>('/api/v1/school-admin/users', {
      query: { schoolId: row.schoolId, role: 'psychologist', status: 'active', page: 1, pageSize: 100 },
    }),
  ])
  teacherOptions.value = (teachers.rows || []).map(item => ({ label: item.name, value: item.id }))
  psychologistOptions.value = (psychologists.rows || []).map(item => ({ label: item.name, value: item.id }))
}

function closeDisable() {
  disableTarget.value = null
}

// ===== 角色维护（平台侧补位入口）=====
// 学校级账号管理只服务教师/心理专员与两个只读看板角色，且语义是「换一个角色」；
// 学校管理员、学部校长与兼任（多角色）账号在这里统一维护，换角色时一并完成业务数据移交。
const ROLE_MAINTENANCE_OPTIONS = ['teacher', 'psychologist', 'school_admin', 'division_principal', 'moral_education_director', 'grade_director']
  .map(value => ({ label: roleLabels[value] ?? value, value }))

const roleTarget = ref<UserRow | null>(null)
const roleError = ref('')
const roleSaving = ref(false)
const roleForm = reactive({
  roles: [] as string[],
  primaryRole: '',
  scopeGrades: [] as number[],
  transferToUserId: '',
  newPsychologistId: '__none__',
  reason: '',
})

/** 目标账号当前持有的角色（缺省按主角色）。 */
const roleTargetRoles = computed(() => rolesOfRow(roleTarget.value))
/** 新集合不再含业务角色时，若账号当前持有业务角色，换角色必须指定业务接收教师。 */
const roleNeedsTransfer = computed(() => roleForm.roles.length > 0
  && !roleForm.roles.some(role => businessRoles.includes(role))
  && roleTargetRoles.value.some(role => businessRoles.includes(role)))
/** 去掉心理专员角色时需要指定未结转介的承接人。 */
const roleDropsPsychologist = computed(() => roleTargetRoles.value.includes('psychologist')
  && roleForm.roles.length > 0 && !roleForm.roles.includes('psychologist'))
const rolePrimaryOptions = computed(() => ROLE_MAINTENANCE_OPTIONS.filter(option => roleForm.roles.includes(option.value)))
/** 主角色必须落在集合内：勾选变化后自动收敛。 */
function syncRolePrimary() {
  if (!roleForm.roles.includes(roleForm.primaryRole)) roleForm.primaryRole = roleForm.roles[0] ?? ''
}

function openRoleMaintenance(row: UserRow) {
  roleTarget.value = row
  roleForm.roles = [...rolesOfRow(row)]
  roleForm.primaryRole = row.role
  roleForm.scopeGrades = row.roleScopes?.grade_director?.grades?.length
    ? [...row.roleScopes.grade_director.grades]
    : row.roleScopes?.grade_director?.grade ? [row.roleScopes.grade_director.grade] : []
  roleForm.transferToUserId = ''
  roleForm.newPsychologistId = '__none__'
  roleForm.reason = ''
  roleError.value = ''
  // 需要移交或需要承接心理转介时，先拉好本校的接收人选项
  if (roleTargetRoles.value.some(role => businessRoles.includes(role))) void loadTransferOptions(row)
}

function closeRoleMaintenance() {
  roleTarget.value = null
}

async function saveRoles() {
  const row = roleTarget.value
  if (!row) return
  if (!roleForm.roles.length) { roleError.value = '请至少保留一个角色'; return }
  if (!roleForm.roles.includes(roleForm.primaryRole)) { roleError.value = '主角色必须包含在角色集合中'; return }
  if (roleForm.roles.includes('grade_director') && !roleForm.scopeGrades.length) { roleError.value = '持有年级主任角色时必须填写所辖年级（可多选）'; return }
  if (roleNeedsTransfer.value && !roleForm.transferToUserId) { roleError.value = '该账号名下有业务数据，请选择业务接收教师'; return }
  if (roleForm.reason.trim().length < 10) { roleError.value = '请填写至少 10 个字符的操作事由'; return }
  roleSaving.value = true
  roleError.value = ''
  try {
    await $fetch(`/api/v1/platform-admin/users/${row.id}/roles`, {
      method: 'PATCH',
      body: {
        roles: roleForm.roles,
        primaryRole: roleForm.primaryRole,
        scopes: roleForm.roles.includes('grade_director') ? { grade_director: { grades: roleForm.scopeGrades } } : undefined,
        transferToUserId: roleNeedsTransfer.value && roleForm.transferToUserId ? roleForm.transferToUserId : undefined,
        newPsychologistId: roleDropsPsychologist.value && roleForm.newPsychologistId !== '__none__' ? roleForm.newPsychologistId : undefined,
        reason: roleForm.reason.trim(),
      },
    })
    roleTarget.value = null
    await list.refresh()
  } catch (error) {
    roleError.value = (error as { data?: { message?: string } }).data?.message || '角色维护失败，请稍后重试'
  } finally {
    roleSaving.value = false
  }
}

async function transferAndDisable() {
  const needsTransfer = disableNeedsTransfer.value
  if (!disableTarget.value || disableForm.reason.trim().length < 10 || (needsTransfer && !disableForm.toUserId)) {
    formError.value = needsTransfer
      ? '请选择业务接收教师，并填写至少 10 个字符的停用事由'
      : '请填写至少 10 个字符的停用事由'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    await $fetch(`/api/v1/school-admin/users/${disableTarget.value.id}/transfer-and-disable`, {
      method: 'POST',
      query: opQuery(disableTarget.value),
      body: {
        // 只读看板角色没有业务数据：不传接收教师，服务端跳过业务移交
        ...(needsTransfer ? { toUserId: disableForm.toUserId } : {}),
        newPsychologistId: disableForm.newPsychologistId === '__none__' ? undefined : disableForm.newPsychologistId,
        reason: disableForm.reason,
      },
    })
    disableTarget.value = null
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '业务移交和账号停用失败'
  } finally {
    saving.value = false
  }
}

async function deleteInvitation(reason: string) {
  if (!deleteTarget.value) return
  saving.value = true
  formError.value = ''
  try {
    await $fetch(`/api/v1/school-admin/users/${deleteTarget.value.id}`, { method: 'DELETE', query: opQuery(deleteTarget.value) })
    deleteTarget.value = null
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || `邀请删除失败：${reason}`
  } finally {
    saving.value = false
  }
}

async function copyGeneratedPassword() {
  if (!import.meta.client || !createdResult.value?.generatedPassword) return
  await navigator.clipboard.writeText(createdResult.value.generatedPassword)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <ManagementPage :title="title" :description="description" :can-create="canInvite" create-label="添加账号" @create="openCreate">
    <TableToolbar :search-value="list.q.value" :status-filter="list.statusFilter.value" :status-options="statusOptions" search-placeholder="搜索姓名或手机号..." :loading="list.loading.value" @search="list.onSearch" @update:status-filter="list.onStatusChange" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange" @row-click="openRow">
      <template #role-data="{ row }">{{ roleLabelOf(row) }}</template>
      <template #selfStatusLevel-data="{ row }">
        <UBadge
          v-if="row.selfStatusLevel"
          :color="row.selfStatusLevel === '需转介' ? 'error' : row.selfStatusLevel === '需关注' ? 'warning' : row.selfStatusLevel === '关注' ? 'info' : 'success'"
          variant="subtle"
          :title="row.selfStatusLevel === '需转介' ? '转介等级：评估命中红线时已生成安全事件与转介工单，由心理专员处置' : undefined"
        >{{ row.selfStatusLevel }}</UBadge>
        <span v-else class="text-xs text-slate-400">未评估</span>
      </template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : row.status === 'invited' ? 'info' : 'neutral'" variant="subtle">{{ statusLabels[row.status] || row.status }}</UBadge></template>
      <template #lastLoginAt-data="{ value }">{{ value ? formatDateTime(value) : '从未登录' }}</template>
      <template #actions-data="{ row }">
        <div class="flex items-center gap-1">
          <RowActions
            :capabilities="row._capabilities"
            :row-id="row.id"
            @view="openEdit"
            @edit="openEdit"
            @disable="openDisable"
            @delete="deleteTarget = row"
          />
          <UButton v-if="row.status === 'invited'" size="xs" variant="soft" color="primary" @click="activateInvited(row)">激活账号</UButton>
          <UButton
            v-if="!rolesOfRow(row).includes('platform_admin')"
            size="xs"
            variant="soft"
            color="neutral"
            @click="openRoleMaintenance(row)"
          >
            角色维护
          </UButton>
        </div>
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <EntityFormDrawer :open="drawerOpen" :title="editing ? '编辑账号' : '添加账号'" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="editing ? saveUser() : createUser()">
        <UFormField label="姓名" required><UInput v-model="form.name" class="w-full" /></UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="手机号" required><UInput v-model="form.phone" inputmode="numeric" maxlength="11" class="w-full" /></UFormField>
          <UFormField label="工号"><UInput v-model="form.employeeNo" class="w-full" /></UFormField>
          <UFormField :label="editing ? '重置密码（选填）' : '初始密码（选填）'" :hint="editing ? '留空表示不修改当前密码' : '留空则系统自动生成 16 位随机密码，创建成功后一次性展示'">
            <UInput v-model="form.password" type="password" minlength="8" maxlength="200" autocomplete="new-password" class="w-full" />
          </UFormField>
          <UFormField label="角色" required><USelect v-model="form.role" :items="roleOptions" :disabled="roleLocked" class="w-full" /></UFormField>
          <UFormField v-if="form.role === 'grade_director'" label="所辖年级" required hint="数据驾驶舱按所辖年级收窄范围，可多选">
            <USelectMenu v-model="form.scopeGrades" :items="scopeGradeItems" multiple value-key="value" placeholder="请选择年级（可多选）" class="w-full" />
          </UFormField>
          <UFormField label="性别"><USelect v-model="form.gender" :items="genderOptions" class="w-full" /></UFormField>
          <UFormField v-if="!formIsDashboardRole" label="任教年级"><USelectMenu v-model="form.teachingGrades" multiple :items="gradeItems" class="w-full" /></UFormField>
          <UFormField v-if="!formIsDashboardRole" label="任教学科"><UInput v-model="form.subject" placeholder="如：语文" class="w-full" /></UFormField>
          <UFormField label="职称"><USelect v-model="form.title" :items="titleOptions" class="w-full" /></UFormField>
          <UFormField label="入职时间"><UInput v-model="form.hiredAt" type="date" class="w-full" /></UFormField>
          <UFormField v-if="!formIsDashboardRole" label="是否班主任"><UCheckbox v-model="form.isClassTeacher" label="当前承担班主任工作" /></UFormField>
          <UFormField v-if="!formIsDashboardRole" label="班主任年限（年）"><UInput v-model="form.classTeacherYears" type="number" min="0" max="60" placeholder="如：5" class="w-full" /></UFormField>
        </div>
        <UFormField v-if="editing?.role === 'psychologist'" :label="editing ? '更新资质说明（留空表示不修改）' : '心理资质说明'">
          <UTextarea v-model="form.certNote" :rows="2" placeholder="如：国家二级心理咨询师" class="w-full" />
        </UFormField>
        <UCheckbox v-if="editing?.status === 'disabled'" v-model="form.reactivate" label="重新启用该账号" />
        <div v-if="editing && !formIsDashboardRole" class="rounded-lg bg-amber-50/60 p-3">
          <UFormField label="自我状态等级（手动修正）" hint="按最近一次自我成长评估展示；手动指定后将在下次评估前覆盖显示">
            <USelect v-model="form.selfStatusLevel" :items="selfStatusOptions" class="w-full" />
          </UFormField>
          <p class="mt-2 text-xs leading-relaxed text-amber-800">
            只有「需转介」会到转介：评估命中红线时中断并展示转介指引，同时生成安全事件与转介工单、通知心理专员。评估判出的其他等级（状态良好 / 轻度关注 / 明显消耗 / 重度风险）都不转介；这里手动修正只覆盖展示等级，不会生成或关闭转介工单。
          </p>
        </div>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" @click="closeDrawer">取消</UButton><UButton type="submit" :loading="saving">{{ editing ? '保存' : '添加账号' }}</UButton></div>
      </form>
    </EntityFormDrawer>

    <UModal :open="Boolean(createdResult)" @update:open="value => { if (!value) createdResult = null }">
      <template #header><h3 class="text-lg font-semibold">账号已创建</h3></template>
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-gray-600">账号 <strong>{{ createdResult?.name }}</strong>（{{ roleLabels[createdResult?.role || ''] || createdResult?.role }}）已创建并可直接登录。</p>
          <div v-if="createdResult?.generatedPassword" class="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p class="text-sm font-medium text-amber-800">系统生成的初始密码仅展示一次，关闭后不再显示，请尽快复制并通过校内安全渠道转交。</p>
            <code class="mt-2 block break-all rounded bg-white px-3 py-2 font-mono text-sm">{{ createdResult.generatedPassword }}</code>
            <UButton size="sm" icon="i-lucide-copy" variant="outline" class="mt-2" @click="copyGeneratedPassword">{{ copied ? '已复制' : '复制密码' }}</UButton>
          </div>
          <p v-else class="text-sm text-gray-600">已使用管理员设置的初始密码，可直接登录。</p>
        </div>
      </template>
    </UModal>

    <UModal :open="Boolean(disableTarget)" @update:open="value => { if (!value) disableTarget = null }">
      <template #header><h3 class="text-lg font-semibold">{{ disableNeedsTransfer ? '移交业务并停用账号' : '停用账号' }}</h3></template>
      <template #body>
        <div class="space-y-4">
          <p v-if="disableNeedsTransfer" class="text-sm text-gray-600">将 {{ disableTarget?.name }} 的全部业务责任链移交后，撤销其登录会话并停用账号。</p>
          <p v-else class="text-sm text-gray-600">{{ disableTarget?.name }} 是只读数据驾驶舱账号（{{ roleLabelOf(disableTarget) }}），没有业务数据需要移交；确认后撤销其登录会话并停用账号。</p>
          <UFormField v-if="disableNeedsTransfer" label="业务接收教师" required><USelect v-model="disableForm.toUserId" :items="teacherOptions" class="w-full" /></UFormField>
          <UFormField v-if="disableTarget?.role === 'psychologist'" label="未结转介接收心理专员"><USelect v-model="disableForm.newPsychologistId" :items="[{ label: '无未结转介', value: '__none__' }, ...psychologistOptions]" class="w-full" /></UFormField>
          <UFormField label="操作事由" required><UTextarea v-model="disableForm.reason" :rows="3" placeholder="至少 10 个字符" class="w-full" /></UFormField>
          <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        </div>
      </template>
      <template #footer><div class="flex justify-end gap-2"><UButton variant="outline" @click="closeDisable">取消</UButton><UButton color="error" :loading="saving" @click="transferAndDisable">{{ disableNeedsTransfer ? '确认移交并停用' : '确认停用' }}</UButton></div></template>
    </UModal>

    <UModal :open="Boolean(roleTarget)" @update:open="value => { if (!value) closeRoleMaintenance() }">
      <template #header><h3 class="text-lg font-semibold">角色维护</h3></template>
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-600">
            账号 <strong>{{ roleTarget?.name }}</strong>（{{ roleTarget?.phone }}）
            当前角色：{{ roleLabelOf(roleTarget) }}。此入口用于给学部校长等账号加兼任角色、修复角色配置，
            换角色时若账号名下有业务数据会一并完成移交。
          </p>
          <UFormField label="角色集合（至少一个，可多选）" required>
            <div class="flex flex-wrap gap-x-4 gap-y-1.5">
              <label v-for="option in ROLE_MAINTENANCE_OPTIONS" :key="option.value" class="flex items-center gap-1.5 text-sm text-gray-700">
                <input v-model="roleForm.roles" type="checkbox" :value="option.value" class="size-3.5 rounded border-gray-300" @change="syncRolePrimary">
                {{ option.label }}
              </label>
            </div>
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="主角色" required hint="登录后的缺省落地身份">
              <USelect v-model="roleForm.primaryRole" :items="rolePrimaryOptions" class="w-full" />
            </UFormField>
            <UFormField v-if="roleForm.roles.includes('grade_director')" label="所辖年级" required hint="数据驾驶舱按所辖年级收窄范围，可多选">
              <USelectMenu v-model="roleForm.scopeGrades" :items="scopeGradeItems" multiple value-key="value" placeholder="请选择年级（可多选）" class="w-full" />
            </UFormField>
          </div>
          <UFormField v-if="roleNeedsTransfer" label="业务接收教师" required hint="该账号名下有班级/学生/方案等业务数据，换角色需要一并移交">
            <USelect v-model="roleForm.transferToUserId" :items="teacherOptions" class="w-full" />
          </UFormField>
          <UFormField v-if="roleDropsPsychologist" label="未结转介接收心理专员">
            <USelect v-model="roleForm.newPsychologistId" :items="[{ label: '无未结转介', value: '__none__' }, ...psychologistOptions]" class="w-full" />
          </UFormField>
          <UFormField label="操作事由" required><UTextarea v-model="roleForm.reason" :rows="2" placeholder="至少 10 个字符，例如：校方申请校长兼任教师身份使用 AI 助手" class="w-full" /></UFormField>
          <p v-if="roleError" class="text-sm text-red-600">{{ roleError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="outline" @click="closeRoleMaintenance">取消</UButton>
          <UButton color="primary" :loading="roleSaving" @click="saveRoles">保存角色</UButton>
        </div>
      </template>
    </UModal>

    <LifecycleDialog
      :open="Boolean(deleteTarget)"
      action="删除未激活邀请"
      :target-name="deleteTarget?.name"
      confirm-label="确认删除"
      :reason-required="false"
      :loading="saving"
      @close="deleteTarget = null"
      @confirm="deleteInvitation"
    />
  </ManagementPage>
</template>
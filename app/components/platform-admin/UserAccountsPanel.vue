<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import type { ManagedListResult } from '~~/shared/management'

interface UserRow {
  id: string
  schoolId: string
  schoolName?: string
  name: string
  phone: string
  role: 'teacher' | 'psychologist'
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
}
interface OptionRow { id: string; name: string; role?: string }
interface InvitationResult {
  activationToken: string
  expiresAt: string
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
]
const roleLabels: Record<string, string> = { teacher: '教师', psychologist: '心理专员' }
const statusLabels: Record<string, string> = { active: '正常', invited: '待激活', disabled: '已停用' }
const genderOptions = [
  { label: '未知', value: '__none__' }, { label: '男', value: '男' }, { label: '女', value: '女' },
]
const titleOptions = [
  { label: '无/其他', value: '__none__' }, { label: '正高级', value: '正高级' }, { label: '副高级', value: '副高级' },
  { label: '一级', value: '一级' }, { label: '二级', value: '二级' },
]
const gradeItems = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].map(g => `${g} 年级`)
const selfStatusOptions = [
  { label: '（当前按评估结果）', value: '__auto__' },
  { label: '改回按评估结果', value: '__clear__' },
  { label: '需转介', value: '需转介' }, { label: '需关注', value: '需关注' }, { label: '关注', value: '关注' }, { label: '良好', value: '良好' },
]

const teacherOptions = ref<{ label: string; value: string }[]>([])
const psychologistOptions = ref<{ label: string; value: string }[]>([])

const drawerOpen = ref(false)
const editing = ref<UserRow | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({
  name: '', phone: '', role: 'teacher' as 'teacher' | 'psychologist', reactivate: false,
  employeeNo: '', gender: '__none__', teachingGrades: [] as string[],
  subject: '', isClassTeacher: false, classTeacherYears: '', hiredAt: '', title: '__none__', certNote: '',
  selfStatusLevel: '__auto__',
})
const invitation = ref<InvitationResult | null>(null)
const activationLink = computed(() => invitation.value ? `/activate?token=${encodeURIComponent(invitation.value.activationToken)}` : '')
const copied = ref(false)

const disableTarget = ref<UserRow | null>(null)
const disableForm = reactive({ toUserId: '', newPsychologistId: '__none__', reason: '' })
const deleteTarget = ref<UserRow | null>(null)

function openCreate() {
  editing.value = null
  Object.assign(form, {
    name: '', phone: '', role: 'teacher', reactivate: false,
    employeeNo: '', gender: '__none__', teachingGrades: [],
    subject: '', isClassTeacher: false, classTeacherYears: '', hiredAt: '', title: '__none__', certNote: '', selfStatusLevel: '__auto__',
  })
  formError.value = ''
  drawerOpen.value = true
}

function openEdit(rowOrId: UserRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  editing.value = row
  Object.assign(form, {
    name: row.name, phone: row.phone, role: row.role, reactivate: false,
    employeeNo: row.employeeNo || '', gender: row.gender || '__none__',
    teachingGrades: row.teachingGrades?.map(g => `${g} 年级`) || [],
    subject: row.subject || '', isClassTeacher: row.isClassTeacher,
    classTeacherYears: row.classTeacherYears != null ? String(row.classTeacherYears) : '',
    hiredAt: row.hiredAt ? row.hiredAt.slice(0, 10) : '', title: row.title || '__none__',
    certNote: '', selfStatusLevel: row.overrides?.selfStatusLevel || '__auto__',
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

async function saveUser() {
  const target = editing.value
  if (!target) return
  if (form.name.trim().length < 2 || !/^1[3-9]\d{9}$/.test(form.phone)) {
    formError.value = '请填写有效的姓名和手机号'
    return
  }
  saving.value = true
  formError.value = ''
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
    status: target.status === 'disabled' && form.reactivate ? 'active' : undefined,
  }
  // 电话/心理资质备注是加密字段：编辑时留空表示不修改
  if (form.phone) body.phone = form.phone
  if (form.certNote) body.certNote = form.certNote
  // 自我状态三态：未操作不发送；显式“改回按评估结果”清除；选择具体等级写入
  if (form.selfStatusLevel === '__clear__') body.overrides = { selfStatusLevel: '' }
  else if (form.selfStatusLevel !== '__auto__') body.overrides = { selfStatusLevel: form.selfStatusLevel }
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

async function inviteUser() {
  if (form.name.trim().length < 2 || !/^1[3-9]\d{9}$/.test(form.phone)) {
    formError.value = '请填写有效的姓名和手机号'
    return
  }
  if (!props.inviteSchoolId) {
    formError.value = '缺少目标学校，无法邀请'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    invitation.value = await $fetch<InvitationResult>('/api/v1/school-admin/users', {
      method: 'POST',
      query: { schoolId: props.inviteSchoolId },
      body: { name: form.name, phone: form.phone, role: form.role },
    })
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '邀请创建失败'
  } finally {
    saving.value = false
  }
}

async function reInvite(row: UserRow) {
  if (row.status !== 'invited') return
  saving.value = true
  formError.value = ''
  try {
    invitation.value = await $fetch<InvitationResult>('/api/v1/school-admin/users', {
      method: 'POST',
      query: opQuery(row),
      body: { name: row.name, phone: row.phone, role: row.role },
    })
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '重新邀请失败'
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
  void loadTransferOptions(row)
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

async function transferAndDisable() {
  if (!disableTarget.value || !disableForm.toUserId || disableForm.reason.trim().length < 10) {
    formError.value = '请选择业务接收教师，并填写至少 10 个字符的停用事由'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    await $fetch(`/api/v1/school-admin/users/${disableTarget.value.id}/transfer-and-disable`, {
      method: 'POST',
      query: opQuery(disableTarget.value),
      body: {
        toUserId: disableForm.toUserId,
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

async function copyActivationLink() {
  if (!import.meta.client) return
  await navigator.clipboard.writeText(`${window.location.origin}${activationLink.value}`)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <ManagementPage :title="title" :description="description" :can-create="canInvite" create-label="邀请用户" @create="openCreate">
    <TableToolbar :search-value="list.q.value" :status-filter="list.statusFilter.value" :status-options="statusOptions" search-placeholder="搜索姓名或手机号..." :loading="list.loading.value" @search="list.onSearch" @update:status-filter="list.onStatusChange" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange" @row-click="openEdit">
      <template #role-data="{ row }">{{ roleLabels[row.role] || row.role }}</template>
      <template #selfStatusLevel-data="{ row }">
        <UBadge v-if="row.selfStatusLevel" :color="row.selfStatusLevel === '需转介' ? 'error' : row.selfStatusLevel === '需关注' ? 'warning' : row.selfStatusLevel === '关注' ? 'info' : 'success'" variant="subtle">{{ row.selfStatusLevel }}</UBadge>
        <span v-else class="text-xs text-slate-400">未评估</span>
      </template>
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : row.status === 'invited' ? 'info' : 'neutral'" variant="subtle">{{ statusLabels[row.status] || row.status }}</UBadge></template>
      <template #lastLoginAt-data="{ value }">{{ value ? new Date(String(value)).toLocaleString('zh-CN') : '从未登录' }}</template>
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
          <UButton v-if="row.status === 'invited'" size="xs" variant="soft" color="primary" @click="reInvite(row)">重新邀请</UButton>
        </div>
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <EntityFormDrawer :open="drawerOpen" :title="editing ? '编辑账号' : '邀请用户'" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="editing ? saveUser() : inviteUser()">
        <UFormField label="姓名" required><UInput v-model="form.name" class="w-full" /></UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="手机号" required><UInput v-model="form.phone" inputmode="numeric" maxlength="11" class="w-full" /></UFormField>
          <UFormField label="工号"><UInput v-model="form.employeeNo" class="w-full" /></UFormField>
          <UFormField label="角色" required><USelect v-model="form.role" :items="roleOptions" :disabled="Boolean(editing && editing.status !== 'invited')" class="w-full" /></UFormField>
          <UFormField :label="editing ? '更新手机号（留空表示不修改）' : '手机号'"><UInput v-model="form.phone" class="w-full" /></UFormField>
          <UFormField label="性别"><USelect v-model="form.gender" :items="genderOptions" class="w-full" /></UFormField>
          <UFormField label="任教年级"><USelectMenu v-model="form.teachingGrades" multiple :items="gradeItems" class="w-full" /></UFormField>
          <UFormField label="任教学科"><UInput v-model="form.subject" placeholder="如：语文" class="w-full" /></UFormField>
          <UFormField label="职称"><USelect v-model="form.title" :items="titleOptions" class="w-full" /></UFormField>
          <UFormField label="入职时间"><UInput v-model="form.hiredAt" type="date" class="w-full" /></UFormField>
          <UFormField label="是否班主任"><UCheckbox v-model="form.isClassTeacher" label="当前承担班主任工作" /></UFormField>
          <UFormField label="班主任年限（年）"><UInput v-model="form.classTeacherYears" type="number" min="0" max="60" placeholder="如：5" class="w-full" /></UFormField>
        </div>
        <UFormField v-if="editing?.role === 'psychologist'" :label="editing ? '更新资质说明（留空表示不修改）' : '心理资质说明'">
          <UTextarea v-model="form.certNote" :rows="2" placeholder="如：国家二级心理咨询师" class="w-full" />
        </UFormField>
        <UCheckbox v-if="editing?.status === 'disabled'" v-model="form.reactivate" label="重新启用该账号" />
        <div v-if="editing" class="rounded-lg bg-amber-50/60 p-3">
          <UFormField label="自我状态等级（手动修正）" hint="按最近一次自我成长评估展示；手动指定后将在下次评估前覆盖显示">
            <USelect v-model="form.selfStatusLevel" :items="selfStatusOptions" class="w-full" />
          </UFormField>
        </div>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" @click="closeDrawer">取消</UButton><UButton type="submit" :loading="saving">{{ editing ? '保存' : '生成邀请' }}</UButton></div>
      </form>
    </EntityFormDrawer>

    <UModal :open="Boolean(invitation)" @update:open="value => { if (!value) invitation = null }">
      <template #header><h3 class="text-lg font-semibold">邀请已创建</h3></template>
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-gray-600">请通过校内安全渠道发送激活链接。链接 72 小时内有效，关闭后不再展示令牌。</p>
          <UInput :model-value="activationLink" readonly class="w-full" />
          <UButton icon="i-lucide-copy" variant="outline" @click="copyActivationLink">{{ copied ? '已复制' : '复制完整链接' }}</UButton>
        </div>
      </template>
    </UModal>

    <UModal :open="Boolean(disableTarget)" @update:open="value => { if (!value) disableTarget = null }">
      <template #header><h3 class="text-lg font-semibold">移交业务并停用账号</h3></template>
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-600">将 {{ disableTarget?.name }} 的全部业务责任链移交后，撤销其登录会话并停用账号。</p>
          <UFormField label="业务接收教师" required><USelect v-model="disableForm.toUserId" :items="teacherOptions" class="w-full" /></UFormField>
          <UFormField v-if="disableTarget?.role === 'psychologist'" label="未结转介接收心理专员"><USelect v-model="disableForm.newPsychologistId" :items="[{ label: '无未结转介', value: '__none__' }, ...psychologistOptions]" class="w-full" /></UFormField>
          <UFormField label="操作事由" required><UTextarea v-model="disableForm.reason" :rows="3" placeholder="至少 10 个字符" class="w-full" /></UFormField>
          <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        </div>
      </template>
      <template #footer><div class="flex justify-end gap-2"><UButton variant="outline" @click="closeDisable">取消</UButton><UButton color="error" :loading="saving" @click="transferAndDisable">确认移交并停用</UButton></div></template>
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
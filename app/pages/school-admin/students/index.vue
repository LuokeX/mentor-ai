<script setup lang="ts">
import { useManagedList } from '~/composables/useManagedList'
import type { ManagedListResult } from '~~/shared/management'

interface StudentRow {
  id: string
  name: string
  gender: string | null
  birthDate: string | null
  ethnicity: string | null
  boardingType: string | null
  caseLevel: string | null
  learningLevel: string | null
  overrides: Record<string, string>
  classId: string | null
  className: string | null
  ownerUserId: string
  ownerName: string
  departmentName: string | null
  status: string
  updatedAt: string
}
interface OptionRow { id: string; name: string }

const list = useManagedList<StudentRow>('/api/v1/school-admin/students')
const columns = [
  { key: 'name', label: '学生姓名', sortable: true },
  { key: 'className', label: '班级', sortable: true },
  { key: 'caseLevel', label: '个体支持', sortable: true },
  { key: 'learningLevel', label: '学习问题', sortable: true },
  { key: 'ownerName', label: '负责教师' },
  { key: 'gender', label: '性别', mobileHidden: true },
  { key: 'status', label: '状态', sortable: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '在读', value: 'active' },
  { label: '已归档', value: 'archived' },
]
const genderOptions = [
  { label: '未知', value: '__none__' }, { label: '男', value: '男' }, { label: '女', value: '女' },
]
const boardingOptions = [
  { label: '未知', value: '__none__' }, { label: '走读', value: 'day' }, { label: '住宿', value: 'boarding' },
]
/** 修正选项：按评估结果（默认）或手动指定等级 */
const caseLevelOptions = [
  { label: '（当前按评估结果）', value: '__auto__' },
  { label: '改回按评估结果', value: '__clear__' },
  { label: 'L3 专业会商', value: 'L3 专业会商' }, { label: 'L2 年级协同', value: 'L2 年级协同' }, { label: 'L1 教师关注', value: 'L1 教师关注' },
]
const learningLevelOptions = [
  { label: '（当前按评估结果）', value: '__auto__' },
  { label: '改回按评估结果', value: '__clear__' },
  { label: 'LP0 危机转介', value: 'LP0 危机转介' }, { label: 'LP3 系统干预', value: 'LP3 系统干预' }, { label: 'LP2 深入诊断', value: 'LP2 深入诊断' },
]
const { data: classData } = await useFetch<ManagedListResult<OptionRow>>('/api/v1/school-admin/classes', {
  query: { page: 1, pageSize: 100, status: 'active' },
})
const { data: teacherData } = await useFetch<ManagedListResult<OptionRow>>('/api/v1/school-admin/teachers', {
  query: { page: 1, pageSize: 100, status: 'active' },
})
const classOptions = computed(() => [
  { label: '暂不分班', value: '__none__' },
  ...(classData.value?.rows || []).map(item => ({ label: item.name, value: item.id })),
])
const teacherOptions = computed(() => (teacherData.value?.rows || []).map(item => ({ label: item.name, value: item.id })))

const drawerOpen = ref(false)
const editing = ref<StudentRow | null>(null)
const lifecycle = ref<{ action: 'archive' | 'restore'; row: StudentRow } | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({
  name: '', gender: '__none__', classId: '__none__', ownerUserId: '',
  birthDate: '', studentNo: '', ethnicity: '', enrolledAt: '', boardingType: '__none__', address: '',
  caseLevel: '__auto__', learningLevel: '__auto__',
})

function openCreate() {
  editing.value = null
  Object.assign(form, {
    name: '', gender: '__none__', classId: '__none__', ownerUserId: '',
    birthDate: '', studentNo: '', ethnicity: '', enrolledAt: '', boardingType: '__none__', address: '',
    caseLevel: '__auto__', learningLevel: '__auto__',
  })
  formError.value = ''
  drawerOpen.value = true
}

function openEdit(rowOrId: StudentRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  editing.value = row
  Object.assign(form, {
    name: row.name,
    gender: row.gender || '__none__',
    classId: row.classId || '__none__',
    ownerUserId: row.ownerUserId,
    birthDate: row.birthDate ? row.birthDate.slice(0, 10) : '',
    ethnicity: row.ethnicity || '',
    enrolledAt: (row as any).enrolledAt ? (row as any).enrolledAt.slice(0, 10) : '',
    boardingType: row.boardingType || '__none__',
    caseLevel: row.overrides?.caseLevel || '__auto__',
    learningLevel: row.overrides?.learningLevel || '__auto__',
  })
  formError.value = ''
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
}

async function saveStudent() {
  if (!form.name.trim() || !form.ownerUserId) {
    formError.value = '请填写学生姓名并选择负责教师'
    return
  }
  saving.value = true
  formError.value = ''
  const ownerChanged = editing.value?.ownerUserId !== form.ownerUserId
  const body: Record<string, unknown> = {
    name: form.name,
    gender: form.gender === '__none__' ? null : form.gender,
    classId: form.classId === '__none__' ? null : form.classId,
    ownerUserId: form.ownerUserId,
    birthDate: form.birthDate || null,
    studentNo: form.studentNo || null,
    ethnicity: form.ethnicity || null,
    enrolledAt: form.enrolledAt || null,
    boardingType: form.boardingType === '__none__' ? null : form.boardingType,
    address: form.address || null,
    reason: editing.value && ownerChanged ? '学校管理员在学生管理表中调整负责教师' : undefined,
  }
  // 学籍号/地址是加密字段，列表不返回旧值；编辑时留空表示“不修改”，避免误清空
  if (editing.value) {
    if (!form.studentNo) delete body.studentNo
    if (!form.address) delete body.address
  }
  // 支持等级三态：未操作不发送；显式“改回按评估结果”清除修正；选择具体等级写入修正
  if (editing.value) {
    const overrides: Record<string, string> = {}
    if (form.caseLevel === '__clear__') overrides.caseLevel = ''
    else if (form.caseLevel !== '__auto__') overrides.caseLevel = form.caseLevel
    if (form.learningLevel === '__clear__') overrides.learningLevel = ''
    else if (form.learningLevel !== '__auto__') overrides.learningLevel = form.learningLevel
    if (Object.keys(overrides).length) body.overrides = overrides
  }
  try {
    if (editing.value) {
      await $fetch(`/api/v1/school-admin/students/${editing.value.id}`, {
        method: 'PATCH',
        query: { expectedUpdatedAt: editing.value.updatedAt },
        body,
      })
    } else {
      await $fetch('/api/v1/school-admin/students', { method: 'POST', body })
    }
    drawerOpen.value = false
    await list.refresh()
  } catch (error: unknown) {
    const response = error as { statusCode?: number; data?: { message?: string } }
    formError.value = response.statusCode === 409
      ? '学生档案已被其他管理员修改，请刷新后重试'
      : response.data?.message || '学生保存失败'
  } finally {
    saving.value = false
  }
}

async function runLifecycle(reason: string) {
  if (!lifecycle.value) return
  saving.value = true
  formError.value = ''
  const { action, row } = lifecycle.value
  try {
    await $fetch(`/api/v1/school-admin/students/${row.id}/${action}`, {
      method: 'POST',
      body: { expectedUpdatedAt: row.updatedAt, reason },
    })
    lifecycle.value = null
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '学生状态更新失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ManagementPage title="学生管理" description="管理全校学生的班级、负责教师与业务档案；个体支持/学习问题等级由评估自动回写，可手动修正。所有生命周期操作保留审计。" :can-create="list.pageCapabilities.value.includes('create')" create-label="添加学生" @create="openCreate">
    <TableToolbar :search-value="list.q.value" :status-filter="list.statusFilter.value" :status-options="statusOptions" search-placeholder="输入完整姓名或外部编号..." :loading="list.loading.value" @search="list.onSearch" @update:status-filter="list.onStatusChange" @refresh="list.refresh" />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange" @row-click="openEdit">
      <template #status-data="{ row }"><UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle">{{ row.status === 'active' ? '在读' : '已归档' }}</UBadge></template>
      <template #caseLevel-data="{ row }">
        <UBadge v-if="row.caseLevel" :color="row.caseLevel.startsWith('L3') ? 'error' : row.caseLevel.startsWith('L2') ? 'warning' : 'info'" variant="subtle">{{ row.caseLevel }}</UBadge>
        <span v-else class="text-xs text-slate-400">未评估</span>
      </template>
      <template #learningLevel-data="{ row }">
        <UBadge v-if="row.learningLevel" :color="row.learningLevel.startsWith('LP0') ? 'error' : row.learningLevel.startsWith('LP3') ? 'warning' : 'info'" variant="subtle">{{ row.learningLevel }}</UBadge>
        <span v-else class="text-xs text-slate-400">未评估</span>
      </template>
      <template #actions-data="{ row }">
        <RowActions
          :capabilities="row._capabilities"
          :row-id="row.id"
          @view="openEdit"
          @edit="openEdit"
          @transfer="openEdit"
          @archive="lifecycle = { action: 'archive', row }"
          @restore="lifecycle = { action: 'restore', row }"
        />
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <EntityFormDrawer :open="drawerOpen" :title="editing ? '编辑学生' : '添加学生'" @close="drawerOpen = false">
      <form class="space-y-4" @submit.prevent="saveStudent">
        <UFormField label="学生姓名" required><UInput v-model="form.name" class="w-full" /></UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="性别"><USelect v-model="form.gender" :items="genderOptions" class="w-full" /></UFormField>
          <UFormField label="出生日期"><UInput v-model="form.birthDate" type="date" class="w-full" /></UFormField>
          <UFormField label="班级"><USelect v-model="form.classId" :items="classOptions" class="w-full" /></UFormField>
          <UFormField label="负责教师" required><USelect v-model="form.ownerUserId" :items="teacherOptions" class="w-full" /></UFormField>
          <UFormField label="学籍号"><UInput v-model="form.studentNo" class="w-full" /></UFormField>
          <UFormField label="民族"><UInput v-model="form.ethnicity" class="w-full" /></UFormField>
          <UFormField label="入学时间"><UInput v-model="form.enrolledAt" type="date" class="w-full" /></UFormField>
          <UFormField label="住宿方式"><USelect v-model="form.boardingType" :items="boardingOptions" class="w-full" /></UFormField>
        </div>
        <UFormField label="家庭住址"><UInput v-model="form.address" class="w-full" /></UFormField>
        <div v-if="editing" class="grid gap-4 rounded-lg bg-amber-50/60 p-3 sm:grid-cols-2">
          <UFormField label="个体支持等级（手动修正）" hint="按最近一次评估展示；手动指定后将在下次评估前覆盖显示">
            <USelect v-model="form.caseLevel" :items="caseLevelOptions" class="w-full" />
          </UFormField>
          <UFormField label="学习问题等级（手动修正）">
            <USelect v-model="form.learningLevel" :items="learningLevelOptions" class="w-full" />
          </UFormField>
        </div>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" @click="closeDrawer">取消</UButton><UButton type="submit" :loading="saving">保存</UButton></div>
      </form>
    </EntityFormDrawer>
    <LifecycleDialog
      :open="Boolean(lifecycle)"
      :action="lifecycle?.action === 'archive' ? '归档学生' : '恢复学生'"
      :target-name="lifecycle?.row.name"
      :loading="saving"
      @close="lifecycle = null"
      @confirm="runLifecycle"
    />
  </ManagementPage>
</template>
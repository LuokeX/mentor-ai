<script setup lang="ts">
import {
  TARGET_TYPE_GROUPS,
  allowedCapabilities,
  diffRolePermissions,
  normalizeRolePermissions,
} from '~~/shared/management'
import type { Capability, RolePermissions } from '~~/shared/management'
import { ROLE_LABELS } from '~/composables/useAuth'

type PermissionGroup = 'pages' | 'records'

interface DroppedPermission {
  group: PermissionGroup
  targetType: string
  capability: string
}

interface RoleDetail {
  id: string
  code: string
  name: string
  description: string | null
  isSystem: boolean
  updatedAt: string
  /** 生效权限清单（库里缺键已按系统默认补齐） */
  permissions: RolePermissions
  /** 系统内置默认清单；目录表里的新角色可能没有 */
  defaults: RolePermissions | null
  isDefault: boolean
  /** 库里未显式配置、当前按系统默认生效的目标类型 */
  inherited: Array<{ group: PermissionGroup, targetType: string }>
  /** 库里有、但按当前白名单不会生效的历史配置（保存时会被清理） */
  legacyPermissions: DroppedPermission[]
  lastChange: { actorName: string | null, createdAt: string } | null
  recordCount: number
  pageCount: number
  targetTypeCount: number
  dashboardPageCount: number
}

const route = useRoute()
const { data: role, pending, refresh } = await useFetch<RoleDetail>(`/api/v1/platform-admin/roles/${route.params.id}`)
const { capabilityLabel, targetTypeLabel } = useDisplayLabels()

/** 能力说明：勾选框 hover 提示与页面底部「能力说明」共用一份文案 */
const CAPABILITY_HINTS: Record<string, string> = {
  view: '可进入该模块并查看基础字段（不含敏感正文）',
  create: '列表页顶部显示「新建」入口',
  view_sensitive: '填写事由（≥10 字）后可查看个体明细；每次查看写审计，默认关闭，按校方授权开通',
  edit: '可修改基础字段；行级仍受负责人、租户与状态约束',
  inline_edit: '可在列表中直接修改简单字段',
  archive: '可归档记录（归档后只读）',
  restore: '可恢复已归档记录',
  transfer: '可移交负责人（转介为移交心理专员）',
  graduate: '可把班级标记为毕业',
  delete: '可删除记录（仅限未激活的邀请账号等允许删除的对象，须填事由）',
  disable: '可停用账号'
}
const SENSITIVE_HINT = '开通后该角色可填写事由换取 15 分钟授权查看个体明细（学生 / 教师 / 家长），每次查看写管理员访问事件与审计。'

function clonePermissions(perm: RolePermissions): RolePermissions {
  return {
    pages: Object.fromEntries(Object.entries(perm.pages ?? {}).map(([key, value]) => [key, [...value]])),
    records: Object.fromEntries(Object.entries(perm.records ?? {}).map(([key, value]) => [key, [...value]])),
  }
}

const initPermissions: RolePermissions = { pages: {}, records: {} }
/** 已保存版本：作为「未保存改动」的比对基准 */
const saved = ref<RolePermissions | null>(null)
const form = reactive<{ permissions: RolePermissions }>({ permissions: clonePermissions(initPermissions) })
const initialized = ref(false)

watch(role, (value) => {
  if (!value) return
  // 每次以服务端返回为准重置表单与基准；未保存的本地改动只在 409 时不覆盖（见 reloadLatest）
  saved.value = normalizeRolePermissions(value.permissions)
  form.permissions = clonePermissions(value.permissions)
  initialized.value = true
}, { immediate: true })

// ---- 未保存改动 ----
const changes = computed(() => diffRolePermissions(saved.value ?? initPermissions, form.permissions))
const hasChanges = computed(() => changes.value.length > 0)
const changedTargets = computed(() => new Set(changes.value.map(change => `${change.group}:${change.targetType}`)))
const changeSummary = computed(() => {
  let added = 0
  let removed = 0
  for (const change of changes.value) {
    added += change.added.length
    removed += change.removed.length
  }
  return { added, removed }
})

// ---- 勾选状态读写 ----
function hasPerm(group: PermissionGroup, targetType: string, capability: Capability): boolean {
  return (form.permissions[group][targetType] ?? []).includes(capability)
}
function togglePerm(group: PermissionGroup, targetType: string, capability: Capability) {
  const list = form.permissions[group][targetType] ?? (form.permissions[group][targetType] = [])
  const index = list.indexOf(capability)
  if (index >= 0) list.splice(index, 1)
  else list.push(capability)
  // 与白名单同序，保存时的差异对比更稳定
  form.permissions[group][targetType] = allowedCapabilities(targetType, group).filter(item => list.includes(item))
}
function capabilitiesOf(group: PermissionGroup, targetType: string): Capability[] {
  return allowedCapabilities(targetType, group)
}
function isTargetDirty(targetType: string): boolean {
  return changedTargets.value.has(`pages:${targetType}`) || changedTargets.value.has(`records:${targetType}`)
}
function targetCount(targetType: string): number {
  return (form.permissions.pages[targetType]?.length ?? 0) + (form.permissions.records[targetType]?.length ?? 0)
}

// ---- 继承默认标注 ----
// 库里没有显式配置的目标类型在运行时按代码默认回退，勾选值已按生效值展示，
// 标注出来是为了让管理员知道「这一项还没固化到数据库」。
const inheritedSet = computed(() => new Set((role.value?.inherited ?? []).map(item => `${item.group}:${item.targetType}`)))
function isInherited(group: PermissionGroup, targetType: string): boolean {
  return inheritedSet.value.has(`${group}:${targetType}`)
}
function targetInheritsDefault(targetType: string): boolean {
  return isInherited('pages', targetType) || isInherited('records', targetType)
}

// ---- 快捷操作 ----
function defaultsOf(group: PermissionGroup, targetType: string): Capability[] {
  return role.value?.defaults?.[group]?.[targetType] ?? []
}
function applyTargetDefault(targetType: string) {
  if (!role.value?.defaults) return
  for (const group of ['pages', 'records'] as const) {
    form.permissions[group][targetType] = allowedCapabilities(targetType, group)
      .filter(capability => defaultsOf(group, targetType).includes(capability))
  }
}
function clearTarget(targetType: string) {
  form.permissions.pages[targetType] = []
  form.permissions.records[targetType] = []
}
function applyGroupDefault(targetTypes: string[]) {
  for (const targetType of targetTypes) applyTargetDefault(targetType)
}
function clearGroup(targetTypes: string[]) {
  for (const targetType of targetTypes) clearTarget(targetType)
}
/** 整角色恢复系统默认：未点保存前不会写库 */
function restoreAllDefaults() {
  if (!role.value?.defaults) return
  form.permissions = clonePermissions(role.value.defaults)
}
function revertChanges() {
  if (!saved.value) return
  form.permissions = clonePermissions(saved.value)
}

// ---- 分组导航 ----
const groupStats = computed(() => TARGET_TYPE_GROUPS.map((group) => {
  const configured = group.targetTypes.filter(targetType => targetCount(targetType) > 0).length
  return {
    ...group,
    configured,
    total: group.targetTypes.length,
    dirty: group.targetTypes.some(targetType => isTargetDirty(targetType)),
  }
}))
function scrollToGroup(groupId: string) {
  document.getElementById(`perm-group-${groupId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ---- 历史残留配置 ----
const legacyItems = computed(() => role.value?.legacyPermissions ?? [])
const legacyText = computed(() => legacyItems.value
  .map(item => `${item.group === 'pages' ? '页面级' : '记录级'} · ${targetTypeLabel(item.targetType)} · ${capabilityLabel(item.capability)}`)
  .join('；'))
/** 把不生效的历史配置从表单里摘掉：保存后即被清理 */
function dropLegacy() {
  for (const item of legacyItems.value) {
    const list = form.permissions[item.group][item.targetType]
    if (!list) continue
    form.permissions[item.group][item.targetType] = list.filter(capability => capability !== item.capability)
  }
}
const isPlatformAdminRole = computed(() => role.value?.code === 'platform_admin')
const inheritedTargetCount = computed(() => TARGET_TYPE_GROUPS
  .flatMap(group => group.targetTypes)
  .filter(targetType => targetInheritsDefault(targetType)).length)
const roleDisplayName = computed(() => role.value
  ? (role.value.name || ROLE_LABELS[role.value.code as keyof typeof ROLE_LABELS] || role.value.code)
  : '')

// ---- 保存 ----
const saving = ref(false)
const saveError = ref('')
const conflict = ref(false)
const savedMessage = ref('')
let savedTimer: ReturnType<typeof setTimeout> | undefined

async function savePermissions() {
  if (!role.value || !hasChanges.value) return
  saving.value = true
  saveError.value = ''
  conflict.value = false
  savedMessage.value = ''
  const summary = changeSummary.value
  try {
    await $fetch(`/api/v1/platform-admin/roles/${role.value.id}`, {
      method: 'PATCH',
      query: { expectedUpdatedAt: role.value.updatedAt },
      body: { permissions: form.permissions },
    })
    savedMessage.value = `已保存：新增 ${summary.added} 项、移除 ${summary.removed} 项，权限即时生效`
    clearTimeout(savedTimer)
    savedTimer = setTimeout(() => { savedMessage.value = '' }, 5000)
    await refresh()
  } catch (error: unknown) {
    const response = error as { statusCode?: number, data?: { message?: string } }
    if (response.statusCode === 409) {
      conflict.value = true
      saveError.value = response.data?.message || '角色权限已被其他平台管理员修改'
    } else {
      saveError.value = response.data?.message || '保存失败，请稍后重试'
    }
  } finally {
    saving.value = false
  }
}

/** 冲突后手动拉取最新权限（覆盖本地未保存改动，先确认） */
async function reloadLatest() {
  if (hasChanges.value && !window.confirm('重新加载会丢弃当前未保存的改动，确定继续吗？')) return
  conflict.value = false
  saveError.value = ''
  await refresh()
}

onBeforeRouteLeave(() => {
  if (hasChanges.value) {
    return window.confirm('有未保存的权限改动，确定要离开吗？')
  }
  return true
})

onBeforeUnmount(() => clearTimeout(savedTimer))
</script>

<template>
  <ManagementPage title="角色权限配置" :description="role ? `${roleDisplayName}（${role.code}）的权限清单` : '加载中…'">
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <UButton to="/platform-admin/roles" variant="ghost" color="neutral" icon="i-lucide-arrow-left" size="sm">返回角色列表</UButton>
      <template v-if="role">
        <UBadge variant="subtle" color="neutral" size="sm">{{ role.code }}</UBadge>
        <UBadge v-if="role.isSystem" variant="soft" color="info" size="sm">系统内置</UBadge>
        <UBadge v-if="role.isDefault" variant="soft" color="success" size="sm">与系统默认一致</UBadge>
        <UBadge v-else variant="soft" color="warning" size="sm">已自定义</UBadge>
        <span v-if="role.lastChange" class="text-xs text-gray-400">
          最近修改：{{ role.lastChange.actorName || '平台管理员' }} · {{ formatDateTime(role.lastChange.createdAt) }}
        </span>
      </template>
    </div>

    <div v-if="pending && !role" class="space-y-3">
      <div v-for="i in 5" :key="i" class="h-24 animate-pulse rounded-xl bg-gray-100" />
    </div>

    <div v-else-if="role" class="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
      <!-- 左侧：分组导航 + 整角色操作 -->
      <aside class="space-y-3 self-start xl:sticky xl:top-4">
        <nav class="rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
          <p class="px-2 pb-1.5 pt-1 text-xs font-medium text-gray-400">权限分组</p>
          <button
            v-for="group in groupStats"
            :key="group.id"
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-gray-600 transition hover:bg-gray-50"
            @click="scrollToGroup(group.id)"
          >
            <span class="min-w-0 flex-1 truncate">{{ group.label }}</span>
            <span v-if="group.dirty" class="size-1.5 shrink-0 rounded-full bg-amber-500" title="该分组有未保存改动" />
            <span class="shrink-0 text-xs tabular-nums text-gray-400">{{ group.configured }}/{{ group.total }}</span>
          </button>
        </nav>

        <div class="space-y-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <p class="text-xs font-medium text-gray-400">整角色操作</p>
          <UButton
            v-if="role.defaults"
            block
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-rotate-ccw"
            @click="restoreAllDefaults"
          >
            恢复系统默认清单
          </UButton>
          <UButton
            block
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-undo-2"
            :disabled="!hasChanges"
            @click="revertChanges"
          >
            撤销未保存改动
          </UButton>
          <p class="text-xs text-gray-400">所有改动点击「保存并生效」后才写库，并记录审计。</p>
        </div>

        <div class="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-500 shadow-sm">
          <p class="mb-1 font-medium text-gray-700">当前勾选</p>
          <p>页面级 {{ role.pageCount }} 项 · 记录级 {{ role.recordCount }} 项</p>
          <p class="mt-0.5">覆盖 {{ role.targetTypeCount }} 类目标</p>
          <p v-if="role.dashboardPageCount > 0" class="mt-0.5 text-emerald-700">驾驶舱 {{ role.dashboardPageCount }}/4 页可见</p>
          <p v-if="inheritedTargetCount > 0" class="mt-0.5 text-gray-400">其中 {{ inheritedTargetCount }} 类按系统默认生效（继承）</p>
        </div>
      </aside>

      <!-- 右侧：分组编辑区 -->
      <div class="space-y-5">
        <div v-if="isPlatformAdminRole" class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p class="flex items-center gap-2 font-medium"><UIcon name="i-lucide-alert-triangle" class="size-4" />这是平台管理员自身的角色</p>
          <p class="mt-1 text-xs leading-5">
            取消「账号与组织」的查看能力会让所有平台管理员无法进入学校管理、账号管理；角色权限配置本身仍可进入，可以回到这里改回。建议只做必要调整。
          </p>
        </div>

        <div v-if="legacyItems.length" class="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          <p class="flex items-center gap-2 font-medium text-gray-800">
            <UIcon name="i-lucide-eraser" class="size-4" />检测到 {{ legacyItems.length }} 项不会生效的历史配置
          </p>
          <p class="mt-1 text-xs leading-5">{{ legacyText }}</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-eraser" @click="dropLegacy">放入待清理</UButton>
            <span class="text-xs text-gray-400">这些能力在当前规则下本来就不生效，保存后会被服务端清洗掉。</span>
          </div>
        </div>

        <section
          v-for="group in TARGET_TYPE_GROUPS"
          :id="`perm-group-${group.id}`"
          :key="group.id"
          class="scroll-mt-4 space-y-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2">
            <div>
              <h2 class="text-sm font-semibold text-gray-900">{{ group.label }}</h2>
              <p class="text-xs text-gray-400">{{ group.description }}</p>
            </div>
            <div v-if="role.defaults" class="flex shrink-0 gap-2">
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" @click="applyGroupDefault(group.targetTypes)">按默认</UButton>
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-circle-slash" @click="clearGroup(group.targetTypes)">清空本组</UButton>
            </div>
          </div>

          <div
            v-for="targetType in group.targetTypes"
            :key="targetType"
            class="rounded-xl border bg-white p-4 shadow-sm"
            :class="isTargetDirty(targetType) ? 'border-amber-300' : 'border-gray-200'"
          >
            <div class="mb-3 flex flex-wrap items-center gap-2">
              <p class="flex items-center gap-2 text-sm font-medium text-gray-900">
                <UIcon name="i-lucide-folder-kanban" class="size-4 text-gray-400" />
                {{ targetTypeLabel(targetType) }}
                <span class="text-xs font-normal text-gray-400">{{ targetType }}</span>
              </p>
              <UBadge v-if="isTargetDirty(targetType)" variant="soft" color="warning" size="xs">未保存</UBadge>
              <UBadge
                v-if="targetInheritsDefault(targetType)"
                variant="soft"
                color="neutral"
                size="xs"
                title="该目标类型尚未在数据库里单独配置，当前按系统默认生效；保存后会被固化为显式配置"
              >
                继承默认
              </UBadge>
              <span class="text-xs text-gray-400">已勾选 {{ targetCount(targetType) }} 项</span>
              <div class="ml-auto flex shrink-0 gap-1">
                <UButton v-if="role.defaults" size="xs" color="neutral" variant="ghost" @click="applyTargetDefault(targetType)">按默认</UButton>
                <UButton size="xs" color="neutral" variant="ghost" @click="clearTarget(targetType)">清空</UButton>
              </div>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="rounded-lg bg-gray-50/70 p-3">
                <p class="mb-2 text-xs font-medium text-gray-500">页面级能力（列表页入口）</p>
                <div class="flex flex-wrap gap-x-4 gap-y-1.5">
                  <UCheckbox
                    v-for="capability in capabilitiesOf('pages', targetType)"
                    :key="capability"
                    :model-value="hasPerm('pages', targetType, capability)"
                    :label="capabilityLabel(capability)"
                    :title="CAPABILITY_HINTS[capability]"
                    @update:model-value="() => togglePerm('pages', targetType, capability)"
                  />
                </div>
              </div>
              <div class="rounded-lg bg-gray-50/70 p-3">
                <p class="mb-2 text-xs font-medium text-gray-500">记录级能力（行内操作，仍受行级业务规则约束）</p>
                <div class="flex flex-wrap gap-x-4 gap-y-1.5">
                  <UCheckbox
                    v-for="capability in capabilitiesOf('records', targetType)"
                    :key="capability"
                    :model-value="hasPerm('records', targetType, capability)"
                    :label="capabilityLabel(capability)"
                    :title="CAPABILITY_HINTS[capability]"
                    @update:model-value="() => togglePerm('records', targetType, capability)"
                  />
                </div>
                <p
                  v-if="hasPerm('records', targetType, 'view_sensitive')"
                  class="mt-2 rounded-md bg-amber-50 p-2 text-xs leading-5 text-amber-800"
                >
                  {{ SENSITIVE_HINT }}
                </p>
              </div>
            </div>
          </div>
        </section>

        <!-- 能力说明 -->
        <details class="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <summary class="cursor-pointer select-none text-sm font-medium text-gray-700">能力说明</summary>
          <ul class="mt-2 grid gap-1.5 text-xs text-gray-500 sm:grid-cols-2">
            <li v-for="(hint, capability) in CAPABILITY_HINTS" :key="capability">
              <span class="font-medium text-gray-700">{{ capabilityLabel(capability) }}</span>：{{ hint }}
            </li>
          </ul>
          <p class="mt-2 text-xs text-gray-400">
            白名单之外的能力不会展示：例如审计、导入、方案操作、应急访问申请只有「查看」；
            数据驾驶舱只有「查看」与「查看敏感详情」。带「继承默认」的目标类型尚未固化到数据库，
            当前按系统默认生效，保存后写入显式配置。
          </p>
        </details>

        <!-- 保存条 -->
        <div class="sticky bottom-0 z-10 rounded-xl border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur">
          <div v-if="saveError" class="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">
            <span>{{ saveError }}</span>
            <UButton v-if="conflict" size="xs" color="error" variant="soft" icon="i-lucide-refresh-cw" @click="reloadLatest">重新加载最新权限</UButton>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <UButton
              color="primary"
              icon="i-lucide-save"
              :loading="saving"
              :disabled="!initialized || !hasChanges"
              @click="savePermissions"
            >
              保存并生效
            </UButton>
            <UButton v-if="hasChanges" color="neutral" variant="ghost" icon="i-lucide-undo-2" :disabled="saving" @click="revertChanges">撤销改动</UButton>
            <span v-if="savedMessage" class="text-sm text-green-600">{{ savedMessage }}</span>
            <span v-else-if="hasChanges" class="text-sm text-amber-700">
              未保存：新增 {{ changeSummary.added }} 项、移除 {{ changeSummary.removed }} 项（涉及 {{ changes.length }} 个目标类型）
            </span>
            <span v-else class="text-xs text-gray-400">当前勾选与已保存版本一致</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-400">角色不存在或已删除</div>
  </ManagementPage>
</template>

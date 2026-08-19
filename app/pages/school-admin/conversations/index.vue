<script setup lang="ts">
/**
 * 学校后台 · AI 对话管理。
 *
 * 接口契约（server/api/v1/school-admin/conversations）：
 * - 列表行：id / ownerUserId / teacherName / title / contextType / contextId /
 *   status(active|archived) / messageCount / createdAt / updatedAt + _capabilities
 * - 详情：会话整行 + messages（{ id, role, text, metadata, createdAt }，content 已解密为 text）+
 *   routingDecisions
 * - archive/restore：POST body { expectedUpdatedAt, reason }；物理删除：DELETE body { reason }
 * - 单条消息软删：DELETE /[id]/messages/[messageId]（body 可选）
 */
import { useManagedList } from '~/composables/useManagedList'

interface ConversationRow {
  id: string
  ownerUserId: string
  teacherName: string
  title: string
  contextType: string
  contextId: string | null
  status: 'active' | 'archived'
  messageCount: number
  createdAt: string
  updatedAt: string
}
interface ConversationMessage {
  id: string
  role: string
  text: string
  metadata: Record<string, unknown>
  createdAt: string
}
interface ConversationDetail extends ConversationRow {
  metadata: Record<string, unknown>
  archivedAt: string | null
  archivedBy: string | null
  messages: ConversationMessage[]
  routingDecisions: Array<Record<string, unknown>>
}

const list = useManagedList<ConversationRow>('/api/v1/school-admin/conversations')

const columns = [
  { key: 'title', label: '标题', class: 'w-72 max-w-72 min-w-0' },
  { key: 'teacherName', label: '教师' },
  { key: 'messageCount', label: '消息数' },
  { key: 'status', label: '状态' },
  { key: 'updatedAt', label: '更新时间', sortable: true },
  { key: 'actions', label: '操作' },
]
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '进行中', value: 'active' },
  { label: '已归档', value: 'archived' },
]
const ROLE_META: Record<string, { label: string; color: 'info' | 'success' | 'neutral' | 'primary' }> = {
  user: { label: '教师', color: 'info' },
  assistant: { label: 'AI 助手', color: 'success' },
  system: { label: '系统', color: 'neutral' },
}
/** 系统消息为基础设施记录，不提供删除入口；教师/AI 消息可逐条软删 */
function roleMeta(role: string) {
  return ROLE_META[role] || { label: role, color: 'neutral' as const }
}
const isDeletable = (role: string) => role !== 'system'

// ===== 详情抽屉 =====
const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<ConversationDetail | null>(null)
const messageDeleting = ref<string | null>(null)
const formError = ref('')
const saving = ref(false)
const lifecycle = ref<{ action: 'archive' | 'restore'; row: ConversationRow } | null>(null)
const deleteTarget = ref<ConversationRow | null>(null)
const deleteReason = ref('')
const deleteFormError = ref('')

async function loadDetail(id: string) {
  detailLoading.value = true
  try {
    detail.value = await $fetch<ConversationDetail>(`/api/v1/school-admin/conversations/${id}`)
  } finally {
    detailLoading.value = false
  }
}

async function openDetail(rowOrId: ConversationRow | string) {
  const row = typeof rowOrId === 'string' ? list.rows.value.find(item => item.id === rowOrId) : rowOrId
  if (!row) return
  detailOpen.value = true
  await loadDetail(row.id)
}

async function deleteMessage(messageId: string) {
  if (!detail.value) return
  messageDeleting.value = messageId
  try {
    await $fetch(`/api/v1/school-admin/conversations/${detail.value.id}/messages/${messageId}`, {
      method: 'DELETE',
    })
    await loadDetail(detail.value.id)
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '消息删除失败'
  } finally {
    messageDeleting.value = null
  }
}

// ===== 归档 / 恢复 / 删除 =====
async function runLifecycle(reason: string) {
  if (!lifecycle.value) return
  saving.value = true
  formError.value = ''
  const { action, row } = lifecycle.value
  try {
    await $fetch(`/api/v1/school-admin/conversations/${row.id}/${action}`, {
      method: 'POST',
      body: { expectedUpdatedAt: row.updatedAt, reason },
    })
    lifecycle.value = null
    await list.refresh()
  } catch (error: unknown) {
    formError.value = (error as { data?: { message?: string } }).data?.message || '对话状态更新失败'
  } finally {
    saving.value = false
  }
}

const canDelete = computed(() => deleteReason.value.trim().length >= 10)

async function confirmDelete() {
  if (!deleteTarget.value || !canDelete.value) return
  saving.value = true
  deleteFormError.value = ''
  try {
    await $fetch(`/api/v1/school-admin/conversations/${deleteTarget.value.id}`, {
      method: 'DELETE',
      body: { reason: deleteReason.value.trim() },
    })
    deleteTarget.value = null
    deleteReason.value = ''
    await list.refresh()
  } catch (error: unknown) {
    deleteFormError.value = (error as { data?: { message?: string } }).data?.message || '对话删除失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ManagementPage title="AI 对话" description="查看本校教师与 AI 助手的对话记录，可归档、恢复或删除（删除对话及全部消息，评估与方案保留）。所有操作保留审计。">
    <TableToolbar
      :search-value="list.q.value"
      :status-filter="list.statusFilter.value"
      :status-options="statusOptions"
      search-placeholder="搜索教师姓名..."
      :loading="list.loading.value"
      @search="list.onSearch"
      @update:status-filter="list.onStatusChange"
      @refresh="list.refresh"
    />
    <ManagedDataTable :columns="columns" :rows="list.rows.value" :loading="list.loading.value" :sort="list.sort.value" :order="list.order.value" @sort="list.onSortChange">
      <template #title-data="{ row }">
        <UTooltip :text="row.title" class="block min-w-0" :popper="{ placement: 'top', strategy: 'fixed' }">
          <span class="block truncate font-medium text-emerald-700">{{ row.title }}</span>
        </UTooltip>
      </template>
      <template #status-data="{ row }">
        <UBadge :color="row.status === 'active' ? 'success' : 'neutral'" variant="subtle">{{ row.status === 'active' ? '进行中' : '已归档' }}</UBadge>
      </template>
      <template #updatedAt-data="{ value }">{{ new Date(String(value)).toLocaleString('zh-CN') }}</template>
      <template #actions-data="{ row }">
        <RowActions
          :capabilities="row._capabilities"
          :row-id="row.id"
          @view="openDetail"
          @edit="openDetail"
          @archive="lifecycle = { action: 'archive', row }"
          @restore="lifecycle = { action: 'restore', row }"
          @delete="deleteTarget = row"
        />
      </template>
    </ManagedDataTable>
    <div v-if="list.error.value || formError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ formError || list.error.value }}</div>
    <TablePagination :page="list.page.value" :page-size="list.pageSize.value" :total="list.total.value" @update:page="list.onPageChange" @update:page-size="list.onPageSizeChange" />

    <!-- 详情抽屉：消息时间线（敏感内容，开启全屏水印） -->
    <EntityDetailDrawer :open="detailOpen" title="对话详情" :loading="detailLoading" @close="detailOpen = false">
      <div v-if="detail" class="space-y-5">
        <div v-if="detailOpen" class="sensitive-watermark" aria-hidden="true">
          <template v-for="n in 16" :key="n"><span>敏感数据 · 禁止外传</span></template>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div><span class="text-slate-400">标题</span><p class="font-medium break-all">{{ detail.title }}</p></div>
          <div><span class="text-slate-400">教师</span><p class="font-medium">{{ detail.teacherName }}</p></div>
          <div><span class="text-slate-400">消息数</span><p class="font-medium">{{ detail.messageCount }}</p></div>
          <div><span class="text-slate-400">状态</span><p class="font-medium">{{ detail.status === 'active' ? '进行中' : '已归档' }}</p></div>
          <div v-if="detail.contextType && detail.contextType !== 'none'"><span class="text-slate-400">上下文</span><p class="font-medium break-all">{{ detail.contextType }}</p></div>
        </div>

        <section>
          <h3 class="mb-3 text-sm font-semibold text-slate-700">消息时间线（{{ detail.messages.length }} 条）</h3>
          <div v-if="detail.messages.length" class="space-y-3">
            <div v-for="message in detail.messages" :key="message.id" class="rounded-xl border border-slate-100 p-3">
              <div class="flex items-start justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                  <UBadge :color="roleMeta(message.role).color" variant="soft" size="sm">{{ roleMeta(message.role).label }}</UBadge>
                  <span class="shrink-0 text-xs text-slate-400">{{ new Date(message.createdAt).toLocaleString('zh-CN') }}</span>
                </div>
                <UTooltip v-if="isDeletable(message.role)" text="删除该消息（软删除，内容不再可见）">
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="xs"
                    square
                    aria-label="删除消息"
                    :loading="messageDeleting === message.id"
                    @click="deleteMessage(message.id)"
                  />
                </UTooltip>
              </div>
              <p class="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{{ message.text }}</p>
            </div>
          </div>
          <p v-else class="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-400">该对话暂无可见消息（可能已被删除）。</p>
        </section>
      </div>
    </EntityDetailDrawer>

    <LifecycleDialog
      :open="Boolean(lifecycle)"
      :action="lifecycle?.action === 'archive' ? '归档对话' : '恢复对话'"
      :target-name="lifecycle?.row.title"
      :loading="saving"
      @close="lifecycle = null"
      @confirm="runLifecycle"
    />

    <!-- 物理删除：确认 + 事由 -->
    <UModal :open="Boolean(deleteTarget)" @update:open="value => { if (!value) { deleteTarget = null; deleteReason = ''; deleteFormError = '' } }">
      <template #header><h3 class="text-lg font-semibold">删除对话</h3></template>
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-600">
            确认删除对话 <span class="font-medium">{{ deleteTarget?.title }}</span>（{{ deleteTarget?.teacherName }}）？
          </p>
          <p class="rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-700">
            将删除对话及全部消息（含已软删消息），<strong>评估与方案记录保留</strong>。删除后不可恢复。
          </p>
          <UFormField label="操作事由" required>
            <UTextarea v-model="deleteReason" :rows="3" placeholder="请输入删除事由（至少 10 个字符）" class="w-full" />
          </UFormField>
          <p v-if="deleteFormError" class="text-sm text-red-600">{{ deleteFormError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="outline" @click="deleteTarget = null">取消</UButton>
          <UButton color="error" :loading="saving" :disabled="!canDelete" @click="confirmDelete">确认删除</UButton>
        </div>
      </template>
    </UModal>
  </ManagementPage>
</template>
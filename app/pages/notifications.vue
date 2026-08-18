<script setup lang="ts">
import { moduleMeta } from '#shared/assessments'

type EventKind = 'notification' | 'action' | 'review' | 'draft' | 'assignment' | 'student_event'
type EventFilter = 'all' | EventKind
type EventPriority = 'P0' | 'P1' | 'P2' | 'P3'
type EventStage = 'new' | 'todo' | 'doing' | 'done' | 'info'

interface CenterEvent {
  id: string
  kind: EventKind
  priority: EventPriority
  stage: EventStage
  title: string
  body: string
  nextStep: string
  time?: string | Date | null
  unread?: boolean
  urgent?: boolean
  to?: string
  actionLabel?: string
  raw?: any
}

const toast = useToast()
const { user } = useAuth()
const { targetTypeLabel } = useDisplayLabels()
// 从工作台「查看全部」等入口过来时会带 ?tab=actions，之前这个参数没人读，
// 点进来永远落在「全部」。
const route = useRoute()
const FILTER_VALUES: EventFilter[] = ['all', 'notification', 'action', 'review', 'draft', 'assignment', 'student_event']
const routedFilter = String(route.query.tab || '') as EventFilter
const activeFilter = ref<EventFilter>(FILTER_VALUES.includes(routedFilter) ? routedFilter : 'all')
const completingActionId = ref<string | null>(null)
const selectedEventId = ref<string | null>(null)

const { data: notifications, refresh: refreshNotifications, status: notificationStatus } = await useFetch<any[]>('/api/v1/notifications')
const {
  data: workbench,
  refresh: refreshWorkbench,
  status: workbenchStatus
} = await useFetch<any>('/api/v1/workbench/today', { immediate: user.value?.role === 'teacher' })
const {
  data: studentEventsData,
  refresh: refreshStudentEvents,
  status: studentEventsStatus
} = await useFetch<any>('/api/v1/information/student-events', { immediate: user.value?.role === 'teacher' })

const filterItems: Array<{ label: string, value: EventFilter, icon: string }> = [
  { label: '全部', value: 'all', icon: 'i-lucide-inbox' },
  { label: '通知', value: 'notification', icon: 'i-lucide-bell' },
  { label: '待执行', value: 'action', icon: 'i-lucide-list-checks' },
  { label: '待复盘', value: 'review', icon: 'i-lucide-refresh-ccw' },
  { label: '草稿', value: 'draft', icon: 'i-lucide-file-clock' },
  { label: '移交', value: 'assignment', icon: 'i-lucide-git-branch' },
  { label: '事件记录', value: 'student_event', icon: 'i-lucide-clipboard-list' }
]

const kindMeta: Record<EventKind, { label: string, icon: string, color: any }> = {
  notification: { label: '通知', icon: 'i-lucide-bell', color: 'primary' },
  action: { label: '待执行', icon: 'i-lucide-list-checks', color: 'warning' },
  review: { label: '待复盘', icon: 'i-lucide-refresh-ccw', color: 'info' },
  draft: { label: '草稿', icon: 'i-lucide-file-clock', color: 'neutral' },
  assignment: { label: '移交', icon: 'i-lucide-git-branch', color: 'success' },
  student_event: { label: '事件记录', icon: 'i-lucide-clipboard-list', color: 'warning' }
}

const priorityMeta: Record<EventPriority, { label: string, color: any, rank: number, description: string }> = {
  P0: { label: 'P0 紧急', color: 'error', rank: 0, description: '安全或危机相关事件，优先查看并按校内流程处理。' },
  P1: { label: 'P1 今日', color: 'warning', rank: 1, description: '今日应处理或已逾期事项，建议优先闭环。' },
  P2: { label: 'P2 建议', color: 'info', rank: 2, description: '建议继续推进的工作事项。' },
  P3: { label: 'P3 知悉', color: 'neutral', rank: 3, description: '普通通知或记录性事件，阅读确认即可。' }
}

const stageMeta: Record<EventStage, { label: string, color: any }> = {
  new: { label: '新事件', color: 'success' },
  todo: { label: '待处理', color: 'warning' },
  doing: { label: '处理中', color: 'info' },
  done: { label: '已完成', color: 'neutral' },
  info: { label: '知悉', color: 'primary' }
}

const isTeacher = computed(() => user.value?.role === 'teacher')
const loading = computed(() => notificationStatus.value === 'pending' || (isTeacher.value && (workbenchStatus.value === 'pending' || studentEventsStatus.value === 'pending')))

const notificationEvents = computed<CenterEvent[]>(() => (notifications.value || []).map((item: any) => ({
  id: `notification:${item.id}`,
  kind: 'notification',
  priority: notificationPriority(item),
  stage: item.readAt ? 'done' : 'new',
  title: item.title,
  body: item.body,
  nextStep: item.readAt ? '这条通知已读，可按需进入关联页面查看。' : '先阅读通知内容；如有关联页面，可进入后继续处理。',
  time: item.createdAt,
  unread: !item.readAt,
  urgent: notificationPriority(item) === 'P0',
  to: notificationTargetUrl(item),
  actionLabel: item.readAt ? '查看' : '标记已读',
  raw: item
})))

const actionEvents = computed<CenterEvent[]>(() => (workbench.value?.actions || []).map((item: any) => ({
  id: `action:${item.id}`,
  kind: 'action',
  priority: item.overdue ? 'P1' : 'P2',
  stage: item.status === 'in_progress' ? 'doing' : 'todo',
  // 用 action detail 做主标题（真正要做什么），而非抽象的 "针对「xxx」"
  title: item.detail,
  body: (moduleMeta as Record<string, { title: string }>)[item.planModule]?.title || item.planTitle || '',
  nextStep: item.overdue ? '该动作已逾期，建议先完成或进入方案调整后续安排。' : '按方案完成该动作，完成后在这里标记闭环。',
  time: item.dueAt,
  urgent: item.overdue,
  to: `/plans/${item.planId}`,
  actionLabel: '标记完成',
  raw: item
})))

const reviewEvents = computed<CenterEvent[]>(() => (workbench.value?.reviews || []).map((item: any) => ({
  id: `review:${item.id}`,
  kind: 'review',
  priority: item.nextReviewAt && new Date(item.nextReviewAt).getTime() < Date.now() ? 'P1' : 'P2',
  stage: 'todo',
  title: `复盘：${item.title}`,
  body: `${moduleMeta[item.module as keyof typeof moduleMeta]?.title || '方案'} 需要复盘，补充执行效果和下一步动作。`,
  nextStep: '进入方案页，填写效果评分、进展记录和下一步动作。',
  time: item.nextReviewAt,
  urgent: item.nextReviewAt ? new Date(item.nextReviewAt).getTime() < Date.now() : false,
  to: `/plans/${item.id}`,
  actionLabel: '去复盘',
  raw: item
})))

const draftEvents = computed<CenterEvent[]>(() => (workbench.value?.drafts || []).map((item: any) => ({
  id: `draft:${item.id}`,
  kind: 'draft',
  priority: 'P2',
  stage: 'todo',
  title: `继续评估：${moduleMeta[item.module as keyof typeof moduleMeta]?.title || item.module}`,
  body: `已填写 ${item.answerCount || 0} 题，继续完成后会生成报告和行动方案。`,
  nextStep: '继续填写评估；提交后系统会生成报告和后续行动方案。',
  time: item.updatedAt,
  to: `/module/${item.module}`,
  actionLabel: '继续填写',
  raw: item
})))

const assignmentEvents = computed<CenterEvent[]>(() => (workbench.value?.recentAssignments || []).map((item: any) => ({
  id: `assignment:${item.id}`,
  kind: 'assignment',
  priority: 'P2',
  stage: 'todo',
  title: '收到业务档案移交',
  body: item.reason || '有新的业务档案已移交给您负责，请在信息中心查看。',
  nextStep: '进入信息中心查看新负责的档案，并根据需要发起咨询、评估或记录跟进。',
  time: item.createdAt,
  to: '/information',
  actionLabel: '查看档案',
  raw: item
})))

const studentEvents = computed<CenterEvent[]>(() => (studentEventsData.value?.rows || []).map((item: any) => ({
  id: `student_event:${item.id}`,
  kind: 'student_event' as EventKind,
  priority: (item.severity === '严重' ? 'P0' : item.severity === '高' ? 'P1' : item.severity === '中' ? 'P2' : 'P3') as EventPriority,
  stage: (item.status === 'open' ? 'todo' : item.status === 'resolved' ? 'doing' : 'done') as EventStage,
  title: item.title,
  body: `${item.studentName || '未知学生'} · ${item.eventType} · ${item.description || '暂无描述'}`,
  nextStep: item.status === 'open' ? '该事件尚未处置，请在信息中心补充处置措施。' : item.status === 'resolved' ? '事件已处置，可进入学生档案查看详情。' : '事件已关闭。',
  time: item.occurredAt,
  urgent: item.severity === '严重' || item.severity === '高',
  to: `/information/students/${item.studentId}`,
  actionLabel: '查看学生档案',
  raw: item
})))

const allEvents = computed(() => [
  ...actionEvents.value,
  ...reviewEvents.value,
  ...notificationEvents.value,
  ...draftEvents.value,
  ...assignmentEvents.value,
  ...studentEvents.value
].sort((a, b) => priorityMeta[a.priority].rank - priorityMeta[b.priority].rank || eventTime(b) - eventTime(a)))

const filteredEvents = computed(() =>
  activeFilter.value === 'all'
    ? allEvents.value
    : allEvents.value.filter(item => item.kind === activeFilter.value)
)

const eventCounts = computed<Record<EventFilter, number>>(() => ({
  all: allEvents.value.length,
  notification: notificationEvents.value.length,
  action: actionEvents.value.length,
  review: reviewEvents.value.length,
  draft: draftEvents.value.length,
  assignment: assignmentEvents.value.length,
  student_event: studentEvents.value.length
}))

const openCount = computed(() => actionEvents.value.length + reviewEvents.value.length + draftEvents.value.length)
const unreadCount = computed(() => notificationEvents.value.filter(item => item.unread).length)
const urgentCount = computed(() => allEvents.value.filter(item => item.urgent).length)
const selectedEvent = computed(() => {
  if (!allEvents.value.length) return null
  return allEvents.value.find(item => item.id === selectedEventId.value) || filteredEvents.value[0] || allEvents.value[0] || null
})

watch(filteredEvents, (items) => {
  if (!items.length) {
    selectedEventId.value = null
    return
  }
  if (!items.some(item => item.id === selectedEventId.value)) selectedEventId.value = items[0]!.id
}, { immediate: true })

function eventTime(item: CenterEvent) {
  return item.time ? new Date(item.time).getTime() : 0
}

function formatTime(value?: string | Date | null) {
  if (!value) return '时间未定'
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function notificationTargetUrl(item: any) {
  if (!item.targetId) return undefined
  if (item.targetType === 'plan') return `/plans/${item.targetId}`
  if (item.targetType === 'student') return `/information/students/${item.targetId}`
  if (item.targetType === 'guardian') return `/information/guardians/${item.targetId}`
  if (item.targetType === 'referral') {
    if (user.value?.role === 'psychologist') return '/specialist'
    if (user.value?.role === 'school_admin') return '/school-admin'
  }
  if (item.targetType === 'conversation') return '/'
  return undefined
}

function notificationPriority(item: any): EventPriority {
  if (item.type === 'referral_assigned' || item.targetType === 'referral' || item.targetType === 'safety_event') return 'P0'
  if (!item.readAt) return 'P2'
  return 'P3'
}

function detailRows(item: CenterEvent) {
  const rows = [
    { label: '类型', value: kindMeta[item.kind].label },
    { label: '状态', value: stageMeta[item.stage].label },
    { label: '优先级', value: priorityMeta[item.priority].label },
    { label: '时间', value: formatTime(item.time) }
  ]
  if (item.raw?.planTitle) rows.push({ label: '关联方案', value: item.raw.planTitle })
  if (item.raw?.targetType) rows.push({ label: '关联对象', value: targetTypeLabel(item.raw.targetType) })
  return rows
}

function selectEvent(item: CenterEvent) {
  selectedEventId.value = item.id
}

async function refreshCenter() {
  await refreshNotifications()
  if (isTeacher.value) {
    await refreshWorkbench()
    await refreshStudentEvents()
  }
}

async function markRead(eventItem: CenterEvent) {
  const id = eventItem.raw?.id
  if (!id || !eventItem.unread) return
  try {
    await $fetch(`/api/v1/notifications/${id}/read`, { method: 'PATCH' })
    await refreshNotifications()
  } catch (error: any) {
    toast.add({ title: '操作失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  }
}

async function readAll() {
  try {
    await $fetch('/api/v1/notifications/read-all', { method: 'POST' })
    toast.add({ title: '已全部标记为已读', color: 'success' })
    await refreshNotifications()
  } catch (error: any) {
    toast.add({ title: '操作失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  }
}

async function completeAction(eventItem: CenterEvent) {
  const action = eventItem.raw
  if (!action?.id || completingActionId.value) return
  completingActionId.value = action.id
  try {
    await $fetch(`/api/v1/plans/${action.planId}/actions`, {
      method: 'PATCH',
      body: { actionId: action.id, status: 'completed' }
    })
    toast.add({ title: '已完成该动作', color: 'success' })
    await refreshCenter()
  } catch (error: any) {
    toast.add({ title: '更新失败', description: error?.data?.message || '请稍后重试', color: 'error' })
  } finally {
    completingActionId.value = null
  }
}

async function handlePrimary(eventItem: CenterEvent) {
  if (eventItem.kind === 'notification') {
    await markRead(eventItem)
    if (eventItem.to) await navigateTo(eventItem.to)
    return
  }
  if (eventItem.to) await navigateTo(eventItem.to)
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-5 py-8 sm:py-12">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="text-sm font-semibold text-emerald-700">从提醒到处理闭环</p>
        <h1 class="mt-2 text-3xl font-semibold">工作日志</h1>
        <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-500">聚合通知、到期动作、复盘、草稿和档案移交；先处理高优先级事件，再回到方案或信息中心完成闭环。</p>
      </div>
      <div class="flex gap-2">
        <UButton color="neutral" variant="soft" icon="i-lucide-refresh-cw" :loading="loading" @click="refreshCenter">刷新</UButton>
        <UButton color="neutral" variant="soft" icon="i-lucide-check-check" :disabled="!unreadCount" @click="readAll">通知全读</UButton>
      </div>
    </div>

    <div class="mt-8 grid gap-4 md:grid-cols-3">
      <div class="panel p-5"><p class="text-sm text-slate-500">待处理事件</p><strong class="mt-2 block text-3xl">{{ openCount }}</strong><span class="mt-1 block text-xs text-slate-400">动作、复盘和草稿</span></div>
      <div class="panel p-5"><p class="text-sm text-slate-500">未读通知</p><strong class="mt-2 block text-3xl">{{ unreadCount }}</strong><span class="mt-1 block text-xs text-slate-400">点击事件后自动标记</span></div>
      <div class="panel p-5"><p class="text-sm text-slate-500">逾期/紧急</p><strong class="mt-2 block text-3xl">{{ urgentCount }}</strong><span class="mt-1 block text-xs text-slate-400">建议优先处理</span></div>
    </div>

    <div class="mt-6 flex gap-2 overflow-x-auto pb-1">
      <button
        v-for="item in filterItems"
        :key="item.value"
        type="button"
        class="flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm transition"
        :class="activeFilter === item.value ? 'border-emerald-600 bg-emerald-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50'"
        @click="activeFilter = item.value"
      >
        <UIcon :name="item.icon" class="size-4" />
        {{ item.label }}
        <span class="rounded-full px-2 py-0.5 text-xs" :class="activeFilter === item.value ? 'bg-white/20' : 'bg-slate-100 text-slate-500'">{{ eventCounts[item.value] }}</span>
      </button>
    </div>

    <div class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div class="panel overflow-hidden">
        <div v-if="loading" class="p-8 text-center text-sm text-slate-500"><UIcon name="i-lucide-loader-circle" class="mr-2 animate-spin" />正在整理事件</div>
        <div
          v-for="item in filteredEvents"
          v-else
          :key="item.id"
          role="button"
          tabindex="0"
          class="grid w-full gap-4 border-b border-slate-100 p-5 text-left transition last:border-0 hover:bg-slate-50 md:grid-cols-[auto_1fr_auto]"
          :class="selectedEvent?.id === item.id ? 'bg-emerald-50/70 ring-1 ring-inset ring-emerald-100' : ''"
          @click="selectEvent(item)"
          @keydown.enter.prevent="selectEvent(item)"
          @keydown.space.prevent="selectEvent(item)"
        >
          <div class="grid size-10 place-items-center rounded-2xl" :class="item.priority === 'P0' ? 'bg-red-100 text-red-700' : item.priority === 'P1' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'">
            <UIcon :name="kindMeta[item.kind].icon" class="size-5" />
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge v-if="item.urgent" color="error" variant="soft">逾期</UBadge>
              <UBadge :color="kindMeta[item.kind].color" variant="soft">{{ kindMeta[item.kind].label }}</UBadge>
              <span class="text-xs text-slate-400">{{ formatTime(item.time) }}</span>
            </div>
            <h2 class="mt-2 font-semibold text-slate-900">{{ item.title }}</h2>
            <p class="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{{ item.body }}</p>
          </div>
          <div class="flex items-center gap-2 md:justify-end">
            <span v-if="item.unread" class="size-2 rounded-full bg-emerald-500" />
            <UButton
              v-if="item.to || (item.kind === 'notification' && item.unread)"
              size="xs"
              color="neutral"
              variant="soft"
              trailing-icon="i-lucide-arrow-right"
              @click.stop="handlePrimary(item)"
            >{{ item.kind === 'action' ? '查看方案' : item.actionLabel || '处理' }}</UButton>
            <UIcon name="i-lucide-chevron-right" class="text-slate-300" />
          </div>
        </div>
        <div v-if="!loading && !filteredEvents.length" class="p-12 text-center text-sm text-slate-400">
          <UIcon name="i-lucide-inbox" class="mx-auto mb-3 size-8" />
          当前分类没有事件
        </div>
      </div>

      <aside class="panel h-fit overflow-hidden lg:sticky lg:top-24">
        <template v-if="selectedEvent">
          <div class="border-b border-slate-100 p-5">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge :color="priorityMeta[selectedEvent.priority].color" variant="soft">{{ priorityMeta[selectedEvent.priority].label }}</UBadge>
              <UBadge :color="stageMeta[selectedEvent.stage].color" variant="soft">{{ stageMeta[selectedEvent.stage].label }}</UBadge>
            </div>
            <h2 class="mt-3 text-xl font-semibold">{{ selectedEvent.title }}</h2>
            <p class="mt-2 text-sm leading-6 text-slate-600">{{ selectedEvent.body }}</p>
          </div>

          <div class="space-y-5 p-5">
            <UAlert
              :color="priorityMeta[selectedEvent.priority].color"
              variant="soft"
              title="下一步建议"
              :description="selectedEvent.nextStep"
            />

            <div>
              <h3 class="text-sm font-semibold text-slate-900">事件信息</h3>
              <dl class="mt-3 space-y-2 text-sm">
                <div v-for="row in detailRows(selectedEvent)" :key="row.label" class="flex justify-between gap-4 rounded-xl bg-slate-50 px-3 py-2">
                  <dt class="text-slate-400">{{ row.label }}</dt>
                  <dd class="text-right text-slate-700">{{ row.value }}</dd>
                </div>
              </dl>
            </div>

            <div>
              <h3 class="text-sm font-semibold text-slate-900">处理动作</h3>
              <div class="mt-3 grid gap-2">
                <UButton
                  v-if="selectedEvent.kind === 'action'"
                  block
                  color="primary"
                  icon="i-lucide-check"
                  :loading="completingActionId === selectedEvent.raw?.id"
                  @click="completeAction(selectedEvent)"
                >标记该动作已完成</UButton>
                <UButton
                  v-if="selectedEvent.kind === 'notification' && selectedEvent.unread"
                  block
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-check-check"
                  @click="markRead(selectedEvent)"
                >标记通知已读</UButton>
                <UButton
                  v-if="selectedEvent.to"
                  block
                  color="neutral"
                  variant="ghost"
                  trailing-icon="i-lucide-arrow-right"
                  @click="handlePrimary(selectedEvent)"
                >{{ selectedEvent.actionLabel || '进入处理页面' }}</UButton>
              </div>
            </div>

            <div class="rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-500">
              <p class="font-semibold text-slate-700">闭环原则</p>
              <p class="mt-1">工作日志只展示最小必要信息；具体正文、复盘和档案仍回到对应业务页面处理，避免在聚合页扩散敏感内容。</p>
            </div>
          </div>
        </template>
        <div v-else class="p-10 text-center text-sm text-slate-400">
          <UIcon name="i-lucide-mouse-pointer-click" class="mx-auto mb-3 size-8" />
          选择左侧事件查看处理建议
        </div>
      </aside>
    </div>
  </div>
</template>

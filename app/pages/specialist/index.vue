<script setup lang="ts">
const statusFilter = ref('all')
const { data: referralData, refresh } = await useFetch<{ rows: any[] }>('/api/v1/specialist/referrals', {
  query: computed(() => ({ page: 1, pageSize: 100, status: statusFilter.value }))
})
const data = computed(() => referralData.value?.rows || [])
const note = reactive<Record<string,string>>({})
const closureReason = reactive<Record<string,string>>({})
const details = reactive<Record<string, any>>({})
const pending = ref<string>()
const toast = useToast()
const { referralStatusLabel, referralStatusColor, severityLabel, priorityLabel } = useDisplayLabels()

function remaining(seconds: number | null) {
  if (seconds === null) return '已停止计时'
  const overdue = seconds < 0
  const absolute = Math.abs(seconds)
  const minutes = Math.floor(absolute / 60)
  const rest = absolute % 60
  return `${overdue ? '已超时' : '剩余'} ${minutes}分${rest}秒`
}

async function loadDetail(id: string) {
  if (details[id]) { delete details[id]; return }
  try { details[id] = await $fetch(`/api/v1/specialist/referrals/${id}`) }
  catch (error: any) { toast.add({ title: '工单详情加载失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
}

async function update(id:string,status:'acknowledged'|'offline_handling'|'closed') {
  pending.value = id
  try {
    await $fetch(`/api/v1/specialist/referrals/${id}`, {
      method:'PATCH', body: { status, note: note[id] || undefined, closureReason: status === 'closed' ? closureReason[id] : undefined }
    })
    toast.add({ title: status === 'acknowledged' ? '已确认收到' : status === 'closed' ? '工单已关闭' : '已记录线下处置', color: 'success' })
    delete details[id]
    await refresh()
  } catch (error: any) { toast.add({ title: '状态更新失败', description: error?.data?.message || '请检查状态和必填项', color: 'error' }) }
  finally { pending.value = undefined }
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-5 py-10">
    <div>
      <p class="text-sm font-semibold text-red-700">安全响应空间</p>
      <h1 class="mt-2 text-3xl font-semibold">心理专员工作台</h1>
      <p class="mt-2 text-sm leading-6 text-slate-500">最小必要转介空间：仅显示当前分配给您的工单，确认、处置和关闭全部留痕。</p>
    </div>
    <div class="mt-6 flex flex-wrap items-center justify-between gap-3"><USelect v-model="statusFilter" :items="[{label:'全部状态',value:'all'},{label:'待确认',value:'created'},{label:'已升级',value:'escalated'},{label:'已确认',value:'acknowledged'},{label:'线下处置',value:'offline_handling'},{label:'已关闭',value:'closed'}]" class="w-44" /><UBadge color="error" variant="soft">{{ data?.filter(x=>x.status==='created'||x.status==='escalated').length||0 }} 个待确认</UBadge></div>
    <div class="mt-5 space-y-5"><article v-for="item in data" :key="item.id" class="panel overflow-hidden"><div class="flex flex-wrap items-center justify-between gap-3 border-b border-red-100 bg-red-50/70 px-6 py-4"><div class="flex items-center gap-3"><span class="grid size-10 place-items-center rounded-xl bg-red-100 text-red-700"><UIcon name="i-lucide-siren" /></span><div><strong>{{ item.teacherName }} · {{ severityLabel(item.severity) }} · {{ priorityLabel(item.priority) }}</strong><p class="mt-1 text-xs text-red-700/60">事件 {{ item.safetyEventId.slice(0,8) }} · {{ new Date(item.eventCreatedAt).toLocaleString('zh-CN') }}</p></div></div><div class="text-right"><UBadge :color="referralStatusColor(item.status)" variant="soft">{{ referralStatusLabel(item.status) }}</UBadge><p v-if="!item.acknowledgedAt" class="mt-1 text-xs" :class="item.acknowledgeRemainingSeconds < 0 ? 'text-red-700 font-semibold':'text-slate-500'">确认 SLA：{{ remaining(item.acknowledgeRemainingSeconds) }}</p></div></div><div class="p-6"><p class="text-sm leading-7">{{ item.summary }}</p><div class="mt-4 flex flex-wrap gap-2"><UBadge v-for="rule in item.matchedRules" :key="rule" color="error" variant="soft">{{ rule }}</UBadge></div><UFormField class="mt-5" label="处置记录"><UTextarea v-model="note[item.id]" :rows="3" class="w-full" placeholder="记录已采取的最小必要处置，不扩散无关信息" /></UFormField><UFormField v-if="item.status==='acknowledged'||item.status==='offline_handling'" class="mt-4" label="关闭原因"><USelect v-model="closureReason[item.id]" :items="[{label:'已妥善处置',value:'resolved'},{label:'转线下持续跟进',value:'transferred_offline'},{label:'复核后排除',value:'false_alarm'},{label:'其他',value:'other'}]" class="w-full" /></UFormField><div class="mt-4 flex flex-wrap gap-2"><UButton v-if="item.status==='created'||item.status==='escalated'" :loading="pending===item.id" @click="update(item.id,'acknowledged')">确认收到</UButton><UButton v-if="item.status==='acknowledged'" color="warning" variant="soft" :loading="pending===item.id" @click="update(item.id,'offline_handling')">开始线下处置</UButton><UButton v-if="item.status==='acknowledged'||item.status==='offline_handling'" color="neutral" variant="soft" :disabled="!closureReason[item.id]" :loading="pending===item.id" @click="update(item.id,'closed')">关闭工单</UButton><UButton color="neutral" variant="ghost" trailing-icon="i-lucide-chevron-down" @click="loadDetail(item.id)">处置时间线</UButton></div><div v-if="details[item.id]" class="mt-5 border-l-2 border-slate-200 pl-5"><div v-for="event in details[item.id].events" :key="event.id" class="relative pb-5 text-sm"><span class="absolute -left-[1.55rem] top-1 size-3 rounded-full border-2 border-white bg-emerald-500" /><strong>{{ referralStatusLabel(event.eventType) }}</strong><p class="mt-1 text-xs text-slate-500">{{ referralStatusLabel(event.fromStatus) }} → {{ referralStatusLabel(event.toStatus) }} · {{ new Date(event.createdAt).toLocaleString('zh-CN') }}</p><p v-if="event.note" class="mt-2 rounded-lg bg-slate-50 p-2 text-xs">{{ event.note }}</p></div></div></div></article><div v-if="!data?.length" class="panel grid min-h-72 place-items-center text-center text-sm text-slate-400"><div><UIcon name="i-lucide-shield-check" class="mx-auto mb-3 size-9 text-emerald-600" /><p>暂无分配给您的转介工单</p></div></div></div>
  </div>
</template>

<script setup lang="ts">
const { data, refresh } = await useFetch<any[]>('/api/v1/specialist/referrals')
const note = reactive<Record<string,string>>({})
async function update(id:string,status:'acknowledged'|'offline_handling'|'closed'){await $fetch(`/api/v1/specialist/referrals/${id}`,{method:'PATCH',body:{status,note:note[id]||undefined}});await refresh()}
</script>

<template>
  <div class="mx-auto max-w-5xl px-5 py-10">
    <div class="flex flex-wrap items-end justify-between gap-4"><div><p class="text-sm font-semibold text-red-700">最小必要转介空间</p><h1 class="mt-2 text-3xl font-semibold">心理专员工作台</h1><p class="mt-2 text-sm text-slate-500">这里只展示分配给您的危机转介，不开放教师历史档案。</p></div><UBadge color="error" variant="soft">{{ data?.filter(x=>x.status==='created').length||0 }} 个新工单</UBadge></div>
    <div class="mt-8 space-y-5"><article v-for="item in data" :key="item.id" class="panel overflow-hidden"><div class="flex flex-wrap items-center justify-between gap-3 border-b border-red-100 bg-red-50/70 px-6 py-4"><div class="flex items-center gap-3"><span class="grid size-10 place-items-center rounded-xl bg-red-100 text-red-700"><UIcon name="i-lucide-siren" /></span><div><strong>{{ item.teacherName }} · {{ item.severity }}</strong><p class="mt-1 text-xs text-red-700/60">{{ new Date(item.eventCreatedAt).toLocaleString('zh-CN') }}</p></div></div><UBadge :color="item.status==='created'?'error':'neutral'" variant="soft">{{ item.status }}</UBadge></div><div class="p-6"><p class="text-sm leading-7">{{ item.summary }}</p><div class="mt-4 flex flex-wrap gap-2"><UBadge v-for="rule in item.matchedRules" :key="rule" color="error" variant="soft">{{ rule }}</UBadge></div><UFormField class="mt-5" label="最小处置备注"><UTextarea v-model="note[item.id]" :rows="3" class="w-full" /></UFormField><div class="mt-4 flex flex-wrap gap-2"><UButton v-if="item.status==='created'" @click="update(item.id,'acknowledged')">确认收到</UButton><UButton color="warning" variant="soft" @click="update(item.id,'offline_handling')">已转线下处置</UButton><UButton color="neutral" variant="soft" @click="update(item.id,'closed')">关闭工单</UButton></div></div></article><div v-if="!data?.length" class="panel grid min-h-72 place-items-center text-center text-sm text-slate-400"><div><UIcon name="i-lucide-shield-check" class="mx-auto mb-3 size-9 text-emerald-600" /><p>暂无分配给您的转介工单</p></div></div></div>
  </div>
</template>

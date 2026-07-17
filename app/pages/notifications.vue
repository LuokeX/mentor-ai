<script setup lang="ts">
const toast = useToast()
const { data: notifications, refresh, status } = await useFetch<any[]>('/api/v1/notifications')

async function markRead(id: string) {
  try {
    await $fetch(`/api/v1/notifications/${id}/read`, { method: 'PATCH' })
    await refresh()
  } catch (error: any) { toast.add({ title: '操作失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
}

async function readAll() {
  try {
    await $fetch('/api/v1/notifications/read-all', { method: 'POST' })
    toast.add({ title: '已全部标记为已读', color: 'success' })
    await refresh()
  } catch (error: any) { toast.add({ title: '操作失败', description: error?.data?.message || '请稍后重试', color: 'error' }) }
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-5 py-8 sm:py-12">
    <div class="flex items-center justify-between gap-4"><div><p class="text-sm font-semibold text-emerald-700">个人消息</p><h1 class="mt-2 text-3xl font-semibold">通知中心</h1></div><UButton color="neutral" variant="soft" @click="readAll">全部已读</UButton></div>
    <div class="panel mt-8 overflow-hidden">
      <div v-if="status === 'pending'" class="p-8 text-center text-sm text-slate-500"><UIcon name="i-lucide-loader-circle" class="mr-2 animate-spin" />正在加载</div>
      <button v-for="item in notifications" :key="item.id" class="flex w-full gap-4 border-b border-slate-100 p-5 text-left last:border-0 hover:bg-slate-50" @click="markRead(item.id)">
        <span class="mt-1 size-2 shrink-0 rounded-full" :class="item.readAt ? 'bg-slate-200' : 'bg-emerald-500'" />
        <span class="min-w-0 flex-1"><strong class="text-sm">{{ item.title }}</strong><span class="mt-1 block text-sm leading-6 text-slate-600">{{ item.body }}</span><span class="mt-2 block text-xs text-slate-400">{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</span></span>
      </button>
      <div v-if="status !== 'pending' && !notifications?.length" class="p-10 text-center text-sm text-slate-400"><UIcon name="i-lucide-bell-off" class="mx-auto mb-3 size-7" />暂无通知</div>
    </div>
  </div>
</template>

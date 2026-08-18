<script setup lang="ts">
definePageMeta({ layout: 'default' })

type WorkLog = {
  id: string
  type: string
  title: string | null
  targetUrl: string | null
  createdAt: string
}

const { data: logs, pending, refresh } = await useFetch<WorkLog[]>('/api/v1/growth/work-logs')

const eventMeta: Record<string, { label: string, icon: string, color: string }> = {
  assistant_question_submitted: { label: '使用 AI 助手梳理问题', icon: 'i-lucide-message-circle', color: 'text-sky-600 bg-sky-50' },
  assessment_completed: { label: '完成专项评估', icon: 'i-lucide-clipboard-check', color: 'text-violet-600 bg-violet-50' },
  plan_generated: { label: '生成行动方案', icon: 'i-lucide-file-plus-2', color: 'text-emerald-600 bg-emerald-50' },
  plan_merged: { label: '补充评估并更新方案', icon: 'i-lucide-files', color: 'text-emerald-600 bg-emerald-50' },
  plan_acceptance_updated: { label: '确认方案', icon: 'i-lucide-circle-check', color: 'text-emerald-600 bg-emerald-50' },
  plan_action_updated: { label: '更新方案行动', icon: 'i-lucide-list-checks', color: 'text-indigo-600 bg-indigo-50' },
  plan_action_added: { label: '新增方案行动', icon: 'i-lucide-list-plus', color: 'text-indigo-600 bg-indigo-50' },
  plan_action_blocked: { label: '记录行动受阻', icon: 'i-lucide-circle-alert', color: 'text-amber-700 bg-amber-50' },
  plan_review_completed: { label: '完成方案复盘', icon: 'i-lucide-rotate-ccw', color: 'text-sky-600 bg-sky-50' },
  plan_feedback_submitted: { label: '提交方案反馈', icon: 'i-lucide-message-square-check', color: 'text-slate-600 bg-slate-100' },
  plan_collaboration_needed: { label: '发起协同处理', icon: 'i-lucide-users', color: 'text-amber-700 bg-amber-50' },
  plan_closed: { label: '关闭方案', icon: 'i-lucide-circle-stop', color: 'text-slate-600 bg-slate-100' }
}

function meta(type: string) {
  return eventMeta[type] || { label: '更新工作记录', icon: 'i-lucide-history', color: 'text-slate-600 bg-slate-100' }
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-5 py-8">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-sm font-semibold text-emerald-700">我的成长</p>
        <h1 class="mt-1 text-2xl font-semibold">工作日志</h1>
      </div>
      <UButton icon="i-lucide-refresh-cw" variant="soft" :loading="pending" @click="() => refresh()">刷新</UButton>
    </div>

    <nav class="mt-6 flex gap-2 border-b border-slate-200 pb-3" aria-label="我的成长视图">
      <UButton to="/growth" color="neutral" variant="ghost" icon="i-lucide-chart-no-axes-combined">自我状态分析</UButton>
      <UButton to="/growth/logs" variant="soft" icon="i-lucide-notebook-tabs">工作日志</UButton>
    </nav>

    <div v-if="pending && !logs" class="grid min-h-64 place-items-center text-slate-400">
      <UIcon name="i-lucide-loader-circle" class="size-7 animate-spin" />
    </div>
    <div v-else-if="!logs?.length" class="mt-8 rounded-lg border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
      完成一次咨询、评估或方案行动后，这里会形成工作记录。
    </div>
    <ol v-else class="mt-8 divide-y divide-slate-100 border-y border-slate-100">
      <li v-for="log in logs" :key="`${log.type}-${log.id}`" class="flex gap-4 py-4">
        <span class="grid size-9 shrink-0 place-items-center rounded-lg" :class="meta(log.type).color">
          <UIcon :name="meta(log.type).icon" class="size-4" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-medium text-slate-800">{{ meta(log.type).label }}</p>
            <time class="text-xs text-slate-400">{{ new Date(log.createdAt).toLocaleString('zh-CN') }}</time>
          </div>
          <NuxtLink v-if="log.targetUrl" :to="log.targetUrl" class="mt-1 block truncate text-xs text-emerald-700 hover:underline">
            {{ log.title || '查看相关方案' }}
          </NuxtLink>
        </div>
      </li>
    </ol>
  </div>
</template>

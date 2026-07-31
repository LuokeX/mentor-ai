<script setup lang="ts">
/**
 * 历史评估报告回看。
 *
 * 报告纸复用 AssessmentReportView，与提交后那一刻看到的完全一致——
 * 两处各写一份标记迟早会分叉。
 */
import type { AssessmentReport } from '#shared/reports'

interface AttemptDetail {
  id: string
  module: string
  moduleTitle: string
  assessmentCode: string | null
  definitionVersion: string | null
  submittedAt: string
  report: AssessmentReport | null
  levelName: string | null
  blocked: boolean
  tools: Array<{ title: string, content: string }>
  plan: { id: string, title: string, status: string } | null
}

const route = useRoute()
const id = String(route.params.id)
const { data, error: loadError, refresh } = await useFetch<AttemptDetail>(`/api/v1/assessments/attempts/${id}`)

function printReport() {
  window.print()
}
</script>

<template>
  <div class="report-page mx-auto max-w-4xl px-5 py-10">
    <div class="print-actions mb-6 flex flex-wrap items-center justify-between gap-3">
      <UButton to="/information" color="neutral" variant="ghost" icon="i-lucide-arrow-left" size="sm">返回信息中心</UButton>
      <div class="flex gap-2">
        <UButton v-if="data?.report" icon="i-lucide-printer" color="neutral" variant="soft" size="sm" @click="printReport">打印/归档</UButton>
        <UButton v-if="data?.plan" :to="`/information/plans/${data.plan.id}`" icon="i-lucide-list-checks" size="sm">查看对应方案</UButton>
      </div>
    </div>

    <UAlert
      v-if="loadError"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="评估报告加载失败"
      :description="(loadError as any)?.data?.message || '请检查网络后重试；该记录可能已被删除。'"
    >
      <template #actions>
        <UButton size="xs" color="error" variant="soft" @click="() => refresh()">重试</UButton>
      </template>
    </UAlert>

    <div v-else-if="!data" class="grid min-h-64 place-items-center text-sm text-slate-400">
      <div class="text-center">
        <UIcon name="i-lucide-loader" class="mx-auto mb-3 size-8 animate-spin" />
        <p>加载中...</p>
      </div>
    </div>

    <template v-else>
      <p class="mb-4 text-xs text-slate-400">
        {{ data.moduleTitle }}
        <template v-if="data.assessmentCode"> · {{ data.assessmentCode }}</template>
        · {{ new Date(data.submittedAt).toLocaleString('zh-CN') }} 提交
      </p>

      <!-- 命中红线的评估不生成报告，只留了安全转介记录 -->
      <UAlert
        v-if="!data.report && data.blocked"
        color="error"
        variant="soft"
        icon="i-lucide-siren"
        title="该次评估触发了安全转介"
        description="按安全流程处理，未生成常规评估报告。请在事件中心查看转介记录。"
      />
      <UAlert
        v-else-if="!data.report"
        color="warning"
        variant="soft"
        title="该次评估没有留存报告"
        description="可能是早期版本生成的记录。可在对应方案里查看当时的行动建议。"
      />
      <AssessmentReportView v-else :report="data.report" :tools="data.tools" />
    </template>
  </div>
</template>

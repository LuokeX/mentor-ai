<script setup lang="ts">
/**
 * 正式评估报告纸。
 *
 * 提交后的报告页和历史报告回看页共用这一份标记。
 * 之前只有提交那一刻能看到报告，离开页面后 assessment_attempts.result.report
 * 虽然存着却没有任何读取入口——教师做过的评估结论等于看一次就没了。
 * 两处各写一份 HTML 迟早会分叉，所以抽成组件。
 */
import type { AssessmentReport } from '#shared/reports'

defineProps<{
  report: AssessmentReport
  /** 匹配出的工具卡。空数组时整块不渲染。 */
  tools?: Array<{ title: string, content: string }>
}>()

/** 只呈现强弱分组，不呈现占比小数——占比是规则匹配强度，不是测量精度。 */
function attributionStrengthLabel(strength: 'primary' | 'secondary' | 'reference') {
  return { primary: '主要', secondary: '次要', reference: '参考' }[strength] || '参考'
}
</script>

<template>
  <div class="panel report-sheet p-7 sm:p-9">
    <div class="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-6">
      <div><p class="text-sm font-semibold text-emerald-700">正式评估报告</p><h1 class="mt-2 text-3xl font-semibold">{{ report.printMeta.moduleTitle }}</h1><p class="mt-2 text-xs text-slate-400">生成时间：{{ new Date(report.printMeta.generatedAt).toLocaleString('zh-CN') }} · 版本：{{ report.printMeta.assessmentVersion }}</p></div>
      <UBadge size="xl" color="primary" variant="soft">{{ report.risk.label }}</UBadge>
    </div>
    <div class="mt-7 grid gap-6 lg:grid-cols-[.95fr_1.05fr]">
      <section><h2 class="text-lg font-semibold">问题画像</h2><p class="mt-3 text-sm leading-7 text-slate-600">{{ report.profile.summary }}</p><p class="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">主要关注：{{ report.profile.primaryConcern }}</p></section>
      <section><h2 class="text-lg font-semibold">风险等级</h2><p class="mt-3 text-sm leading-7 text-slate-600">{{ report.risk.description }}</p><p class="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">{{ report.risk.nonDiagnosticNote }}</p></section>
    </div>
    <!--
      归因构成。只呈现主要/次要/参考的分组与排序，不显示占比数字：
      占比反映的是规则匹配强度，直接给出百分比会被当成测量精度承诺。
    -->
    <section v-if="report.attributions?.length" class="mt-8">
      <h2 class="text-lg font-semibold">归因构成</h2>
      <p class="mt-2 text-xs text-slate-400">按规则匹配强度排序，供教育支持参考，不构成诊断。</p>
      <div class="mt-4 space-y-3">
        <div
          v-for="attribution in report.attributions"
          :key="attribution.name"
          class="rounded-xl border p-4"
          :class="attribution.strength === 'primary' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100 bg-white'"
        >
          <div class="flex items-center gap-2">
            <UBadge
              size="sm"
              :color="attribution.strength === 'primary' ? 'primary' : 'neutral'"
              :variant="attribution.strength === 'primary' ? 'solid' : 'soft'"
            >
              {{ attributionStrengthLabel(attribution.strength) }}
            </UBadge>
            <p class="text-sm font-semibold text-slate-800">{{ attribution.name }}</p>
          </div>
          <ul v-if="attribution.reasons?.length" class="mt-2 space-y-1">
            <li v-for="reason in attribution.reasons" :key="reason" class="text-xs leading-5 text-slate-500">· {{ reason }}</li>
          </ul>
        </div>
      </div>
      <p v-if="report.attributionNarrative" class="mt-4 rounded-xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">{{ report.attributionNarrative }}</p>
    </section>
    <section class="mt-8"><h2 class="text-lg font-semibold">关键依据</h2><div class="mt-4 grid gap-3 md:grid-cols-2"><div v-for="item in report.evidence" :key="item.title + item.detail" class="rounded-xl border border-slate-100 p-4"><p class="text-sm font-semibold">{{ item.title }}</p><p class="mt-2 text-xs leading-5 text-slate-500">{{ item.detail }}</p></div></div></section>
    <section class="mt-8" v-if="tools?.length"><h2 class="text-lg font-semibold">工具卡</h2><p v-if="report.toolIntro" class="mt-2 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">{{ report.toolIntro }}</p><div class="mt-4 grid gap-4 md:grid-cols-2"><div v-for="tool in tools" :key="tool.title" class="rounded-xl bg-slate-50 p-4"><p class="text-sm font-semibold">{{ tool.title }}</p><p class="mt-2 text-xs leading-5 text-slate-500">{{ tool.content }}</p></div></div></section>
    <!-- 无匹配工具时整块不渲染，否则会留下一个只有「工具卡」标题的空区 -->
    <section v-if="tools?.length" class="mt-8"><h2 class="text-lg font-semibold">工具卡</h2><p v-if="report.toolIntro" class="mt-2 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">{{ report.toolIntro }}</p><div class="mt-4 grid gap-4 md:grid-cols-2"><div v-for="tool in tools" :key="tool.title" class="rounded-xl bg-slate-50 p-4"><p class="text-sm font-semibold">{{ tool.title }}</p><p class="mt-2 text-xs leading-5 text-slate-500">{{ tool.content }}</p></div></div></section>
    <p class="mt-8 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-400">{{ report.printMeta.disclaimer }}</p>
  </div>
</template>

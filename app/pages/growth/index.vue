<script setup lang="ts">
/**
 * 「我的成长」——能力体检 → 个性化成长路径（方案 V2.0 子系统 A 成长层）。
 * 数据来自自我成长评估的快照回写与历史记录，页面只做呈现。
 */
definePageMeta({ layout: 'default' })

const { data, pending, refresh } = await useFetch<any>('/api/v1/assessments/self-growth/growth-plan')

const severityColor: Record<string, string> = {
  crisis: 'error', high: 'warning', medium: 'info', low: 'success'
}
const severityLabel: Record<string, string> = {
  crisis: '危机', high: '高', medium: '中', low: '低'
}
/** 五色等级 → 徽标颜色（按等级名匹配常见等级词） */
function levelColor(name: string | null | undefined): 'error' | 'warning' | 'info' | 'success' | 'neutral' {
  if (!name) return 'neutral'
  if (/危机|转介|熔断|E 级|L3|LP0|保护/.test(name)) return 'error'
  if (/冲突|协同|干预|L2|LP3|需立即/.test(name)) return 'warning'
  if (/需关注|需谨慎|预警|L1|LP2|关注/.test(name)) return 'info'
  if (/需谨慎|谨慎/.test(name)) return 'warning'
  return 'success'
}
/** 维度趋势：取最近 8 次评估，转成条形数据（每次一个维度条） */
function trendBars(): Array<{ code: string, name: string, points: Array<number | null> }> {
  const t = data.value?.trend ?? []
  if (!t.length) return []
  const dims = new Set<string>()
  for (const item of t) for (const code of Object.keys(item.dimensions ?? {})) dims.add(code)
  const labels = data.value?.dimensionLabels ?? {}
  return [...dims].map(code => ({
    code,
    name: labels[code] || code,
    points: t.map((item: any) => {
      const v = item.dimensions?.[code]
      return v === null || v === undefined ? null : Number(v)
    })
  }))
}
function printPage() {
  window.print()
}
function topSteps(t: any): string[] {
  return (t?.steps || []).slice(0, 4)
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-5 py-8">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-sm font-semibold text-emerald-700">自我成长</p>
        <h1 class="mt-1 text-2xl font-semibold">我的成长</h1>
        <p class="mt-1 text-sm text-slate-500">基于自我状态评估生成的能力体检与成长路径，建议每月回顾一次。</p>
      </div>
      <div class="flex items-center gap-2">
        <UButton variant="soft" icon="i-lucide-refresh-cw" :loading="pending" @click="() => refresh()">刷新</UButton>
        <UButton icon="i-lucide-printer" @click="printPage">打印规划书</UButton>
      </div>
    </div>

    <div v-if="pending && !data" class="mt-8 grid place-items-center py-20 text-slate-400">
      <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin" />
    </div>

    <template v-else>
      <!-- 空状态：还没有评估 -->
      <div v-if="!data?.current && !data?.trend?.length" class="mt-8 rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
        <UIcon name="i-lucide-sprout" class="mx-auto size-10 text-slate-300" />
        <h2 class="mt-3 font-semibold text-slate-700">还没有成长记录</h2>
        <p class="mt-1 text-sm text-slate-500">先在工作台做一次「班主任状态五问」，这里就会生成你的能力画像与成长规划。</p>
        <UButton class="mt-5" to="/module/self_growth">去做自我状态评估</UButton>
      </div>

      <template v-else>
        <!-- 身份画像 -->
        <section class="panel mt-8 p-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-xs text-slate-400">身份画像</p>
              <h2 class="mt-1 text-xl font-semibold">{{ data.profile?.name || '未设置姓名' }}</h2>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <UBadge color="neutral" variant="subtle">
              任教年级：{{ (data.profile?.teachingGrades || []).length ? data.profile.teachingGrades.join('、') + ' 年级' : '未设置' }}
            </UBadge>
            <UBadge color="neutral" variant="subtle">
              班主任年限：{{ data.profile?.classTeacherYears != null ? data.profile.classTeacherYears + ' 年' : '未设置' }}
            </UBadge>
            <UBadge v-if="data.profile?.subject" color="neutral" variant="subtle">学科：{{ data.profile.subject }}</UBadge>
            <UBadge v-if="data.profile?.gender" color="neutral" variant="subtle">性别：{{ data.profile.gender }}</UBadge>
          </div>
          <p class="mt-3 text-xs text-slate-400">身份画像由学校管理员维护，如信息有误请联系学校管理员。</p>
        </section>

        <!-- 当前状态 -->
        <section v-if="data.current" class="panel mt-6 p-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-xs text-slate-400">当前状态（{{ data.current.assessedAt ? new Date(data.current.assessedAt).toLocaleDateString('zh-CN') : '' }}）</p>
              <div class="mt-2 flex items-center gap-2">
                <UBadge :color="levelColor(data.current.levelName)" variant="soft" class="!text-base !px-3 !py-1">{{ data.current.levelName }}</UBadge>
                <span class="text-xs text-slate-400">严重度 {{ severityLabel[data.current.severity] || data.current.severity }}</span>
              </div>
            </div>
            <div class="text-right text-xs text-slate-400">
              <p v-if="data.current.attributions?.length">需要关注的方向：</p>
              <div class="mt-1 flex flex-wrap justify-end gap-1.5">
                <UBadge v-for="a in data.current.attributions" :key="a" color="neutral" variant="subtle">{{ a }}</UBadge>
              </div>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap gap-4 text-sm">
            <p class="text-slate-500">最近深度评估：<span class="font-medium text-slate-700">{{ data.current.assessedAt ? new Date(data.current.assessedAt).toLocaleDateString('zh-CN') : '—' }}</span></p>
            <p class="text-slate-500">建议下次评估：<span class="font-medium text-slate-700">{{ data.nextAssessmentAt ? new Date(data.nextAssessmentAt).toLocaleDateString('zh-CN') : '—' }}</span></p>
          </div>
          <div v-if="data.suggestions?.length" class="mt-4 space-y-1.5 rounded-xl bg-emerald-50/60 p-4">
            <p v-for="(s, i) in data.suggestions" :key="i" class="flex gap-2 text-sm leading-6 text-emerald-900">
              <UIcon name="i-lucide-circle-check" class="mt-1 size-3.5 shrink-0 text-emerald-600" />{{ s }}
            </p>
          </div>
        </section>

        <!-- 维度趋势 -->
        <section v-if="trendBars().length" class="panel mt-6 p-6">
          <h2 class="font-semibold text-slate-800">维度趋势</h2>
          <p class="mt-1 text-xs text-slate-400">最近 {{ data.trend.length }} 次评估的维度得分（越高越需要关注），对比看改善方向。</p>
          <div class="mt-5 space-y-4">
            <div v-for="dim in trendBars()" :key="dim.code">
              <div class="flex items-center justify-between text-sm">
                <span class="font-medium text-slate-600">{{ dim.name }}</span>
                <span class="text-xs text-slate-400">{{ dim.points.filter(p => p !== null).join(' → ') }}</span>
              </div>
              <div class="mt-1.5 flex items-end gap-1">
                <div v-for="(p, i) in dim.points" :key="i" class="flex flex-1 flex-col items-center gap-1">
                  <span class="text-[10px] text-slate-400">{{ p !== null ? p : '—' }}</span>
                  <div class="w-full rounded-t bg-emerald-100 transition-all"
                    :style="{ height: (p !== null ? p * 14 : 4) + 'px', background: p !== null && p >= 4 ? '#f87171' : p !== null && p >= 3 ? '#fbbf24' : '#6ee7b7' }" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 推荐工具 -->
        <section v-if="data.recommendedTools?.length" class="panel mt-6 p-6">
          <h2 class="font-semibold text-slate-800">推荐工具</h2>
          <p class="mt-1 text-xs text-slate-400">按当前最需要关注的方向匹配，建议本周选一项落地。</p>
          <div class="mt-4 grid gap-3 md:grid-cols-3">
            <div v-for="t in data.recommendedTools" :key="t.name" class="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
              <h3 class="font-medium text-slate-700">{{ t.name }}</h3>
              <p class="mt-1 text-xs leading-5 text-slate-500">{{ t.whenToUse }}</p>
              <ol class="mt-3 space-y-1.5">
                <li v-for="(s, i) in topSteps(t)" :key="i" class="flex gap-2 text-xs leading-5 text-slate-500">
                  <span class="grid size-4 shrink-0 place-items-center rounded-full bg-emerald-100 text-[10px] text-emerald-700">{{ i + 1 }}</span>{{ s }}
                </li>
              </ol>
            </div>
          </div>
        </section>

        <!-- 历史记录 -->
        <section v-if="data.trend?.length" class="panel mt-6 p-6">
          <h2 class="font-semibold text-slate-800">评估足迹</h2>
          <div class="mt-3 divide-y divide-slate-100">
            <div v-for="(item, i) in [...data.trend].reverse()" :key="i" class="flex items-center gap-3 py-2.5 text-sm">
              <span class="w-20 shrink-0 text-slate-500">{{ item.assessedAt ? new Date(item.assessedAt).toLocaleDateString('zh-CN') : '—' }}</span>
              <UBadge :color="levelColor(item.levelName)" variant="subtle" class="shrink-0">{{ item.levelName || '—' }}</UBadge>
              <span class="min-w-0 truncate text-xs text-slate-400">{{ item.primaryAttribution || '' }}</span>
            </div>
          </div>
        </section>

        <!-- 成长轨迹 -->
        <section class="panel mt-6 p-6">
          <h2 class="font-semibold text-slate-800">成长轨迹</h2>
          <div class="mt-4 grid gap-3 md:grid-cols-3">
            <div class="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
              <div class="flex items-center gap-2 text-slate-500">
                <UIcon name="i-lucide-check-circle-2" class="size-4" />
                <span class="text-sm">成长打卡次数</span>
              </div>
              <p class="mt-2 text-2xl font-semibold text-slate-800">{{ data.growth?.checkinCount ?? 0 }}</p>
              <p class="mt-1 text-xs text-slate-400">方案动作执行/反馈记录累计</p>
            </div>
            <div class="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
              <div class="flex items-center gap-2 text-slate-500">
                <UIcon name="i-lucide-message-circle" class="size-4" />
                <span class="text-sm">求助记录</span>
              </div>
              <p class="mt-2 text-2xl font-semibold text-slate-800">{{ data.growth?.helpCount ?? 0 }}</p>
              <p class="mt-1 text-xs text-slate-400">个人成长模块的 AI 咨询会话数</p>
            </div>
            <div class="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
              <div class="flex items-center gap-2 text-slate-500">
                <UIcon name="i-lucide-clipboard-list" class="size-4" />
                <span class="text-sm">当前执行方案</span>
              </div>
              <p v-if="data.growth?.currentPlan" class="mt-2 text-sm font-medium text-slate-800">{{ data.growth.currentPlan.title }}</p>
              <p v-else class="mt-2 text-sm text-slate-400">暂无进行中的方案</p>
              <div v-if="data.growth?.currentPlan?.tools?.length" class="mt-2 space-y-1">
                <p v-for="(t, i) in data.growth.currentPlan.tools" :key="i" class="flex items-center gap-1.5 text-xs text-slate-500">
                  <UIcon name="i-lucide-wrench" class="size-3" />{{ t.title || t }}
                </p>
              </div>
              <NuxtLink v-if="data.growth?.currentPlan" :to="`/information/plans/${data.growth.currentPlan.id}`" class="mt-2 inline-block text-xs text-emerald-700 hover:underline">
                查看方案与执行记录 →
              </NuxtLink>
            </div>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>
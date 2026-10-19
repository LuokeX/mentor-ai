<script setup lang="ts">
/**
 * 学校管理员 · 平台使用量看板（PRD 8.3 的 S1 / S2 / S4）。
 *
 * 2026-10-08 起原「学校系统管理员」角色已并入学校管理员，本页随之下放给学校管理员；
 * 只用平台系统层面的运营数据：账号开通量、角色分布、使用量趋势与操作审计日志；
 * 不展示任何业务数据（评估、方案、对话、学生、家长、转介等）。
 * S1 = 平台使用总览；S2 = 使用量趋势（访问人次与人均使用时长来自客户端活跃心跳埋点，
 * 见 shared/school-usage.ts 顶部口径；活跃账号数/提问数保留为业务动作口径）；
 * S4 = 学校操作审计日志。
 */
import { USAGE_DEFAULT_DAYS, USAGE_MAX_DAYS, type SchoolUsageResponse } from '#shared/school-usage'

const { start, end, period, rangeError, applyPreset } = useDashboardRange({
  defaultDays: USAGE_DEFAULT_DAYS,
  maxDays: USAGE_MAX_DAYS
})

const q = ref('')
const page = ref(1)
const pageSize = ref(20)

const params = computed(() => compactDashboardQuery({
  start: start.value,
  end: end.value,
  q: q.value,
  page: page.value,
  pageSize: pageSize.value
}))

const { data, pending, error } = await useFetch<SchoolUsageResponse>('/api/v1/school-admin/usage', {
  query: params,
  watch: [params]
})

const presets = [
  { label: '近 7 天', days: 7 },
  { label: '近 30 天', days: 30 },
  { label: '近 90 天', days: 90 }
]

const overview = computed(() => data.value?.overview ?? null)
const trend = computed(() => data.value?.trend ?? [])
const audits = computed(() => data.value?.audits.rows ?? [])
const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.audits.total ?? 0) / pageSize.value)))

const formatTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

const RESULT_LABELS: Record<string, string> = { success: '成功', denied: '被拒绝', failure: '失败' }

watch([start, end], () => { page.value = 1 })
watch(pageSize, () => { page.value = 1 })
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(q, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1 }, 300)
})
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-5 px-5 py-8">
    <header class="space-y-1">
      <h1 class="text-xl font-semibold text-slate-800">平台使用量</h1>
      <p class="flex flex-wrap items-center gap-x-1.5 text-sm text-slate-500">
        账号开通与使用情况、学校操作审计日志（只读视图，不含任何业务数据）
        <span class="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">🔒 仅账号与使用量统计，不含业务正文</span>
      </p>
    </header>

    <section class="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <DashboardPeriodPicker
        v-model:start="start"
        v-model:end="end"
        :presets="presets"
        :range-error="rangeError"
        @preset="applyPreset"
      />
      <p class="text-xs text-slate-400">统计口径：{{ period.start }} ~ {{ period.end }}</p>
    </section>

    <div v-if="error" class="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
      {{ (error.data as { message?: string } | undefined)?.message || '数据加载失败，请稍后重试' }}
    </div>

    <template v-else>
      <section class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <DashboardStatCard label="开通账号" :value="overview?.accounts ?? 0" unit="个" hint="本校全部账号（含待激活）" />
        <DashboardStatCard label="已激活" :value="overview?.activated ?? 0" unit="个" />
        <DashboardStatCard label="待激活" :value="overview?.invited ?? 0" unit="个" />
        <DashboardStatCard label="已停用" :value="overview?.disabled ?? 0" unit="个" />
        <DashboardStatCard label="周期内活跃（登录）" :value="overview?.activeInPeriod ?? 0" unit="个" hint="最近登录时间落在区间内" />
        <DashboardStatCard label="周期内活跃（使用）" :value="overview?.activeByEvents ?? 0" unit="个" hint="按平台使用事件去重的账号数（不含活跃心跳）" />
        <DashboardStatCard label="访问人次" :value="overview?.visitsInPeriod ?? 0" unit="次" hint="活跃心跳按空闲 30 分钟切段；心跳上线前的历史趋势见下方估算曲线" />
        <DashboardStatCard label="人均使用时长" :value="overview?.avgDurationMinutes ?? null" unit="分钟" hint="当日总时长 ÷ 当日去重账号数；按 5 分钟心跳折算" />
        <DashboardStatCard label="教师提问数" :value="overview?.aiQuestions ?? 0" unit="条" hint="周期内提问次数（不含已删除）" />
        <DashboardStatCard label="新建方案数" :value="overview?.plans ?? 0" unit="个" />
      </section>

      <section class="grid gap-3 lg:grid-cols-2">
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">分日访问用户人次</h2>
          <DashboardLineChart
            :labels="trend.map(item => item.date)"
            :series="[
              { name: '访问人次（心跳）', values: trend.map(item => item.visits) },
              { name: '访问人次（估算）', values: trend.map(item => item.estimatedVisits) },
              { name: '活跃账号', values: trend.map(item => item.activeUsers) }
            ]"
          />
          <p class="mt-2 text-[11px] text-slate-400">
            心跳口径：页面可见时每 5 分钟一次，同一账号同一会话空闲超过 30 分钟算新的一次访问。心跳上线前没有真实数据，图中「访问人次（估算）」按产品事件（提问 / 量表 / 方案等）以账号 30 分钟空闲切段补位，口径不同，仅用于观察趋势。活跃账号按平台使用事件去重。
          </p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">分日人均使用时长</h2>
          <DashboardLineChart
            :labels="trend.map(item => item.date)"
            :series="[{ name: '人均使用时长', values: trend.map(item => item.avgDurationMinutes) }]"
            suffix=" 分钟"
          />
          <p class="mt-2 text-[11px] text-slate-400">
            按 5 分钟心跳折算累计时长（单账号单日封顶 24 小时），再除以当天去重账号数；心跳上线前的日期显示为「—」，没有可还原的真实时长。
          </p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">使用量趋势</h2>
          <DashboardLineChart
            :labels="trend.map(item => item.date)"
            :series="[
              { name: '活跃账号', values: trend.map(item => item.activeUsers) },
              { name: '提问数', values: trend.map(item => item.aiQuestions) }
            ]"
          />
          <p class="mt-2 text-[11px] text-slate-400">每日活跃账号数按平台使用事件去重统计（不含活跃心跳）。</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <h2 class="mb-3 text-sm font-medium text-slate-700">角色分布</h2>
          <DashboardRankTable
            :rows="(overview?.roleDistribution ?? []).map(item => ({ label: item.roleLabel, value: item.count }))"
            value-label="人"
          />
          <p class="mt-2 text-[11px] text-slate-400">按账号持有的角色统计；一人多角色会计入多个角色。</p>
        </div>
      </section>

      <section class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-medium text-slate-700">操作审计日志</h2>
          <input
            v-model="q"
            type="search"
            placeholder="按操作名或操作人筛选"
            class="w-56 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none"
          >
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[760px] text-sm">
            <thead>
              <tr class="border-b border-slate-100 text-left text-xs text-slate-500">
                <th class="py-2 pr-3 font-normal">时间</th>
                <th class="py-2 pr-3 font-normal">操作人</th>
                <th class="py-2 pr-3 font-normal">角色</th>
                <th class="py-2 pr-3 font-normal">操作</th>
                <th class="py-2 pr-3 font-normal">对象</th>
                <th class="py-2 pr-3 font-normal">结果</th>
                <th class="py-2 pr-3 font-normal">来源 IP</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in audits" :key="row.id" class="border-b border-slate-50 last:border-0">
                <td class="py-2 pr-3 text-slate-500">{{ formatTime(row.createdAt) }}</td>
                <td class="py-2 pr-3 text-slate-600">{{ row.actorName ?? '—' }}</td>
                <td class="py-2 pr-3 text-slate-500">{{ row.actorRoleLabel ?? '—' }}</td>
                <td class="py-2 pr-3 text-slate-600">{{ row.action }}</td>
                <td class="py-2 pr-3 text-slate-500">{{ row.targetType ?? '—' }}</td>
                <td class="py-2 pr-3 text-slate-500">{{ RESULT_LABELS[row.result] ?? row.result }}</td>
                <td class="py-2 pr-3 text-slate-400">{{ row.ipAddress ?? '—' }}</td>
              </tr>
              <tr v-if="!audits.length">
                <td colspan="7" class="py-8 text-center text-sm text-slate-400">所选条件暂无审计记录</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>共 {{ data?.audits.total ?? 0 }} 条，第 {{ page }} / {{ totalPages }} 页<span v-if="pending" class="ml-2 text-slate-400">加载中…</span></span>
          <div class="flex items-center gap-2">
            <select v-model="pageSize" class="rounded-lg border border-slate-200 px-2 py-1 text-xs">
              <option :value="20">20 条/页</option>
              <option :value="50">50 条/页</option>
              <option :value="100">100 条/页</option>
            </select>
            <button type="button" class="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40" :disabled="page <= 1" @click="page -= 1">上一页</button>
            <button type="button" class="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40" :disabled="page >= totalPages" @click="page += 1">下一页</button>
          </div>
        </div>
        <p class="text-[11px] text-slate-400">
          审计日志仅展示操作元数据（谁、何时、做了什么），不含业务正文。
        </p>
      </section>
    </template>
  </div>
</template>

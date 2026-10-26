<script setup lang="ts">
interface CendMe {
  user: { id: string, nickname: string, phone: string }
  points: { balance: number }
  membership: { tier: string, startAt: string, endAt: string } | null
  checkin: { checkinDate: string, streak: number, reward: number } | null
  tasks: Array<{ key: string, title: string, reward: number, completed: boolean, progress?: number, target?: number }>
}
interface PointTransaction {
  id: string
  amount: number
  balanceAfter: number
  type: string
  status: string
  note: string | null
  createdAt: string
}
interface PointsResponse {
  balance: number
  transactions: PointTransaction[]
}

const { user, tenants, switchTenant } = useAuth()
const { refresh: refreshCendBalance } = useCendBalance()
const me = ref<CendMe | null>(null)
const points = ref<PointsResponse | null>(null)
const pending = ref(false)
const checkinPending = ref(false)
const errorMessage = ref('')
const rewardMessage = ref('')

const cendTenant = computed(() => tenants.value.find(item => item.kind === 'cend'))
const isCendWorkspace = computed(() => Boolean(cendTenant.value && user.value?.schoolId === cendTenant.value.schoolId))
const membershipLabel = computed(() => {
  if (!me.value?.membership) return '未开通会员'
  const tierLabels: Record<string, string> = { month: '月度会员', quarter: '季度会员', half_year: '半年会员', year: '年度会员' }
  return `${tierLabels[me.value.membership.tier] || me.value.membership.tier} · 至 ${new Date(me.value.membership.endAt).toLocaleDateString('zh-CN')}`
})
const typeLabels: Record<string, string> = {
  signup_bonus: '注册赠送',
  checkin: '每日签到',
  checkin_streak: '连续签到奖励',
  task_reward: '任务奖励',
  ai_question: 'AI 问答',
  assessment_plan: '量表 + 方案',
  refund: '退回',
  admin_adjust: '运营调整'
}

async function ensureCendWorkspace() {
  if (cendTenant.value && user.value?.schoolId !== cendTenant.value.schoolId) {
    await switchTenant(cendTenant.value.schoolId)
  }
}

async function load() {
  pending.value = true
  errorMessage.value = ''
  try {
    await ensureCendWorkspace()
    const [meData, pointsData] = await Promise.all([
      $fetch<CendMe>('/api/v1/cend/me'),
      $fetch<PointsResponse>('/api/v1/cend/points?page=1&pageSize=20')
    ])
    me.value = meData
    points.value = pointsData
    await refreshCendBalance()
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.message || '加载失败'
  } finally {
    pending.value = false
  }
}

async function checkin() {
  checkinPending.value = true
  rewardMessage.value = ''
  errorMessage.value = ''
  try {
    const result = await $fetch<{ already: boolean, streak: number, reward: number, balance: number }>('/api/v1/cend/checkins', { method: 'POST' })
    if (result.already) {
      rewardMessage.value = '今天已经签到过了'
    } else {
      rewardMessage.value = `签到成功，获得 ${result.reward} 积分（连续 ${result.streak} 天）`
    }
    await load()
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.message || '签到失败'
  } finally {
    checkinPending.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-5 px-5 py-8">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-sm font-medium text-emerald-700">班主任智能体 · C 端</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-800">签到 & 积分中心</h1>
        <p class="mt-1 text-sm text-slate-500">{{ me?.user.nickname || user?.name }} · {{ membershipLabel }}</p>
      </div>
      <div class="flex gap-2">
        <UButton to="/" color="neutral" variant="outline">返回问答</UButton>
        <UButton to="/cend/profile" color="neutral" variant="outline">个人资料</UButton>
      </div>
    </header>

    <div v-if="errorMessage" class="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{{ errorMessage }}</div>
    <div v-if="rewardMessage" class="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">{{ rewardMessage }}</div>

    <section class="grid gap-4 md:grid-cols-[1.1fr_.9fr]">
      <div class="rounded-2xl border border-slate-200 bg-white p-6">
        <p class="text-sm text-slate-500">当前可用积分</p>
        <p class="mt-2 text-4xl font-semibold text-emerald-700">{{ me?.points.balance ?? '—' }}</p>
        <p class="mt-2 text-xs text-slate-400">会员不消耗积分，积分长期不清零</p>
        <div class="mt-5 flex flex-wrap items-center gap-3">
          <UButton :loading="checkinPending" :disabled="Boolean(me?.checkin)" @click="checkin">
            {{ me?.checkin ? '今日已签到' : '立即签到 +200' }}
          </UButton>
          <span v-if="me?.checkin" class="text-xs text-slate-500">已连续签到 {{ me.checkin.streak }} 天</span>
          <NuxtLink to="/cend/profile" class="text-xs text-emerald-700 hover:underline">完善资料再得 200 积分</NuxtLink>
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-6">
        <p class="text-sm font-medium text-slate-700">会员权益</p>
        <p class="mt-2 text-sm text-slate-500">{{ membershipLabel }}</p>
        <p class="mt-3 text-xs leading-6 text-slate-400">会员由运营老师线下开通，支持月度 / 季度 / 半年 / 年度。开通后 AI 问答、量表评估不再消耗积分，积分长期保留。</p>
      </div>
    </section>

    <section class="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 class="text-sm font-medium text-slate-700">任务中心</h2>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <div v-for="task in me?.tasks ?? []" :key="task.key" class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div class="flex items-center justify-between gap-2">
            <strong class="text-sm text-slate-700">{{ task.title }}</strong>
            <UBadge :color="task.completed ? 'success' : 'neutral'" variant="subtle" size="xs">
              {{ task.completed ? '已完成' : '未完成' }}
            </UBadge>
          </div>
          <p class="mt-2 text-xs text-slate-500">一次性 +{{ task.reward }} 积分</p>
          <p v-if="task.target" class="mt-1 text-xs text-slate-400">进度 {{ task.progress ?? 0 }} / {{ task.target }}</p>
          <div v-if="task.key === 'complete_profile' && !task.completed" class="mt-3">
            <UButton size="xs" to="/cend/profile" variant="outline">去完善资料</UButton>
          </div>
          <div v-if="task.key === 'submit_feedback' && !task.completed" class="mt-3">
            <UButton size="xs" to="/cend/profile?feedback=1" variant="outline">去提交反馈</UButton>
          </div>
          <div v-if="task.key === 'first_question' && !task.completed" class="mt-3">
            <UButton size="xs" to="/" variant="outline">去提问</UButton>
          </div>
        </div>
      </div>
    </section>

    <section class="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 class="text-sm font-medium text-slate-700">积分流水</h2>
      <div class="mt-4 divide-y divide-slate-100">
        <div v-for="item in points?.transactions ?? []" :key="item.id" class="flex items-center justify-between gap-4 py-3 text-sm">
          <div>
            <p class="text-slate-700">{{ typeLabels[item.type] || item.type }}</p>
            <p class="text-xs text-slate-400">{{ new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) }}<span v-if="item.status === 'pending'"> · 冻结中</span></p>
          </div>
          <div class="text-right">
            <p :class="item.amount >= 0 ? 'text-emerald-700' : 'text-slate-700'" class="font-medium">
              {{ item.amount >= 0 ? '+' : '' }}{{ item.amount }}
            </p>
            <p class="text-xs text-slate-400">余额 {{ item.balanceAfter }}</p>
          </div>
        </div>
        <p v-if="!points?.transactions?.length" class="py-8 text-center text-sm text-slate-400">暂无积分流水</p>
      </div>
    </section>
  </div>
</template>

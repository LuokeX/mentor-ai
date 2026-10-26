<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface CendUser {
  userId: string
  name: string
  nickname: string
  phone: string | null
  status: string
  balance: number
  membership: { tier: string, endAt: string } | null
  createdAt: string
  lastLoginAt: string | null
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

const users = ref<CendUser[]>([])
const total = ref(0)
const q = ref('')
const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

const membershipTarget = ref<CendUser | null>(null)
const membershipForm = reactive({ tier: 'month', note: '', reason: '' })
const membershipSaving = ref(false)

const pointsTarget = ref<CendUser | null>(null)
const pointsForm = reactive({ amount: 100, reason: '' })
const pointsSaving = ref(false)

const transactionsTarget = ref<CendUser | null>(null)
const transactions = ref<PointTransaction[]>([])
const transactionsLoading = ref(false)

const tierLabels: Record<string, string> = {
  month: '月度会员',
  quarter: '季度会员',
  half_year: '半年会员',
  year: '年度会员'
}
const typeLabels: Record<string, string> = {
  signup_bonus: '注册赠送',
  checkin: '每日签到',
  checkin_streak: '连续签到',
  task_reward: '任务奖励',
  ai_question: 'AI 问答',
  assessment_plan: '量表 + 方案',
  refund: '退回',
  admin_adjust: '运营调整'
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await $fetch('/api/v1/platform-admin/cend/users', {
      query: { page: 1, pageSize: 20, q: q.value.trim() || undefined }
    }) as unknown as { rows: CendUser[], total: number }
    users.value = data.rows
    total.value = data.total
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function openMembership(user: CendUser) {
  membershipTarget.value = user
  membershipForm.tier = 'month'
  membershipForm.note = ''
  membershipForm.reason = ''
  successMessage.value = ''
}

async function saveMembership() {
  if (!membershipTarget.value || membershipForm.reason.trim().length < 10) {
    errorMessage.value = '请填写至少 10 个字符的操作事由'
    return
  }
  membershipSaving.value = true
  try {
    await $fetch(`/api/v1/platform-admin/cend/users/${membershipTarget.value.userId}/membership`, {
      method: 'PATCH',
      body: {
        tier: membershipForm.tier,
        note: membershipForm.note.trim() || undefined,
        reason: membershipForm.reason.trim()
      }
    })
    successMessage.value = '会员已开通/续期'
    membershipTarget.value = null
    await load()
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.message || '开通失败'
  } finally {
    membershipSaving.value = false
  }
}

function openPoints(user: CendUser, amount = 100) {
  pointsTarget.value = user
  pointsForm.amount = amount
  pointsForm.reason = ''
  successMessage.value = ''
}

async function savePoints() {
  if (!pointsTarget.value || pointsForm.reason.trim().length < 10) {
    errorMessage.value = '请填写至少 10 个字符的操作事由'
    return
  }
  pointsSaving.value = true
  try {
    await $fetch(`/api/v1/platform-admin/cend/users/${pointsTarget.value.userId}/points`, {
      method: 'POST',
      body: { amount: Number(pointsForm.amount), reason: pointsForm.reason.trim() }
    })
    successMessage.value = '积分已调整'
    pointsTarget.value = null
    await load()
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.message || '调整失败'
  } finally {
    pointsSaving.value = false
  }
}

async function openTransactions(user: CendUser) {
  transactionsTarget.value = user
  transactions.value = []
  transactionsLoading.value = true
  try {
    const data = await $fetch(`/api/v1/platform-admin/cend/users/${user.userId}/transactions`, {
      query: { page: 1, pageSize: 50 }
    }) as unknown as { transactions: PointTransaction[] }
    transactions.value = data.transactions
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.message || '流水加载失败'
  } finally {
    transactionsLoading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-5 px-5 py-8">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-sm font-medium text-emerald-700">平台管理后台</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-800">C 端运营</h1>
        <p class="mt-1 text-sm text-slate-500">C 端用户、会员线下开通、积分调整与流水。共 {{ total }} 位用户。</p>
      </div>
      <form class="flex gap-2" @submit.prevent="load">
        <UInput v-model="q" placeholder="手机号 / 昵称" class="w-56" />
        <UButton type="submit" :loading="loading">查询</UButton>
      </form>
    </header>

    <div v-if="errorMessage" class="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{{ errorMessage }}</div>
    <div v-if="successMessage" class="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">{{ successMessage }}</div>

    <section class="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table class="w-full min-w-[900px] text-sm">
        <thead>
          <tr class="border-b border-slate-100 text-left text-xs text-slate-500">
            <th class="px-4 py-3 font-normal">用户</th>
            <th class="px-4 py-3 font-normal">手机号</th>
            <th class="px-4 py-3 font-normal">积分</th>
            <th class="px-4 py-3 font-normal">会员</th>
            <th class="px-4 py-3 font-normal">注册时间</th>
            <th class="px-4 py-3 font-normal">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.userId" class="border-b border-slate-50 last:border-0">
            <td class="px-4 py-3">
              <p class="font-medium text-slate-700">{{ user.nickname || user.name }}</p>
              <p class="text-xs text-slate-400">{{ user.status === 'active' ? '正常' : user.status }}</p>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ user.phone || '—' }}</td>
            <td class="px-4 py-3 font-medium text-emerald-700">{{ user.balance }}</td>
            <td class="px-4 py-3 text-slate-600">
              <span v-if="user.membership">{{ tierLabels[user.membership.tier] || user.membership.tier }} · {{ new Date(user.membership.endAt).toLocaleDateString('zh-CN') }}</span>
              <span v-else class="text-slate-400">未开通</span>
            </td>
            <td class="px-4 py-3 text-xs text-slate-400">{{ new Date(user.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</td>
            <td class="px-4 py-3">
              <div class="flex flex-wrap gap-1.5">
                <UButton size="xs" variant="outline" @click="openMembership(user)">会员</UButton>
                <UButton size="xs" variant="outline" @click="openPoints(user, 100)">+100</UButton>
                <UButton size="xs" variant="outline" @click="openPoints(user, -100)">-100</UButton>
                <UButton size="xs" variant="ghost" @click="openTransactions(user)">流水</UButton>
              </div>
            </td>
          </tr>
          <tr v-if="!users.length">
            <td colspan="6" class="px-4 py-12 text-center text-sm text-slate-400">暂无 C 端用户</td>
          </tr>
        </tbody>
      </table>
    </section>

    <UModal :open="Boolean(membershipTarget)" @update:open="value => { if (!value) membershipTarget = null }">
      <template #header><h3 class="text-lg font-semibold">开通/续期会员</h3></template>
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-slate-500">用户：{{ membershipTarget?.nickname || membershipTarget?.name }}（{{ membershipTarget?.phone }}）</p>
          <UFormField label="会员类型" required>
            <USelect v-model="membershipForm.tier" :items="Object.entries(tierLabels).map(([value, label]) => ({ value, label }))" class="w-full" />
          </UFormField>
          <UFormField label="备注"><UInput v-model="membershipForm.note" maxlength="500" class="w-full" /></UFormField>
          <UFormField label="操作事由" required hint="至少 10 个字符，写入审计">
            <UTextarea v-model="membershipForm.reason" :rows="3" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="outline" @click="membershipTarget = null">取消</UButton>
          <UButton :loading="membershipSaving" @click="saveMembership">确认开通</UButton>
        </div>
      </template>
    </UModal>

    <UModal :open="Boolean(pointsTarget)" @update:open="value => { if (!value) pointsTarget = null }">
      <template #header><h3 class="text-lg font-semibold">调整积分</h3></template>
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-slate-500">用户：{{ pointsTarget?.nickname || pointsTarget?.name }}（当前 {{ pointsTarget?.balance }} 积分）</p>
          <UFormField label="变动积分" required hint="正数为补发，负数为扣减">
            <UInput v-model="pointsForm.amount" type="number" class="w-full" />
          </UFormField>
          <UFormField label="操作事由" required hint="至少 10 个字符，写入审计">
            <UTextarea v-model="pointsForm.reason" :rows="3" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="outline" @click="pointsTarget = null">取消</UButton>
          <UButton :loading="pointsSaving" @click="savePoints">确认调整</UButton>
        </div>
      </template>
    </UModal>

    <UModal :open="Boolean(transactionsTarget)" @update:open="value => { if (!value) transactionsTarget = null }">
      <template #header><h3 class="text-lg font-semibold">积分流水</h3></template>
      <template #body>
        <div class="max-h-[60vh] space-y-2 overflow-y-auto">
          <p class="text-sm text-slate-500">{{ transactionsTarget?.nickname || transactionsTarget?.name }} · 当前 {{ transactionsTarget?.balance }} 积分</p>
          <div v-if="transactionsLoading" class="py-8 text-center text-sm text-slate-400">加载中...</div>
          <div v-for="item in transactions" :key="item.id" class="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3">
            <div>
              <p class="text-sm text-slate-700">{{ typeLabels[item.type] || item.type }}</p>
              <p class="text-xs text-slate-400">{{ new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) }} · {{ item.status }}</p>
            </div>
            <div class="text-right">
              <p :class="item.amount >= 0 ? 'text-emerald-700' : 'text-slate-700'" class="font-medium">{{ item.amount >= 0 ? '+' : '' }}{{ item.amount }}</p>
              <p class="text-xs text-slate-400">余额 {{ item.balanceAfter }}</p>
            </div>
          </div>
          <p v-if="!transactionsLoading && !transactions.length" class="py-8 text-center text-sm text-slate-400">暂无流水</p>
        </div>
      </template>
    </UModal>
  </div>
</template>

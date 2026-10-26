<script setup lang="ts">
import { emptyCendProfileForm, type CendProfileForm } from '~/utils/cend-profile'

interface CendMe {
  user: { id: string, nickname: string, phone: string }
  profile: {
    nickname: string
    subjects: string[]
    grades: number[]
    textbookVersion: string | null
    region: string | null
    teachingYears: string | null
    roles: string[]
    completedAt: string | null
  } | null
}

const { user, tenants, switchTenant, refresh } = useAuth()
const { refresh: refreshCendBalance } = useCendBalance()
const route = useRoute()
const me = ref<CendMe | null>(null)
const pending = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const feedbackText = ref('')
const feedbackRating = ref(5)
const feedbackPending = ref(false)

const form = reactive<CendProfileForm>(emptyCendProfileForm())

const cendTenant = computed(() => tenants.value.find(item => item.kind === 'cend'))
const welcome = computed(() => route.query.welcome === '1')
const showFeedback = computed(() => route.query.feedback === '1')

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
    const data = await $fetch<CendMe>('/api/v1/cend/me')
    me.value = data
    form.nickname = data.profile?.nickname || data.user.nickname
    form.subjects = data.profile?.subjects ?? []
    form.grades = data.profile?.grades ?? []
    form.textbookVersion = data.profile?.textbookVersion ?? ''
    form.region = data.profile?.region ?? ''
    form.teachingYears = data.profile?.teachingYears ?? ''
    form.roles = data.profile?.roles ?? []
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.message || '加载失败'
  } finally {
    pending.value = false
  }
}

async function save() {
  saving.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const result = await $fetch<{ reward: number }>('/api/v1/cend/profile', {
      method: 'PATCH',
      body: {
        nickname: form.nickname.trim() || undefined,
        subjects: form.subjects,
        grades: form.grades,
        textbookVersion: form.textbookVersion.trim() || null,
        region: form.region || null,
        teachingYears: form.teachingYears || null,
        roles: form.roles
      }
    })
    successMessage.value = result.reward > 0 ? `资料已保存，获得 ${result.reward} 积分` : '资料已保存'
    await Promise.all([refresh(), refreshCendBalance()])
    await load()
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function submitFeedback() {
  if (feedbackText.value.trim().length < 2) {
    errorMessage.value = '请填写反馈内容'
    return
  }
  feedbackPending.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const result = await $fetch<{ reward: number }>('/api/v1/cend/feedback', {
      method: 'POST',
      body: { content: feedbackText.value.trim(), rating: feedbackRating.value }
    })
    successMessage.value = result.reward > 0 ? `反馈已提交，获得 ${result.reward} 积分` : '反馈已提交'
    feedbackText.value = ''
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.message || '提交失败'
  } finally {
    feedbackPending.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5 px-5 py-8">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-sm font-medium text-emerald-700">班主任智能体 · C 端</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-800">个人资料</h1>
        <p class="mt-1 text-sm text-slate-500">{{ me?.user.phone }} · 完善资料后 AI 回答会更贴合你的学段与学科</p>
      </div>
      <div class="flex gap-2">
        <UButton to="/" color="neutral" variant="outline">返回问答</UButton>
        <UButton to="/cend/points" color="neutral" variant="outline">积分中心</UButton>
      </div>
    </header>

    <div v-if="welcome" class="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
      欢迎加入班主任智能体。完善资料即可一次性领取 200 积分，部分选项可以稍后补充。
    </div>
    <div v-if="errorMessage" class="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{{ errorMessage }}</div>
    <div v-if="successMessage" class="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">{{ successMessage }}</div>

    <section class="rounded-2xl border border-slate-200 bg-white p-6">
      <CendProfileFields :form="form" :phone="me?.user.phone" />
      <div class="mt-6 flex items-center justify-between gap-3">
        <p class="text-xs text-slate-400">在此页面修改资料不会重复发放“首次完善资料”积分。</p>
        <UButton :loading="saving" @click="save">保存修改</UButton>
      </div>
    </section>

    <section v-if="showFeedback" class="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 class="text-sm font-medium text-slate-700">产品反馈</h2>
      <p class="mt-1 text-xs text-slate-400">提交后即可获得 300 积分奖励，你的反馈会直接影响产品迭代。</p>
      <div class="mt-4 space-y-4">
        <UFormField label="反馈内容" required>
          <UTextarea v-model="feedbackText" :rows="4" maxlength="2000" placeholder="请描述你遇到的问题或建议" class="w-full" />
        </UFormField>
        <UFormField label="整体满意度">
          <USelect v-model="feedbackRating" :items="[1, 2, 3, 4, 5].map(value => ({ label: `${value} 分`, value }))" class="w-32" />
        </UFormField>
        <UButton :loading="feedbackPending" @click="submitFeedback">提交反馈，领取 300 积分</UButton>
      </div>
    </section>
  </div>
</template>

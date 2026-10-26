<script setup lang="ts">
import { APP_VERSION } from '#shared/app-version'
import { roleHomePath, type AppRole } from '~/composables/useAuth'
import { groupTestAccounts, type TestAccount } from '~/utils/test-accounts'
definePageMeta({ layout: false })
const route = useRoute()
/** 同一登录页承载学校账号与个人（C 端）账号，顶部切换。 */
const accountMode = ref<'school' | 'personal'>(route.query.account === 'personal' ? 'personal' : 'school')
function setAccountMode(mode: 'school' | 'personal') {
  accountMode.value = mode
  errorMessage.value = ''
}
const config = useRuntimeConfig()
const showSsoLogin = config.public.showSsoLogin
// 仅测试/UAT 环境为 true（docker-compose.test.yml 注入）；正式环境恒为 false，
// 登录页不渲染任何测试账号，清单与维护口径见 app/utils/test-accounts.ts
const showTestAccounts = config.public.showTestAccounts
const testAccountGroups = showTestAccounts ? groupTestAccounts() : []
const testAccountsOpen = ref(false)
const pickedAccountPhone = ref('')
const form = reactive({ phone: '', password: '' })
const pending = ref(false)
const hydrated = ref(false)
const errorMessage = ref('')
const ssoError = ref(false)

/** 点选测试账号：只填入表单，登录仍走正常手机号+密码流程（不跳过任何认证） */
function pickTestAccount(account: TestAccount) {
  form.phone = account.phone
  form.password = account.password
  pickedAccountPhone.value = account.phone
  errorMessage.value = ''
}

onMounted(() => {
  hydrated.value = true
  ssoError.value = useRoute().query.error === 'sso'
})

function ssoLogin() {
  window.location.href = '/api/v1/auth/sso/authorize'
}

async function login() {
  pending.value = true
  errorMessage.value = ''
  try {
    // role 是登录后的激活角色；roles 为账号持有的全部角色（旧响应可能没有 roles 字段）
    const result = await $fetch<{ role?: AppRole, roles?: AppRole[] }>('/api/v1/auth/login', {
      method: 'POST',
      body: { phone: form.phone, password: form.password }
    })
    const { refresh } = useAuth()
    await refresh()
    // 按激活角色落地；旧响应缺 role 时回落到 roles 的第一项
    await navigateTo(roleHomePath(result.role ?? result.roles?.[0]))
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.data?.statusMessage || error?.message || '登录失败'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="grid min-h-screen lg:grid-cols-[1.15fr_.85fr]">
    <section class="relative hidden overflow-hidden bg-[#173c35] p-14 text-white lg:flex lg:flex-col lg:justify-between">
      <div class="absolute -right-24 -top-24 size-96 rounded-full border border-white/10 bg-white/5" />
      <div class="absolute -bottom-40 -left-32 size-[34rem] rounded-full border border-white/10 bg-emerald-400/10" />
      <div class="relative flex items-center gap-3">
        <span class="grid size-12 place-items-center rounded-2xl bg-emerald-300 text-xl font-bold text-emerald-950">{{ accountMode === 'personal' ? '班' : '六' }}</span>
        <div>
          <div class="flex items-center gap-2">
            <strong class="text-lg">{{ accountMode === 'personal' ? '班主任智能体' : '班主任助理智能平台' }}</strong>
            <span class="rounded-full border border-emerald-200/30 bg-white/10 px-2 py-0.5 text-xs font-medium tracking-wide text-emerald-100">{{ APP_VERSION }}</span>
          </div>
          <p class="text-sm text-emerald-100/70">{{ accountMode === 'personal' ? '做班主任，少一点事务，多一点教育' : '让每一次求助，都得到可行动的回应' }}</p>
        </div>
      </div>
      <div class="relative max-w-xl">
        <p class="mb-6 text-sm font-semibold uppercase tracking-[.3em] text-emerald-200">{{ accountMode === 'personal' ? 'For Teachers' : 'Teacher Empowerment' }}</p>
        <h1 v-if="accountMode === 'personal'" class="text-5xl font-semibold leading-tight">班级管理、家校沟通，<br>一次提问就有可落地的方案。</h1>
        <h1 v-else class="text-5xl font-semibold leading-tight">理解教师的语言，<br>守住每一次安全边界。</h1>
        <p v-if="accountMode === 'personal'" class="mt-6 max-w-lg text-lg leading-8 text-emerald-50/70">新注册即送 1000 积分；每日签到、完成任务可继续获取积分；开通会员后问答与量表评估不再消耗积分。</p>
        <p v-else class="mt-6 max-w-lg text-lg leading-8 text-emerald-50/70">统一智能体入口连接自我成长、班级建设、家校沟通、学生个体支持与学习问题。确定性规则负责判断，AI 负责让专业方案更容易使用。</p>
      </div>
      <div v-if="accountMode === 'personal'" class="relative grid grid-cols-3 gap-3 text-sm">
        <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><strong class="block text-2xl">1000</strong><span class="text-emerald-100/60">新手积分</span></div>
        <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><strong class="block text-2xl">+200</strong><span class="text-emerald-100/60">每日签到</span></div>
        <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><strong class="block text-2xl">0</strong><span class="text-emerald-100/60">会员问答消耗</span></div>
      </div>
      <div v-else class="relative grid grid-cols-3 gap-3 text-sm">
        <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><strong class="block text-2xl">5</strong><span class="text-emerald-100/60">个模块</span></div>
        <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><strong class="block text-2xl">24h</strong><span class="text-emerald-100/60">安全守护</span></div>
        <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><strong class="block text-2xl">100%</strong><span class="text-emerald-100/60">敏感访问审计</span></div>
      </div>
    </section>
    <section class="flex items-center justify-center p-6 sm:p-12">
      <div class="w-full max-w-md">
        <div class="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            class="rounded-lg px-4 py-2.5 text-sm font-medium transition"
            :class="accountMode === 'school' ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-500'"
            @click="setAccountMode('school')"
          >
            学校账户
          </button>
          <button
            type="button"
            class="rounded-lg px-4 py-2.5 text-sm font-medium transition"
            :class="accountMode === 'personal' ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-500'"
            @click="setAccountMode('personal')"
          >
            个人账户
          </button>
        </div>
        <template v-if="accountMode === 'school'">
        <div class="mb-8 lg:hidden"><div class="flex items-center gap-2"><span class="grid size-12 place-items-center rounded-2xl bg-emerald-800 text-white">六</span><span class="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium tracking-wide text-emerald-700">{{ APP_VERSION }}</span></div></div>
        <p class="text-sm font-semibold text-emerald-700">欢迎回来</p>
        <h2 class="mt-2 text-3xl font-semibold">登录您的工作空间</h2>
        <p class="mt-2 text-sm text-slate-500">封闭试用环境 · 所有敏感操作均会留痕</p>
        <!-- 选择测试账户：仅测试/UAT 环境渲染（NUXT_PUBLIC_SHOW_TEST_ACCOUNTS=true）。
             只做表单填充，不绕过手机号+密码认证；清单见 app/utils/test-accounts.ts -->
        <details v-if="showTestAccounts" :open="testAccountsOpen" class="mt-6 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 p-4">
          <summary class="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-amber-900 [&::-webkit-details-marker]:hidden" @click.prevent="testAccountsOpen = !testAccountsOpen">
            选择测试账户
            <span class="rounded-full bg-amber-200/70 px-2 py-0.5 text-[11px] font-normal">仅测试环境</span>
            <UIcon :name="testAccountsOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="ml-auto size-4" />
          </summary>
          <p class="mt-3 text-xs leading-5 text-amber-900/70">点选账号自动填入手机号与密码，再点下方「安全登录」。这些账号只存在于测试库，正式环境没有此入口。</p>
          <div class="mt-3 space-y-3">
            <div v-for="group in testAccountGroups" :key="group.name">
              <p class="mb-1.5 text-xs font-medium text-slate-500">{{ group.name }}</p>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="account in group.accounts"
                  :key="account.phone"
                  type="button"
                  class="rounded-lg border px-2.5 py-1.5 text-xs transition"
                  :class="pickedAccountPhone === account.phone
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-500 hover:text-emerald-700'"
                  @click="pickTestAccount(account)"
                >
                  <span class="font-medium">{{ account.label }}</span>
                  <span class="ml-1.5 text-[11px] text-slate-400">{{ account.phone }}</span>
                </button>
              </div>
            </div>
          </div>
        </details>
        <form class="mt-8 space-y-5" @submit.prevent="login">
          <UFormField label="手机号"><UInput v-model="form.phone" size="xl" icon="i-lucide-smartphone" inputmode="numeric" maxlength="11" class="w-full" /></UFormField>
          <UFormField label="密码"><UInput v-model="form.password" type="password" size="xl" icon="i-lucide-lock-keyhole" class="w-full" /></UFormField>
          <UAlert v-if="errorMessage" color="error" variant="soft" :description="errorMessage" />
          <button type="submit" class="w-full rounded-lg bg-[var(--ui-primary)] px-6 py-3.5 text-lg font-medium text-white disabled:opacity-50" :disabled="!hydrated">安全登录</button>
          <div v-if="showSsoLogin" class="space-y-4 pt-1">
            <div class="flex items-center gap-3 text-xs text-slate-400"><span class="h-px flex-1 bg-slate-200" /><span>或使用统一身份</span><span class="h-px flex-1 bg-slate-200" /></div>
            <button type="button" class="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-6 py-3 text-base font-medium text-slate-700 transition hover:border-emerald-600 hover:text-emerald-700" @click="ssoLogin">
              <UIcon name="i-lucide-building-2" class="size-5" />统一身份登录
            </button>
            <UAlert v-if="ssoError" color="error" variant="soft" description="统一身份登录未成功，请重试，或使用下方账号密码登录" />
          </div>
        </form>
        <p class="mt-5 text-center text-sm text-slate-500">收到学校邀请？<NuxtLink class="font-medium text-emerald-700 hover:underline" to="/activate">激活账号</NuxtLink></p>
        <p class="mt-6 text-xs leading-5 text-slate-400">登录即表示您已阅读校方隐私告知：学校管理员仅可在填写事由、获得短时只读授权并完整审计的前提下履行校内管理职责；平台管理员须另经学校审批。</p>
        </template>
        <template v-else>
          <div class="mb-8 lg:hidden"><div class="flex items-center gap-2"><span class="grid size-12 place-items-center rounded-2xl bg-emerald-800 text-white">班</span><span class="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium tracking-wide text-emerald-700">{{ APP_VERSION }}</span></div></div>
          <p class="text-sm font-semibold text-emerald-700">教师个人版</p>
          <h2 class="mt-2 text-3xl font-semibold">登录班主任智能体</h2>
          <CendLoginForm class="mt-8" />
        </template>
      </div>
    </section>
  </div>
</template>
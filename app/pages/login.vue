<script setup lang="ts">
import QRCode from 'qrcode'
definePageMeta({ layout: false })
const config = useRuntimeConfig()
const showDemoLogin = config.public.showDemoLogin
const showSsoLogin = config.public.showSsoLogin
const form = reactive({ phone: showDemoLogin ? '13900001001' : '', password: showDemoLogin ? 'Mentor@2026' : '' })
const pending = ref(false)
const hydrated = ref(false)
const errorMessage = ref('')
const ssoError = ref(false)

// 心理专员首次登录 TOTP 绑定（账号由管理员直接创建、尚未绑定身份验证器）
const mfaStep = ref<'none' | 'bind' | 'recovery'>('none')
const mfaSetup = ref<{ token: string; otpauthUri: string } | null>(null)
const qrDataUrl = ref('')
const otp = ref('')
const recoveryCodes = ref<string[]>([])
const mfaError = ref('')
const mfaPending = ref(false)

// 已绑定 TOTP 的心理专员登录：密码校验通过后需动态验证码或恢复码（服务端 401 提示触发本区显示）
const totpChallenge = ref(false)
const loginOtp = ref('')
const loginRecoveryCode = ref('')

const demoAccounts = [
  { label: '李老师（教师）', value: '13900001001' },
  { label: '张老师（教师）', value: '13900001002' },
  { label: '王心理专员', value: '13900001003' },
  { label: '学校管理员', value: '13900001004' },
  { label: '平台管理员', value: '13900001005' },
]
const selectedDemo = ref(demoAccounts[0]!.value)

function onDemoSelect(phone: string) {
  form.phone = phone
  form.password = 'Mentor@2026'
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
    const result = await $fetch<{ role?: string; needsMfa?: boolean; token?: string; otpauthUri?: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        phone: form.phone,
        password: form.password,
        ...(loginOtp.value.trim() ? { otp: loginOtp.value.trim() } : {}),
        ...(loginRecoveryCode.value.trim() ? { recoveryCode: loginRecoveryCode.value.trim() } : {})
      }
    })
    if (result.needsMfa && result.token && result.otpauthUri) {
      mfaSetup.value = { token: result.token, otpauthUri: result.otpauthUri }
      qrDataUrl.value = await QRCode.toDataURL(result.otpauthUri, { width: 220, margin: 2 })
      mfaStep.value = 'bind'
      mfaError.value = ''
      return
    }
    const { refresh } = useAuth()
    await refresh()
    const homes: Record<string, string> = { teacher: '/', psychologist: '/specialist', school_admin: '/school-admin', platform_admin: '/platform-admin' }
    await navigateTo(homes[result.role || ''] || '/')
  } catch (error: any) {
    const message = error?.data?.message || error?.data?.statusMessage || error?.message || '登录失败'
    errorMessage.value = message
    // 服务端对已绑定 TOTP 的心理专员返回：请提供动态验证码或恢复码 / 动态验证码错误 / 恢复码无效
    if (/验证码|恢复码/.test(message)) {
      totpChallenge.value = true
    }
  } finally {
    pending.value = false
  }
}

async function confirmMfa() {
  if (!mfaSetup.value) return
  mfaPending.value = true
  mfaError.value = ''
  try {
    const result = await $fetch<{ recoveryCodes: string[] }>('/api/v1/auth/activate-mfa', {
      method: 'POST',
      body: { token: mfaSetup.value.token, otp: otp.value.trim() }
    })
    recoveryCodes.value = result.recoveryCodes
    mfaStep.value = 'recovery'
  } catch (error: any) {
    mfaError.value = error?.data?.message || '动态验证码校验失败'
  } finally {
    mfaPending.value = false
  }
}

async function finishMfa() {
  // activate-mfa 只完成绑定不创建会话：回到登录流程重新登录
  mfaStep.value = 'none'
  otp.value = ''
  await login()
}

async function copyRecoveryCodes() {
  if (!import.meta.client) return
  await navigator.clipboard.writeText(recoveryCodes.value.join('\n'))
}
</script>

<template>
  <div class="grid min-h-screen lg:grid-cols-[1.15fr_.85fr]">
    <section class="relative hidden overflow-hidden bg-[#173c35] p-14 text-white lg:flex lg:flex-col lg:justify-between">
      <div class="absolute -right-24 -top-24 size-96 rounded-full border border-white/10 bg-white/5" />
      <div class="absolute -bottom-40 -left-32 size-[34rem] rounded-full border border-white/10 bg-emerald-400/10" />
      <div class="relative flex items-center gap-3">
        <span class="grid size-12 place-items-center rounded-2xl bg-emerald-300 text-xl font-bold text-emerald-950">六</span>
        <div><strong class="text-lg">教师赋能智能平台</strong><p class="text-sm text-emerald-100/70">让每一次求助，都得到可行动的回应</p></div>
      </div>
      <div class="relative max-w-xl">
        <p class="mb-6 text-sm font-semibold uppercase tracking-[.3em] text-emerald-200">Teacher Empowerment</p>
        <h1 class="text-5xl font-semibold leading-tight">理解教师的语言，<br>守住每一次安全边界。</h1>
        <p class="mt-6 max-w-lg text-lg leading-8 text-emerald-50/70">统一智能体入口连接自我成长、班级建设、家校沟通、学生个体支持与学习问题。确定性规则负责判断，AI 负责让专业方案更容易使用。</p>
      </div>
      <div class="relative grid grid-cols-3 gap-3 text-sm">
        <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><strong class="block text-2xl">5</strong><span class="text-emerald-100/60">个模块</span></div>
        <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><strong class="block text-2xl">24h</strong><span class="text-emerald-100/60">安全守护</span></div>
        <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><strong class="block text-2xl">100%</strong><span class="text-emerald-100/60">敏感访问审计</span></div>
      </div>
    </section>
    <section class="flex items-center justify-center p-6 sm:p-12">
      <div class="w-full max-w-md">
        <div class="mb-8 lg:hidden"><span class="grid size-12 place-items-center rounded-2xl bg-emerald-800 text-white">六</span></div>
        <p class="text-sm font-semibold text-emerald-700">欢迎回来</p>
        <h2 class="mt-2 text-3xl font-semibold">登录您的工作空间</h2>
        <p class="mt-2 text-sm text-slate-500">封闭试用环境 · 所有敏感操作均会留痕</p>
        <form class="mt-8 space-y-5" @submit.prevent="login">
          <UFormField v-if="showDemoLogin" label="演示账号">
            <USelect v-model="selectedDemo" :items="demoAccounts" class="w-full" @update:model-value="onDemoSelect" />
          </UFormField>
          <UFormField label="手机号"><UInput v-model="form.phone" size="xl" icon="i-lucide-smartphone" inputmode="numeric" maxlength="11" class="w-full" /></UFormField>
          <UFormField label="密码"><UInput v-model="form.password" type="password" size="xl" icon="i-lucide-lock-keyhole" class="w-full" /></UFormField>
          <UAlert v-if="errorMessage" color="error" variant="soft" :description="errorMessage" />
          <div v-if="totpChallenge" class="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <p class="text-xs leading-5 text-slate-600">该心理专员账号已绑定动态验证码，请输入身份验证器中的 6 位动态验证码；或输入恢复码（格式 XXXXXX-XXXXXX）完成登录。</p>
            <UFormField label="动态验证码">
              <UInput v-model="loginOtp" inputmode="numeric" maxlength="6" size="xl" icon="i-lucide-shield-check" class="w-full" placeholder="6 位动态验证码" />
            </UFormField>
            <UFormField label="恢复码（选填）">
              <UInput v-model="loginRecoveryCode" size="xl" icon="i-lucide-key-round" class="w-full" placeholder="XXXXXX-XXXXXX" />
            </UFormField>
          </div>
          <button type="submit" class="w-full rounded-lg bg-[var(--ui-primary)] px-6 py-3.5 text-lg font-medium text-white disabled:opacity-50" :disabled="!hydrated">{{ totpChallenge ? '验证并登录' : '安全登录' }}</button>
          <div v-if="showSsoLogin" class="space-y-4 pt-1">
            <div class="flex items-center gap-3 text-xs text-slate-400"><span class="h-px flex-1 bg-slate-200" /><span>或使用统一身份</span><span class="h-px flex-1 bg-slate-200" /></div>
            <button type="button" class="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-6 py-3 text-base font-medium text-slate-700 transition hover:border-emerald-600 hover:text-emerald-700" @click="ssoLogin">
              <UIcon name="i-lucide-building-2" class="size-5" />统一身份登录
            </button>
            <UAlert v-if="ssoError" color="error" variant="soft" description="统一身份登录未成功，请重试，或使用下方账号密码登录" />
          </div>
        </form>
        <p class="mt-5 text-center text-sm text-slate-500">收到学校邀请？<NuxtLink class="font-medium text-emerald-700 hover:underline" to="/activate">激活账号</NuxtLink></p>

        <div v-if="mfaStep === 'bind'" class="mt-6 space-y-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5">
          <div>
            <h3 class="text-sm font-semibold text-emerald-900">首次登录 · 绑定身份验证器</h3>
            <p class="mt-1 text-xs leading-5 text-emerald-700">该心理专员账号由学校直接创建，需先绑定动态验证码。使用身份验证器扫描二维码，再输入当前 6 位验证码。</p>
          </div>
          <img :src="qrDataUrl" alt="TOTP 二维码" class="mx-auto size-52 rounded-xl border border-slate-100 bg-white p-2" />
          <UFormField label="动态验证码"><UInput v-model="otp" inputmode="numeric" maxlength="6" size="xl" icon="i-lucide-shield-check" class="w-full" /></UFormField>
          <UAlert v-if="mfaError" color="error" variant="soft" :description="mfaError" />
          <button type="button" class="w-full rounded-lg bg-[var(--ui-primary)] px-6 py-3 text-lg font-medium text-white disabled:opacity-50" :disabled="mfaPending" @click="confirmMfa">{{ mfaPending ? '绑定中…' : '确认绑定并登录' }}</button>
        </div>
        <div v-else-if="mfaStep === 'recovery'" class="mt-6 space-y-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
          <p class="text-sm font-semibold text-amber-900">请立即保存恢复码</p>
          <p class="text-xs leading-5 text-amber-700">每个恢复码只能使用一次，离开本页后平台无法再次展示。请存放在安全位置，不要发送给管理员。</p>
          <div class="grid grid-cols-2 gap-2 rounded-xl bg-white p-3 font-mono text-xs">
            <code v-for="code in recoveryCodes" :key="code">{{ code }}</code>
          </div>
          <button type="button" class="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" @click="copyRecoveryCodes">
            <UIcon name="i-lucide-copy" class="size-4" />复制恢复码
          </button>
          <button type="button" class="w-full rounded-lg bg-[var(--ui-primary)] px-6 py-3 text-lg font-medium text-white" @click="finishMfa">我已安全保存，进入平台</button>
        </div>
        <div v-if="showDemoLogin" class="mt-8 rounded-2xl bg-slate-100/80 p-4 text-xs leading-6 text-slate-500">
          演示账号：13900001001（李老师）、13900001004（学校管理员）、13900001005（平台管理员）；统一密码 Mentor@2026。
        </div>
        <p class="mt-6 text-xs leading-5 text-slate-400">登录即表示您已阅读校方隐私告知：学校管理员仅可在填写事由、获得短时只读授权并完整审计的前提下履行校内管理职责；平台管理员须另经学校审批。</p>
      </div>
    </section>
  </div>
</template>

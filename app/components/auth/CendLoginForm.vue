<script setup lang="ts">
import { roleHomePath } from '~/composables/useAuth'

const { refresh } = useAuth()
const mode = ref<'login' | 'register'>('login')
const form = reactive({
  phone: '',
  password: '',
  confirmPassword: '',
  captcha: '',
  agreement: false
})
const captchaSvg = ref('')
const captchaLoading = ref(false)
const pending = ref(false)
const errorMessage = ref('')

async function loadCaptcha() {
  captchaLoading.value = true
  try {
    const result = await $fetch<{ svg: string }>('/api/v1/cend/captcha')
    captchaSvg.value = result.svg
    form.captcha = ''
  } catch {
    captchaSvg.value = ''
  } finally {
    captchaLoading.value = false
  }
}

onMounted(loadCaptcha)

function switchMode(next: 'login' | 'register') {
  mode.value = next
  errorMessage.value = ''
  if (next === 'register') void loadCaptcha()
}

async function login() {
  if (!form.phone.trim() || !form.password) {
    errorMessage.value = '请填写手机号和密码'
    return
  }
  pending.value = true
  errorMessage.value = ''
  try {
    const result = await $fetch<{ role?: string }>('/api/v1/cend/auth/login', {
      method: 'POST',
      body: { phone: form.phone.trim(), password: form.password }
    })
    await refresh()
    await navigateTo(roleHomePath(result.role))
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.message || '登录失败'
  } finally {
    pending.value = false
  }
}

async function register() {
  if (!form.phone.trim() || form.password.length < 8) {
    errorMessage.value = '请填写手机号和至少 8 位密码'
    return
  }
  if (form.password !== form.confirmPassword) {
    errorMessage.value = '两次输入的密码不一致'
    return
  }
  if (!form.captcha.trim()) {
    errorMessage.value = '请输入图形验证码'
    return
  }
  if (!form.agreement) {
    errorMessage.value = '请先阅读并同意服务协议与隐私政策'
    return
  }
  pending.value = true
  errorMessage.value = ''
  try {
    await $fetch('/api/v1/cend/auth/register', {
      method: 'POST',
      body: {
        phone: form.phone.trim(),
        password: form.password,
        confirmPassword: form.confirmPassword,
        captcha: form.captcha.trim(),
        agreement: true
      }
    })
    await refresh()
    // 注册后直接进入 AI 助手首页；完善资料以弹窗形式盖在首页上（可在弹窗内跳过）。
    await navigateTo('/?welcome=1')
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.message || '注册失败'
    await loadCaptcha()
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
      <button
        type="button"
        class="rounded-lg px-4 py-2 text-sm font-medium transition"
        :class="mode === 'login' ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-500'"
        @click="switchMode('login')"
      >
        登录
      </button>
      <button
        type="button"
        class="rounded-lg px-4 py-2 text-sm font-medium transition"
        :class="mode === 'register' ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-500'"
        @click="switchMode('register')"
      >
        注册
      </button>
    </div>

    <form class="space-y-4" @submit.prevent="mode === 'login' ? login() : register()">
      <UFormField label="手机号" required>
        <UInput v-model="form.phone" size="xl" icon="i-lucide-smartphone" inputmode="numeric" maxlength="11" placeholder="请输入手机号" class="w-full" />
      </UFormField>
      <UFormField :label="mode === 'login' ? '密码' : '设置密码'" required>
        <UInput v-model="form.password" type="password" size="xl" icon="i-lucide-lock-keyhole" :placeholder="mode === 'login' ? '请输入密码' : '至少 8 位密码'" class="w-full" />
      </UFormField>

      <template v-if="mode === 'register'">
        <UFormField label="确认密码" required>
          <UInput v-model="form.confirmPassword" type="password" size="xl" icon="i-lucide-lock-keyhole" placeholder="再次输入密码" class="w-full" />
        </UFormField>
        <UFormField label="图形验证码" required>
          <div class="flex items-center gap-3">
            <UInput v-model="form.captcha" size="xl" maxlength="8" placeholder="请输入右侧字符" class="flex-1" />
            <button
              type="button"
              class="grid h-12 w-32 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-white"
              :disabled="captchaLoading"
              title="点击刷新验证码"
              @click="loadCaptcha"
            >
              <span v-if="captchaLoading" class="text-xs text-slate-400">加载中</span>
              <span v-else v-html="captchaSvg" class="[&>svg]:h-10 [&>svg]:w-32" />
            </button>
          </div>
        </UFormField>
        <label class="flex items-start gap-2 text-xs leading-5 text-slate-500">
          <input v-model="form.agreement" type="checkbox" class="mt-0.5 size-4 rounded border-slate-300">
          <span>
            我已阅读并同意
            <NuxtLink to="/cend/agreements/service" target="_blank" class="text-emerald-700 hover:underline" @click.stop>《服务协议》</NuxtLink>
            <NuxtLink to="/cend/agreements/privacy" target="_blank" class="text-emerald-700 hover:underline" @click.stop>《隐私政策》</NuxtLink>，
            同意平台按隐私政策处理我的账号与使用数据。
          </span>
        </label>
      </template>

      <UAlert v-if="errorMessage" color="error" variant="soft" :description="errorMessage" />
      <button type="submit" class="w-full rounded-lg bg-[var(--ui-primary)] px-6 py-3.5 text-lg font-medium text-white disabled:opacity-50" :disabled="pending">
        {{ pending ? '处理中…' : mode === 'login' ? '登录个人账户' : '注册并登录' }}
      </button>
    </form>
  </div>
</template>

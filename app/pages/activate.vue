<script setup lang="ts">
import QRCode from 'qrcode'

definePageMeta({ layout: false })
const route = useRoute()
const token = ref(typeof route.query.token === 'string' ? route.query.token : '')
const account = ref<any>(null)
const loading = ref(false)
const errorMessage = ref('')
const step = ref<'token' | 'password' | 'mfa' | 'recovery' | 'done'>('token')
const password = ref('')
const passwordConfirm = ref('')
const otp = ref('')
const qrDataUrl = ref('')
const recoveryCodes = ref<string[]>([])

async function validateToken() {
  if (!token.value.trim()) return
  loading.value = true; errorMessage.value = ''
  try {
    account.value = await $fetch('/api/v1/auth/activate', { query: { token: token.value.trim() } })
    step.value = 'password'
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '激活链接无效或已过期'
  } finally { loading.value = false }
}

async function setPassword() {
  if (password.value !== passwordConfirm.value) { errorMessage.value = '两次输入的密码不一致'; return }
  loading.value = true; errorMessage.value = ''
  try {
    const result = await $fetch<any>('/api/v1/auth/activate', {
      method: 'POST', body: { token: token.value.trim(), password: password.value }
    })
    if (result.needsMfa) {
      qrDataUrl.value = await QRCode.toDataURL(result.otpauthUri, { width: 260, margin: 2 })
      step.value = 'mfa'
    } else step.value = 'done'
  } catch (error: any) { errorMessage.value = error?.data?.message || '账号激活失败' }
  finally { loading.value = false }
}

async function confirmMfa() {
  loading.value = true; errorMessage.value = ''
  try {
    const result = await $fetch<any>('/api/v1/auth/activate-mfa', {
      method: 'POST', body: { token: token.value.trim(), otp: otp.value.trim() }
    })
    recoveryCodes.value = result.recoveryCodes
    step.value = 'recovery'
  } catch (error: any) { errorMessage.value = error?.data?.message || '动态验证码校验失败' }
  finally { loading.value = false }
}

async function copyRecoveryCodes() {
  await navigator.clipboard.writeText(recoveryCodes.value.join('\n'))
}

function finishRecovery() { step.value = 'done' }

onMounted(() => { if (token.value) validateToken() })
</script>

<template>
  <main class="grid min-h-[100dvh] place-items-center bg-[#f8faf6] p-5">
    <section class="panel w-full max-w-lg p-6 sm:p-9">
      <div class="flex items-center gap-3"><span class="grid size-11 place-items-center rounded-2xl bg-emerald-800 text-white">六</span><div><h1 class="text-xl font-semibold">账号激活</h1><p class="text-sm text-slate-500">一次性链接有效期为 72 小时</p></div></div>

      <div v-if="step === 'token'" class="mt-8 space-y-5">
        <UFormField label="激活码"><UInput v-model="token" size="xl" class="w-full" autocomplete="one-time-code" /></UFormField>
        <button type="button" class="w-full rounded-lg bg-[var(--ui-primary)] px-6 py-3.5 text-lg font-medium text-white" @click="validateToken">验证邀请</button>
      </div>

      <form v-else-if="step === 'password'" class="mt-8 space-y-5" @submit.prevent="setPassword">
        <UAlert color="primary" variant="soft" :title="account?.name" :description="`${account?.phone} · ${account?.role === 'psychologist' ? '心理专员' : '教师'}`" />
        <UFormField label="设置密码" help="至少 10 位，建议混合字母、数字和符号"><UInput v-model="password" type="password" minlength="10" autocomplete="new-password" size="xl" class="w-full" /></UFormField>
        <UFormField label="确认密码"><UInput v-model="passwordConfirm" type="password" minlength="10" autocomplete="new-password" size="xl" class="w-full" /></UFormField>
        <button type="submit" class="w-full rounded-lg bg-[var(--ui-primary)] px-6 py-3.5 text-lg font-medium text-white">继续</button>
      </form>

      <div v-else-if="step === 'mfa'" class="mt-8 space-y-5 text-center">
        <div><h2 class="text-lg font-semibold">绑定身份验证器</h2><p class="mt-2 text-sm leading-6 text-slate-500">使用身份验证器扫描二维码，再输入当前 6 位验证码。二维码只在您的设备上生成。</p></div>
        <img :src="qrDataUrl" alt="TOTP 二维码" class="mx-auto size-64 rounded-2xl border border-slate-100 bg-white p-2" />
        <UFormField label="动态验证码"><UInput v-model="otp" inputmode="numeric" maxlength="6" size="xl" class="w-full" /></UFormField>
        <button type="button" class="w-full rounded-lg bg-[var(--ui-primary)] px-6 py-3.5 text-lg font-medium text-white" @click="confirmMfa">确认绑定</button>
      </div>

      <div v-else-if="step === 'recovery'" class="mt-8 space-y-5">
        <UAlert color="warning" variant="soft" title="请立即保存恢复码" description="每个恢复码只能使用一次，离开本页后平台无法再次展示。请存放在安全位置，不要发送给管理员。" />
        <div class="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-4 font-mono text-sm"><code v-for="code in recoveryCodes" :key="code">{{ code }}</code></div>
        <button type="button" class="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" @click="copyRecoveryCodes"><UIcon name="i-lucide-copy" class="size-4" />复制恢复码</button>
        <button type="button" class="w-full rounded-lg bg-[var(--ui-primary)] px-6 py-3.5 text-lg font-medium text-white" @click="finishRecovery">我已安全保存</button>
      </div>

      <div v-else class="mt-8 space-y-5 text-center">
        <span class="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-emerald-700"><UIcon name="i-lucide-check" class="size-8" /></span>
        <div><h2 class="text-xl font-semibold">账号激活成功</h2><p class="mt-2 text-sm text-slate-500">现在可以使用手机号和新密码登录。</p></div>
        <NuxtLink to="/login" class="inline-block w-full rounded-lg bg-[var(--ui-primary)] px-6 py-3.5 text-center text-lg font-medium text-white">前往登录</NuxtLink>
      </div>
      <UAlert v-if="errorMessage" class="mt-5" color="error" variant="soft" :description="errorMessage" />
    </section>
  </main>
</template>

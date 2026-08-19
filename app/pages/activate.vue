<script setup lang="ts">
definePageMeta({ layout: false })
const route = useRoute()
const token = ref(typeof route.query.token === 'string' ? route.query.token : '')
const account = ref<any>(null)
const loading = ref(false)
const errorMessage = ref('')
const step = ref<'token' | 'password' | 'done'>('token')
const password = ref('')
const passwordConfirm = ref('')

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
    await $fetch('/api/v1/auth/activate', {
      method: 'POST', body: { token: token.value.trim(), password: password.value }
    })
    step.value = 'done'
  } catch (error: any) { errorMessage.value = error?.data?.message || '账号激活失败' }
  finally { loading.value = false }
}

onMounted(() => { if (token.value) validateToken() })
</script>

<template>
  <main class="grid min-h-[100dvh] place-items-center bg-[#f8faf6] p-5">
    <section class="panel w-full max-w-lg p-6 sm:p-9">
      <div class="flex items-center gap-3"><span class="grid size-11 place-items-center rounded-2xl bg-emerald-800 text-white">六</span><div><div class="flex items-center gap-2"><h1 class="text-xl font-semibold">账号激活</h1><span class="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium tracking-wide text-emerald-700">v1.0.0</span></div><p class="text-sm text-slate-500">一次性链接有效期为 72 小时</p></div></div>

      <div v-if="step === 'token'" class="mt-8 space-y-5">
        <UFormField label="激活码"><UInput v-model="token" size="xl" class="w-full" autocomplete="one-time-code" /></UFormField>
        <button type="button" class="w-full rounded-lg bg-[var(--ui-primary)] px-6 py-3.5 text-lg font-medium text-white" @click="validateToken">验证邀请</button>
      </div>

      <form v-else-if="step === 'password'" class="mt-8 space-y-5" @submit.prevent="setPassword">
        <UAlert color="primary" variant="soft" :title="account?.name" :description="`${account?.phone} · ${account?.role === 'psychologist' ? '心理专员' : '教师'}`" />
        <UFormField label="设置密码" help="至少 10 位，建议混合字母、数字和符号"><UInput v-model="password" type="password" minlength="10" autocomplete="new-password" size="xl" class="w-full" /></UFormField>
        <UFormField label="确认密码"><UInput v-model="passwordConfirm" type="password" minlength="10" autocomplete="new-password" size="xl" class="w-full" /></UFormField>
        <button type="submit" class="w-full rounded-lg bg-[var(--ui-primary)] px-6 py-3.5 text-lg font-medium text-white">激活账号</button>
      </form>

      <div v-else class="mt-8 space-y-5 text-center">
        <span class="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-emerald-700"><UIcon name="i-lucide-check" class="size-8" /></span>
        <div><h2 class="text-xl font-semibold">账号激活成功</h2><p class="mt-2 text-sm text-slate-500">现在可以使用手机号和新密码登录。</p></div>
        <NuxtLink to="/login" class="inline-block w-full rounded-lg bg-[var(--ui-primary)] px-6 py-3.5 text-center text-lg font-medium text-white">前往登录</NuxtLink>
      </div>
      <UAlert v-if="errorMessage" class="mt-5" color="error" variant="soft" :description="errorMessage" />
    </section>
  </main>
</template>
<script setup lang="ts">
definePageMeta({ layout: false })
const config = useRuntimeConfig()
const showDemoLogin = config.public.showDemoLogin
const form = reactive({ email: showDemoLogin ? 'teacher@demo.local' : '', password: showDemoLogin ? 'Mentor@2026' : '', otp: '', recoveryCode: '' })
const pending = ref(false)
const hydrated = ref(false)
const errorMessage = ref('')
const needOtp = ref(false)
const useRecoveryCode = ref(false)

const demoAccounts = [
  { label: '李老师（教师）', value: 'teacher@demo.local' },
  { label: '张老师（教师）', value: 'teacher.zhang@demo.local' },
  { label: '王心理专员', value: 'psychologist@demo.local' },
  { label: '学校管理员', value: 'school.admin@demo.local' },
  { label: '平台管理员', value: 'platform.admin@demo.local' },
]
const selectedDemo = ref(demoAccounts[0]!.value)

function onDemoSelect(email: string) {
  form.email = email
  form.password = 'Mentor@2026'
}

onMounted(() => { hydrated.value = true })


async function login() {
  pending.value = true
  errorMessage.value = ''
  try {
    const result = await $fetch<{ role: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: form.email,
        password: form.password,
        ...(useRecoveryCode.value && form.recoveryCode.trim() ? { recoveryCode: form.recoveryCode.trim().toUpperCase() } : {}),
        ...(!useRecoveryCode.value && form.otp.trim() ? { otp: form.otp.trim() } : {})
      }
    })
    const { refresh } = useAuth()
    await refresh()
    const homes: Record<string, string> = { teacher: '/', psychologist: '/specialist', school_admin: '/school-admin', platform_admin: '/platform-admin' }
    await navigateTo(homes[result.role] || '/')
  } catch (error: any) {
    if (error?.statusCode === 428 || error?.data?.data?.code === 'MFA_REQUIRED') needOtp.value = true
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
        <span class="grid size-12 place-items-center rounded-2xl bg-emerald-300 text-xl font-bold text-emerald-950">六</span>
        <div><strong class="text-lg">教师赋能智能平台</strong><p class="text-sm text-emerald-100/70">让每一次求助，都得到可行动的回应</p></div>
      </div>
      <div class="relative max-w-xl">
        <p class="mb-6 text-sm font-semibold uppercase tracking-[.3em] text-emerald-200">Teacher Empowerment</p>
        <h1 class="text-5xl font-semibold leading-tight">理解教师的语言，<br>守住每一次安全边界。</h1>
        <p class="mt-6 max-w-lg text-lg leading-8 text-emerald-50/70">统一智能体入口连接自我成长、班级建设、家校沟通与学生个体支持。确定性规则负责判断，AI 负责让专业方案更容易使用。</p>
      </div>
      <div class="relative grid grid-cols-3 gap-3 text-sm">
        <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><strong class="block text-2xl">4</strong><span class="text-emerald-100/60">专业模块</span></div>
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
          <UFormField label="邮箱"><UInput v-model="form.email" size="xl" icon="i-lucide-mail" class="w-full" /></UFormField>
          <UFormField label="密码"><UInput v-model="form.password" type="password" size="xl" icon="i-lucide-lock-keyhole" class="w-full" /></UFormField>
          <UFormField v-if="needOtp && !useRecoveryCode" label="心理专员动态验证码" help="请输入身份验证器中的 6 位验证码"><UInput v-model="form.otp" inputmode="numeric" maxlength="6" size="xl" icon="i-lucide-shield-check" class="w-full" /></UFormField>
          <UFormField v-if="needOtp && useRecoveryCode" label="一次性恢复码" help="恢复码使用后立即失效"><UInput v-model="form.recoveryCode" maxlength="13" size="xl" icon="i-lucide-key-round" class="w-full" placeholder="XXXXXX-XXXXXX" /></UFormField>
          <button v-if="needOtp" type="button" class="text-sm text-emerald-700 hover:underline" @click="useRecoveryCode = !useRecoveryCode">{{ useRecoveryCode ? '使用动态验证码' : '无法使用验证器？改用恢复码' }}</button>
          <UAlert v-if="errorMessage" color="error" variant="soft" :description="errorMessage" />
          <UButton type="submit" block size="xl" color="primary" :loading="pending" :disabled="!hydrated">安全登录</UButton>
        </form>
        <p class="mt-5 text-center text-sm text-slate-500">收到学校邀请？<NuxtLink class="font-medium text-emerald-700 hover:underline" to="/activate">激活账号</NuxtLink></p>
        <div v-if="showDemoLogin" class="mt-8 rounded-2xl bg-slate-100/80 p-4 text-xs leading-6 text-slate-500">
          演示账号：teacher@demo.local、school.admin@demo.local、platform.admin@demo.local；统一密码 Mentor@2026。
        </div>
        <p class="mt-6 text-xs leading-5 text-slate-400">登录即表示您已阅读校方隐私告知：学校管理员仅可在填写事由、获得短时只读授权并完整审计的前提下履行校内管理职责；平台管理员须另经学校审批。</p>
      </div>
    </section>
  </div>
</template>

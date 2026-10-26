<script setup lang="ts">
definePageMeta({ layout: false })
const route = useRoute()
const type = computed(() => route.params.type === 'privacy' ? 'privacy' : 'service')
const title = computed(() => type.value === 'privacy' ? '隐私政策' : '服务协议')
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-12">
    <NuxtLink to="/cend/login" class="text-sm text-emerald-700 hover:underline">← 返回登录</NuxtLink>
    <h1 class="mt-6 text-2xl font-semibold text-slate-800">{{ title }}</h1>
    <div class="mt-6 space-y-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-6 text-sm leading-7 text-slate-700">
      <p class="font-medium text-amber-900">当前为测试环境占位文本，正式版本以法务审核后的《{{ title }}》为准。</p>
      <p v-if="type === 'service'">
        本协议约定班主任智能体 C 端服务的使用规则、账号与积分规则、会员服务、内容边界与责任限制。正式上线前将补充完整条款。
      </p>
      <p v-else>
        本政策说明班主任智能体 C 端收集的手机号、教学资料、对话与积分记录的使用目的、保存期限、共享范围和用户权利。正式上线前将补充完整条款。
      </p>
      <p>如对协议或个人信息处理有疑问，请通过平台运营老师联系。</p>
    </div>
  </div>
</template>

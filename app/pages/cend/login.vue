<script setup lang="ts">
// C 端登录已合并到统一登录页（学校账户 / 个人账户切换）；保留此路径做兼容跳转。
definePageMeta({ layout: false })
await navigateTo({ path: '/login', query: { account: 'personal' } }, { replace: true })
</script>

<template>
  <div />
</template>

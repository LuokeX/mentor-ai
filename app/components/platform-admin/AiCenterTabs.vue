<script setup lang="ts">
const route = useRoute()
// 子分区高亮：以 path 前缀匹配（ai-center 下任意子页面都保持当前 tab 高亮）
const tabs = [
  { label: '概览', to: '/platform-admin/ai-center', icon: 'i-lucide-layout-dashboard' },
  { label: '提示词库', to: '/platform-admin/ai-center/prompts', icon: 'i-lucide-braces' },
  { label: '模型与服务', to: '/platform-admin/ai-center/runtime', icon: 'i-lucide-server-cog' },
  { label: '调用审计', to: '/platform-admin/ai-center/model-calls', icon: 'i-lucide-activity' },
]
function isActive(item: { to: string }) {
  return route.path === item.to || (item.to !== '/platform-admin/ai-center' && route.path.startsWith(item.to))
}
</script>

<template>
  <nav class="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-sm">
    <UButton
      v-for="item in tabs"
      :key="item.to"
      :to="item.to"
      :icon="item.icon"
      :variant="isActive(item) ? 'soft' : 'ghost'"
      :color="isActive(item) ? 'primary' : 'neutral'"
      size="sm"
      class="shrink-0"
    >
      {{ item.label }}
    </UButton>
  </nav>
</template>
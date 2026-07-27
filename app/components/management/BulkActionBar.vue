<script setup lang="ts">
defineProps<{
  selectedCount: number
  canArchive?: boolean
  canRestore?: boolean
}>()
const emit = defineEmits<{
  archive: []
  restore: []
  clear: []
}>()
</script>

<template>
  <div v-if="selectedCount > 0" class="flex items-center gap-2 px-3 py-2 bg-primary-50 border border-primary-200 rounded-lg">
    <span class="text-sm font-medium text-primary-700">已选 {{ selectedCount }} 项</span>
    <UButton v-if="canArchive" size="xs" variant="outline" @click="emit('archive')">批量归档</UButton>
    <UButton v-if="canRestore" size="xs" variant="outline" @click="emit('restore')">批量恢复</UButton>
    <UButton size="xs" variant="ghost" @click="emit('clear')">取消选择</UButton>
  </div>
</template>
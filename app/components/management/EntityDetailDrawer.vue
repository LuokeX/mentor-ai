<script setup lang="ts">
defineProps<{
  open: boolean
  title: string
  loading?: boolean
}>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <USlideover :open="open" @close="emit('close')">
    <template #header>
      <h2 class="text-lg font-semibold">{{ title }}</h2>
    </template>
    <div class="p-4">
      <slot v-if="!loading" />
      <div v-else class="flex items-center justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="animate-spin text-gray-400" />
      </div>
    </div>
  </USlideover>
</template>
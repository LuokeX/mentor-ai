<script setup lang="ts">
defineProps<{
  open: boolean
  title: string
}>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <USlideover :open="open" @close="emit('close')">
    <template #header>
      <h2 class="text-lg font-semibold">{{ title }}</h2>
    </template>
    <div class="p-4">
      <slot />
    </div>
  </USlideover>
</template>
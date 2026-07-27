<script setup lang="ts">
defineProps<{
  open: boolean
  title: string
}>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <USlideover :open="open" @update:open="value => { if (!value) emit('close') }">
    <template #header>
      <h2 class="text-lg font-semibold">{{ title }}</h2>
    </template>
    <template #body>
      <slot />
    </template>
  </USlideover>
</template>

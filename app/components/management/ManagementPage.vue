<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  createLabel?: string
  canCreate?: boolean
}>()
const emit = defineEmits<{ create: [] }>()
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div>
        <h1 class="text-xl font-semibold text-gray-900">{{ title }}</h1>
        <p v-if="description" class="mt-1 text-sm text-gray-500">{{ description }}</p>
      </div>
      <UButton
        v-if="canCreate && createLabel"
        icon="i-lucide-plus"
        color="primary"
        size="sm"
        @click="emit('create')"
      >
        {{ createLabel }}
      </UButton>
    </div>
    <slot />
  </div>
</template>
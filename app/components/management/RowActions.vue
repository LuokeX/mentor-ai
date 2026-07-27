<script setup lang="ts">
import type { Capability } from '~~/shared/management'

defineProps<{
  capabilities: Capability[]
  rowId: string
}>()
const emit = defineEmits<{
  view: [id: string]
  edit: [id: string]
  archive: [id: string]
  restore: [id: string]
  transfer: [id: string]
}>()
</script>

<template>
  <div class="flex items-center gap-1">
    <UTooltip v-if="capabilities.includes('view')" text="查看详情">
      <UButton icon="i-lucide-eye" variant="ghost" size="xs" @click="emit('view', rowId)" />
    </UTooltip>
    <UTooltip v-if="capabilities.includes('edit') || capabilities.includes('inline_edit')" text="编辑">
      <UButton icon="i-lucide-pencil" variant="ghost" size="xs" @click="emit('edit', rowId)" />
    </UTooltip>
    <UTooltip v-if="capabilities.includes('archive')" text="归档">
      <UButton icon="i-lucide-archive" variant="ghost" size="xs" @click="emit('archive', rowId)" />
    </UTooltip>
    <UTooltip v-if="capabilities.includes('restore')" text="恢复">
      <UButton icon="i-lucide-rotate-ccw" variant="ghost" size="xs" @click="emit('restore', rowId)" />
    </UTooltip>
    <UTooltip v-if="capabilities.includes('transfer')" text="移交">
      <UButton icon="i-lucide-user-switch" variant="ghost" size="xs" @click="emit('transfer', rowId)" />
    </UTooltip>
  </div>
</template>
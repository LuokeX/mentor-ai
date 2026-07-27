<script setup lang="ts">
const props = defineProps<{
  searchValue?: string
  searchPlaceholder?: string
  statusFilter?: string
  statusOptions?: Array<{ label: string; value: string }>
  loading?: boolean
}>()
const emit = defineEmits<{
  search: [value: string]
  'update:statusFilter': [value: string]
  refresh: []
}>()

const searchDraft = ref(props.searchValue || '')
watch(() => props.searchValue, value => {
  if (value !== searchDraft.value) searchDraft.value = value || ''
})
</script>

<template>
  <div class="flex flex-col sm:flex-row sm:items-center gap-3">
    <UInput
      v-model="searchDraft"
      :placeholder="searchPlaceholder || '搜索...'"
      icon="i-lucide-search"
      size="sm"
      class="w-full sm:w-64"
      @update:model-value="(v: string) => emit('search', v)"
    />
    <USelect
      v-if="statusOptions"
      :model-value="statusFilter"
      :items="statusOptions"
      size="sm"
      class="w-32"
      @update:model-value="(v: string) => emit('update:statusFilter', v)"
    />
    <div class="flex-1" />
    <UButton
      icon="i-lucide-refresh-cw"
      variant="ghost"
      size="sm"
      :loading="loading"
      @click="emit('refresh')"
    >
      刷新
    </UButton>
  </div>
</template>

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
      size="md"
      class="w-full sm:w-72"
      @update:model-value="(v: string) => emit('search', v)"
    />
    <!-- 额外筛选（如「学校」下拉），由页面按需注入；排在状态筛选之前，与需求图顺序一致 -->
    <slot name="filters" />
    <USelect
      v-if="statusOptions"
      :model-value="statusFilter"
      :items="statusOptions"
      size="md"
      class="w-36"
      @update:model-value="(v: string) => emit('update:statusFilter', v)"
    />
    <div class="flex-1" />
    <UButton
      icon="i-lucide-refresh-cw"
      variant="ghost"
      size="md"
      :loading="loading"
      @click="emit('refresh')"
    >
      刷新
    </UButton>
  </div>
</template>

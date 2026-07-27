<script setup lang="ts">
import { ALLOWED_PAGE_SIZES } from '~~/shared/management'

const props = defineProps<{
  page: number
  pageSize: number
  total: number
}>()
const emit = defineEmits<{
  'update:page': [page: number]
  'update:pageSize': [size: number]
}>()

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))

const sizeOptions = ALLOWED_PAGE_SIZES.map((s) => ({ label: `${s} 条/页`, value: s }))
</script>

<template>
  <div class="flex items-center justify-between pt-2">
    <div class="text-sm text-gray-500">共 {{ total }} 条</div>
    <div class="flex items-center gap-3">
      <USelect
        :model-value="(pageSize as any)"
        :items="sizeOptions"
        size="xs"
        class="w-28"
        @update:model-value="(v: number) => emit('update:pageSize', v)"
      />
      <UPagination
        :model-value="page"
        :total="total"
        :page-size="(pageSize as any)"
        size="xs"
        @update:model-value="(v: number) => emit('update:page', v)"
      />
    </div>
  </div>
</template>
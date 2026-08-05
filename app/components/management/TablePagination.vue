<script setup lang="ts">
import { ALLOWED_PAGE_SIZES } from '~~/shared/management'

const props = defineProps<{
  page: number
  pageSize: 20 | 50 | 100
  total: number
}>()
const emit = defineEmits<{
  'update:page': [page: number]
  'update:pageSize': [size: 20 | 50 | 100]
}>()

const sizeOptions = ALLOWED_PAGE_SIZES.map((s) => ({ label: `${s} 条/页`, value: s }))
</script>

<template>
  <div class="flex items-center justify-between pt-2">
    <div class="text-base text-gray-500">共 {{ total }} 条</div>
    <div class="flex items-center gap-3">
      <USelect
        :model-value="pageSize"
        :items="sizeOptions"
        size="sm"
        class="w-32"
        @update:model-value="(v: 20 | 50 | 100) => emit('update:pageSize', v)"
      />
      <UPagination
        :page="page"
        :total="total"
        :items-per-page="pageSize"
        size="sm"
        @update:page="(v: number) => emit('update:page', v)"
      />
    </div>
  </div>
</template>
